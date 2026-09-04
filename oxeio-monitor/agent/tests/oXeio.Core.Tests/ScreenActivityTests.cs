using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// <b>G46 — পর্দা সত্যিই বদলাচ্ছে কি না।</b>
///
/// ⚠️⚠️ এই ফাইলের ভুলের দুটো দিক, আর <b>দ্বিতীয়টা অনেক বেশি ক্ষতিকর</b>:
///   · কম ধরলে জিগলার ঘণ্টা চুরি করে যাবে
///   · <b>বেশি ধরলে সৎ কর্মীর কাজের সময় কাটা যাবে</b> — লম্বা নথি পড়া,
///     ভাবা, ফোনে কথা বলা; পর্দা তখন স্থির থাকতেই পারে
///
/// ⭐ তাই "জমেনি" প্রমাণ করার টেস্টগুলো এখানে অন্তত ততটাই গুরুত্ব পায়।
/// </summary>
public class ScreenActivityTests
{
    private static readonly DateTimeOffset Start =
        new(2026, 8, 16, 4, 0, 0, TimeSpan.Zero); // ঢাকায় সকাল ১০টা

    private static DateTimeOffset At(int minutes) => Start.AddMinutes(minutes);

    /// <summary>১৬×১৬ ধূসর ছাপ — সব কোষ একই মান</summary>
    private static byte[] Flat(byte value) => Enumerable.Repeat(value, 256).ToArray();

    /// <summary>
    /// বাস্তবের মতো নমুনা আসতে থাকা — প্রতি মিনিটে একই ছাপ।
    ///
    /// ⚠️⚠️ <b>টেস্টে এটা দরকার হয়, আর সেটাই আসল কথা।</b> একটামাত্র নমুনা
    /// দিয়ে আর কখনো "জমেছে" প্রমাণ করা যায় না — <see cref="ScreenActivity.StaleAfter"/>
    /// পেরোলেই সন্দেহ উঠে যায়। এজেন্টে নমুনা আসে প্রতি ৬০ সেকেন্ডে
    /// (জমে থাকলে ৫ সেকেন্ডে), তাই এখানেও তা-ই।
    /// </summary>
    private static void Steady(ScreenActivity screen, byte value, int fromMin, int toMin)
    {
        for (var m = fromMin; m <= toMin; m++) screen.Observe(Flat(value), At(m));
    }

    /// <summary>একই ছাপ, কিন্তু `cells`টা কোষ অনেকখানি বদলানো</summary>
    private static byte[] Nudged(byte value, int cells)
    {
        var f = Flat(value);
        for (var i = 0; i < cells; i++) f[i] = (byte)(value + 90);
        return f;
    }

    /// <summary>
    /// ⚠️⚠️ <b>নমুনা না থাকলে কখনোই "জমেছে" নয়।</b> ক্যাপচার বন্ধ থাকতে পারে
    /// (রাতে), ব্যর্থ হতে পারে, বা এজেন্ট সবে চালু হয়েছে — তথ্যের অভাবকে
    /// প্রমাণ ধরলে গোটা দলের গোনা বন্ধ হয়ে যেত।
    /// </summary>
    [Fact]
    public void No_sample_is_never_frozen()
    {
        var screen = new ScreenActivity();

        Assert.False(screen.IsFrozen(At(0)));
        Assert.False(screen.IsFrozen(At(600)));
        Assert.Null(screen.LastChangedAt);
    }

