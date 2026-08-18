using System.Drawing;
using System.Runtime.Versioning;

namespace oXeio.Agent.Ui;

internal enum TrayFontRole
{
    /// <summary>সাধারণ লেখা।</summary>
    Body,

    /// <summary>শিরোনাম ও গুরুত্বপূর্ণ লাইন।</summary>
    Strong,

    /// <summary>আজকের ঘণ্টা — জানালার সবচেয়ে বড় সংখ্যা।</summary>
    Big,

    /// <summary>পাদটীকা ও ব্যাখ্যা।</summary>
    Small,

    /// <summary>
    /// হিরো সংখ্যা — আজ কত ঘণ্টা গোনা হয়েছে। <see cref="Big"/>-এর চেয়ে বড়
    /// আর হালকা: ৪৪px semibold। ⚠️ ৪৪px bold-এ সংখ্যাটা চিৎকার করত, আর
    /// এই জানালার কাজ আশ্বাস দেওয়া, দাবি করা নয়।
    /// </summary>
    Hero,

    /// <summary>
    /// হিরো সংখ্যার <b>সেকেন্ড অংশ</b> — <see cref="Hero"/>-র ঠিক অর্ধেক (২২px)।
    ///
    /// ⭐ মালিকের চাওয়া (১৮ আগস্ট): <c>3:59:22</c>-এর <c>:22</c> অর্ধেক মাপে।
    /// ⚠️⚠️ কারণটা সাজসজ্জার চেয়ে বেশি: সেকেন্ডটাই একমাত্র অঙ্ক যেটা
    /// <b>প্রতি সেকেন্ডে</b> বদলায়, আর পুরো মাপে সেটা চোখ টেনে রাখত —
    /// অথচ কাজের সংখ্যা ঘণ্টা ও মিনিট। ছোট করলে নড়াচড়াটা থাকে (ঘড়ি
    /// চলছে, সেটা দেখা যায়), কিন্তু আর চিৎকার করে না।
    /// ⚠️ ফ্যামিলি ও style <see cref="Hero"/>-রই — নইলে দুটো অঙ্ক দেখতে
    /// দুই পরিবারের লাগত, আর baseline মেলানোর হিসাবও ভাঙত।
    /// </summary>
    HeroSeconds,

    /// <summary>রিডআউটের ছোট বড়-হাতের লেবেল (SYNC · LAST SYNC · QUEUED)।</summary>
    Micro,

    /// <summary>
    /// সংখ্যা ও ঘড়ির রিডআউট। ⚠️ আলাদা ফ্যামিলি (Cascadia Mono) — ওয়েবের
    /// <c>--font-mono</c> যা বলে। সমান-প্রস্থের অঙ্ক পাশাপাশি বসলে চোখ
    /// তুলনা করতে পারে; proportional-এ "১১:১১" আর "১৯:৪০" আলাদা চওড়া হতো।
    /// </summary>
    Mono,
}

