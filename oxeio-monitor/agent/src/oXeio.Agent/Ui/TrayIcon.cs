using System.Diagnostics;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Core.Agent;
using oXeio.Core.Time;

namespace oXeio.Agent.Ui;

/// <summary>
/// ট্রে আইকন — এজেন্টের একমাত্র দৃশ্যমান অংশ।
///
/// <b>এটা সাজসজ্জা নয়, একটা কমপ্লায়েন্স সারফেস।</b> লিখিত মনিটরিং পলিসিতে
/// স্টাফকে প্রতিশ্রুতি দেওয়া আছে যে আইকনটা সবসময় দেখা যাবে। অর্থাৎ এই ক্লাসটা
/// ঠিকমতো না চললে ইনস্টলেশনটা covert হয়ে যায় — যা করা যাবে না বলা আছে। তাই:
///
///  • <see cref="NotifyIcon.Visible"/> লুকানোর কোনো পথ নেই, এবং প্রতিটা রেন্ডারে
///    আবার true করা হয় (কেউ কোড থেকে ভুল করে লুকিয়ে ফেললেও এক সেকেন্ডে ফেরে)।
///  • মেনুতে <b>Exit নেই</b>। স্টাফ ট্রে থেকে এজেন্ট থামাতে পারবে না।
///  • মেনুতে বিরতি/মিটিং/pause-এর কোনো বাটন নেই (ADR-011d)। স্টাফের চাপার মতো
///    কিছু থাকলেই সেটা approval workflow-র প্রথম ধাপ, আর এই সিস্টেমে সেরকম কিছু নেই।
///
/// ⚠️ এই অবজেক্টটা যে থ্রেডে তৈরি হবে সেই থ্রেডকেই পরে <c>Application.Run()</c>
/// ডাকতে হবে। <see cref="Publish"/> যেকোনো থ্রেড থেকে ডাকা যায়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class TrayIcon : IAgentStatusSink, IDisposable
{
    private const string BalloonTitle = "oXeio";

    /// <summary>এর ভেতরে আবার "সিঙ্ক এখন" চাপলে নতুন অনুরোধ যায় না।</summary>
    private static readonly TimeSpan SyncDebounce = TimeSpan.FromSeconds(20);

    private readonly MonotonicClock _clock;
    private readonly UiDispatcher _dispatcher;
    private readonly TrayIconPainter _painter;
    private readonly TrayFonts _fonts;
    private readonly BalloonThrottle _balloons;

    private readonly NotifyIcon _notify;
    private readonly ContextMenuStrip _menu;
    private readonly ToolStripMenuItem _todayItem;
    private readonly ToolStripMenuItem _portalItem;
    private readonly ToolStripMenuItem _policyItem;
    private readonly ToolStripMenuItem _syncItem;
    private readonly ToolStripMenuItem _aboutItem;

    // ── শুধু UI থ্রেড থেকে ছোঁয়া হয় ──────────────────────────────────────
    private TrayOptions _options;
    private AgentStatus _status = AgentStatus.Starting;
    private TrayVisual? _shownVisual;
    private string? _shownText;
    private SyncHealth? _shownHealth;
    private TimeSpan? _lastSyncRequest;
    private TodayForm? _todayForm;
    private AboutForm? _aboutForm;

    // ── থ্রেড পেরিয়ে যায় ─────────────────────────────────────────────────
    private AgentStatus _pending = AgentStatus.Starting;
    private int _renderScheduled;
    private volatile bool _disposed;

    public TrayIcon(TrayOptions options, MonotonicClock? clock = null)
    {
        ArgumentNullException.ThrowIfNull(options);

        _options = options;
        _clock = clock ?? MonotonicClock.StartNow();
        _dispatcher = new UiDispatcher(options.OnError);
        _painter = new TrayIconPainter();
        _fonts = new TrayFonts();
        _balloons = new BalloonThrottle();

        _todayItem = new ToolStripMenuItem("আজকের সময়");
        _portalItem = new ToolStripMenuItem("আমার তথ্য");
        _policyItem = new ToolStripMenuItem("পলিসি দেখুন");
        _syncItem = new ToolStripMenuItem("সিঙ্ক এখন");
        _aboutItem = new ToolStripMenuItem("সম্পর্কে");

        _todayItem.Click += (_, _) => Guarded(ShowToday);
        _portalItem.Click += (_, _) => Guarded(() =>
            OpenExternal(_options.StaffPortalUrl, "স্টাফ পোর্টালের ঠিকানা বসানো নেই"));
        _policyItem.Click += (_, _) => Guarded(() =>
            OpenExternal(_options.PolicyUrl, "পলিসি ডকুমেন্ট পাওয়া যায়নি"));
        _syncItem.Click += (_, _) => Guarded(RequestSync);
        _aboutItem.Click += (_, _) => Guarded(ShowAbout);

        _menu = new ContextMenuStrip
        {
            Font = _fonts.Get(TrayFontRole.Body, _dispatcher.Dpi),
            ShowImageMargin = false,
        };

        _menu.Items.AddRange(new ToolStripItem[]
        {
            _todayItem,
            _portalItem,
            _policyItem,
            new ToolStripSeparator(),
            _syncItem,
            _aboutItem,
        });

        // ⚠️ এখানে কোনো "প্রস্থান" আইটেম যোগ করবেন না। যোগ করলে স্টাফ নিজের
        //    ট্র্যাকিং বন্ধ করে দিতে পারত, আর তখন ২০৮ ঘণ্টার হিসাবের কোনো মানে থাকত না।

        _menu.Opening += (_, _) => Guarded(RefreshMenu);

        // ⚠️ হাতে <c>Shell_NotifyIcon</c> না ডেকে WinForms-এর NotifyIcon ব্যবহারের
        //    একটা নির্দিষ্ট কারণ আছে: explorer.exe ক্র্যাশ করে আবার চালু হলে ট্রে-র
        //    সব আইকন মুছে যায় আর shell একটা রেজিস্টার-করা "TaskbarCreated" মেসেজ
        //    ব্রডকাস্ট করে। যে ইমপ্লিমেন্টেশন ওটা ধরে না, তার আইকন পরের রিবুট
        //    পর্যন্ত উধাও — অর্থাৎ ঠিক তখনই অদৃশ্য, যখন কেউ দেখছে না।
        //    NotifyIcon মেসেজটা নিজেই রেজিস্টার করে আইকন ফিরিয়ে আনে।
        _notify = new NotifyIcon
        {
            ContextMenuStrip = _menu,
            Icon = _painter.Get(TrayVisual.Idle),
            Text = BalloonTitle,
            Visible = true,
        };

        _notify.DoubleClick += (_, _) => Guarded(ShowToday);

        // প্রথম চেহারাটা এখনই বসিয়ে দেওয়া, প্রথম Publish-এর অপেক্ষা না করে
        Render(AgentStatus.Starting);
    }

    // ── IAgentStatusSink ──────────────────────────────────────────────────

    /// <summary>
    /// ট্র্যাকিং/সিঙ্ক থ্রেড থেকে আসে। কখনো ব্লক করে না, কখনো ছোড়ে না।
    ///
    /// ⚠️ প্রতিটা আপডেটের জন্য আলাদা <c>BeginInvoke</c> করা হয় না। UI থ্রেড এক
    /// মুহূর্তের জন্য আটকে গেলে (মেনু খোলা, ড্র্যাগ চলছে) সেকেন্ডে একটা করে
    /// মেসেজ জমে সারিটা ফুলে যেত। বদলে সবশেষ স্ট্যাটাসটা রাখা হয় আর একটাই
    /// রেন্ডার সারিবদ্ধ থাকে — মাঝের ফ্রেমগুলো এমনিতেও কেউ দেখত না।
    /// </summary>
    public void Publish(AgentStatus status)
    {
        if (status is null || _disposed) return;

        Volatile.Write(ref _pending, status);

        if (Interlocked.Exchange(ref _renderScheduled, 1) == 0)
            _dispatcher.Post(RenderPending);
    }

    /// <summary>এনরোলমেন্টের পর ডিভাইস আইডি/কর্মীর নাম বসাতে।</summary>
    public void UpdateOptions(TrayOptions options)
    {
        if (options is null || _disposed) return;

        _dispatcher.Post(() =>
        {
            _options = options;
            _aboutForm?.RedrawContent();
            _todayForm?.Invalidate();
        });
    }

    // ── রেন্ডার (সবসময় UI থ্রেডে) ─────────────────────────────────────────

    private void RenderPending()
    {
        // ⚠️ আগে পতাকা নামাও, তারপর মান পড়ো। উল্টো করলে এই দুই ধাপের মাঝে আসা
        //    আপডেটটা হারিয়ে যেত — আইকন চিরকাল পুরোনো অবস্থায় আটকে থাকত।
        Interlocked.Exchange(ref _renderScheduled, 0);
        Render(Volatile.Read(ref _pending));
    }

    private void Render(AgentStatus status)
    {
        if (_disposed) return;

        _status = status;

        var visual = TrayVisuals.For(status);
        if (_shownVisual != visual)
        {
            _shownVisual = visual;

            // ⚠️ শুধু বদলালেই বসানো হয়। প্রতি সেকেন্ডে একই আইকন আবার বসালে
            //    shell প্রতিবার ট্রে-টা নতুন করে আঁকে — কিছু মেশিনে সেটা চোখে
            //    পড়ার মতো ঝিকিমিকি করে।
            _notify.Icon = _painter.Get(visual);
        }

        var text = TrayTooltip.Build(status);
        if (!string.Equals(_shownText, text, StringComparison.Ordinal))
        {
            _shownText = text;
            SetTooltip(text);
        }

        // পলিসি: আইকন লুকানো যাবে না
        if (!_notify.Visible) _notify.Visible = true;

        NotifyOnHealthChange(status);
        NotifyOnMonthlyTarget(status);

        _todayForm?.Apply(status);
    }

    /// <summary>
    /// ⚠️ <see cref="NotifyIcon.Text"/> কখনো এক্সসেপশন ছুড়তে দেওয়া যাবে না।
    /// পুরোনো রানটাইমে ৬৩-র বেশি হলে <c>ArgumentOutOfRangeException</c> আসে, আর
    /// সেটা এখানে ঘটত UI থ্রেডে — অর্থাৎ পুরো এজেন্ট বন্ধ, কারণ "লেখাটা একটু
    /// লম্বা ছিল"। <see cref="TrayTooltip"/> এমনিতেই মেপে দেয়, এটা দ্বিতীয় জাল।
    /// </summary>
    private void SetTooltip(string text)
    {
        try
        {
            _notify.Text = text;
            return;
        }
        catch (ArgumentException)
        {
        }

        try
        {
            // শেষ চেষ্টা: কাঁচা কাটাকাটি। এখানে অক্ষর ভাঙার ঝুঁকি নেওয়া হচ্ছে,
            // কারণ বিকল্প হলো টুলটিপ ছাড়া একটা আইকন।
            _notify.Text = text.Length > TrayTooltip.MaxLength
                ? text[..TrayTooltip.MaxLength]
                : text;
        }
        catch (ArgumentException)
        {
            try { _notify.Text = BalloonTitle; }
            catch (ArgumentException) { }
        }
    }

    // ── বেলুন ─────────────────────────────────────────────────────────────

    private void NotifyOnHealthChange(AgentStatus status)
    {
        var previous = _shownHealth;
        if (previous == status.Health) return;

        _shownHealth = status.Health;

        // প্রথম রেন্ডারে বেলুন নয় — চালু হওয়ার মুহূর্তে "সব ঠিক আছে" জানানোর
        // কোনো দরকার নেই, আর তাতে বাস্তব সমস্যার বেলুনটা এক ঘণ্টা চাপা পড়ত
        if (previous is null) return;

        switch (status.Health)
        {
            case SyncHealth.Failing:
                Balloon("sync_failing", TrayTooltip.SyncFailingLine, ToolTipIcon.Warning);
                break;

            case SyncHealth.Revoked:
                Balloon("revoked", TrayTooltip.RevokedLine, ToolTipIcon.Warning);
                break;

            case SyncHealth.Ok when previous is SyncHealth.Failing or SyncHealth.Degraded:
                Balloon("sync_restored", "সার্ভারের সাথে সংযোগ ফিরে এসেছে", ToolTipIcon.Info);
                break;
        }
    }

    /// <summary>
    /// J03 — এ মাসের লক্ষ্য পূরণ হলে একবার ✅।
    ///
    /// ⭐ <b>মনে রাখা হয় দেখানোর আগে, পরে নয়।</b> বেলুন দেখানো একটা নীরবে
    /// ব্যর্থ হতে পারা কাজ (Focus Assist, নোটিফিকেশন বন্ধ) — সেটার সফলতার
    /// উপর স্মৃতি বসালে ওই মেশিনে প্রতিটা heartbeat-এ আবার চেষ্টা হতো, আর
    /// Focus Assist বন্ধ হওয়ার মুহূর্তে বেলুনের বন্যা নামত।
    ///
    /// ⚠️ এখানে কোনো "রেন্ডারের আগে-পরে" তুলনা নেই, ইচ্ছাকৃতভাবে। লক্ষ্যটা
    /// এজেন্ট বন্ধ থাকা অবস্থায়ও পূর্ণ হতে পারে (কর্মী অন্য PC-তে কাজ করেছে),
    /// তখন প্রথম heartbeat-এই শর্তটা সত্যি হয়ে আসে — "বদলেছে কি না" দেখলে
    /// ওই স্টাফ কোনোদিন বেলুনটা পেত না।
    /// </summary>
    private void NotifyOnMonthlyTarget(AgentStatus status)
    {
        var memory = _options.Milestone;
        if (memory is null) return;

        if (!MonthlyMilestone.ShouldCelebrate(
                status, DateTimeOffset.UtcNow, memory.LastCelebrated(), out var monthKey))
        {
            return;
        }

        memory.Remember(monthKey);
        Balloon(
            MonthlyMilestone.EventClass,
            MonthlyMilestone.Text(status.MonthlyTargetHours),
            ToolTipIcon.Info);
    }

    /// <summary>
    /// ⚠️ timeout প্যারামিটারটা Windows Vista থেকে উপেক্ষিত — কতক্ষণ দেখা যাবে
    /// সেটা এখন সিস্টেম ঠিক করে। ⚠️ Focus Assist চালু থাকলে বা ইউজার
    /// নোটিফিকেশন বন্ধ করে রাখলে এটা নীরবে কিছুই করে না, কোনো ত্রুটি ছাড়াই —
    /// তাই বেলুনকে কখনো একমাত্র বার্তাবাহক ধরা যাবে না, আইকন ও টুলটিপই মূল।
    /// </summary>
    private void Balloon(string eventClass, string text, ToolTipIcon icon)
    {
        if (string.IsNullOrEmpty(text)) return;
        if (!_balloons.ShouldShow(eventClass, _clock.Elapsed)) return;

        try
        {
            _notify.ShowBalloonTip(10_000, BalloonTitle, text, icon);
        }
        catch (Exception ex)
        {
            Report(ex);
        }
    }

    // ── মেনুর কাজ ─────────────────────────────────────────────────────────

    private void RefreshMenu()
    {
        _portalItem.Enabled = !string.IsNullOrWhiteSpace(_options.StaffPortalUrl);
        _policyItem.Enabled = !string.IsNullOrWhiteSpace(_options.PolicyUrl);

        var busy = _options.RequestSyncNow is null ||
                   (_lastSyncRequest is { } last && _clock.Elapsed - last < SyncDebounce);

        _syncItem.Enabled = !busy;
        _syncItem.Text = busy && _lastSyncRequest is not null ? "সিঙ্ক চলছে…" : "সিঙ্ক এখন";
    }

    private void ShowToday()
    {
        if (_todayForm is { IsDisposed: false } existing)
        {
            existing.Activate();
            return;
        }

        var form = new TodayForm(_fonts, () => _options);
        form.FormClosed += (_, _) => _todayForm = null;

        _todayForm = form;
        form.Apply(_status);
        form.Show();
        form.PositionNearTray();
        form.Activate();
    }

    private void ShowAbout()
    {
        if (_aboutForm is { IsDisposed: false } existing)
        {
            existing.Activate();
            return;
        }

        var form = new AboutForm(_fonts, () => _options);
        form.FormClosed += (_, _) => _aboutForm = null;

        _aboutForm = form;
        form.Show();
        form.PositionNearTray();
        form.Activate();
    }

    private void RequestSync()
    {
        var request = _options.RequestSyncNow;
        if (request is null) return;

        var now = _clock.Elapsed;
        if (_lastSyncRequest is { } last && now - last < SyncDebounce) return;

        _lastSyncRequest = now;

        // ⚠️ UI থ্রেডে সিঙ্ক ডাকা যাবে না। ইমপ্লিমেন্টেশন যদি একটা HTTP কল করে
        //    বসে থাকে, ততক্ষণ ট্রে জমে থাকত — আর স্টাফ ভাবত এজেন্ট ক্র্যাশ করেছে,
        //    ঠিক যখন সে সংযোগ নিয়ে দুশ্চিন্তায় আছে।
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try { request(); }
            catch (Exception ex) { Report(ex); }
        });

        Balloon("sync_now", "সিঙ্কের চেষ্টা শুরু হয়েছে", ToolTipIcon.Info);
    }

    // ── বাইরের লিংক ───────────────────────────────────────────────────────

    private void OpenExternal(string? target, string missingMessage)
    {
        if (string.IsNullOrWhiteSpace(target) || !TryResolveTarget(target, out var launch))
        {
            Balloon("link_missing", missingMessage, ToolTipIcon.Warning);
            return;
        }

        try
        {
            // ⚠️ UseShellExecute স্পষ্ট করে true। .NET Core-এ এর ডিফল্ট false, আর
            //    তখন একটা URL দিলে "The specified executable is not a valid
            //    application" বলে Win32Exception আসে — লোকাল মেশিনে পরীক্ষা না
            //    করলে এটা ধরা পড়ে না।
            using var process = Process.Start(new ProcessStartInfo(launch)
            {
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            Report(ex);
            Balloon("link_failed", "লিংকটি খোলা গেল না", ToolTipIcon.Warning);
        }
    }

    /// <summary>শুধু http/https, অথবা <see cref="AllowedDocumentExtensions"/>-এর কোনো ফাইল।</summary>
    private static bool TryResolveTarget(string target, out string launch)
    {
        launch = string.Empty;

        if (Uri.TryCreate(target, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            {
                launch = uri.AbsoluteUri;
                return true;
            }

            return uri.IsFile && TryResolveFile(uri.LocalPath, out launch);
        }

        return TryResolveFile(target, out launch);
    }

    /// <summary>
    /// ⚠️ এই সাদা তালিকাটাই আসল নিরাপত্তা। পলিসির ঠিকানা আসে কনফিগ থেকে, আর
    /// কনফিগ আসে নেটওয়ার্ক দিয়ে। যাচাই না করে ShellExecute করলে ওই একটা
    /// স্ট্রিং বদলেই স্টাফের অ্যাকাউন্টে যেকোনো <c>.exe</c>, <c>.lnk</c>,
    /// <c>.hta</c> বা <c>.ps1</c> চালানো যেত — মনিটরিং এজেন্ট তখন নিজেই
    /// সবচেয়ে সহজ আক্রমণপথ।
    /// </summary>
    private static readonly string[] AllowedDocumentExtensions =
        [".pdf", ".html", ".htm", ".md", ".txt", ".rtf", ".docx"];

    private static bool TryResolveFile(string path, out string launch)
    {
        launch = string.Empty;

        try
        {
            var full = Path.GetFullPath(path);
            if (!File.Exists(full)) return false;

            var extension = Path.GetExtension(full);
            foreach (var allowed in AllowedDocumentExtensions)
            {
                if (string.Equals(extension, allowed, StringComparison.OrdinalIgnoreCase))
                {
                    launch = full;
                    return true;
                }
            }

            return false;
        }
        catch (Exception ex) when (
            ex is ArgumentException or NotSupportedException or
                  PathTooLongException or IOException or UnauthorizedAccessException or
                  System.Security.SecurityException)
        {
            return false;
        }
    }

    // ── সহায়ক ─────────────────────────────────────────────────────────────

    private void Guarded(Action action)
    {
        try
        {
            if (!_disposed) action();
        }
        catch (Exception ex)
        {
            Report(ex);
        }
    }

    private void Report(Exception ex)
    {
        try { _options.OnError?.Invoke(ex); }
        catch { /* লগারও ভাঙলে আর কিছু করার নেই */ }
    }

    // ── বন্ধ ──────────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // ⚠️ সরাসরি নয়, UI থ্রেডে পাঠিয়ে। NotifyIcon/Form অন্য থ্রেড থেকে
        //    Dispose করলে হ্যান্ডেল ধ্বংস হয় ভুল থ্রেডে, আর ট্রেতে একটা ভূতুড়ে
        //    আইকন পড়ে থাকে যতক্ষণ না কেউ তার উপর মাউস নেয়।
        _dispatcher.Post(TearDown);
    }

    private void TearDown()
    {
        // ক্রমটাই আসল কাজ:
        // ১) আইকন লুকাও — না লুকিয়ে Dispose করলে shell-এর কাছে এন্ট্রিটা থেকে
        //    যায়, আর "ভূতুড়ে আইকন" রয়ে যায়
        // ২) Icon = null — নইলে ধাপ ৪-এ ধ্বংস করা HICON shell আঁকতে যেত
        // ৩) জানালাগুলো বন্ধ
        // ৪) আঁকার সম্পদ
        try { _notify.Visible = false; } catch (Exception ex) { Report(ex); }
        try { _notify.Icon = null; } catch (Exception ex) { Report(ex); }

        try { _todayForm?.Close(); } catch (Exception ex) { Report(ex); }
        try { _aboutForm?.Close(); } catch (Exception ex) { Report(ex); }
        _todayForm = null;
        _aboutForm = null;

        try { _notify.Dispose(); } catch (Exception ex) { Report(ex); }
        try { _menu.Dispose(); } catch (Exception ex) { Report(ex); }

        try { _painter.Dispose(); } catch (Exception ex) { Report(ex); }
        try { _fonts.Dispose(); } catch (Exception ex) { Report(ex); }

        // সবার শেষে — এটার হ্যান্ডেল দিয়েই এখানে পৌঁছানো গেছে
        try { _dispatcher.Dispose(); } catch (Exception ex) { Report(ex); }
    }
}