    /// <summary>⭐ প্রথম নমুনাটাই একটা "বদল" — তার আগে তুলনার কিছু ছিল না।</summary>
    [Fact]
    public void First_sample_counts_as_a_change()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(60), At(0));

        Assert.False(screen.IsFrozen(At(9)));
        Assert.Equal(At(0), screen.LastChangedAt);
    }

    [Fact]
    public void Same_hash_for_ten_minutes_is_frozen()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(100), At(0));
        screen.Observe(Flat(100), At(5));
        screen.Observe(Flat(100), At(10));

        Assert.True(screen.IsFrozen(At(10)));
    }

    /// <summary>⚠️ ঠিক সীমানার আগে এখনো "জমেনি" — এক মিনিটও আগে নয়।</summary>
    [Fact]
    public void Just_under_the_window_is_not_frozen()
    {
        var screen = new ScreenActivity();

        Steady(screen, 100, 0, 10);

        Assert.False(screen.IsFrozen(At(9)));
        Assert.True(screen.IsFrozen(At(10)));
    }

    /// <summary>
    /// ⭐⭐ <b>এই ফাইলের মূল টেস্ট</b> — একবার বদলালেই ঘড়ি নতুন করে শুরু।
    /// নইলে যিনি দশ মিনিট পড়ে তারপর কাজ শুরু করলেন, তাঁর গোনা বন্ধই থেকে যেত।
    /// </summary>
    [Fact]
    public void A_change_resets_the_clock()
    {
        var screen = new ScreenActivity();

        Steady(screen, 60, 0, 12);
        Assert.True(screen.IsFrozen(At(12)));

        screen.Observe(Flat(100), At(12));   // পর্দা নড়ল

        Assert.False(screen.IsFrozen(At(12)));

        Steady(screen, 100, 13, 22);
        Assert.False(screen.IsFrozen(At(21)));
        Assert.True(screen.IsFrozen(At(22)));
    }

    /// <summary>⚠️ পুরোনো হ্যাশে ফিরে গেলেও সেটা একটা বদল — পর্দা নড়েছে।</summary>
    [Fact]
    public void Returning_to_an_old_hash_is_still_a_change()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(60), At(0));
        screen.Observe(Flat(100), At(5));
        screen.Observe(Flat(60), At(10));

        Assert.False(screen.IsFrozen(At(15)));
    }

    /// <summary>
    /// ⚠️⚠️ ঘড়ি পিছিয়ে গেলে (NTP সংশোধন) হিসাবটা ঋণাত্মক হয় — তখনও
    /// "জমেছে" বলা যাবে না, নইলে একটা সময়-সংশোধনেই সবার গোনা বন্ধ হতো।
    /// </summary>
    [Fact]
    public void Clock_going_backwards_is_not_frozen()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(60), At(30));

        Assert.False(screen.IsFrozen(At(10)));
    }

    /// <summary>⭐ জানালাটা বদলানো যায় — টেস্টে ও ভবিষ্যতে নিয়ম বদলাতে</summary>
    [Fact]
    public void Window_is_configurable()
    {
        var screen = new ScreenActivity(TimeSpan.FromMinutes(2));

        screen.Observe(Flat(100), At(0));

        Assert.False(screen.IsFrozen(At(1)));
        Assert.True(screen.IsFrozen(At(2)));
    }

    [Fact]
    public void Zero_window_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new ScreenActivity(TimeSpan.Zero));
    }

    /// <summary>⭐ ডিফল্ট ১০ মিনিট — জিগলার সর্বোচ্চ ওইটুকুই চুরি করতে পারবে</summary>
    [Fact]
    public void Default_window_is_ten_minutes()
    {
        Assert.Equal(TimeSpan.FromMinutes(10), ScreenActivity.FrozenAfter);
    }

    // ── সহনশীলতা — এখানেই ফিচারটা বাঁচে বা মরে ────────────────────────────

    /// <summary>
    /// ⭐⭐⭐ <b>এই ফাইলের সবচেয়ে জরুরি টেস্ট।</b>
    ///
    /// টাস্কবারের ঘড়ি <b>প্রতি মিনিটে</b> বদলায়। হুবহু মিল খুঁজলে ওই একটা
    /// অঙ্কই যথেষ্ট হতো — পর্দা চিরকাল "বদলাচ্ছে" দেখাত, আর গোটা পাহারাটা
    /// <b>নীরবে অকেজো</b> থাকত। ঠিক এই ধরনের নীরব অকেজো ফিচার এই প্রকল্পে
    /// বারবার ফিরে এসেছে, তাই এটা টেস্টে বাঁধা।
    /// </summary>
    [Fact]
    public void Taskbar_clock_alone_does_not_count_as_a_change()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(100), At(0));
        // ঘড়ির অঙ্ক বদলাল — ২৫৬ কোষের মধ্যে দুটো
        screen.Observe(Nudged(100, cells: 2), At(5));
        screen.Observe(Nudged(100, cells: 2), At(10));

        Assert.True(screen.IsFrozen(At(10)));
    }

    /// <summary>⭐ সত্যিকারের কাজ সহজেই সীমা ছাড়ায় — স্ক্রল, টাইপ, উইন্ডো বদল</summary>
    [Fact]
    public void Real_work_counts_as_a_change()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(100), At(0));
        screen.Observe(Nudged(100, cells: 40), At(5));

        Assert.False(screen.IsFrozen(At(14)));
    }

    /// <summary>⚠️ সীমানা — ৫টা কোষে জমেই থাকে, ৬টায় বদল</summary>
    [Fact]
    public void Threshold_is_six_cells()
    {
        Assert.False(ScreenActivity.Differs(Flat(100), Nudged(100, cells: 5)));
        Assert.True(ScreenActivity.Differs(Flat(100), Nudged(100, cells: 6)));
    }

    /// <summary>
    /// ⚠️⚠️ সামান্য হেরফের (WebP-র ক্ষতিপূরণ, অ্যান্টি-এলিয়াসিং) বদল নয় —
    /// নইলে পর্দা <b>কোনোদিনই</b> জমত না।
    /// </summary>
    [Fact]
    public void Tiny_noise_everywhere_is_not_a_change()
    {
        var a = Flat(100);
        var b = Flat(100);
        for (var i = 0; i < b.Length; i++) b[i] = (byte)(100 + (i % 2 == 0 ? 10 : -10));

        Assert.False(ScreenActivity.Differs(a, b));
    }

    /// <summary>⚠️ মনিটর যোগ/বিয়োগ হলে ছাপের আকারই বদলায় — সেটা বদল</summary>
    [Fact]
    public void Different_size_is_a_change()
    {
        Assert.True(ScreenActivity.Differs(Flat(100), new byte[128]));
    }

    // ── বাসি নমুনা — যে ভুলটা বেলালের একটা দিন কেড়ে নিয়েছিল ─────────────

    /// <summary>
    /// ⭐⭐⭐ <b>এই ফাইলের সবচেয়ে দামি টেস্ট, কারণ এটা একটা সত্যিকারের
    /// ক্ষতি থেকে এসেছে।</b>
    ///
    /// ০.৪.১-এ ছাপ আসত কেবল স্ক্রিনশটের স্লট থেকে, আর স্লট চলত কেবল ACTIVE
    /// অবস্থায়। ফলে: <b>জমেছে → IDLE → স্লট বন্ধ → নতুন ছাপ নেই → চিরকাল
    /// জমে আছে</b>। কর্মী ফিরে এসে কাজ শুরু করলেও এজেন্ট স্থায়ীভাবে idle
    /// দেখাত, রিস্টার্ট না করা পর্যন্ত।
    ///
    /// ⚠️⚠️ নিয়মটা ভুল ছিল না — <b>তারের সংযোগ</b> ভুল ছিল। তাই প্রতিকারটাও
    /// নিয়মের ভেতরেই বসানো হয়েছে: টাটকা নমুনা না থাকলে কোনো উত্তর নেই।
    /// কলার যেভাবেই লেখা হোক, অচলাবস্থাটা আর তৈরি হতে পারে না।
    /// </summary>
    [Fact]
    public void A_stale_sample_never_freezes()
    {
        var screen = new ScreenActivity();

        // জমে গেছে, আর নমুনা তখনো টাটকা — সন্দেহটা বৈধ
        Steady(screen, 100, 0, 11);
        Assert.True(screen.IsFrozen(At(11)));

        // ⭐ নমুনা আসা বন্ধ (IDLE হওয়ায় ক্যাপচার থেমেছিল) — তিন মিনিট
        //    পরেই সন্দেহ তুলে নেওয়া হয়, আর কর্মী ফিরে এলে গোনা শুরু হয়
        Assert.False(screen.IsFrozen(At(15)));
        Assert.False(screen.IsFrozen(At(600)));
    }

    /// <summary>
    /// ⭐ নমুনা আসতে থাকলে সন্দেহ টেকে — নইলে StaleAfter বসিয়ে পুরো
    /// পাহারাটাই অকেজো করে ফেলা হতো।
    /// </summary>
    [Fact]
    public void Fresh_samples_keep_the_freeze()
    {
        var screen = new ScreenActivity();

        Steady(screen, 100, 0, 20);

        Assert.True(screen.IsFrozen(At(20)));
    }

    /// <summary>⚠️ একই নমুনা আবার এলে "বদলেনি", কিন্তু "দেখা হয়েছে" — দুটো আলাদা।</summary>
    [Fact]
    public void An_unchanged_sample_still_counts_as_seen()
    {
        var screen = new ScreenActivity();

        screen.Observe(Flat(100), At(0));
        screen.Observe(Flat(100), At(12));

        // বদলায়নি, তাই জমেই আছে — আর নমুনা টাটকা, তাই উত্তরটা দেওয়া হয়
        Assert.True(screen.IsFrozen(At(12)));
        Assert.Equal(At(0), screen.LastChangedAt);
        Assert.Equal(At(12), screen.LastSampledAt);
    }

    /// <summary>⭐ সীমানা — ঠিক StaleAfter-এ এখনো উত্তর দেওয়া হয়</summary>
    [Fact]
    public void Stale_boundary_is_inclusive()
    {
        var screen = new ScreenActivity();

        Steady(screen, 100, 0, 11);   // শেষ নমুনা ১১ মিনিটে

        Assert.True(screen.IsFrozen(At(14)));   // ঠিক ৩ মিনিট পুরোনো
        Assert.False(screen.IsFrozen(At(15)));  // তার বেশি
    }

    [Fact]
    public void Default_stale_window_is_three_minutes()
    {
        Assert.Equal(TimeSpan.FromMinutes(3), ScreenActivity.StaleAfter);
    }

    [Fact]
    public void Zero_stale_window_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new ScreenActivity(staleAfter: TimeSpan.Zero));
    }

    [Fact]
    public void Null_fingerprint_is_rejected()
    {
        var screen = new ScreenActivity();

        // ⚠️ ৩১ আগস্ট থেকে দুটো overload, তাই null-এর ধরন লিখে দিতে হয়
        Assert.Throws<ArgumentNullException>(() => screen.Observe((byte[])null!, At(0)));
        Assert.Throws<ArgumentNullException>(
            () => screen.Observe((IReadOnlyList<byte[]>)null!, At(0)));
    }

    // ════════════════════════════════════════════════════════════════════
    // ⭐⭐ একাধিক মনিটর (৩১ আগস্ট ২০২৬)
    //
    // ⚠️⚠️ মাঠের বাগ: ছাপ নেওয়া হতো কেবল **প্রথম** পর্দা থেকে, আর কেউ
    //    দ্বিতীয় মনিটরে কাজ করলে প্রথমটা স্থির থাকত → দশ মিনিট পর "জমেছে"
    //    → গোনা বন্ধ। মাপা: দুই মনিটরের তিনটে PC-তে দুদিনে ৪৩ · ৯ · ৬টা
    //    ভুয়া idle, এক-মনিটরের ছ-টায় শূন্য।
    // ════════════════════════════════════════════════════════════════════

    /// <summary>
    /// ⭐⭐ এই টেস্টটাই আসল দাবি: <b>দ্বিতীয় পর্দা বদলালে প্রথমটা স্থির
    /// থাকলেও জমেনি</b>।
    /// </summary>
    [Fact]
    public void দ্বিতীয়_মনিটর_বদলালে_পর্দা_জমেনি()
    {
        var screen = new ScreenActivity();

        // প্রথম পর্দা সারাক্ষণ একই, দ্বিতীয়টায় প্রতি মিনিটে কাজ চলছে
        for (var m = 0; m <= 20; m++)
        {
            screen.Observe([Flat(100), Flat((byte)(m * 5))], At(m));
        }

        Assert.False(screen.IsFrozen(At(20)));
    }

    /// <summary>
    /// ⚠️ পাহারাটা অটুট: জিগলার চললে <b>কোনো</b> পর্দাই বদলায় না, তাই
    /// দুই মনিটরেও ঠিক আগের মতোই ধরা পড়ে।
    /// </summary>
    [Fact]
    public void দুই_মনিটরের_কোনোটাই_না_বদলালে_জমে_যায়()
    {
        var screen = new ScreenActivity();

        for (var m = 0; m <= 20; m++)
        {
            screen.Observe([Flat(100), Flat(200)], At(m));
        }

        Assert.True(screen.IsFrozen(At(20)));
    }

    /// <summary>⚠️ মনিটর যোগ বা বিয়োগ হলে "বদলেছে" — কেউ মেশিনটা ছুঁয়েছে।</summary>
    [Fact]
    public void মনিটরের_সংখ্যা_বদলালে_বদল_হিসেবে_ধরা_হয়()
    {
        Assert.True(ScreenActivity.DiffersAny([Flat(10)], [Flat(10), Flat(10)]));
        Assert.False(ScreenActivity.DiffersAny([Flat(10)], [Flat(10)]));
    }

    /// <summary>
    /// ⭐ একটামাত্র পর্দার পুরোনো ডাকটাও আগের মতোই চলে — ওটা এখন
    /// এক-সদস্যের তালিকা।
    /// </summary>
    [Fact]
    public void এক_মনিটরের_পুরোনো_আচরণ_অপরিবর্তিত()
    {
        var screen = new ScreenActivity();

        for (var m = 0; m <= 20; m++) screen.Observe(Flat(100), At(m));

        Assert.True(screen.IsFrozen(At(20)));
    }

    /// <summary>⚠️ খালি তালিকা মানে "কিছুই তুলতে পারিনি" — নমুনাই নয়।</summary>
    [Fact]
    public void খালি_তালিকা_নমুনা_হিসেবে_গোনা_হয়_না()
    {
        var screen = new ScreenActivity();

        screen.Observe(System.Array.Empty<byte[]>(), At(0));

        // নমুনা নেই ⇒ সন্দেহও নেই
        Assert.False(screen.IsFrozen(At(20)));
    }
}
