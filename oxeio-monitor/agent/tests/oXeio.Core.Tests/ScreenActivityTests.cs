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

        screen.Observe(Flat(100), At(0));

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

        screen.Observe(Flat(60), At(0));
        Assert.True(screen.IsFrozen(At(12)));

        screen.Observe(Flat(100), At(12));

        Assert.False(screen.IsFrozen(At(12)));
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

    [Fact]
    public void Null_fingerprint_is_rejected()
    {
        var screen = new ScreenActivity();

        Assert.Throws<ArgumentNullException>(() => screen.Observe(null!, At(0)));
    }
}
