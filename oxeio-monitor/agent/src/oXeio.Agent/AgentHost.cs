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
    private static readonly TimeSpan HeartbeatEvery = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(60);

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

    private volatile bool _sessionSuspended;
    private long _activeTodaySec;
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
            new SyncClientOptions { BaseAddress = _settings.ApiRoot, AgentVersion = _version },
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
            IdleThreshold,
            _clock.Now,
            lockState == LockState.Locked ? SegmentState.Locked : SegmentState.Active);

        _capture = new ScreenCaptureService(
            new FallbackCapturer(new DuplicationCapturer(), new GdiCapturer()));
        _slots = new SlotScheduler(AgentConfig.Default.SlotMinutes);

        // D01–D04। ⚠️ কনফিগে বন্ধ থাকলে অবজেক্টটাই তৈরি হয় না — তাহলে
        //    foreground উইন্ডোর নামও কখনো মেমোরিতে আসে না, শুধু "পাঠাচ্ছি না" নয়।
        if (AgentConfig.Default.AppTracking.Enabled)
        {
            _apps = new AppUsageService(
                TimeSpan.FromSeconds(AgentConfig.Default.AppTracking.MinDurationSec));
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

                var gap = _sleep.Observe(
                    new SleepGapDetector.Sample(sample.BiasedMs, sample.UnbiasedMs, now));

                if (gap.Detected)
                {
                    Record(_machine!.OnSuspend(gap.SuspendedAt));
                    Record(_machine!.OnResume(gap.ResumedAt));
                }

                Record(_machine!.Tick(now, sample.SinceLastInput, _sessionSuspended));
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

    private async Task CaptureSlotAsync(SlotScheduler.Slot slot, CancellationToken ct)
    {
        // A04 — ACTIVE ছাড়া ছবি নয়। A04b — ০৭:০০–২৩:০০ ছাড়া ছবি নয়,
        // কিন্তু সময় গোনা তবু চলে।
        if (_machine!.State != SegmentState.Active) return;
        if (!_window.Allows(slot.FireAt)) return;
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
                RecordApps(_apps.Tick(_clock.Now, _machine?.State ?? SegmentState.Idle));
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
        while (!ct.IsCancellationRequested)
        {
            if (_worker is not null) await _worker.DrainOnceAsync(ct);
            PublishStatus();

            try { await Task.Delay(SyncEvery, ct); }
            catch (OperationCanceledException) { return; }
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
                        _configVersion = body.ConfigVersion;
                        if (body.Progress is not null) _progress = body.Progress;
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

            try { await Task.Delay(HeartbeatEvery, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task EnrollIfNeededAsync(CancellationToken ct)
    {
        if (_credentials is null || _sync is null) return;
        if (!_credentials.NeedsEnrollment) return;

        if (string.IsNullOrWhiteSpace(_settings.EnrollmentCode))
        {
            _log.Warn("No enrolment code — this device has not been added to the server");
            return;
        }

        var enroller = new EnrollmentClient(
            _sync,
            new DeviceTokenStore(log: _log.Info),
            _credentials,
            _version,
            _log.Info);

        var monitors = MonitorEnumerator.Enumerate().Count;
        var result = await enroller.EnrollWithRetryAsync(
            new SecretText(_settings.EnrollmentCode), monitors, ct: ct);

        _log.Info(result.Ok ? "✅ Device enrolled" : $"Enrolment failed: {result.Message}");
        PublishStatus();
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

            _outbox?.EnqueueAsync(OutboxCodec.Item(s, DateTimeOffset.UtcNow))
                   .ContinueWith(
                       t => _log.Error("Could not queue the segment", t.Exception),
                       TaskContinuationOptions.OnlyOnFaulted);
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

            QueueDepth = depth,
            LastSyncAt = _worker?.LastSuccessAt,
            Health = _worker?.Health ?? SyncHealth.Ok,
            HealthDetail = _worker?.HealthDetail,
            Paused = false,
        };
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
        if (_outbox is not null && TryMarkClosing(AgentEventTypes.AgentStop))
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
