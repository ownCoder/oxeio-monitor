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

    private readonly Dictionary<(TrayFontRole Role, int Dpi), Font> _cache = new();
    private readonly string _family;
    private bool _disposed;

    public TrayFonts()
    {
        _family = PickFamily();
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
        var style = role is TrayFontRole.Strong or TrayFontRole.Big
            ? FontStyle.Bold
            : FontStyle.Regular;

        var font = new Font(_family, px, style, GraphicsUnit.Pixel);
        _cache[key] = font;
        return font;
    }

    private static float BasePixels(TrayFontRole role) => role switch
    {
        TrayFontRole.Big => 30f,
        TrayFontRole.Strong => 16f,
        TrayFontRole.Small => 12f,
        _ => 14f,
    };

    private static string PickFamily()
    {
        foreach (var candidate in Candidates)
        {
            try
            {
                // ইনস্টল করা না থাকলে ArgumentException — এটাই একমাত্র নির্ভরযোগ্য
                // পরীক্ষা, কারণ new Font(...) অজানা নাম পেলে চুপচাপ ফলব্যাক করে,
                // অর্থাৎ ভুলটা কেবল স্ক্রিনে ধরা পড়ত, কোনো লগে নয়
                using var family = new FontFamily(candidate);
                return candidate;
            }
            catch (ArgumentException)
            {
            }
        }

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
