using oXeio.Core.Watchdog;

namespace oXeio.Core.Tests;

public class RestartLadderTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 10, 9, 0, 0, TimeSpan.Zero);

    // ── প্রথম চেষ্টা সাথে সাথেই ──────────────────────────────────────────────

    /// <summary>
    /// H01-এর গ্রহণযোগ্যতার শর্ত: Task Manager থেকে kill → ৩০ সেকেন্ডে ফিরে আসে।
    /// প্রথমবারেই ব্যাকঅফ বসালে সেটা মিথ্যা হয়ে যেত।
    /// </summary>
    [Fact]
    public void প্রথম_ক্র্যাশে_সাথে_সাথেই_চালু_করা_যায়()
    {
        var ladder = new RestartLadder();

        Assert.True(ladder.MayLaunch(T0));
        Assert.Equal(TimeSpan.Zero, ladder.TimeUntilNextLaunch(T0));
    }

    // ── মইয়ের ধাপ ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(1, 30)]
    [InlineData(2, 90)]
    [InlineData(3, 270)]
    [InlineData(4, 810)]
    public void প্রতিবার_তিনগুণ_অপেক্ষা(int failures, double seconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(seconds), new RestartLadder().DelayAfter(failures));
    }

    [Fact]
    public void সিলিং_ছাড়ায়_না()
    {
        Assert.Equal(TimeSpan.FromMinutes(15), new RestartLadder().DelayAfter(5));
    }

    /// <summary>
    /// এখানে throw করা মানে watchdog-ই মরে যাওয়া — অর্থাৎ পাহারাদারবিহীন মেশিন,
    /// আর সেটা ঘটত ঠিক সেই মেশিনে যেটা সবচেয়ে বেশিদিন ভেঙে পড়ে আছে।
    /// </summary>
    [Fact]
    public void বহু_ব্যর্থতাতেও_overflow_হয়_না()
    {
        var ladder = new RestartLadder();

        Assert.Equal(TimeSpan.FromMinutes(15), ladder.DelayAfter(100_000));
        Assert.Equal(TimeSpan.FromMinutes(15), ladder.DelayAfter(int.MaxValue));
        Assert.Equal(TimeSpan.Zero, ladder.DelayAfter(0));
        Assert.Equal(TimeSpan.Zero, ladder.DelayAfter(-7));
    }

    [Fact]
    public void চালু_করার_পর_ব্যাকঅফ_মানা_হয়()
    {
        var ladder = new RestartLadder();
        ladder.RecordLaunch(T0);

        Assert.False(ladder.MayLaunch(T0 + TimeSpan.FromSeconds(29)));
        Assert.True(ladder.MayLaunch(T0 + TimeSpan.FromSeconds(30)));
    }

    /// <summary>
    /// ⚠️ চালু করার চেষ্টাই গোনা বাড়ায়, "চালু হয়েছে" নয়। <c>Process.Start</c>
    /// ছুড়ে দিলেও (exe নেই, AV ব্লক করেছে) মই এগোতে হবে — নইলে প্রতি ৩০ সেকেন্ডে
    /// চিরকাল চেষ্টা চলত।
    /// </summary>
    [Fact]
    public void প্রতিটা_লঞ্চ_আগেই_ব্যর্থ_ধরা_হয়()
    {
        var ladder = new RestartLadder();

        ladder.RecordLaunch(T0);

        Assert.Equal(1, ladder.Failures);
    }

    // ── হাল ছাড়া ও ঠান্ডা হওয়া ──────────────────────────────────────────────

    [Fact]
    public void পাঁচবার_চেষ্টার_পর_হাল_ছাড়ে()
    {
        var ladder = LaunchUntilExhausted(out var now);

        Assert.True(ladder.IsExhausted);
        Assert.False(ladder.MayLaunch(now));
    }

    /// <summary>
    /// ⚠️ হাল ছাড়া মানে চিরতরে থামা নয়। থামলে AV আপডেটে exe লক হয়ে থাকার মতো
    /// সাময়িক সমস্যায় ১৫টা PC-র প্রত্যেকটায় একজন মানুষকে যেতে হতো, আর ততক্ষণ
    /// কারো সময় গোনা হতো না।
    /// </summary>
    [Fact]
    public void ঠান্ডা_হওয়ার_পর_আবার_একবার_চেষ্টা_করে()
    {
        var ladder = LaunchUntilExhausted(out var now);
        var coolOff = ladder.Policy.CoolOff;

        Assert.False(ladder.MayLaunch(now + coolOff - TimeSpan.FromMinutes(1)));
        Assert.True(ladder.MayLaunch(now + coolOff));
    }

    /// <summary>ঠান্ডা হওয়ার ব্যবধান মইয়ের সবচেয়ে বড় ধাপের চেয়ে ছোট হলে
    /// "হাল ছাড়া" আসলে চেষ্টা বাড়িয়ে দিত।</summary>
    [Fact]
    public void ঠান্ডা_হওয়ার_সময়_সবচেয়ে_বড়_ধাপের_চেয়ে_বড়()
    {
        Assert.True(RestartPolicy.Default.CoolOff >= RestartPolicy.Default.MaxDelay);
    }

    [Fact]
    public void হাল_ছাড়ার_পরেও_চেষ্টা_চলতেই_থাকে()
    {
        var ladder = LaunchUntilExhausted(out var now);
        var coolOff = ladder.Policy.CoolOff;

        // ঠান্ডা হওয়ার পর একবার চেষ্টা — সেটাও ব্যর্থ
        var probe = now + coolOff;
        ladder.RecordLaunch(probe);

        Assert.True(ladder.IsExhausted);
        Assert.False(ladder.MayLaunch(probe + TimeSpan.FromHours(1)));
        Assert.True(ladder.MayLaunch(probe + coolOff));
    }

    // ── অ্যালার্ম ────────────────────────────────────────────────────────────

    [Fact]
    public void অ্যালার্ম_চিহ্ন_মনে_রাখা_হয়()
    {
        var ladder = LaunchUntilExhausted(out _);

        Assert.False(ladder.AlarmRaised);
        ladder.MarkAlarmRaised();
        Assert.True(ladder.AlarmRaised);
    }

    // ── রিসেট ───────────────────────────────────────────────────────────────

    /// <summary>
    /// "একবার চালু হয়েছে" রিসেট করে না — ক্র্যাশ-লুপে প্রসেসটা বারবার চালু
    /// হয়ই। শুধু টানা সুস্থ থাকাই গোনা।
    /// </summary>
    [Fact]
    public void অল্প_সময়_সুস্থ_থাকলে_মই_রিসেট_হয়_না()
    {
        var ladder = new RestartLadder();
        ladder.RecordLaunch(T0);

        ladder.Observe(healthy: true, T0 + TimeSpan.FromSeconds(10));
        ladder.Observe(healthy: false, T0 + TimeSpan.FromSeconds(20));
        ladder.Observe(healthy: true, T0 + TimeSpan.FromSeconds(30));

        Assert.Equal(1, ladder.Failures);
    }

    [Fact]
    public void টানা_স্থির_থাকলে_মই_রিসেট_হয়()
    {
        var ladder = LaunchUntilExhausted(out var now);
        ladder.MarkAlarmRaised();

        ladder.Observe(healthy: true, now);
        ladder.Observe(healthy: true, now + RestartPolicy.Default.StabilityWindow);

        Assert.Equal(0, ladder.Failures);
        Assert.False(ladder.IsExhausted);
        Assert.False(ladder.AlarmRaised);
        Assert.True(ladder.MayLaunch(now));
    }

    /// <summary>সপ্তাহে একবার ক্র্যাশ করা এজেন্ট যেন এক মাস পর "হাল ছাড়া"
    /// অবস্থায় পৌঁছে না যায়।</summary>
    [Fact]
    public void মাঝেমধ্যে_ক্র্যাশ_জমে_হাল_ছাড়ায়_না()
    {
        var ladder = new RestartLadder();
        var now = T0;

        for (var week = 0; week < 8; week++)
        {
            ladder.RecordLaunch(now);
            now += TimeSpan.FromMinutes(30);
            ladder.Observe(healthy: true, now);
            now += TimeSpan.FromDays(7);
            ladder.Observe(healthy: true, now);
        }

        Assert.False(ladder.IsExhausted);
    }

    // ── ঘড়ির গোলমাল ────────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ কলার ভুল করে দেয়াল-ঘড়ি দিলে আর কেউ ঘড়ি পিছিয়ে দিলে watchdog নীরবে
    /// চিরতরে অপেক্ষায় বসে থাকত — পাহারা আছে বলে সবাই ভাবত, আসলে নেই।
    /// </summary>
    [Fact]
    public void ঘড়ি_পিছিয়ে_গেলেও_আটকে_থাকে_না()
    {
        var ladder = new RestartLadder();
        ladder.RecordLaunch(T0);

        var backwards = T0 - TimeSpan.FromHours(2);

        Assert.False(ladder.MayLaunch(backwards));
        Assert.Equal(TimeSpan.FromSeconds(30), ladder.TimeUntilNextLaunch(backwards));
    }

    [Fact]
    public void ঘড়ি_পিছালে_স্থিরতার_হিসাব_নতুন_করে_শুরু_হয়()
    {
        var ladder = new RestartLadder();
        ladder.RecordLaunch(T0);

        ladder.Observe(healthy: true, T0 + TimeSpan.FromHours(1));
        ladder.Observe(healthy: true, T0);           // ঘড়ি পিছিয়ে গেল

        Assert.Equal(1, ladder.Failures);            // ভুয়া রিসেট হয়নি
        ladder.Observe(healthy: true, T0 + RestartPolicy.Default.StabilityWindow);
        Assert.Equal(0, ladder.Failures);
    }

    // ── সেটিং যাচাই ─────────────────────────────────────────────────────────

    [Fact]
    public void অসম্ভব_সেটিং_নাকচ_হয়()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new RestartPolicy(
            TimeSpan.Zero, 3, TimeSpan.FromMinutes(15), 5, TimeSpan.FromHours(6), TimeSpan.FromMinutes(10)));

        // সিলিং base-এর চেয়ে ছোট
        Assert.Throws<ArgumentOutOfRangeException>(() => new RestartPolicy(
            TimeSpan.FromMinutes(5), 3, TimeSpan.FromSeconds(30), 5, TimeSpan.FromHours(6), TimeSpan.FromMinutes(10)));

        // হাল ছাড়ার আগে অন্তত একবার চেষ্টা করতেই হবে
        Assert.Throws<ArgumentOutOfRangeException>(() => new RestartPolicy(
            TimeSpan.FromSeconds(30), 3, TimeSpan.FromMinutes(15), 0, TimeSpan.FromHours(6), TimeSpan.FromMinutes(10)));

        // ঠান্ডা হওয়ার সময় সবচেয়ে বড় ধাপের চেয়ে ছোট
        Assert.Throws<ArgumentOutOfRangeException>(() => new RestartPolicy(
            TimeSpan.FromSeconds(30), 3, TimeSpan.FromMinutes(15), 5, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10)));
    }

    // ── সহায়ক ───────────────────────────────────────────────────────────────

    /// <summary>
    /// পাঁচবার চালু করে প্রতিবারই ব্যর্থ — মই ফুরিয়ে যাওয়া পর্যন্ত।
    /// <paramref name="now"/> ফেরে <b>শেষ লঞ্চের মুহূর্ত</b>, কারণ ঠান্ডা হওয়ার
    /// সময় ওখান থেকেই গোনা হয়।
    /// </summary>
    private static RestartLadder LaunchUntilExhausted(out DateTimeOffset now)
    {
        var ladder = new RestartLadder();
        now = T0;

        for (var i = 0; i < RestartPolicy.Default.GiveUpAfter; i++)
        {
            Assert.True(ladder.MayLaunch(now), $"{i + 1} নম্বর চেষ্টা আটকে গেছে");
            ladder.RecordLaunch(now);
            now += ladder.DelayAfter(ladder.Failures);
            ladder.Observe(healthy: false, now);
        }

        now = ladder.LastLaunchAt!.Value;
        return ladder;
    }
}
