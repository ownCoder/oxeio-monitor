using oXeio.Core.Agent;
using oXeio.Core.Models;
using oXeio.Core.Time;

namespace oXeio.Core.Apps;

/// <summary>এক মুহূর্তে সামনে থাকা উইন্ডো — Win32 থেকে যা পড়া যায়।</summary>
public sealed record WindowSample
{
    /// <summary>যেমন <c>chrome.exe</c>। খালি হলে নমুনাটাই বাদ।</summary>
    public required string ProcessName { get; init; }

    /// <summary>যেমন "Google Chrome"। না পেলে <c>null</c>।</summary>
    public string? AppName { get; init; }

    public string? WindowTitle { get; init; }

    /// <summary>address bar থেকে পড়া কাঁচা লেখা — এখানে এখনো ফুল URL থাকতে পারে।</summary>
    public string? RawUrl { get; init; }

    public bool IsBrowser { get; init; }
}

/// <summary>
/// কোন অ্যাপে কতক্ষণ (D01–D04)।
///
/// <b>প্ল্যাটফর্ম-মুক্ত</b> — Win32 থেকে পড়ার কাজটা
/// <c>oXeio.Agent/Apps/</c>-এ; এখানে শুধু নিয়ম, তাই পুরোটা ইউনিট টেস্টে
/// যাচাই করা যায়।
///
/// চারটে নিয়ম:
/// <list type="number">
/// <item>একই উইন্ডো টানা থাকলে একটাই রেকর্ড — প্রতি সেকেন্ডে নয়</item>
/// <item><b>৫ সেকেন্ডের কম হলে বাদ</b> (D04) — alt-tab-এর ঝড় ফিল্টার হয়</item>
/// <item>ACTIVE না থাকলে কিছুই গোনা হয় না — idle সময়ে কোন অ্যাপ সামনে ছিল সেটা অর্থহীন</item>
/// <item>ফুল URL কখনো বেরোয় না — শুধু ডোমেইন ([ADR-013](../../../../docs/05-Options-Decisions.md))</item>
/// </list>
/// </summary>
public sealed class AppUsageTracker(
    TimeSpan? minDuration = null,
    TimeSpan? maxDuration = null,
    Func<Guid>? newUuid = null)
{
    /// <summary>
    /// D04 — এর চেয়ে কম সময় সামনে থাকলে রেকর্ডই হয় না।
    ///
    /// alt-tab করে ফাইল খুঁজতে গিয়ে কেউ ১০টা উইন্ডো ছুঁয়ে যায়; প্রতিটা
    /// রেকর্ড হলে রিপোর্টে ১০টা এক-সেকেন্ডের সারি বসত আর আসল ছবিটা ঢেকে যেত।
    /// </summary>
    public static readonly TimeSpan DefaultMinDuration = TimeSpan.FromSeconds(5);

    /// <summary>
    /// সেগমেন্টের মতোই — টানা এক অ্যাপে কাজ করলেও রেকর্ড নিয়মিত বেরোবে,
    /// নইলে ক্র্যাশে পুরোটা হারাত ([G53](../../../../docs/08-Gap-Analysis.md))।
    /// </summary>
    public static readonly TimeSpan DefaultMaxDuration = TimeSpan.FromMinutes(5);

    private readonly TimeSpan _min = minDuration ?? DefaultMinDuration;
    private readonly TimeSpan _max = maxDuration ?? DefaultMaxDuration;
    private readonly Func<Guid> _newUuid = newUuid ?? Guid.NewGuid;

    private WindowSample? _open;
    private DateTimeOffset _openedAt;

    /// <summary>
    /// ⭐ <b>R22a</b> — খোলা খণ্ডটা কোন অবস্থায় শুরু হয়েছিল।
    ///
    /// ⚠️ অবস্থা বদলালে খণ্ডটা <b>ওখানেই কেটে</b> নতুন করে শুরু হয় — নইলে
    /// একটা সারি অর্ধেক ACTIVE অর্ধেক IDLE হয়ে বসত, আর "এই সময়টা গোনা
    /// হবে কি না" প্রশ্নের কোনো একক উত্তর থাকত না।
    /// </summary>
    private SegmentState _openState = SegmentState.Active;

    /// <summary>
    /// এখন যে উইন্ডোটা গোনা হচ্ছে — ডায়াগনস্টিক ও A07-এর জন্য।
    ///
    /// ⚠️ ACTIVE ছাড়া এটা সবসময় <c>null</c>, কারণ <see cref="Observe"/>
    /// অন্য স্টেটে খোলা রেকর্ড বন্ধ করে দেয়। স্ক্রিনশটও শুধু ACTIVE-এ ওঠে
    /// (A04), তাই ছবির সাথে জোড়া লাগাতে গিয়ে আলাদা কোনো শর্ত লাগে না।
    /// </summary>
    public WindowSample? Current => _open;

    /// <summary>এখন কোন উইন্ডো গোনা হচ্ছে — ডায়াগনস্টিকের জন্য।</summary>
    public string? CurrentProcess => _open?.ProcessName;

    /// <summary>
    /// প্রতিটি নমুনায় ডাকা হয় (উইন্ডো বদলালে, বা নিয়মিত টিকে)।
    /// </summary>
    /// <param name="sample">এখন সামনে যা আছে। কিছু না থাকলে <c>null</c>।</param>
    /// <param name="state">এজেন্টের এখনকার স্টেট — ACTIVE ছাড়া গোনা হয় না।</param>
    public IReadOnlyList<AppUsageRecord> Observe(
        WindowSample? sample, DateTimeOffset now, SegmentState state)
    {
        var closed = new List<AppUsageRecord>();

        /**
         * ⭐⭐ <b>R22a — IDLE-এও দেখা হয়, কিন্তু গোনা হয় না।</b>
         *
         * আগে এখানে শর্ত ছিল <c>state != Active</c>, অর্থাৎ ACTIVE ছাড়ার
         * সাথে সাথেই সব বন্ধ। ⚠️⚠️ ফলে idle সেগমেন্টের ভেতরে একটাও সারি
         * থাকত না — মাঠে মেপে দেখা গেছে যেটুকু overlap দেখা যেত তার গড়
         * ছিল ৫৯ সেকেন্ড, অর্থাৎ শুধু সেগমেন্টের মাথার ভুতুড়ে অংশ।
         * তাতে "এই idle সময়টায় সামনে কী ছিল?" প্রশ্নের উত্তর হারাত, আর
         * মিটিং চেনার কোনো উপায় থাকত না।
         *
         * ⚠️ <b>LOCKED এখনো বাদ</b> — পর্দা লক থাকলে সামনে কোনো উইন্ডোই
         * নেই, আর তখন যা পড়া যেত সেটা লক-স্ক্রিন। এটা গোপনীয়তার দিক থেকেও
         * ঠিক: লক করে উঠে যাওয়া মানুষটার পর্দা পড়ার কোনো কারণ নেই।
         *
         * ⚠️⚠️ আর "লাঞ্চে Excel খোলা রেখে যাওয়া কাজ নয়" নিয়মটা <b>ভাঙেনি</b>:
         * ওই খণ্ডগুলো এখন <c>State = Idle</c> নিয়ে জমা হয়, আর পড়ার প্রতিটা
         * জায়গা কেবল ACTIVE ছাঁকে। রেকর্ড থাকা আর গোনা হওয়া — দুটো আলাদা।
         */
        if (state == SegmentState.Locked || sample is null)
        {
            Close(closed, now);
            return closed;
        }

        if (_open is null)
        {
            Open(sample, now, state);
            return closed;
        }

        // ⚠️ অবস্থা বদলেছে — খণ্ডটা এখানেই কেটে নতুন অবস্থায় শুরু, নইলে
        //    একটা সারি অর্ধেক ACTIVE অর্ধেক IDLE হয়ে বসত।
        if (state != _openState)
        {
            Close(closed, now);
            Open(sample, now, state);
            return closed;
        }

        // একই উইন্ডো — শুধু লম্বা হলে ভাগ করা
        if (SameWindow(_open, sample))
        {
            SplitIfLong(closed, now);
            return closed;
        }

        Close(closed, now);
        Open(sample, now, state);
        return closed;
    }

    /// <summary>এজেন্ট বন্ধ হচ্ছে বা সেশন শেষ — যা খোলা আছে বন্ধ করো।</summary>
    public IReadOnlyList<AppUsageRecord> CloseAll(DateTimeOffset now)
    {
        var closed = new List<AppUsageRecord>();
        Close(closed, now);
        return closed;
    }

    // ── ভেতরের কাজ ──────────────────────────────────────────────────────────

    /// <summary>
    /// দুটো নমুনা একই "ব্যবহার" কি না।
    ///
    /// ⚠️ ব্রাউজারে <b>ডোমেইন বদলালে নতুন রেকর্ড</b>, যদিও প্রসেস একই।
    /// নইলে সারাদিন একটাই "chrome.exe ৮ ঘণ্টা" সারি থাকত আর D08
    /// (টপ ১০ সাইট) বলে কিছু বানানোই যেত না।
    ///
    /// টাইটেল বদলালে নতুন রেকর্ড নয় — একই পেজে স্ক্রল করলেও টাইটেল বদলায়,
    /// আর তাতে রেকর্ডের সংখ্যা অকারণে ফুলে উঠত।
    /// </summary>
    private static bool SameWindow(WindowSample a, WindowSample b) =>
        string.Equals(a.ProcessName, b.ProcessName, StringComparison.OrdinalIgnoreCase)
        && string.Equals(DomainOf(a), DomainOf(b), StringComparison.OrdinalIgnoreCase);

    private static string? DomainOf(WindowSample s) =>
        DomainParser.LooksPrivate(s.WindowTitle) ? null : DomainParser.Extract(s.RawUrl);

    private void Open(WindowSample sample, DateTimeOffset now, SegmentState state)
    {
        _open = sample;
        _openedAt = now;
        _openState = state;
    }

    private void SplitIfLong(List<AppUsageRecord> closed, DateTimeOffset now)
    {
        while (now - _openedAt >= _max)
        {
            var boundary = _openedAt + _max;
            Emit(closed, _openedAt, boundary);
            _openedAt = boundary;
        }

        // মধ্যরাত পেরোলেও ভাগ — এক রেকর্ড দুই work_date-এ থাকতে পারে না
        var midnight = DhakaTime.NextLocalMidnight(_openedAt);
        while (midnight <= now)
        {
            Emit(closed, _openedAt, midnight);
            _openedAt = midnight;
            midnight = DhakaTime.NextLocalMidnight(_openedAt);
        }
    }

    private void Close(List<AppUsageRecord> closed, DateTimeOffset now)
    {
        if (_open is null) return;

        SplitIfLong(closed, now);
        Emit(closed, _openedAt, now);

        _open = null;
    }

    private void Emit(List<AppUsageRecord> closed, DateTimeOffset from, DateTimeOffset to)
    {
        if (_open is null || to <= from) return;

        var duration = to - from;

        // D04 — ৫ সেকেন্ডের কম হলে রেকর্ডই হয় না
        if (duration < _min) return;

        var isPrivate = DomainParser.LooksPrivate(_open.WindowTitle);

        closed.Add(new AppUsageRecord
        {
            ClientUuid = _newUuid(),
            StartedAt = from,
            EndedAt = to,
            DurationSec = (int)Math.Round(duration.TotalSeconds),
            ProcessName = _open.ProcessName,
            AppName = _open.AppName,

            // ⚠️ ব্যক্তিগত ব্রাউজিংয়ে টাইটেলও যায় না — টাইটেলে পেজের নাম
            //    থাকে, অর্থাৎ ওটা রাখা মানে ঘুরিয়ে একই তথ্য রাখা।
            WindowTitle = isPrivate ? null : _open.WindowTitle,
            Domain = isPrivate ? null : DomainParser.Extract(_open.RawUrl),
            IsBrowser = _open.IsBrowser,

            // ⭐ R22a — কোন অবস্থায় দেখা হয়েছে। ⚠️ `state` প্যারামিটার নয়,
            //    `_openState`: খণ্ডটা যে অবস্থায় **শুরু** হয়েছিল সেটাই তার
            //    অবস্থা, আর অবস্থা বদলালে খণ্ডটা এমনিতেই কেটে যায় (Observe)।
            State = _openState,
        });
    }
}
