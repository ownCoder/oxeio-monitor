using System.Drawing;
using System.Runtime.Versioning;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray জানালার রং — <c>web/src/index.css</c>-এর টোকেনের হুবহু জোড়া।
///
/// ⭐ <b>কেন এই ফাইলটা দরকার হলো:</b> আগে জানালা আঁকা হতো
/// <see cref="SystemColors"/> দিয়ে — <c>Window</c>, <c>WindowText</c>,
/// <c>GrayText</c>, <c>ControlLight</c>। ফলে জানালাটা Windows যা পরে আছে
/// তা-ই পরত, আর oXeio-র নিজের কোনো পরিচয় বহন করত না। অথচ এটাই একমাত্র
/// পর্দা যা প্রতিটা কর্মী রোজ দেখে।
///
/// ⚠️ মানগুলো এখানে <b>হাতে লেখা ধ্রুবক</b>, কারণ CSS ফাইলটা এজেন্টের
/// বিল্ডে আসে না। ওখানে রং বদলালে এখানেও বদলাতে হবে — সেজন্যই প্রতিটার
/// পাশে টোকেনের নাম লেখা।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed record TrayTheme
{
    /// <summary><c>--color-surface</c> — জানালার পটভূমি।</summary>
    public required Color Surface { get; init; }

    /// <summary><c>--color-line</c> — হেয়ারলাইন ও বর্ডার।</summary>
    public required Color Line { get; init; }

    /// <summary><c>--color-ink</c> — মূল লেখা ও চলতি অগ্রগতির ভরাট।</summary>
    public required Color Ink { get; init; }

    /// <summary><c>--color-ink-2</c> — লেবেল।</summary>
    public required Color Ink2 { get; init; }

    /// <summary><c>--color-ink-3</c> — পাদটীকা ও নিষ্ক্রিয় ডট।</summary>
    public required Color Ink3 { get; init; }

    /// <summary>
    /// <c>--color-brand</c>। ⚠️ এই জানালায় লাল <b>কেবল সত্যিকারের গোলমালে</b> —
    /// "ডেটা সার্ভারে পৌঁছাচ্ছে না"। পিছিয়ে থাকা কোনো ইনসিডেন্ট নয়, ওটা
    /// <see cref="Idle"/> আম্বারে।
    /// </summary>
    public required Color Brand { get; init; }

    /// <summary><c>--color-ok</c> — কাজ চলছে, আর মাসের টার্গেট পূর্ণ।</summary>
    public required Color Ok { get; init; }

    /// <summary><c>--color-idle</c> — থেমে আছে, আর "পিছিয়ে আছে"।</summary>
    public required Color Idle { get; init; }

    /// <summary>মিটারের খালি অংশ (<c>--track</c>)।</summary>
    public required Color Track { get; init; }

    /// <summary>ডিফল্ট — ড্যাশবোর্ডের Midnight।</summary>
    public static TrayTheme Midnight { get; } = new()
    {
        Surface = Rgb(0x16, 0x1B, 0x22),
        Line = Rgb(0x24, 0x2B, 0x35),
        Ink = Rgb(0xE8, 0xEC, 0xF1),
        Ink2 = Rgb(0xA6, 0xB0, 0xBD),
        Ink3 = Rgb(0x6E, 0x78, 0x85),
        Brand = Rgb(0xFF, 0x4D, 0x54),
        Ok = Rgb(0x3F, 0xB9, 0x50),
        Idle = Rgb(0xD9, 0xA4, 0x06),
        Track = Rgb(0x24, 0x2B, 0x35),
    };

    /// <summary>হালকা থিম — Windows আলোয় থাকলে।</summary>
    public static TrayTheme Day { get; } = new()
    {
        Surface = Rgb(0xFF, 0xFF, 0xFF),
        Line = Rgb(0xE4, 0xE6, 0xEA),
        Ink = Rgb(0x14, 0x17, 0x1C),
        Ink2 = Rgb(0x4E, 0x56, 0x61),
        Ink3 = Rgb(0x8B, 0x93, 0xA0),
        Brand = Rgb(0xED, 0x1C, 0x24),
        Ok = Rgb(0x1F, 0x9D, 0x55),
        Idle = Rgb(0xB8, 0x86, 0x0B),
        Track = Rgb(0xE4, 0xE6, 0xEA),
    };

    /// <summary>
    /// জানালা যা পরে — <b>সবসময় Midnight</b>।
    ///
    /// ⭐ মালিকের সিদ্ধান্ত (১১ আগস্ট): Windows আলোয় থাকলেও জানালাটা পণ্যের
    /// নিজের পরিচয়ই বহন করবে, OS-এর নয়। ড্যাশবোর্ডও ঠিক তাই করে —
    /// <c>index.css</c>-এ <c>color-scheme: dark</c>, <c>light dark</c> নয়।
    /// দুই পর্দায় দুই চেহারা হলে স্টাফের চোখে ওগুলো দুটো আলাদা জিনিস হয়ে যেত।
    ///
    /// ⚠️ <see cref="Day"/> মুছে ফেলা হয়নি: রংগুলো ড্যাশবোর্ডের হালকা থিমের
    /// সাথে মিলিয়ে বাছা, আর মকআপে দুটোই আঁকা আছে। কোনোদিন সেটিংসে থিমের
    /// সুইচ এলে ওটাই লাগবে — তখন নতুন করে রং বাছতে হবে না।
    /// </summary>
    public static TrayTheme Current => Midnight;

    private static Color Rgb(int r, int g, int b) => Color.FromArgb(r, g, b);
}