/// <summary>
/// জানালার লেখার ফন্ট, DPI অনুযায়ী ক্যাশ করা।
///
/// ⚠️ ফন্ট একটা GDI হ্যান্ডেল। প্রতিটা <c>OnPaint</c>-এ <c>new Font(...)</c> লিখলে
/// দেখতে নিরীহ লাগে (GC তো আছেই), কিন্তু ফাইনালাইজার চলার আগেই হাজারখানেক
/// হ্যান্ডেল জমতে পারে — আর এই জানালা খোলা রেখে কেউ দিনভর কাজ করলে সেটাই ঘটে।
/// তাই (ভূমিকা, DPI) জোড়া ধরে ক্যাশ। জোড়ার সংখ্যা সীমিত: ৪টা ভূমিকা × হাতে
/// গোনা কয়েকটা DPI।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class TrayFonts : IDisposable
{
    /// <summary>
    /// অগ্রাধিকার ক্রমে ফন্ট। Segoe UI Windows-এর নিজস্ব UI ফন্ট, Vista থেকে
    /// সব সংস্করণে আছে — আমাদের সর্বনিম্ন লক্ষ্য Windows 10 1809-এর অনেক আগে।
    /// বাকি দুটো নিছক নিরাপত্তা, কেউ সিস্টেম ফন্ট আনইনস্টল করে ফেললে।
    ///
    /// ⚠️ আগে এখানে "Nirmala UI"/"Shonar Bangla"/"Vrinda" প্রথমে ছিল, কারণ
    /// লেখা ছিল বাংলা। পর্দার সব লেখা ইংরেজি হওয়ার পর ওই তালিকাটা শুধু
    /// অপ্রয়োজনীয় নয়, ক্ষতিকরও: Nirmala UI ইন্ডিক লিপির জন্য বানানো, তার
    /// ল্যাটিন মেট্রিক Segoe UI-এর মতো নয়, আর Windows-এর বাকি সব UI-র পাশে
    /// জানালাটা বেমানান দেখাত।
    /// </summary>
    private static readonly string[] Candidates =
    [
        "Segoe UI", "Tahoma", "Arial",
    ];

    /// <summary>
    /// রিডআউটের সমান-প্রস্থ ফন্ট — ওয়েবের <c>--font-mono</c>-র সাথে এক।
    /// Cascadia Mono Windows 11-এ আছে, Consolas Vista থেকেই আছে।
    /// </summary>
    private static readonly string[] MonoCandidates =
    [
        "Cascadia Mono", "Consolas", "Courier New",
    ];

    /// <summary>
    /// ⚠️ semibold Windows-এ <b>আলাদা ফ্যামিলি</b>, style নয় — "Segoe UI"-তে
    /// <c>FontStyle.Bold</c> দিলে ৭০০ ওজন আসে, ৬০০ নয়। না পেলে নিচে
    /// <see cref="TrayFontRole.Hero"/> bold-এ ফিরে যায়।
    /// </summary>
    private const string SemiboldFamily = "Segoe UI Semibold";

    private readonly Dictionary<(TrayFontRole Role, int Dpi), Font> _cache = new();
    private readonly string _family;
    private readonly string _mono;
    private readonly string? _semibold;
    private bool _disposed;

    public TrayFonts()
    {
        _family = PickFamily();
        _mono = PickFrom(MonoCandidates) ?? _family;
        _semibold = Exists(SemiboldFamily) ? SemiboldFamily : null;
    }

    public string FamilyName => _family;

    public Font Get(TrayFontRole role, int dpi)
    {
        if (dpi < 72) dpi = 96;
        if (dpi > 480) dpi = 480;

        var key = (role, dpi);
        if (_cache.TryGetValue(key, out var cached)) return cached;

        // ⚠️ মাপ পয়েন্টে নয়, পিক্সেলে। PerMonitorV2 প্রক্রিয়ায় WinForms নিজে থেকে
        //    ফন্ট রি-স্কেল করে না, ফলে পয়েন্ট-ভিত্তিক ফন্ট ১৫০% মনিটরে ঠিক
        //    ততটাই ছোট থাকত যতটা ১০০%-এ — অথচ জানালাটা বড় হয়ে যেত।
        var px = BasePixels(role) * dpi / 96f;

        // Hero semibold ফ্যামিলি পেলে সেটাই, নইলে bold — দুটোর কোনোটাই না
        // পেলে অন্তত মোটা দেখাক, নইলে হিরো সংখ্যাটা বডি লেখার মতো লাগত।
        var family = role switch
        {
            TrayFontRole.Mono => _mono,
            TrayFontRole.Hero or TrayFontRole.HeroSeconds => _semibold ?? _family,
            _ => _family,
        };

        var style = role switch
        {
            TrayFontRole.Strong or TrayFontRole.Big => FontStyle.Bold,
            TrayFontRole.Hero or TrayFontRole.HeroSeconds =>
                _semibold is null ? FontStyle.Bold : FontStyle.Regular,
            _ => FontStyle.Regular,
        };

        var font = new Font(family, px, style, GraphicsUnit.Pixel);
        _cache[key] = font;
        return font;
    }

    private static float BasePixels(TrayFontRole role) => role switch
    {
        TrayFontRole.Hero => 44f,
        // ⚠️ ঠিক অর্ধেক, হাতে বসানো কোনো সংখ্যা নয় — হিরোর মাপ বদলালে
        //    সেকেন্ডও আপনাআপনি সঙ্গে যায়
        TrayFontRole.HeroSeconds => 44f / 2f,
        TrayFontRole.Big => 30f,
        TrayFontRole.Strong => 16f,
        TrayFontRole.Mono => 13f,
        TrayFontRole.Small => 12f,
        TrayFontRole.Micro => 10.5f,
        _ => 14f,
    };

    /// <summary>
    /// ইনস্টল করা না থাকলে <see cref="ArgumentException"/> — এটাই একমাত্র
    /// নির্ভরযোগ্য পরীক্ষা, কারণ <c>new Font(...)</c> অজানা নাম পেলে চুপচাপ
    /// ফলব্যাক করে, অর্থাৎ ভুলটা কেবল স্ক্রিনে ধরা পড়ত, কোনো লগে নয়।
    /// </summary>
    private static bool Exists(string family)
    {
        try
        {
            using var probe = new FontFamily(family);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static string? PickFrom(string[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (Exists(candidate)) return candidate;
        }

        return null;
    }

    private static string PickFamily()
    {
        if (PickFrom(Candidates) is { } found) return found;

        try
        {
            using var messageBox = SystemFonts.MessageBoxFont;
            if (messageBox is not null) return messageBox.Name;
        }
        catch (Exception)
        {
        }

        return "Segoe UI";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var font in _cache.Values) font.Dispose();
        _cache.Clear();
    }
}
