using System.Runtime.Versioning;
using System.Windows.Forms;

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
/// <item>ব্যাকগ্রাউন্ড টাস্ক — ক্যাপচার, সিঙ্ক, heartbeat। ধীর কাজ শুধু এখানে।</item>
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

    private readonly AgentSettings _settings;
    private readonly string _version;
    private readonly ISyncLog _log;

    private readonly MonotonicClock _clock = MonotonicClock.StartNow();
    private readonly IdleProbe _idle = new();
    private readonly SleepGapDetector _sleep = new(Tick);
    private readonly CancellationTokenSource _stopping = new();

    private SqliteOutboxStore? _outbox;
    private HttpSyncClient? _sync;
    private SyncWorker? _worker;
    private DeviceCredentials? _credentials;
    private TrayIcon? _tray;
    private IdleStateMachine? _machine;
    private ScreenCaptureService? _capture;
    private SlotScheduler? _slots;
    private CaptureWindow _window = CaptureWindow.Default;

    private volatile bool _sessionSuspended;
    private long _activeTodaySec;
    private DateOnly _activeDate;
    private EmployeeProgress? _progress;
    private string? _configVersion;

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
            error = $"এই সেশনে সময় গোনা যাবে না — {guard.Explanation}";
            return false;
        }

        if (!AgentDataDirectory.TryEnsure(AgentDataDirectory.Default, out var dirError))
        {
            error = $"ডেটা ফোল্ডার তৈরি করা গেল না: {dirError}";
            return false;
        }

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

        // ── অফলাইন কিউ ─────────────────────────────────────────────────────
        // ⚠️ কিউ খুলতে না পারলেও এজেন্ট চলে। সময় গোনা বন্ধ হয় না; শুধু
        //    পাঠানো যায় না, আর সেটা tray-তে লাল হয়ে দেখা যায়।
        try
        {
            _outbox = SqliteOutboxStore.Open(log: _log.Info);
            _worker = new SyncWorker(_outbox, _sync, _log);
        }
        catch (Exception ex)
        {
            _log.Error("অফলাইন কিউ খোলা গেল না — ডেটা জমবে না", ex);
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

        // ── tray ────────────────────────────────────────────────────────────
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
        _ = Task.Run(() => SyncLoopAsync(_stopping.Token));
        _ = Task.Run(() => HeartbeatLoopAsync(_stopping.Token));
        _ = Task.Run(() => EnrollIfNeededAsync(_stopping.Token));
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
                _log.Error("ট্র্যাকার টিক ব্যর্থ — চলতে থাকছে", ex);
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
                _log.Error("ক্যাপচার স্লট ব্যর্থ", ex);
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

        foreach (var r in results)
        {
            // ⚠️ uuid আগে তৈরি — ফাইলের নাম আর সারির clientUuid এক হতে হবে,
            //    নইলে ফাইল আর মেটাডেটা জোড়া হারিয়ে ফেলত।
            var uuid = Guid.NewGuid();

            var path = _outbox.Paths.NewScreenshotPath(slot.SlotStart, r.MonitorIndex, uuid);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllBytesAsync(path, r.Webp, ct);

            var meta = new ScreenshotRecord
            {
                ClientUuid = uuid,
                SlotStart = slot.SlotStart,
                CapturedAt = DateTimeOffset.UtcNow,
                MonitorIndex = r.MonitorIndex,
                Width = r.Width,
                Height = r.Height,
            };

            await _outbox.EnqueueAsync(
                OutboxCodec.Item(meta, path, r.Webp.LongLength, DateTimeOffset.UtcNow), ct);
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
                    }, ct);

                    if (result.IsSuccess && result.Value is { } body)
                    {
                        _configVersion = body.ConfigVersion;
                        if (body.Progress is not null) _progress = body.Progress;
                        PublishStatus();
                    }
                    else if (result.Outcome == SyncOutcome.Revoked)
                    {
                        _credentials.Revoke("সার্ভার থেকে বাতিল");
                    }
                }
            }
            catch (Exception ex)
            {
                _log.Error("heartbeat ব্যর্থ", ex);
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
            _log.Warn("enrollment কোড নেই — এই ডিভাইস সার্ভারে যুক্ত হয়নি");
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

        _log.Info(result.Ok ? "✅ ডিভাইস enroll হয়েছে" : $"enroll ব্যর্থ: {result.Message}");
        PublishStatus();
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
                       t => _log.Error("সেগমেন্ট কিউয়ে রাখা গেল না", t.Exception),
                       TaskContinuationOptions.OnlyOnFaulted);
        }
    }

    private AgentStatus Snapshot()
    {
        var depth = _worker?.Depth.Total ?? 0;

        return new AgentStatus
        {
            State = _machine?.State ?? SegmentState.Idle,

            // ⭐ আজকের হিসাব সার্ভারেরটাই — এজেন্টের নিজেরটা রিবুটে শূন্য হয়।
            //    সার্ভার এখনো কিছু না বললে (একবারও heartbeat হয়নি) নিজেরটা।
            ActiveToday = TimeSpan.FromSeconds(
                _progress?.TodayActiveSec ?? Interlocked.Read(ref _activeTodaySec)),
            ActiveThisMonth = TimeSpan.FromSeconds(_progress?.MonthActiveSec ?? 0),
            MonthlyTargetHours = _progress?.MonthlyTargetHours ?? 208,

            QueueDepth = depth,
            LastSyncAt = _worker?.LastSuccessAt,
            Health = _worker?.Health ?? SyncHealth.Ok,
            HealthDetail = _worker?.HealthDetail,
            Paused = false,
        };
    }

    private void PublishStatus() => _tray?.Publish(Snapshot());

    // ── উইন্ডো মেসেজ (UI থ্রেড থেকে) ────────────────────────────────────────

    public void OnSessionChange(SessionChange? change)
    {
        if (change == SessionChange.Suspend) _sessionSuspended = true;
        else if (change == SessionChange.Resume) _sessionSuspended = false;
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

        // শেষ চেষ্টা — বন্ধ হওয়ার আগে যা আছে পাঠিয়ে দেওয়া
        if (_worker is not null)
        {
            using var last = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            try { await _worker.DrainOnceAsync(last.Token); }
            catch (Exception) { /* বন্ধ হচ্ছে — আর কিছু করার নেই */ }
        }

        _tray?.Dispose();
        _capture?.Dispose();
        _sync?.Dispose();
        if (_outbox is not null) await _outbox.DisposeAsync();
        _stopping.Dispose();
    }
}
