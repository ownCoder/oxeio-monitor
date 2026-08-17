using System.Diagnostics;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Apps;
using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Agent.Platform.Capture;
using oXeio.Agent.Security;
using oXeio.Agent.Storage;
using oXeio.Agent.Sync;
using oXeio.Agent.Ui;
using oXeio.Core.Agent;
using oXeio.Core.Capture;
using oXeio.Core.Models;
using oXeio.Core.Time;
using oXeio.Core.Tracking;

namespace oXeio.Agent;

/// <summary>
/// পূর্ণ এজেন্ট — সব মডিউল এখানে জোড়া লাগে।
///
/// <b>থ্রেডের ভাগ:</b>
/// <list type="bullet">
/// <item>UI থ্রেড — tray আইকন ও উইন্ডো মেসেজ (lock, power)। কখনো ব্লক করা হয় না।</item>
/// <item>ট্র্যাকার থ্রেড — প্রতি সেকেন্ডে idle পড়া। ছোট, দ্রুত, কোনো I/O নেই।</item>
/// <item>ব্যাকগ্রাউন্ড টাস্ক — ক্যাপচার, সিঙ্ক, heartbeat, অ্যাপ-ব্যবহার। ধীর কাজ শুধু এখানে।</item>
/// </list>
///
/// ⚠️ <b>ট্র্যাকিং কখনো নেটওয়ার্ক বা ডিস্কের জন্য থামে না।</b> সার্ভার বন্ধ
/// থাকলে, ডিস্ক ভরে গেলে বা enrollment ব্যর্থ হলেও সেকেন্ডের হিসাব চলতেই
/// থাকে — শুধু পাঠানো আটকে থাকে। উল্টোটা হলে একটা নেটওয়ার্ক সমস্যা সরাসরি
/// কারো বেতন কমিয়ে দিত।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class AgentHost : IAsyncDisposable
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan SyncEvery = TimeSpan.FromSeconds(30);

    /// <summary>
    /// A05 — কিউয়ের ডিস্ক-বাজেট কত ঘন ঘন প্রয়োগ হবে।
    ///
    /// ⚠️ প্রতি সিঙ্ক-চক্রে (৩০ সে.) নয়: জরিপটা পুরো টেবিল স্ক্যান করে,
    /// আর কিউ বড় হলে সেটা অকারণে ডিস্ক ঘোরাত। ঘণ্টায় একবারই যথেষ্ট —
    /// দিনে ~১৭০ MB জমে, আর ক্যাপ ২ GiB। ⭐ তবে লেখা ব্যর্থ হলে
    /// অপেক্ষা করা হয় না (`LastWriteError`)।
    /// </summary>
    private static readonly TimeSpan BudgetSweepEvery = TimeSpan.FromHours(1);
    /// <summary>
    /// heartbeat-এর ব্যবধান সার্ভারের কনফিগ থেকে (<c>heartbeatSec</c>), তবে
    /// সীমার ভেতরে।
    ///
    /// ⚠️ ছাদ-মেঝে দুটোই দরকার: কেউ ভুল করে ১ সেকেন্ড বসালে ১৫টা PC মিলে
    /// দিনে ১৩ লক্ষ রিকোয়েস্ট পাঠাত, আর ১ দিন বসালে G01 ("এজেন্ট ১০ মিনিট
    /// চুপ") প্রতিটা মেশিনের জন্য চিরকাল জ্বলে থাকত।
    /// </summary>
    private static readonly TimeSpan HeartbeatMin = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan HeartbeatMax = TimeSpan.FromMinutes(5);

    /// <summary>
    /// বন্ধ হওয়ার সময় <c>agent_stop</c> ডিস্কে লিখতে সর্বোচ্চ যতক্ষণ অপেক্ষা।
    /// ⚠️ Windows-এর পুরো শাটডাউন বাজেট কয়েক সেকেন্ড, আর তার পরেও শেষ
    /// drain-এর জন্য সময় রাখতে হয়।
    /// </summary>
    private static readonly TimeSpan StopEnqueueBudget = TimeSpan.FromSeconds(2);

    /// <summary>
    /// বন্ধ হওয়ার আগে শেষ drain-এ সর্বোচ্চ যতক্ষণ।
    /// ⚠️ <c>Program.ShutdownBudget</c>-এর (৪ সে.) ভেতরে থাকতে হবে — এর
    /// চেয়ে বড় দিলে drain কখনো নিজে থামত না, বাইরে থেকে প্রসেস মারা পড়ত।
    /// </summary>
    private static readonly TimeSpan FinalDrainBudget = TimeSpan.FromSeconds(3);

    private readonly AgentSettings _settings;
    private readonly string _version;
    private readonly ISyncLog _log;

    private readonly MonotonicClock _clock = MonotonicClock.StartNow();
    private readonly IdleProbe _idle = new();
    private readonly SleepGapDetector _sleep = new(Tick);
    private readonly CancellationTokenSource _stopping = new();

    private LivenessBeacon? _beacon;
    private SqliteOutboxStore? _outbox;
    private HttpSyncClient? _sync;
    private SyncWorker? _worker;
    private DeviceCredentials? _credentials;
    private TrayIcon? _tray;
    private IdleStateMachine? _machine;
    private ScreenCaptureService? _capture;
    private SlotScheduler? _slots;
    private AppUsageService? _apps;
    private UpdateStager? _updates;
    private CaptureWindow _window = CaptureWindow.Default;

    /// <summary>tray-তে কয়টা ৫-মিনিটের ঘর দেখানো হবে — অর্থাৎ শেষ ~৩০ মিনিট।</summary>
    private const int BusyBlocks = 6;

    /// <summary>
    /// ⚠️ ট্র্যাকিং লুপ লেখে, UI থ্রেড পড়ে — তাই তালা। <c>Queue</c> নিজে
    /// থ্রেড-নিরাপদ নয়, আর এখানে দৌড় হলে জানালা আঁকতে গিয়ে ব্যতিক্রম উঠত।
    /// </summary>
    private readonly Queue<int> _recentBusy = new(BusyBlocks);
    private readonly object _busyGate = new();

    /// <summary>
    /// এখন যে কনফিগে চলছে। ⚠️ শুরুতে <see cref="AgentConfig.Default"/> —
    /// সার্ভারের কনফিগ আসার আগে ট্র্যাকিং থামানো যাবে না।
    /// </summary>
    private AgentConfig _config = AgentConfig.Default;

    /// <summary>
    /// সার্ভার থেকে আনা, কিন্তু এখনো প্রয়োগ হয়নি। heartbeat থ্রেড লেখে,
    /// <see cref="TrackLoop"/> <c>Interlocked.Exchange</c> দিয়ে তুলে নেয়।
    /// </summary>
    private PendingConfig? _pendingConfig;

    /// <summary>শেষ কবে বাজেট প্রয়োগ হয়েছে — শুধু সিঙ্ক লুপ ছোঁয়।</summary>
    private DateTimeOffset _lastBudgetSweep = DateTimeOffset.MinValue;

    private volatile bool _sessionSuspended;
    private long _activeTodaySec;

    /// <summary>H06 — বাতিল হওয়ার কথা একবারই লগে যায়, প্রতি স্লটে নয়।</summary>
    private bool _revokeLogged;

    /// <summary>H06 — বাতিলের পর ট্র্যাকিং একবার গুটিয়ে নেওয়া হয়েছে কি না।</summary>
    private bool _trackingStoppedForRevoke;

    /// <summary>শেষ তোলা ছবির থাম্বনেইল — জানালায় দেখানোর জন্য।</summary>
    private string? _latestShotThumb;
    private DateTimeOffset? _latestShotAt;
    private int _latestShotMonitors;
    private DateOnly _activeDate;
    private EmployeeProgress? _progress;
    private string? _configVersion;
    private MilestoneMemory? _milestone;

    /// <summary>
    /// G02 — কোন "বিদায়ী" ইভেন্ট ইতিমধ্যে কিউতে গেছে।
    ///
    /// ⚠️ ডিডুপটা বাধ্যতামূলক: একটা logoff-এ Windows <b>দুবার</b> খবর দেয় —
    /// একবার <c>WM_WTSSESSION_CHANGE</c>-এ, আরেকবার <c>WM_ENDSESSION</c>-এ।
    /// দুটোই পাঠালে সার্ভারে একই ঘটনার দুটো সারি বসত, আর <c>agent_events</c>
    /// হলো ঘটনার লগ — সেখানে দুবার লেখা মানে ঘটনাটা দুবার ঘটেছে।
    /// </summary>
    private readonly HashSet<string> _closingEventsSent = new(StringComparer.Ordinal);

    public AgentHost(AgentSettings settings, string version, ISyncLog? log = null)
    {
        _settings = settings;
        _version = version;
        _log = log ?? NullSyncLog.Instance;
        _activeDate = DhakaTime.WorkDateOf(DateTimeOffset.UtcNow);
    }

    public TrayIcon? Tray => _tray;

    /// <summary>
    /// UI থ্রেড থেকে ডাকতে হবে — tray আইকন এখানেই তৈরি হয়।
    /// ⚠️ ব্যর্থ হলে <c>false</c>, ব্যতিক্রম নয়: চালু হতে না পারার কারণটা
    /// স্টাফকে দেখাতে হবে, স্ট্যাক ট্রেস নয়।
    /// </summary>
    public bool TryStart(nint messageWindowHandle, out string? error)
    {
        error = null;

        var guard = SessionGuard.Check();
        if (!guard.CanTrack)
        {
            error = $"Time cannot be counted in this session — {guard.Explanation}";
            return false;
        }

        if (!AgentDataDirectory.TryEnsure(AgentDataDirectory.Default, out var dirError))
        {
            error = $"Could not create the data folder: {dirError}";
            return false;
        }

        // ⭐ লক আগে — অন্য কোনো এজেন্ট চললে এখানেই থেমে যেতে হবে।
        //    দুটো এজেন্ট এক মেশিনে চললে একই ঘণ্টা দুবার গোনা হতো, আর
        //    সার্ভারের দিক থেকে সেটা শুধু "খুব বেশি কাজ" দেখাত।
        _beacon = LivenessBeacon.TryAcquire(AgentDataDirectory.Default);
        if (_beacon is null)
        {
            error = "An oXeio agent is already running on this PC.";
            return false;
        }

        _beacon.Start();

        // ── পরিচয় ও টোকেন ──────────────────────────────────────────────────
        var identity = MachineIdentity.Collect();
        var tokenStore = new DeviceTokenStore(log: _log.Info);
        _credentials = DeviceCredentials.Open(tokenStore, identity, _log.Info);

        // ── সার্ভারের সাথে কথা ─────────────────────────────────────────────
        _sync = new HttpSyncClient(
            new SyncClientOptions
            {
                BaseAddress = _settings.ApiRoot,
                AgentVersion = _version,
                // I01 — পিন বসানো থাকলে TLS যাচাই আমরাই করি
                ServerPin = _settings.ServerPin,
            },
            log: _log);
        _credentials.ApplyTo(_sync);
        _credentials.Changed += c => c.ApplyTo(_sync);

        // H04 — নতুন ভার্সন নামানো ও যাচাই। ⚠️ বসানো **হয় না** —
        //    কারণ UpdateStage-এ লেখা (G58)。
        // (কিউ খোলার পরে paths পাওয়া যাবে, তাই নিচে বসানো হয়)

        // ── অফলাইন কিউ ─────────────────────────────────────────────────────
        // ⚠️ কিউ খুলতে না পারলেও এজেন্ট চলে। সময় গোনা বন্ধ হয় না; শুধু
        //    পাঠানো যায় না, আর সেটা tray-তে লাল হয়ে দেখা যায়।
        try
        {
            _outbox = SqliteOutboxStore.Open(log: _log.Info);
            _worker = new SyncWorker(_outbox, _sync, _log);
            _updates = new UpdateStager(_sync, _outbox.Paths, _version, _log);
        }
        catch (Exception ex)
        {
            _log.Error("Could not open the offline queue — no data will be stored", ex);
        }

        // ── ট্র্যাকিং ───────────────────────────────────────────────────────
        var lockState = LockStateProbe.Query();
        _machine = new IdleStateMachine(
            TimeSpan.FromSeconds(_config.IdleThresholdSec),
            _clock.Now,
            lockState == LockState.Locked ? SegmentState.Locked : SegmentState.Active);

        _capture = new ScreenCaptureService(
            new FallbackCapturer(new DuplicationCapturer(), new GdiCapturer()));
        _slots = new SlotScheduler(_config.SlotMinutes);
        _window = _config.ToCaptureWindow();

        // D01–D04। ⚠️ কনফিগে বন্ধ থাকলে অবজেক্টটাই তৈরি হয় না — তাহলে
        //    foreground উইন্ডোর নামও কখনো মেমোরিতে আসে না, শুধু "পাঠাচ্ছি না" নয়।
        if (_config.AppTracking.Enabled)
        {
            _apps = new AppUsageService(
                TimeSpan.FromSeconds(_config.AppTracking.MinDurationSec));
        }

        // ── tray ────────────────────────────────────────────────────────────
        // J03 — বেলুন কোন মাসে দেখানো হয়েছে তার স্মৃতি। ⚠️ এখানে একবারই তৈরি
        //    হয়, কারণ UpdateOptions-এ নতুন অবজেক্ট দিলে ক্যাশ হারিয়ে যেত।
        _milestone = new MilestoneMemory(AgentDataDirectory.Default);

        _tray = new TrayIcon(BuildTrayOptions());
        _tray.Publish(Snapshot());

        _ = messageWindowHandle; // সেশন/পাওয়ার রেজিস্ট্রেশন Program-এ

        StartLoops();
        return true;
    }

    private TrayOptions BuildTrayOptions() => new()
    {
        AgentVersion = _version,
        ServerUrl = _settings.ServerUrl,
        DeviceId = _credentials?.DeviceId,
        EmployeeName = _credentials?.Employee?.FullName,
        EmpCode = _credentials?.Employee?.EmpCode,
        StaffPortalUrl = _settings.StaffPortalUrl,
        PolicyUrl = _settings.PolicyUrl,
        RequestSyncNow = () => _ = SyncNowAsync(),
        RequestSignIn = () => _ = SignInOnDemandAsync(),
        RequestSignOut = () => _ = SignOutOnDemandAsync(),
        InstallUpdate = InstallStagedUpdate,
        Milestone = _milestone,
        OnError = ex => _log.Error("tray", ex),
    };

    // ── লুপগুলো ─────────────────────────────────────────────────────────────

    private void StartLoops()
    {
        var tracker = new Thread(TrackLoop)
        {
            IsBackground = true,
            Name = "oXeio-tracker",
            Priority = ThreadPriority.BelowNormal,
        };
        tracker.Start();

        _ = Task.Run(() => CaptureLoopAsync(_stopping.Token));
        _ = Task.Run(() => AppUsageLoopAsync(_stopping.Token));
        _ = Task.Run(() => SyncLoopAsync(_stopping.Token));
        _ = Task.Run(() => HeartbeatLoopAsync(_stopping.Token));
        _ = Task.Run(() => EnrollIfNeededAsync(_stopping.Token));
        _ = Task.Run(() => UpdateLoopAsync(_stopping.Token));
    }

    /// <summary>
    /// প্রতি সেকেন্ডের হিসাব। ⚠️ এখানে কোনো I/O নেই — সেগমেন্ট বন্ধ হলে
    /// শুধু কিউয়ে ফেলে দেওয়া হয়, লেখা হয় অন্য থ্রেডে।
    /// </summary>
    private void TrackLoop()
    {
        while (!_stopping.IsCancellationRequested)
        {
            try
            {
                var now = _clock.Now;
                var sample = _idle.Read();

                if (!sample.Valid)
                {
                    // ⚠️ ডিফল্ট বসানো হয় না — এই সেকেন্ডটা বাদ। ভুল সংখ্যা
                    //    বসানোর চেয়ে একটা সেকেন্ড হারানো ভালো।
                    Thread.Sleep(Tick);
                    continue;
                }

                // ⭐ নতুন কনফিগ এখানেই প্রয়োগ হয়, heartbeat থ্রেডে নয়।
                //    `_machine` ও `_apps` এই লুপের সম্পত্তি; অন্য থ্রেড থেকে
                //    বদলালে ঠিক সেই সেকেন্ডে একটা Tick পুরোনো অবজেক্টে আর
                //    পরেরটা নতুনটায় পড়ত, আর মাঝখানের সময়টা কোনো সেগমেন্টেই
                //    ঢুকত না — অর্থাৎ কনফিগ বদলানোর দিনে সবার কিছু ঘণ্টা হারাত।
                if (Interlocked.Exchange(ref _pendingConfig, null) is { } pending)
                {
                    ApplyConfig(pending.Config, pending.Version, now);
                }

                // ⭐ H06 — ডিভাইস বাতিল হলে ট্র্যাকিংও থামে, শুধু আপলোড নয়।
                //    আগে শুধু আপলোড থামত, তাই ছাঁটাই হওয়া কর্মীর PC-তে
                //    সেগমেন্ট ও অ্যাপ-ব্যবহার জমতেই থাকত।
                //
                // ⚠️⚠️ সাইন ইন না করা থাকলেও একই — গোনা শুরুর আগে জানা
                //    দরকার ঘণ্টাগুলো **কার**। নইলে ইনস্টল করে রেখে যাওয়া
                //    মেশিনে অ্যাডমিনের সময়টুকু আউটবক্সে জমত, আর স্টাফ সাইন
                //    ইন করামাত্র সেটা তার খাতায় গিয়ে বসত (TrackingGate)।
                var gate = TrackingGate.Check(
                    _credentials?.IsEnrolled == true,
                    _credentials?.IsRevoked == true);

                if (gate != TrackingGate.Verdict.Allowed)
                {
                    // ⚠️ শুধু revoke-এ খোলা সেগমেন্ট বন্ধ করার দরকার হয়।
                    //    সাইন ইনের আগে খোলা সেগমেন্ট থাকতেই পারে না।
                    if (gate == TrackingGate.Verdict.Revoked) StopTrackingForRevoke(now);

                    Thread.Sleep(Tick);
                    continue;
                }

                var gap = _sleep.Observe(
                    new SleepGapDetector.Sample(sample.BiasedMs, sample.UnbiasedMs, now));

                if (gap.Detected)
                {
                    Record(_machine!.OnSuspend(gap.SuspendedAt));
                    Record(_machine!.OnResume(gap.ResumedAt));
                }

                // ⭐⭐ G46 — ছাপ নেওয়া হয় **এখানে**, স্ক্রিনশটের স্লটে নয়।
                //    কারণ ও পরিণতি SampleScreen-এর ডকে।
                SampleScreen(now);

                // ⭐ G46 — পর্দা জমে থাকলে ইনপুট টাইমারকে আর বিশ্বাস করা হয় না
                Record(_machine!.Tick(
                    now, sample.SinceLastInput, _sessionSuspended,
                    screenFrozen: _screen.IsFrozen(now)));
            }
            catch (Exception ex)
            {
                // ⚠️ এই থ্রেড মরলে সময় গোনা চিরতরে বন্ধ — সবচেয়ে খারাপ ব্যর্থতা।
                _log.Error("Tracker tick failed — continuing", ex);
            }

            Thread.Sleep(Tick);
        }
    }

    private async Task CaptureLoopAsync(CancellationToken ct)
    {
        var next = _slots!.Next(DateTimeOffset.UtcNow);

        while (!ct.IsCancellationRequested)
        {
            var wait = next.FireAt - DateTimeOffset.UtcNow;
            if (wait > TimeSpan.Zero)
            {
                try { await Task.Delay(wait, ct); }
                catch (OperationCanceledException) { return; }
            }

            try
            {
                await CaptureSlotAsync(next, ct);
            }
            catch (Exception ex)
            {
                _log.Error("Capture slot failed", ex);
            }

            next = _slots.Next(DateTimeOffset.UtcNow);
        }
    }

    /**
     * ⭐⭐ <b>G46</b> — পর্দা সত্যিই বদলাচ্ছে কি না।
     *
     * ⚠️⚠️ নমুনা আসে <see cref="SampleScreen"/> থেকে, <b>স্ক্রিনশটের স্লট
     *    থেকে নয়</b> — আর এই আলাদা করাটাই এখানকার সবচেয়ে জরুরি সিদ্ধান্ত।
     *    আগে ছাপ আসত স্লট থেকে, আর স্লট চলত কেবল ACTIVE অবস্থায়; ফলে
     *    "জমেছে → IDLE → স্লট বন্ধ → নতুন ছাপ নেই → চিরকাল জমে আছে" —
     *    কর্মী ফিরে এসে কাজ করলেও এজেন্ট স্থায়ীভাবে idle দেখাত।
     *
     * ⚠️ ক্যাপচার বন্ধ থাকলে (রাতে, § ৪.২-এর জানালার বাইরে, বা লক করা
     *    পর্দায়) নমুনা আসে না, আর <see cref="ScreenActivity.StaleAfter"/>
     *    পেরোলে সন্দেহটা নিজে থেকেই উঠে যায়। "জানি না"-কে অভিযোগ ধরা হয় না।
     */
    private readonly ScreenActivity _screen = new();

    /// <summary>শেষ কবে ছাপ নেওয়ার চেষ্টা হয়েছিল — ব্যর্থ হলেও।</summary>
    private DateTimeOffset? _screenSampledAt;

    /// <summary>ছাপ বানানো ব্যর্থ হওয়ার কথা একবারই লগে যায়।</summary>
    private bool _screenSampleFailed;

    /**
     * ⭐⭐⭐ <b>G46 — পর্দার ছাপ নেওয়া।</b>
     *
     * ⚠️⚠️ এটা ইচ্ছাকৃতভাবে <b>ট্র্যাকিং টিকে</b>, ক্যাপচার স্লটে নয়। স্লটে
     * থাকলে ছাপের উৎসটা <see cref="CaptureGate"/>-এর ACTIVE শর্তের নিচে
     * পড়ত, আর তাতে একটা অচলাবস্থা তৈরি হতো — বিস্তারিত
     * <see cref="ScreenSampling"/>-এ।
     *
     * ⚠️ ব্যর্থ হলে চুপচাপ ফিরে আসা, কিন্তু <see cref="_screenSampledAt"/>
     * তবু বসানো হয় — নইলে ক্যাপচার ভাঙা মেশিনে প্রতি সেকেন্ডে চেষ্টা চলত।
     */
    private void SampleScreen(DateTimeOffset now)
    {
        if (_capture is null) return;

        if (!ScreenSampling.Allowed(
                _credentials?.IsEnrolled == true,
                _credentials?.IsRevoked == true,
                _window.Allows(now),
                _sessionSuspended))
            return;

        if (!ScreenSampling.Due(now, _screenSampledAt, _screen.IsFrozen(now))) return;

        _screenSampledAt = now;

        try
        {
            var frame = _capture.CapturePrimary();
            if (frame is null) return;

            var fingerprint = ScreenFingerprint.From(frame);
            if (fingerprint is not null) _screen.Observe(fingerprint, now);
        }
        catch (Exception ex)
        {
            /**
             * ⚠️ গোনা চালু রাখাই বড় কথা — ছাপ না পেলে StaleAfter সামলে নেবে।
             *
             * ⚠️⚠️ <b>একবারই লেখা হয়।</b> প্রতিবার লিখলে ভাঙা ক্যাপচারের
             * মেশিনে লগ ফাইল মিনিটে একটা করে সারি নিয়ে ফুলে উঠত, আর
             * H08-এর ঘূর্ণনে আসল ভুলগুলো মুছে যেত।
             */
            if (!_screenSampleFailed)
            {
                _screenSampleFailed = true;
                _log.Warn($"Screen fingerprint failed — jiggler detection is off on this PC: {ex.Message}");
            }
        }
    }

    private async Task CaptureSlotAsync(SlotScheduler.Slot slot, CancellationToken ct)
    {
        // A04 · A04b · H06 — শর্তগুলো সব CaptureGate-এ, কারণ guard clause
        // হিসেবে এখানে ছড়ানো থাকলে একটা অনুপস্থিত শর্তও কোনো টেস্ট ধরত না।
        var verdict = CaptureGate.Check(
            _machine!.State,
            _credentials?.IsEnrolled == true,
            _credentials?.IsRevoked == true,
            _window,
            slot.FireAt);

        if (verdict != CaptureGate.Verdict.Allowed)
        {
            // ⚠️ revoke হলে একবার জানানো হয় — নীরবে বন্ধ থাকা আর "কাজ
            //    করছে কিন্তু কিছু পাঠাচ্ছে না", দুটো পর্দায় এক দেখাত।
            if (verdict == CaptureGate.Verdict.Revoked && !_revokeLogged)
            {
                _revokeLogged = true;
                _log.Warn("Device revoked — no more screenshots will be taken on this PC.");
            }

            return;
        }

        if (_outbox is null) return;

        var results = _capture!.CaptureAll();

        // A07 — ছবির সাথে ওই মুহূর্তের অ্যাপ ও উইন্ডো টাইটেল।
        //
        // ⚠️ লুপের **বাইরে**, ইচ্ছাকৃতভাবে: ছবি প্রতি মনিটরে একটা, কিন্তু
        //    foreground উইন্ডো গোটা ডেস্কটপে একটাই। ভেতরে পড়লে দুই মনিটরের
        //    দুই সারিতে দু-রকম নাম বসতে পারত (মাঝপথে উইন্ডো বদলালে), অথচ
        //    ছবিগুলো একই মুহূর্তের।
        //
        // ⚠️ কনফিগে অ্যাপ ট্র্যাকিং বন্ধ থাকলে `_apps` তৈরিই হয় না, তাই
        //    নামটাও বসে না — "পাঠাচ্ছি না" নয়, জানাই হয় না (উপরে § ট্র্যাকিং)।
        var front = _apps?.Current;

        // জানালায় দেখানোর জন্য শেষ ছবির থাম্বনেইল — সবচেয়ে বাঁ দিকের পর্দাটা
        string? showThumb = null;
        var showIndex = int.MaxValue;

        foreach (var r in results)
        {
            // ⚠️ uuid আগে তৈরি — ফাইলের নাম আর সারির clientUuid এক হতে হবে,
            //    নইলে ফাইল আর মেটাডেটা জোড়া হারিয়ে ফেলত।
            var uuid = Guid.NewGuid();

            var path = _outbox.Paths.NewScreenshotPath(slot.SlotStart, r.MonitorIndex, uuid);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllBytesAsync(path, r.Webp, ct);

            // A06 — গ্রিডের জন্য ছোট ছবি। ⚠️ ব্যর্থ হলে চুপচাপ এগোনো:
            //    থাম্বনেইল না থাকলে গ্যালারি ফুল ছবি দেখাবে, কিন্তু
            //    থাম্বনেইলের জন্য আসল ছবিটা হারানো যাবে না।
            var thumb = WebpEncoder.EncodeThumb(r.Webp);
            if (thumb is not null)
            {
                try
                {
                    await File.WriteAllBytesAsync(OutboxPaths.ThumbPathFor(path), thumb, ct);

                    if (r.MonitorIndex < showIndex)
                    {
                        showIndex = r.MonitorIndex;
                        showThumb = OutboxPaths.ThumbPathFor(path);
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    _log.Warn($"Could not write the thumbnail — the full image will be sent: {ex.Message}");
                }
            }

            var meta = new ScreenshotRecord
            {
                ClientUuid = uuid,
                SlotStart = slot.SlotStart,
                CapturedAt = DateTimeOffset.UtcNow,
                MonitorIndex = r.MonitorIndex,
                Width = r.Width,
                Height = r.Height,
                ActiveApp = front?.ProcessName,
                ActiveTitle = front?.WindowTitle,
            };

            await _outbox.EnqueueAsync(
                OutboxCodec.Item(meta, path, r.Webp.LongLength, DateTimeOffset.UtcNow), ct);
        }

        KeepLatestShot(showThumb, results.Count);

        /*
         * H08 — ⭐ ক্যাপচারের **এক লাইন**, প্রতি স্লটে একটাই।
         *
         * ⚠️ এই লাইনটার অভাবেই ১১ আগস্ট রাতে ঘণ্টাখানেক নষ্ট হয়েছিল: একটা
         * স্লট বাদ গিয়েছিল, আর সেটা কেন — DXGI ব্যর্থ, নাকি জানালা বন্ধ,
         * নাকি ওই মুহূর্তে idle — জানার কোনো উপায় ছিল না। শেষে সেগমেন্টের
         * সময়ের সাথে মিলিয়ে অনুমান করতে হয়েছিল (§ ৩ঐ), আর প্রথম অনুমানটা
         * ভুলও ছিল।
         *
         * ⚠️ স্লট প্রতি একটাই লাইন, মনিটর প্রতি নয় — দিনে ২৮৮ লাইন, তিন
         * মনিটরে ৮৬৪ হতো। ৭ দিনের লগে ওটুকুই যথেষ্ট, আর তাতে বাকি লাইনগুলো
         * চাপা পড়ে না।
         */
        _log.Info(
            $"📸 slot {slot.SlotStart:HH:mm} · {results.Count} monitor(s)" +
            (front is null ? "" : $" · {front.ProcessName}"));
    }

    /// <summary>
    /// শেষ ছবিটা জানালায় দেখানোর জন্য <b>কপি</b> করে রাখা।
    ///
    /// ⚠️⚠️ কিউয়ের ফাইলটার দিকে শুধু আঙুল তুলে রাখা যায় না — আপলোড সফল
    /// হলে sync worker ছবি ও থাম্বনেইল দুটোই <b>মুছে ফেলে</b> (কয়েক সেকেন্ডের
    /// মধ্যেই)। তখন জানালা খুললে ছবির জায়গায় ফাঁকা থাকত, আর সেটা "ছবি ওঠেনি"
    /// বলে ভুল বার্তা দিত।
    ///
    /// থাম্বনেইলটাই কপি হয় (৪–১১ KB), পুরো ছবি নয় — জানালায় ওটুকুই দেখানো হয়,
    /// আর ১৫টা PC-তে রোজ ১৯২ বার পুরো ছবি কপি করার কোনো মানে নেই।
    /// </summary>
    private void KeepLatestShot(string? thumbPath, int monitors)
    {
        if (thumbPath is null || _outbox is null) return;

        try
        {
            Directory.CreateDirectory(_outbox.Paths.State);
            var target = Path.Combine(_outbox.Paths.State, "last-shot.webp");

            File.Copy(thumbPath, target, overwrite: true);

            _latestShotThumb = target;
            _latestShotAt = DateTimeOffset.UtcNow;
            _latestShotMonitors = monitors;

            PublishStatus();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // ⚠️ ছবি তোলা ও পাঠানোর চেয়ে দেখানোটা কম গুরুত্বপূর্ণ — এখানে
            //    ব্যর্থ হলে চুপচাপ এগোনো, ক্যাপচার যেন না ভাঙে।
            _log.Warn($"Could not keep the last thumbnail for the window: {ex.Message}");
        }
    }

    /// <summary>
    /// কোন অ্যাপ/সাইটে কত সময় (D01–D04)।
    ///
    /// ⚠️ <b>ট্র্যাকার থ্রেডে নয়, আলাদা লুপে।</b> address bar পড়তে UI Automation
    /// লাগে, আর সেটা ব্যস্ত অ্যাপে ৪০০ মি.সে. পর্যন্ত আটকে থাকতে পারে
    /// (<see cref="Apps.BrowserUrlReader"/>)। ওটা সেকেন্ড গোনার থ্রেডে বসালে
    /// idle মাপার টিক পিছিয়ে যেত — আর সেকেন্ডের হিসাবই এই সিস্টেমের মূল কাজ।
    ///
    /// এই লুপ ব্যর্থ হলে অ্যাপের হিসাব হারায়, সময়ের হিসাব নয়।
    /// </summary>
    private async Task AppUsageLoopAsync(CancellationToken ct)
    {
        if (_apps is null) return;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // ⚠️⚠️ এই গেটটা **আলাদা করে** লাগে। TrackLoop-এ বসানো গেট
                //    এই লুপটাকে থামায় না — দুটো আলাদা থ্রেড, আর এই লুপ
                //    নিজেই নিজের সারি কিউতে ফেলে।
                //
                // ⭐ মাপতে গিয়েই ধরা পড়েছে: TrackLoop ও CaptureGate গেট
                //    করার পরেও ৭ মিনিটে একটা সারি জমেছিল — `oXeio.Agent.exe`,
                //    ৩০০ সেকেন্ড। অর্থাৎ সাইন-ইন জানালাটা কতক্ষণ খোলা ছিল,
                //    সেটাই অ্যাপ-ব্যবহার হিসেবে জমা হচ্ছিল।
                if (TrackingGate.Allows(
                        _credentials?.IsEnrolled == true,
                        _credentials?.IsRevoked == true))
                {
                    RecordApps(_apps.Tick(_clock.Now, _machine?.State ?? SegmentState.Idle));
                }
            }
            catch (Exception ex)
            {
                _log.Error("App usage tick failed — continuing", ex);
            }

            try { await Task.Delay(Tick, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SyncLoopAsync(CancellationToken ct)
    {
        // A05 — চালু হওয়ার সাথে সাথেই একবার। ⚠️ এটাই সবচেয়ে জরুরি কলটা:
        //    এজেন্ট বন্ধ থাকা অবস্থায় (বা ক্র্যাশের পর) কিউ যতটা বেড়েছে
        //    সেটা এখানেই ধরা পড়ে, প্রথম আপলোডের আগে।
        //    (`_lastBudgetSweep` তখনো MinValue, তাই OutboxSweep একে
        //     Startup বলে চেনে।)
        await MaybeEnforceOutboxBudgetAsync(ct);

        while (!ct.IsCancellationRequested)
        {
            if (_worker is not null) await _worker.DrainOnceAsync(ct);

            await MaybeEnforceOutboxBudgetAsync(ct);

            PublishStatus();

            try { await Task.Delay(SyncEvery, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>
    /// A05 — কিউয়ের ডিস্ক-বাজেট প্রয়োগ।
    ///
    /// ⚠️⚠️ <see cref="SqliteOutboxStore.EnforceBudgetAsync"/>-এর ডকে চুক্তিটা
    /// লেখাই ছিল — <i>"সিঙ্ক ওয়ার্কার শুধু এটাই ডাকবে (স্টার্টআপে একবার,
    /// তারপর ঘণ্টায় একবার আর <c>LastWriteError</c> দেখা দিলেই সঙ্গে সঙ্গে)"</i>।
    /// <b>কলারটা কোনোদিন লেখা হয়নি।</b> ফলে ২ GiB-র ক্যাপ, ৭ দিনের বয়সসীমা,
    /// eviction-এর ক্রম — পুরো ব্যবস্থাটা তৈরি হয়ে অচল পড়ে ছিল, আর একটা
    /// PC সপ্তাহখানেক অফলাইন থাকলে কিউ বাড়তেই থাকত।
    ///
    /// ⭐ <c>LastWriteError</c>-এ সাথে সাথে চালানোটা কেন: ওই সময়েই ডিস্ক
    /// ভরে গেছে, অর্থাৎ ঠিক তখনই জায়গা খালি করা দরকার। ঘণ্টার অপেক্ষায়
    /// থাকলে মাঝের সময়টুকুর ডেটা নীরবে হারাত।
    /// </summary>
    private async Task MaybeEnforceOutboxBudgetAsync(CancellationToken ct)
    {
        if (_outbox is null) return;

        var reason = OutboxSweep.Check(
            _lastBudgetSweep, _clock.Now, BudgetSweepEvery,
            hasWriteError: _outbox.LastWriteError is not null);

        if (reason == OutboxSweep.Reason.No) return;

        await EnforceOutboxBudgetAsync(Describe(reason), ct);
    }

    private static string Describe(OutboxSweep.Reason reason) => reason switch
    {
        OutboxSweep.Reason.Startup => "startup",
        OutboxSweep.Reason.WriteFailed => "the outbox could not write",
        _ => "hourly",
    };

    private async Task EnforceOutboxBudgetAsync(string why, CancellationToken ct)
    {
        if (_outbox is null) return;

        _lastBudgetSweep = _clock.Now;

        try
        {
            var plan = await _outbox.EnforceBudgetAsync(OutboxBudget.Default, _clock.Now, ct);

            // ⚠️ কিছু বাদ পড়লে **সবসময়** লগে যায়। নীরবে ফেলে দিলে একটা
            //    মেশিন মাসের পর মাস ডেটা হারাত আর রিপোর্টে শুধু "ওর ঘণ্টা
            //    কম" দেখা যেত — সন্দেহটা পড়ত স্টাফের উপর, এজেন্টের উপর নয়।
            //    (বিস্তারিত সারি ধরে DropLog-এ যায়।)
            if (!plan.IsEmpty)
            {
                _log.Warn(
                    $"Outbox trimmed ({why}): {plan.ExpiredRowIds.Count} past the age limit, " +
                    $"{plan.OverBudgetRowIds.Count} over the disk budget");
            }
        }
        catch (Exception ex)
        {
            // ⚠️ ছাঁটাই ব্যর্থ হলে সিঙ্ক থামে না — ট্র্যাকিং তো নয়ই।
            _log.Error("Could not enforce the outbox budget", ex);
        }
    }

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (_credentials?.IsEnrolled == true && _sync is not null)
                {
                    var result = await _sync.HeartbeatAsync(new HeartbeatRequest
                    {
                        State = _machine!.State,
                        ActiveSecToday = (int)Math.Clamp(
                            Interlocked.Read(ref _activeTodaySec), 0, 86_400),
                        QueueDepth = _worker?.Depth.ForHeartbeat,
                        ConfigVersion = _configVersion,
                        AgentVersion = _version,
                    }, ct);

                    if (result.IsSuccess && result.Value is { } body)
                    {
                        if (body.Progress is not null) _progress = body.Progress;

                        // ⭐⚠️ **এখানেই কনফিগ বদলানো এতদিন নীরবে মরে ছিল।**
                        //    আগে লাইনটা ছিল শুধু `_configVersion = body.ConfigVersion;` —
                        //    অর্থাৎ এজেন্ট সার্ভারের ভার্সন নম্বরটা অন্ধভাবে মেনে
                        //    নিত, কিন্তু কনফিগটা আনতই না। পরের heartbeat-এ ভার্সন
                        //    মিলে যেত, তাই সার্ভার আর কোনোদিন `reload_config`
                        //    চাইত না — আর ড্যাশবোর্ডের Settings-এ যা-ই বদলানো
                        //    হোক, ১৫টা PC-র একটাও কিছু জানত না।
                        if (NeedsConfig(body))
                        {
                            await ReloadConfigAsync(ct);
                        }

                        PublishStatus();
                    }
                    else if (result.Outcome == SyncOutcome.Revoked)
                    {
                        _credentials.Revoke("Revoked by the server");
                    }
                }
            }
            catch (Exception ex)
            {
                _log.Error("Heartbeat failed", ex);
            }

            try { await Task.Delay(HeartbeatDelay(), ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>
    /// ⚠️ ১ = জানালা খোলা আছে। <see cref="EnrollIfNeededAsync"/> (স্টার্টআপ)
    /// আর tray-র "Sign in…" — দুটো আলাদা পথ, আর দুটোই একই সময়ে ডাকা যায়।
    /// পাহারা না থাকলে দুটো সাইন-ইন জানালা পাশাপাশি খুলত, দুটোই ১২ ঘণ্টার
    /// টাইমআউট নিয়ে বসে থাকত।
    /// </summary>
    private int _signInOpen;

    /// <summary>
    /// tray-র "Sign in…" থেকে — জানালাটা <b>আবার</b> খোলা।
    ///
    /// ⚠️⚠️ আগে জানালাটা আসত শুধু চালু হওয়ার সময়, একবার। বন্ধ করে দিলে
    /// ফেরার একমাত্র পথ ছিল লগ-অফ করে আবার লগ-ইন — অথচ পর্দায় বড় করে
    /// লেখা থাকত <i>"Sign in to start counting your hours"</i>। কাজটা
    /// বলা হচ্ছিল, করার দরজা ছিল না।
    /// </summary>
    /// <summary>
    /// ⚠️ ১ = নিশ্চিতকরণের জানালা খোলা। মেনু বারবার চাপলে একাধিক জানালা
    /// খুলত, আর প্রতিটাই আলাদা করে কিউ সাফ করার চেষ্টা করত।
    /// </summary>
    private int _signOutOpen;

    /// <summary>
    /// tray-র "Sign out" থেকে — টোকেন মুছে মেশিনটাকে "কেউ সাইন ইন করেনি"
    /// অবস্থায় ফিরিয়ে দেওয়া।
    ///
    /// ⚠️⚠️ <b>ক্রমটাই এখানকার আসল সিদ্ধান্ত: আগে সাইন আউট, তারপর কিউ সাফ।</b>
    /// উল্টো করলে দুটোর মাঝের মুহূর্তে ট্র্যাকিং লুপ তখনো চালু (স্টাফ তখনো
    /// enrolled), তাই একটা নতুন সারি ঢুকে পড়তে পারত — আর সেটা সাইন আউটের
    /// পরেও কিউতে থেকে যেত। পরের জন সাইন ইন করলে ওটা <b>তার</b> টোকেনে
    /// চলে যেত। সাইন আউট আগে করলে <see cref="TrackingGate"/> সাথে সাথেই
    /// নতুন সারি ঢোকা বন্ধ করে দেয়।
    ///
    /// ⚠️ তবু নিখুঁত নয়: ঠিক ওই মুহূর্তে <b>ধার নেওয়া</b> (leased) সারি
    /// থাকলে সেটা এই ঝাড়ুতে পড়ে না (<c>EvictAsync</c> ইচ্ছাকৃতভাবে leased
    /// সারি ছোঁয় না)। জানালাটা ছোট, কিন্তু আছে — তাই সাফ করার পর গভীরতা
    /// আবার মেপে অবশিষ্ট থাকলে লগে <b>জোরে</b> লেখা হয়, নীরবে নয়।
    /// </summary>
    private async Task SignOutOnDemandAsync()
    {
        if (_credentials is null || _outbox is null) return;

        var tray = _tray;
        if (tray is null) return;

        if (Interlocked.CompareExchange(ref _signOutOpen, 1, 0) != 0)
        {
            _log.Info("The sign-out confirmation is already open");
            return;
        }

        try
        {
            var depth = await _outbox.GetDepthAsync(_stopping.Token);

            // ⚠️ tray মেনু আঁকার সময়ও একই নিয়ম চলে, কিন্তু সেটা স্ট্যাটাসের
            //    (একটু পুরোনো) সংখ্যা দিয়ে। ক্লিকের পর আসল সংখ্যা নিয়ে
            //    **আবার** যাচাই — নইলে মেনু খোলা অবস্থায় revoke এসে গেলে
            //    বাতিল ডিভাইসেও সাইন আউট চলত।
            var verdict = SignOutGate.Check(
                _credentials.IsEnrolled, _credentials.IsRevoked, depth.Total);

            if (!SignOutGate.Allows(verdict))
            {
                _log.Info($"Sign out is not available right now ({verdict})");
                return;
            }

            if (!await ConfirmSignOutAsync(tray, SignOutGate.Confirm(verdict, depth.Total)))
            {
                _log.Info("Sign out cancelled by the user");
                return;
            }

            _credentials.SignOut("staff chose Sign out from the tray menu");

            var discarded = await DiscardOutboxAsync();
            if (discarded > 0)
                _log.Info($"Discarded {discarded} unsent item(s) so they cannot be counted for the next person");

            var left = await _outbox.GetDepthAsync(_stopping.Token);
            if (left.Total > 0)
            {
                // ⚠️ এটা নীরবে গিলে ফেলা যায় না — অবশিষ্ট সারি মানে পরের
                //    জনের খাতায় ভুল ঘণ্টা বসার সম্ভাবনা।
                _log.Error(
                    $"⚠ {left.Total} item(s) were still leased and could not be discarded at sign-out. "
                    + "They may upload under the next person who signs in on this PC.");
            }

            tray.UpdateOptions(BuildTrayOptions());
            PublishStatus();
        }
        catch (OperationCanceledException)
        {
            // এজেন্ট বন্ধ হচ্ছে — সাইন আউট অসম্পূর্ণ থাকলেও ক্ষতি নেই,
            // কারণ টোকেন মোছাই হয়নি।
        }
        catch (Exception ex)
        {
            _log.Error("Sign out failed", ex);
        }
        finally
        {
            Interlocked.Exchange(ref _signOutOpen, 0);
        }
    }

    /// <summary>
    /// ⚠️ UI থ্রেডে দেখাতেই হবে — <see cref="TrayIcon.Post"/> দিয়ে, ঠিক
    /// সাইন-ইন জানালার মতো। ব্যাকগ্রাউন্ড থ্রেড থেকে MessageBox তুললে সেটা
    /// tray-র মেসেজ লুপের বাইরে বসত আর অন্য জানালার পেছনে হারিয়ে যেতে পারত।
    ///
    /// ⭐ ডিফল্ট বোতাম <b>No</b> — এই জানালার "হ্যাঁ" তথ্য মুছে ফেলে, তাই
    /// এন্টার চেপে দেওয়া ভুলটা সস্তা হওয়া উচিত নয়।
    /// </summary>
    private static Task<bool> ConfirmSignOutAsync(TrayIcon tray, string message)
    {
        var completion = new TaskCompletionSource<bool>();

        tray.Post(() =>
        {
            try
            {
                var answer = MessageBox.Show(
                    message,
                    "oXeio — sign out",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);

                completion.TrySetResult(answer == DialogResult.Yes);
            }
            catch (Exception)
            {
                // ⚠️ জিজ্ঞাসাই করা গেল না — তখন "না" ধরা হয়। উল্টোটা ধরলে
                //    একটা UI গোলযোগ চুপচাপ কারো তথ্য মুছে দিত।
                completion.TrySetResult(false);
            }
        });

        return completion.Task;
    }

    /// <summary>
    /// কিউয়ের সব <b>অ-ধার-নেওয়া</b> সারি ফেলে দেয়। ফাইলসহ — <c>EvictAsync</c>
    /// .webp-গুলোও মুছে দেয় আর drop-log-এ কারণ লিখে রাখে, তাই পরে
    /// "কী হারাল" প্রশ্নের উত্তর থাকে।
    /// </summary>
    private async Task<int> DiscardOutboxAsync()
    {
        if (_outbox is null) return 0;

        var entries = await _outbox.SurveyAsync(_stopping.Token);
        var rowIds = entries.Where(e => !e.Leased).Select(e => e.RowId).ToList();
        if (rowIds.Count == 0) return 0;

        return await _outbox.EvictAsync(rowIds, "sign out", _stopping.Token);
    }

    /**
     * ⭐⭐ H04 — যাচাই হয়ে যাওয়া MSI-টা চালানো।
     *
     * ⚠️⚠️ <b>নীরবে নয়, আর নীরবে সম্ভবও নয়।</b> এজেন্ট চলে লগইন করা ইউজারের
     * অধিকারে (installer-এ <c>Group=Users</c>), আর <c>msiexec</c> অ্যাডমিন
     * চায় — তাই UAC জানালা উঠবেই। "ব্যাকগ্রাউন্ডে বসে যাবে" করতে হলে
     * SYSTEM হিসেবে চলা একটা সার্ভিস লাগত, আর সেটা আলাদা ও বড় সিদ্ধান্ত।
     *
     * ⭐ আর এই বাধ্যতামূলক ক্লিকটা খারাপ নয় — G58 বলে খারাপ MSI একবার চললে
     * ফেরানোর পথ নেই। একজন মানুষের সম্মতি ওই ঝুঁকির শেষ বাঁধ।
     *
     * ⚠️ <c>/qb</c> — নীরব (<c>/qn</c>) নয়। স্টাফ যেন দেখতে পান কিছু একটা
     * ঘটছে; নীরবে চললে এজেন্ট কয়েক সেকেন্ড বন্ধ হয়ে যেত আর তিনি ভাবতেন
     * কিছু ভেঙে গেছে।
     */
    private void InstallStagedUpdate()
    {
        var update = _updates?.Status;

        // ⚠️ আবার যাচাই — মেনু আঁকার পর অবস্থা বদলে যেতে পারে (নতুন চেক
        //    চলেছে, ফাইল মুছে গেছে)। tray-র শর্তের উপর ভরসা করা যাবে না।
        if (update is null || update.Stage != UpdateStage.Verified) return;

        var msi = update.MsiPath;
        if (string.IsNullOrWhiteSpace(msi) || !File.Exists(msi))
        {
            _log.Warn("Update was ready but the file is gone — it will be downloaded again.");
            return;
        }

        try
        {
            _log.Info($"Staff started the update to {update.Version}.");

            // ⚠️ UseShellExecute = true — নইলে UAC-র elevation প্রম্পটই আসত না,
            //    আর ইনস্টল নীরবে ব্যর্থ হতো।
            Process.Start(new ProcessStartInfo
            {
                FileName = "msiexec.exe",
                Arguments = $"/i \"{msi}\" /qb",
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            // ⚠️ স্টাফ বাতিল করলেও এখানে আসে (UAC-তে "না")। সেটা ভুল নয়,
            //    তাই Error নয় — শুধু লিখে রাখা।
            _log.Warn($"The update did not start: {ex.Message}");
        }
    }

    private async Task SignInOnDemandAsync()
    {
        if (_credentials is null || _sync is null) return;

        // ⚠️ ইতিমধ্যে সাইন ইন হয়ে থাকলে চুপচাপ ফিরে যাওয়া — মেনু আইটেমটা
        //    তখন লুকানো থাকে, কিন্তু মেনু খোলা অবস্থায় স্টার্টআপের সাইন-ইন
        //    সফল হলে ক্লিকটা তবু আসতে পারত।
        if (!_credentials.NeedsEnrollment) return;

        if (Interlocked.CompareExchange(ref _signInOpen, 1, 0) != 0)
        {
            _log.Info("The sign-in window is already open");
            return;
        }

        try
        {
            var enroller = new EnrollmentClient(
                _sync, new DeviceTokenStore(log: _log.Info), _credentials, _version, _log.Info);

            await SignInAsync(enroller, MonitorEnumerator.Enumerate().Count, _stopping.Token);
        }
        catch (Exception ex)
        {
            _log.Error("The sign-in window could not be opened", ex);
        }
        finally
        {
            Interlocked.Exchange(ref _signInOpen, 0);
        }
    }

    private async Task EnrollIfNeededAsync(CancellationToken ct)
    {
        if (_credentials is null || _sync is null) return;
        if (!_credentials.NeedsEnrollment) return;

        // ⚠️ স্টার্টআপের পথটাও একই পাহারার নিচে — নইলে tray থেকে ক্লিক করা
        //    জানালা আর এই জানালা একসাথে খুলতে পারত।
        if (Interlocked.CompareExchange(ref _signInOpen, 1, 0) != 0) return;

        try { await EnrollCoreAsync(ct); }
        finally { Interlocked.Exchange(ref _signInOpen, 0); }
    }

    private async Task EnrollCoreAsync(CancellationToken ct)
    {
        if (_credentials is null || _sync is null) return;

        var enroller = new EnrollmentClient(
            _sync,
            new DeviceTokenStore(log: _log.Info),
            _credentials,
            _version,
            _log.Info);

        var monitors = MonitorEnumerator.Enumerate().Count;

        /**
         * ⭐⭐ <b>দুটো পথ, আর ক্রমটাই মূল সিদ্ধান্ত।</b>
         *
         * ইনস্টলের সময় কোড দেওয়া থাকলে (স্ক্রিপ্টেড রোলআউট, ১৫টা PC
         * একসাথে) সেটাই আগে — তখন কারো কীবোর্ডে বসার সুযোগ নেই।
         *
         * ⚠️ কোড না থাকলে আগে **শূন্যে চেঁচানো হতো**: "No enrolment code —
         * this device has not been added to the server"। এজেন্ট চলত,
         * ট্র্যাক করত, কিন্তু কিছুই পাঠাত না — আর কেউ টেরও পেত না, কারণ
         * বার্তাটা যেত এমন এক লগে যা তখনো লেখাই হতো না (H08)। এখন সেই
         * জায়গায় স্টাফকে সরাসরি জিজ্ঞেস করা হয়।
         */
        if (!string.IsNullOrWhiteSpace(_settings.EnrollmentCode))
        {
            var byCode = await enroller.EnrollWithRetryAsync(
                new SecretText(_settings.EnrollmentCode), monitors, ct: ct);

            _log.Info(byCode.Ok ? "✅ Device enrolled" : $"Enrolment failed: {byCode.Message}");
            PublishStatus();
            return;
        }

        await SignInAsync(enroller, monitors, ct);
    }

    /// <summary>
    /// স্টাফকে জিজ্ঞেস করা — জানালাটা <see cref="SignInForm"/>।
    ///
    /// ⚠️ <b>UI থ্রেডে</b> চালাতেই হয়। এই মেথডটা ডাকা হয় স্টার্টআপের
    /// ব্যাকগ্রাউন্ড টাস্ক থেকে, আর ওখান থেকে সরাসরি <c>ShowDialog()</c>
    /// করলে WinForms হয় ছুড়ত, নয় জানালাটা এমন এক থ্রেডে বসত যার নিজের
    /// message loop নেই — অর্থাৎ জানালাটা দেখা যেত কিন্তু কোনো ক্লিকে
    /// সাড়া দিত না।
    ///
    /// ⚠️ জানালা বন্ধ করে দিলে (বা বাতিল হলে) এজেন্ট **চলতেই থাকে** —
    /// শুধু enroll হয় না। পরের লগঅনে আবার জিজ্ঞেস করা হবে। ইনস্টলের দিন
    /// কারো তাড়া থাকলে সে কাজ শুরু করতে পারবে, আর সেটাই ঠিক।
    /// </summary>
    private async Task SignInAsync(EnrollmentClient enroller, int monitors, CancellationToken ct)
    {
        var tray = _tray;
        if (tray is null)
        {
            _log.Error("The sign-in window could not be opened — the tray is not up yet");
            return;
        }

        var completion = new TaskCompletionSource<EnrollmentResult?>();

        tray.Post(() =>
        {
            try
            {
                using var form = new SignInForm(
                    _settings.ServerUrl,
                    (email, password, totp, token) =>
                        enroller.SignInAsync(email, password, totp, monitors, token));

                form.ShowDialog();
                completion.TrySetResult(form.Result);
            }
            catch (Exception ex)
            {
                _log.Error("The sign-in window could not be opened", ex);
                completion.TrySetResult(null);
            }
        });

        /**
         * ⚠️ <b>টাইমআউট আছে, আর সেটা থাকতেই হবে।</b> `Post()` কখনো ছোড়ে না
         * আর কিছু ফেরতও দেয় না — হ্যান্ডেল ধ্বংস হয়ে গেলে সে চুপচাপ কাজটা
         * ফেলে দেয়। তখন এই `await` **চিরকাল** ঝুলে থাকত, আর তার সাথে
         * স্টার্টআপের টাস্কটাও।
         */
        EnrollmentResult? result;
        try
        {
            result = await completion.Task
                .WaitAsync(TimeSpan.FromHours(12), ct)
                .ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            // জানালাটা সারাদিন খোলা পড়ে ছিল — কেউ বসেনি
            _log.Warn("The sign-in window was left open all day — this PC is still not enrolled");
            return;
        }
        catch (OperationCanceledException)
        {
            // এজেন্ট বন্ধ হচ্ছে
            return;
        }

        _log.Info(result is null
            ? "Sign-in was closed without enrolling — this PC is not sending anything yet"
            : result.Ok
                ? "✅ Device enrolled by sign-in"
                : $"Sign-in failed: {result.Message}");

        PublishStatus();
    }

    // ── কনফিগ (E09 · K07) ───────────────────────────────────────────────────

    private TimeSpan HeartbeatDelay()
    {
        var wanted = TimeSpan.FromSeconds(_config.HeartbeatSec);
        return wanted < HeartbeatMin ? HeartbeatMin
             : wanted > HeartbeatMax ? HeartbeatMax
             : wanted;
    }

    /// <summary>
    /// নতুন করে কনফিগ আনতে হবে কি না।
    ///
    /// দুটো কারণেই — সার্ভার স্পষ্ট করে <c>reload_config</c> বললে, <b>অথবা</b>
    /// ভার্সন না মিললে। ⚠️ দ্বিতীয়টা শুধু বেল্ট-অ্যান্ড-ব্রেসেস নয়: এজেন্ট
    /// সদ্য চালু হলে <see cref="_configVersion"/> <c>null</c>, আর তখন সার্ভার
    /// কোনো কমান্ড পাঠায় না (তার চোখে "কিছু বদলায়নি")। শুধু কমান্ডের উপর
    /// নির্ভর করলে রিবুটের পর এজেন্ট চিরকাল ডিফল্ট কনফিগে চলত।
    /// </summary>
    private bool NeedsConfig(HeartbeatResponse body) =>
        body.Commands.Contains(AgentCommand.ReloadConfig) ||
        !string.Equals(_configVersion, body.ConfigVersion, StringComparison.Ordinal);

    /// <summary>
    /// <c>GET /agent/config</c> — এনে <b>সারিতে রেখে দেওয়া</b>, সাথে সাথে প্রয়োগ নয়।
    ///
    /// ⚠️ প্রয়োগ করে <see cref="TrackLoop"/>, কারণ ট্র্যাকিংয়ের অবজেক্টগুলো
    /// ওই থ্রেডের। এখান থেকে ছুঁলে সেকেন্ডের হিসাব দুই কনফিগে ভাগ হয়ে যেত।
    ///
    /// ব্যর্থ হলে চুপচাপ পুরোনো কনফিগেই চলা — কনফিগ না পাওয়া মানে ঘণ্টা গোনা
    /// থামা নয় (<see cref="AgentConfig.Default"/>-এর মন্তব্য দেখুন)।
    /// </summary>
    private async Task ReloadConfigAsync(CancellationToken ct)
    {
        if (_sync is null) return;

        var result = await _sync.GetConfigAsync(ct);

        if (!result.IsSuccess || result.Value is not { } body)
        {
            _log.Warn($"Could not fetch the config — carrying on with the current one ({result.Detail ?? "reason unknown"})");
            return;
        }

        Interlocked.Exchange(
            ref _pendingConfig, new PendingConfig(body.Config, body.Version));
    }

    /// <summary>এনে রাখা কনফিগ — <see cref="TrackLoop"/> তুলে নেয়।</summary>
    private sealed record PendingConfig(AgentConfig Config, string Version);

    /// <summary>
    /// ⚠️ <b>শুধু <see cref="TrackLoop"/> থেকে ডাকা যাবে।</b>
    ///
    /// প্রতিটা বদল আলাদা করে দেখা হয়, কারণ কোনোটাই বিনামূল্যে নয়:
    /// idle থ্রেশহোল্ড বদলাতে চলতি সেগমেন্ট বন্ধ করতে হয়, আর অ্যাপ ট্র্যাকিং
    /// বন্ধ করতে খোলা রেকর্ড বন্ধ করতে হয়। যা বদলায়নি তাতে হাত না দেওয়াই
    /// নিয়ম — নইলে সার্ভারে কনফিগ save করলেই সবার সেগমেন্ট অকারণে কাটা পড়ত।
    /// </summary>
    private void ApplyConfig(AgentConfig cfg, string version, DateTimeOffset now)
    {
        var old = _config;
        var change = ConfigChange.Between(old, cfg);

        _config = cfg;
        _configVersion = version;

        var changes = new List<string>();

        // ── ছবির সময়সীমা (A04b) — কেবল একটা রেফারেন্স বদল ─────────────────
        if (change.CaptureWindow)
        {
            _window = cfg.ToCaptureWindow();
            changes.Add($"capture window {old.ScreenshotFrom}–{old.ScreenshotTo} → {cfg.ScreenshotFrom}–{cfg.ScreenshotTo}");
        }

        // ── স্লট (A01) ────────────────────────────────────────────────────
        // ⚠️ চলতি স্লটটা যেমন চলছে তেমনই শেষ হবে; নতুন মাপ পরের হিসাব থেকে।
        //    মাঝপথে বদলালে ওই স্লটের ছবিটা হয় দুবার উঠত, নয় একবারও না।
        if (change.Slots)
        {
            _slots = new SlotScheduler(cfg.SlotMinutes);
            changes.Add($"slot {old.SlotMinutes}m → {cfg.SlotMinutes}m");
        }

        if (change.Heartbeat)
        {
            changes.Add($"heartbeat {old.HeartbeatSec}s → {cfg.HeartbeatSec}s");
        }

        ApplyAppTracking(cfg, old, change, now, changes);
        ApplyIdleThreshold(cfg, old, change, now, changes);

        // ⭐ কী বদলাল সেটা লগে থাকা দরকার: কারো ঘণ্টা হঠাৎ অন্যরকম দেখালে
        //    প্রথম প্রশ্নটাই হবে "কনফিগ বদলেছিল কি"।
        _log.Info(changes.Count == 0
            ? $"Config {version} — nothing changed"
            : $"Config {version} applied: {string.Join(" · ", changes)}");
    }

    private void ApplyAppTracking(
        AgentConfig cfg, AgentConfig old, ConfigChange change,
        DateTimeOffset now, List<string> changes)
    {
        if (!change.AppTrackingToggled && !change.AppMinDuration) return;

        var wasOn = _apps is not null;
        var wantsOn = cfg.AppTracking.Enabled;

        // ⚠️ বন্ধ করার সময় খোলা রেকর্ডটা বন্ধ করে কিউয়ে পাঠাতে হয়, নইলে
        //    ওই সময়টুকু নীরবে হারাত।
        if (wasOn && !wantsOn)
        {
            RecordApps(_apps!.CloseAll(now));
            _apps = null;
            changes.Add("app tracking off");
            return;
        }

        if (!wasOn && wantsOn)
        {
            _apps = new AppUsageService(
                TimeSpan.FromSeconds(cfg.AppTracking.MinDurationSec));
            changes.Add("app tracking on");
            return;
        }

        if (wasOn && change.AppMinDuration)
        {
            RecordApps(_apps!.CloseAll(now));
            _apps = new AppUsageService(
                TimeSpan.FromSeconds(cfg.AppTracking.MinDurationSec));
            changes.Add($"app min {old.AppTracking.MinDurationSec}s → {cfg.AppTracking.MinDurationSec}s");
        }
    }

    /// <summary>
    /// ⚠️⚠️ সবচেয়ে সংবেদনশীল বদল — এখানেই ঘণ্টা হারানোর ঝুঁকি।
    ///
    /// থ্রেশহোল্ড <see cref="IdleStateMachine"/>-এর কনস্ট্রাক্টরে যায়, তাই
    /// বদলাতে হলে নতুন অবজেক্ট। তার <b>আগে</b> চলতি সেগমেন্ট বন্ধ করে কিউয়ে
    /// পাঠানো হয় — নইলে যে সময়টুকু পুরোনো মেশিনের ভেতরে খোলা ছিল সেটা
    /// কোনো সেগমেন্টেই ঢুকত না, আর কেউ টেরও পেত না।
    ///
    /// ⚠️ নতুন মেশিন শুরু হয় <b>পুরোনোটার শেষ স্টেট</b> নিয়ে। ডিফল্ট
    /// <c>Active</c> ধরে নিলে লক করা পর্দার মানুষও এক টিকের জন্য "কাজ করছে"
    /// হয়ে যেত।
    /// </summary>
    private void ApplyIdleThreshold(
        AgentConfig cfg, AgentConfig old, ConfigChange change,
        DateTimeOffset now, List<string> changes)
    {
        if (!change.IdleThreshold || _machine is null) return;

        var state = _machine.State;

        Record(_machine.CloseAll(now));
        _machine = new IdleStateMachine(
            TimeSpan.FromSeconds(cfg.IdleThresholdSec), now, state);

        changes.Add($"idle {old.IdleThresholdSec}s → {cfg.IdleThresholdSec}s");
    }

    /// <summary>
    /// H04 — ৬ ঘণ্টায় একবার নতুন ভার্সন খোঁজা।
    ///
    /// ⚠️ এই লুপ ব্যর্থ হলে আপডেট আসে না — সময়ের হিসাব বা সিঙ্ক কিছুই
    /// থামে না। তাই এখানকার কোনো ব্যর্থতাই ট্র্যাকিং পর্যন্ত পৌঁছাতে পারবে না।
    /// </summary>
    private async Task UpdateLoopAsync(CancellationToken ct)
    {
        if (_updates is null) return;

        // ⚠️ চালু হওয়ার সাথে সাথেই নয় — enrollment ও প্রথম heartbeat আগে
        //    হোক। টোকেন ছাড়া চেক করলে শুধু একটা ৪০১ পেতাম।
        try { await Task.Delay(TimeSpan.FromMinutes(2), ct); }
        catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            if (_credentials?.IsEnrolled == true)
            {
                await _updates.CheckOnceAsync(ct);
                PublishStatus();
            }

            try { await Task.Delay(UpdateStager.CheckEvery, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task SyncNowAsync()
    {
        if (_worker is null) return;
        await _worker.DrainOnceAsync(_stopping.Token);
        PublishStatus();
    }

    // ── অবস্থা ──────────────────────────────────────────────────────────────

    private void Record(IReadOnlyList<ActivitySegment> closed)
    {
        foreach (var s in closed)
        {
            if (s.CountsAsWork)
            {
                // ঢাকার মধ্যরাতে আজকের হিসাব শূন্য হয় (§ ২.১-ক)
                var date = DhakaTime.WorkDateOf(s.StartedAt);
                if (date != _activeDate)
                {
                    _activeDate = date;
                    Interlocked.Exchange(ref _activeTodaySec, 0);
                }

                Interlocked.Add(ref _activeTodaySec, s.DurationSec);
            }

            RememberBusy(s);

            _outbox?.EnqueueAsync(OutboxCodec.Item(s, DateTimeOffset.UtcNow))
                   .ContinueWith(
                       t => _log.Error("Could not queue the segment", t.Exception),
                       TaskContinuationOptions.OnlyOnFaulted);
        }
    }

    /// <summary>
    /// H06 — বাতিলের পর ট্র্যাকিং গুটিয়ে নেওয়া। একবারই চলে।
    ///
    /// ⚠️ খোলা সেগমেন্টটা বন্ধ করা হয় কিন্তু **কিউতে পাঠানো হয় না** —
    /// টোকেন ইতিমধ্যে মুছে গেছে (`DeviceCredentials.Revoke`), তাই ওই সারি
    /// কোনোদিন সার্ভারে যেতে পারত না; শুধু আউটবক্স বড় করত।
    ///
    /// ⚠️ অ্যাপ ট্র্যাকিংও থামে — বাতিল ডিভাইসে "কে কোন সাইটে ছিল" জমা
    /// করে রাখার কোনো ভিত্তি নেই।
    /// </summary>
    private void StopTrackingForRevoke(DateTimeOffset now)
    {
        if (_trackingStoppedForRevoke) return;
        _trackingStoppedForRevoke = true;

        _machine?.CloseAll(now);

        if (_apps is not null)
        {
            _apps.CloseAll(now);
            _apps = null;
        }

        _log.Warn("Device revoked — tracking stopped on this PC.");
        PublishStatus();
    }

    /// <summary>
    /// B13 — শেষ কয়েকটা ঘরে কত শতাংশ সময় হাত চলেছে, tray-তে দেখানোর জন্য।
    ///
    /// ⭐ সংখ্যাটা নতুন করে মাপা হয় না — <see cref="ActivitySegment.InputScore"/>
    /// আগে থেকেই আছে, আর সেগমেন্ট কাটা হয় সর্বোচ্চ ৫ মিনিটে (G53)। অর্থাৎ
    /// "প্রতি ৫ মিনিটে কতটা ব্যস্ত" ইতিমধ্যেই হিসাব হয়ে সার্ভারে যাচ্ছে;
    /// এতদিন শুধু দেখানো হতো না।
    ///
    /// ⚠️ <c>locked</c> ঘর বাদ — পর্দা লক থাকলে "ব্যস্ততা ০%" বলাটা
    /// বিভ্রান্তিকর, কারণ মানুষটা তখন কাজই করছিল না। <c>idle</c> ঘরে ০
    /// বসে, কারণ সেটা সত্যিই "সামনে ছিল, হাত চলেনি"।
    /// </summary>
    private void RememberBusy(ActivitySegment s)
    {
        if (s.State == SegmentState.Locked) return;

        lock (_busyGate)
        {
            _recentBusy.Enqueue(s.InputScore ?? 0);
            while (_recentBusy.Count > BusyBlocks) _recentBusy.Dequeue();
        }
    }

    private void RecordApps(IReadOnlyList<AppUsageRecord> closed)
    {
        foreach (var a in closed)
        {
            _outbox?.EnqueueAsync(OutboxCodec.Item(a, DateTimeOffset.UtcNow))
                   .ContinueWith(
                       t => _log.Error("Could not queue app usage", t.Exception),
                       TaskContinuationOptions.OnlyOnFaulted);
        }
    }

    // ── ইভেন্ট (G02) ────────────────────────────────────────────────────────

    /// <summary>
    /// একটা <see cref="AgentEventRecord"/> <b>কিউয়ে</b> ফেলে — নেটওয়ার্কে নয়।
    ///
    /// ⭐⚠️ <b>এটাই এই মেথডের পুরো কারণ।</b> বিদায়ী ইভেন্টগুলো (logoff,
    /// shutdown, agent_stop) ঠিক তখন তৈরি হয় যখন Windows-এর হাতে সব প্রসেস
    /// মিলিয়ে ~২ সেকেন্ড বাকি। ওই মুহূর্তে একটা HTTP কল করলে সেটা DNS বা
    /// TCP-তে ঝুলে যেতে পারত, Windows প্রসেসটা মেরে ফেলত, আর ইভেন্টটা
    /// <b>হারাত</b> — অর্থাৎ যে ইভেন্টের জন্য পুরো ব্যবস্থা, সেটাই সবচেয়ে
    /// বেশি হারাত। কিউয়ে ফেলা মানে এক ডজন মাইক্রোসেকেন্ডের SQLite ইনসার্ট;
    /// পাঠানোর কাজটা DisposeAsync-এর শেষ drain বা পরের স্টার্টআপ করবে।
    ///
    /// ⚠️ <c>await</c> করা হয় না — কলার UI থ্রেড হতে পারে (WM_ENDSESSION)।
    /// <see cref="SqliteOutboxStore.EnqueueAsync"/> ভেতরে
    /// <c>ConfigureAwait(false)</c> ব্যবহার করে, তাই আসল লেখাটা থ্রেড-পুলে যায়
    /// আর ডেস্কটপ আটকে থাকে না।
    /// </summary>
    private void RaiseEvent(string type, IReadOnlyDictionary<string, object?>? meta = null) =>
        RaiseEvent(new AgentEventRecord
        {
            ClientUuid = Guid.NewGuid(),
            Type = type,
            OccurredAt = DateTimeOffset.UtcNow,
            Meta = meta,
        });

    private void RaiseEvent(AgentEventRecord record)
    {
        if (_outbox is null) return;

        // ⚠️ সাইন ইনের আগে ইভেন্টও নয় — নিয়মটা "কিছুই যাবে না", আংশিক নয়।
        //    এগুলো সবই বিদায়ী ইভেন্ট (agent_stop · logoff · shutdown), তাই
        //    সাইন ইন না করা মেশিনে একটাই সারি জমত — কিন্তু সেটাও পরে কেউ
        //    সাইন ইন করলে **তার** নামে চলে যেত।
        //
        // ⚠️ revoke হলেও বাদ: টোকেন মুছে গেছে, তাই সারিটা কোনোদিন সার্ভারে
        //    যেতে পারত না — শুধু আউটবক্স বড় করত (StopTrackingForRevoke-এর
        //    একই যুক্তি)।
        if (!TrackingGate.Allows(
                _credentials?.IsEnrolled == true,
                _credentials?.IsRevoked == true))
        {
            return;
        }

        _outbox.EnqueueAsync(OutboxCodec.Item(record, DateTimeOffset.UtcNow))
               .ContinueWith(
                   t => _log.Error($"Could not queue the event ({record.Type})", t.Exception),
                   TaskContinuationOptions.OnlyOnFaulted);
    }

    /// <summary>
    /// <c>agent_stop</c>-এর দেহ। দুটো পথ থেকেই তৈরি হয় (WM_ENDSESSION ও
    /// DisposeAsync), তাই এক জায়গায় — নইলে একদিন একটা পথে <c>reason</c> বসত
    /// আর অন্যটায় বসত না, এবং সার্ভার ওই মেশিনটাকেই সন্দেহ করত।
    /// </summary>
    private AgentEventRecord BuildStopEvent() => new()
    {
        ClientUuid = Guid.NewGuid(),
        Type = AgentEventTypes.AgentStop,
        OccurredAt = DateTimeOffset.UtcNow,
        Meta = new Dictionary<string, object?>
        {
            ["agentVersion"] = _version,

            // ⚠️ কেন বন্ধ হচ্ছে তার একমাত্র সূত্র। "unknown" মানে
            //    logoff/shutdown কিছুই আসেনি — সার্ভার তখন এটাকেই সন্দেহজনক
            //    ধরবে, এবং সেটাই কাম্য।
            ["reason"] = ClosingReason(),
        },
    };

    /// <summary>
    /// বিদায়ী ইভেন্ট — জীবনে একবার করে।
    ///
    /// ⚠️ <c>shutdown</c> বসে গেলে পরে আসা <c>logoff</c> চেপে দেওয়া হয়:
    /// Windows বন্ধ হওয়ার সময় সেশনের logoff ব্রডকাস্টটাও আসে, কিন্তু ঘটনাটা
    /// একটাই — PC বন্ধ হচ্ছে। দুটো সারি লিখলে লগ পড়ে মনে হতো স্টাফ আগে
    /// লগঅফ করে তারপর কেউ PC বন্ধ করেছে।
    /// </summary>
    /// <returns>সত্যিই কিউয়ে গেল কি না।</returns>
    private bool RaiseClosingEvent(string type, IReadOnlyDictionary<string, object?>? meta = null)
    {
        if (!TryMarkClosing(type)) return false;

        RaiseEvent(type, meta);
        _log.Info($"Event queued: {type}");
        return true;
    }

    /// <summary>এই বিদায়ী ইভেন্টটা এই প্রথমবার? হ্যাঁ হলে চিহ্নিত করে রাখে।</summary>
    private bool TryMarkClosing(string type)
    {
        lock (_closingEventsSent)
        {
            if (_closingEventsSent.Contains(type)) return false;

            if (type == AgentEventTypes.Logoff &&
                _closingEventsSent.Contains(AgentEventTypes.Shutdown))
            {
                return false;
            }

            _closingEventsSent.Add(type);
            return true;
        }
    }

    private AgentStatus Snapshot()
    {
        var depth = _worker?.Depth.Total ?? 0;
        var progress = _progress;

        return new AgentStatus
        {
            State = _machine?.State ?? SegmentState.Idle,

            // ⭐ H04 — tray-র "Install update" আইটেমটা এটার উপরেই দাঁড়ায়
            Update = _updates?.Status ?? UpdateStatus.Idle,

            // ⭐ আজকের হিসাব সার্ভারেরটাই — এজেন্টের নিজেরটা রিবুটে শূন্য হয়।
            //    সার্ভার এখনো কিছু না বললে (একবারও heartbeat হয়নি) নিজেরটা।
            ActiveToday = TimeSpan.FromSeconds(
                progress?.TodayActiveSec ?? Interlocked.Read(ref _activeTodaySec)),
            ActiveThisMonth = TimeSpan.FromSeconds(progress?.MonthActiveSec ?? 0),
            MonthlyTargetHours = progress?.MonthlyTargetHours ?? 208,

            // ⚠️ প্রথম heartbeat আসার আগে মাসের ঘরটা মিথ্যা শূন্য — সেটা
            //    দেখানোর জায়গাকে জানিয়ে দিতে হয় (AgentStatus.MonthlyKnown)।
            MonthlyKnown = progress is not null,

            // ⚠️ সার্ভার না পাঠালে null-ই থাকে, ০ নয় — "আমরা জানি না" আর
            //    "ঠিক লক্ষ্যে আছে" এক জিনিস নয় (AgentStatus.Pace দেখুন)।
            Pace = progress?.PaceSec is { } sec ? TimeSpan.FromSeconds(sec) : null,

            // ⚠️ এখানেও null মানে "সার্ভার বলেনি"; Zero মানে "আজ ছুটি"।
            DailyTarget = progress?.DailyTargetSec is { } day
                ? TimeSpan.FromSeconds(day)
                : null,
            ActiveLast7 = progress?.Week7ActiveSec is { } w7
                ? TimeSpan.FromSeconds(w7)
                : null,
            Last7Target = progress?.Week7TargetSec is { } w7t
                ? TimeSpan.FromSeconds(w7t)
                : null,

            RecentBusy = SnapshotBusy(),

            LatestShotThumb = _latestShotThumb,
            LatestShotAt = _latestShotAt,
            LatestShotMonitors = _latestShotMonitors,

            QueueDepth = depth,
            LastSyncAt = _worker?.LastSuccessAt,
            Health = _worker?.Health ?? SyncHealth.Ok,
            HealthDetail = _worker?.HealthDetail,
            Paused = false,

            // ⚠️ IsEnrolled, NeedsEnrollment-এর উল্টো নয়। ক্রেডেনশিয়াল ফাইল
            //    থাকলেও পড়া না গেলে (নষ্ট, বা অন্য মেশিনের DPAPI) দুটোই
            //    মিথ্যা — তখন "সাইন ইন হয়ে গেছে" বলাটা সরাসরি ভুল হতো।
            Enrolled = _credentials?.IsEnrolled == true,
        };
    }

    /// <summary>⚠️ কপি ফেরত যায়, ভেতরের কিউ নয় — নইলে UI থ্রেড আঁকার মাঝপথে তালিকা বদলে যেত।</summary>
    private int[] SnapshotBusy()
    {
        lock (_busyGate) return [.. _recentBusy];
    }

    private void PublishStatus() => _tray?.Publish(Snapshot());

    // ── উইন্ডো মেসেজ (UI থ্রেড থেকে) ────────────────────────────────────────

    /// <summary>
    /// <c>WM_WTSSESSION_CHANGE</c>-এর কাঁচা কোড।
    ///
    /// ⚠️ ব্যাখ্যা করা <see cref="SessionChange"/> নয়, কোডটাই নেওয়া হয়:
    /// ট্র্যাকিংয়ের দিক থেকে lock আর logoff একই (দুটোতেই suspend), কিন্তু
    /// G02-র দিক থেকে সম্পূর্ণ আলাদা — একটা "সে ফিরে আসবে", আরেকটা "সে চলে
    /// গেছে"। ব্যাখ্যাটা আগে করে ফেললে ওই পার্থক্যটা এখানে পৌঁছাতই না।
    /// </summary>
    public void OnSessionChange(int wtsCode)
    {
        var change = SessionMonitor.Interpret(wtsCode);

        if (change == SessionChange.Suspend) _sessionSuspended = true;
        else if (change == SessionChange.Resume) _sessionSuspended = false;

        if (SessionMonitor.ClosingEventType(wtsCode) is { } type)
        {
            RaiseClosingEvent(type, new Dictionary<string, object?>
            {
                // ⚠️ শুধু কোড আর তার নাম — কোনো ইউজারনেম, হোস্টনেম বা
                //    উইন্ডোর টেক্সট নয় (AgentEventRecord.Meta-র নিয়ম)।
                ["source"] = "wts",
                ["wtsCode"] = wtsCode,
            });
        }
    }

    /// <summary>
    /// <c>WM_ENDSESSION</c> — logoff নাকি PC বন্ধ, সেটা এখানেই জানা যায়।
    /// <see cref="SessionMonitor.InterpretEndSession"/>-এ কেন PowerMonitor নয়
    /// তার ব্যাখ্যা আছে।
    /// </summary>
    public void OnSessionEnd(string? eventType)
    {
        if (eventType is null) return;

        if (!RaiseClosingEvent(eventType, new Dictionary<string, object?>
            {
                ["source"] = "endsession",
            }))
        {
            return;
        }

        // ⭐⚠️ <b>agent_stop এখানেই বসানো হয়, DisposeAsync-এর ভরসায় নয়।</b>
        //    WM_ENDSESSION মানে সেশন সত্যিই শেষ হচ্ছে — এর পর Windows প্রসেসটা
        //    মেরে ফেলবে, আর <c>Application.Run()</c> আদৌ ফিরবে কি না সেটা
        //    WinForms-এর অভ্যন্তরীণ আচরণের উপর নির্ভর করে। না ফিরলে
        //    DisposeAsync চলতই না, আর তখন প্রতিটা স্বাভাবিক শাটডাউনে সার্ভার
        //    পেত logoff/shutdown কিন্তু কোনো agent_stop নয় — অর্থাৎ ঠিক
        //    উল্টো ফাঁক।
        //
        //    দুবার বসার ভয় নেই: DisposeAsync চললে TryMarkClosing তাকে থামিয়ে দেবে।
        if (TryMarkClosing(AgentEventTypes.AgentStop)) RaiseEvent(BuildStopEvent());
    }

    /// <summary>
    /// <c>agent_stop</c>-এর সাথে যাওয়া কারণ — <c>shutdown</c>, <c>logoff</c>,
    /// অথবা <c>unknown</c>।
    ///
    /// ⚠️ <c>unknown</c> ঢাকার চেষ্টা করা হয় না। "কেউ প্রসেসটা মেরে দিয়েছে"
    /// আর "PC বন্ধ হয়েছে" — এই পার্থক্যটাই G02-র পুরো বিষয়। সন্দেহ হলে
    /// সন্দেহই লেখা থাকবে।
    /// </summary>
    private string ClosingReason()
    {
        lock (_closingEventsSent)
        {
            if (_closingEventsSent.Contains(AgentEventTypes.Shutdown))
                return AgentEventTypes.Shutdown;

            if (_closingEventsSent.Contains(AgentEventTypes.Logoff))
                return AgentEventTypes.Logoff;
        }

        return "unknown";
    }

    public void OnPower(PowerSignal? signal)
    {
        if (signal is PowerSignal.Suspend or PowerSignal.DisplayOff)
        {
            // ঘুমাতে যাওয়ার আগে হাতে ~২ সেকেন্ড — শুধু সেগমেন্ট বন্ধ,
            // কোনো নেটওয়ার্ক কল নয়।
            Record(_machine!.OnSuspend(_clock.Now));
            _sleep.Reset();
        }
        else if (signal == PowerSignal.Resume)
        {
            Record(_machine!.OnResume(_clock.Now));
            _sleep.Reset();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync();

        if (_machine is not null) Record(_machine.CloseAll(_clock.Now));
        if (_apps is not null) RecordApps(_apps.CloseAll(_clock.Now));

        // ── G02: agent_stop ─────────────────────────────────────────────────
        // ⭐ এটাই সার্ভারের tamper অ্যালার্টের একমাত্র ইনপুট। এর পাশে একটা
        //    logoff/shutdown থাকলে সার্ভার বলে "স্বাভাবিক বন্ধ", না থাকলে
        //    "হস্তক্ষেপ" (alerts.rules.ts)। তাই দুটোই পাঠানো জরুরি।
        //
        // ⚠️ এখানে await করা হচ্ছে, ইচ্ছাকৃতভাবে — নিচের শেষ drain-এ ইভেন্টটা
        //    ধরা পড়তে হলে তার আগেই SQLite-এ বসতে হবে। fire-and-forget হলে
        //    দৌড়ে হেরে গিয়ে ইভেন্টটা পরের স্টার্টআপ পর্যন্ত পড়ে থাকত — আর
        //    আনইনস্টলের ক্ষেত্রে পরের স্টার্টআপ কখনো আসত না।
        //
        // ⚠️ তবু <b>নেটওয়ার্ক নয়</b> — শুধু ডিস্ক, আর তার উপরেও ছাদ আছে।
        //    ছাদটা WaitAsync দিয়ে, EnqueueAsync-এর CancellationToken দিয়ে নয়:
        //    SqliteOutboxStore ওই টোকেনটা ইচ্ছাকৃতভাবে উপেক্ষা করে (অর্ধেক লেখা
        //    সারি তৈরি হওয়া ঠেকাতে), তাই ওটা দিলে "ছাদ আছে" ভেবে বসে থাকতাম
        //    অথচ বাস্তবে কিছুই থামাত না।
        // ⚠️ এই পথটা `RaiseEvent()`-কে **এড়িয়ে যায়** (সরাসরি EnqueueAsync,
        //    কারণ এখানে একটা সময়-বাজেট মানতে হয়), তাই গেটটা এখানেও আলাদা
        //    করে লাগে। ঠিক এভাবেই AppUsageLoop-টা প্রথমে বাদ পড়েছিল।
        if (_outbox is not null
            && TrackingGate.Allows(
                _credentials?.IsEnrolled == true,
                _credentials?.IsRevoked == true)
            && TryMarkClosing(AgentEventTypes.AgentStop))
        {
            try
            {
                await _outbox
                    .EnqueueAsync(OutboxCodec.Item(BuildStopEvent(), DateTimeOffset.UtcNow))
                    .WaitAsync(StopEnqueueBudget);
            }
            catch (Exception ex)
            {
                _log.Error("Could not queue the agent_stop event", ex);
            }
        }

        // শেষ চেষ্টা — বন্ধ হওয়ার আগে যা আছে পাঠিয়ে দেওয়া
        //
        // ⚠️ ছাদটা আগে ১০ সেকেন্ড ছিল, কিন্তু সেটা কখনো পৌঁছাত না:
        //    Program.Shutdown() পুরো DisposeAsync-কেই ৪ সেকেন্ডে থামিয়ে দেয়
        //    (Windows-এর নিজের বাজেট আরও কম)। ১০ রাখলে drain বাতিলই হতো না —
        //    প্রসেসটা মাঝপথে মারা যেত, HTTP কল অর্ধেক অবস্থায়। এখন সে
        //    নিজেই আগে সরে যায়, ফলে সার্ভারের দিকে কাটা রিকোয়েস্ট পড়ে না।
        if (_worker is not null)
        {
            using var last = new CancellationTokenSource(FinalDrainBudget);
            try { await _worker.DrainOnceAsync(last.Token); }
            catch (Exception) { /* বন্ধ হচ্ছে — আর কিছু করার নেই */ }
        }

        _beacon?.Dispose();
        _tray?.Dispose();
        _capture?.Dispose();
        _sync?.Dispose();
        if (_outbox is not null) await _outbox.DisposeAsync();
        _stopping.Dispose();
    }
}
