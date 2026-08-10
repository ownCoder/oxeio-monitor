using oXeio.Core.Watchdog;

namespace oXeio.Core.Tests;

public class WatchdogPolicyTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 10, 9, 0, 0, TimeSpan.Zero);

    private const long Now = 3_600_000;   // বুট থেকে ১ ঘণ্টা, unbiased ms

    /// <summary>সুস্থ এজেন্ট — lock ধরা, হার্টবিট ৫ সেকেন্ড পুরোনো।</summary>
    private static AgentObservation Healthy => new()
    {
        ProbeSucceeded = true,
        InstanceLockHeld = true,
        ProcessId = 4242,
        ProcessAlive = true,
        HeartbeatUnbiasedMs = Now - 5_000,
        NowUnbiasedMs = Now,
        SessionUsable = true,
        ShuttingDown = false,
    };

    // ── স্বাভাবিক পথ ────────────────────────────────────────────────────────

    [Fact]
    public void সুস্থ_থাকলে_কিছুই_করা_হয়_না()
    {
        var d = WatchdogPolicy.Decide(Healthy, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.None, d.Action);
        Assert.Equal(AgentHealth.Healthy, d.Health);
    }

    [Fact]
    public void লক_খালি_থাকলে_চালু_করা_হয়()
    {
        var obs = Healthy with { InstanceLockHeld = false, ProcessAlive = false, HeartbeatUnbiasedMs = null };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Start, d.Action);
        Assert.Equal(AgentHealth.NotRunning, d.Health);
        Assert.Equal(WatchdogReason.AgentMissing, d.Reason);
    }

    /// <summary>
    /// ⭐ এই মডিউলের আসল কারণ: প্রসেসটা বেঁচে আছে, তবু কাজ করছে না।
    /// শুধু "প্রসেস আছে কি না" দেখা watchdog এই ব্যর্থতাটা কোনোদিন ধরত না।
    /// </summary>
    [Fact]
    public void হার্টবিট_বাসি_হলে_মেরে_আবার_চালু_করা_হয়()
    {
        var obs = Healthy with { HeartbeatUnbiasedMs = Now - 300_000 };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Restart, d.Action);
        Assert.Equal(AgentHealth.Wedged, d.Health);
        Assert.Equal(4242, d.KillProcessId);
    }

    [Fact]
    public void হার্টবিট_ফাইল_না_থাকলেও_জমে_যাওয়া_ধরা_হয়()
    {
        var obs = Healthy with { HeartbeatUnbiasedMs = null };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Restart, d.Action);
    }

    [Fact]
    public void সীমার_ঠিক_ভেতরের_হার্টবিট_তাজা()
    {
        var obs = Healthy with
        {
            HeartbeatUnbiasedMs = Now - (long)AgentLiveness.StaleAfter.TotalMilliseconds,
        };

        Assert.Equal(AgentHealth.Healthy, WatchdogPolicy.Classify(obs, AgentLiveness.StaleAfter));
    }

    /// <summary>
    /// রিবুটের পর হার্টবিট ফাইল ডিস্কে থেকে যায় কিন্তু unbiased কাউন্টার শূন্য
    /// থেকে শুরু হয়। "ভবিষ্যতের" টাইমস্ট্যাম্পকে তাজা ধরলে watchdog মৃত এজেন্টকে
    /// সুস্থ ভেবে বসে থাকত।
    /// </summary>
    [Fact]
    public void আগের_বুটের_হার্টবিট_তাজা_ধরা_হয়_না()
    {
        var obs = Healthy with { HeartbeatUnbiasedMs = Now + 600_000 };

        Assert.Equal(AgentHealth.Wedged, WatchdogPolicy.Classify(obs, AgentLiveness.StaleAfter));
    }

    // ── যেখানে হাত দেওয়াই ভুল ───────────────────────────────────────────────

    /// <summary>
    /// ⚠️ probe ব্যর্থ মানে "lock খালি" নয়। খালি ধরে নিলে দ্বিতীয় এজেন্ট চালু হতো
    /// আর দুজন মিলে একই ঘণ্টা দুবার গুনত — পে-রোল নষ্ট, কেউ টেরও পেত না।
    /// </summary>
    [Fact]
    public void probe_ব্যর্থ_হলে_কখনোই_চালু_করা_হয়_না()
    {
        var obs = Healthy with { ProbeSucceeded = false, InstanceLockHeld = false };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Hold, d.Action);
        Assert.Equal(WatchdogReason.ProbeFailed, d.Reason);
    }

    /// <summary>
    /// ⚠️ Session 0 থেকে চালু করলে সন্তানও Session 0-তে যায়, আর সেখানে এজেন্টের
    /// SessionGuard তাকে সাথে সাথে বন্ধ করে দেয় — নিশ্চিত-ব্যর্থ প্রসেসের অন্তহীন
    /// ঝড়, ১৫টা PC-তে একসাথে।
    /// </summary>
    [Fact]
    public void সেশন_শূন্যে_চালু_করা_হয়_না()
    {
        var obs = Healthy with { InstanceLockHeld = false, SessionUsable = false };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Hold, d.Action);
        Assert.Equal(WatchdogReason.SessionNotUsable, d.Reason);
    }

    [Fact]
    public void শাটডাউনের_সময়_চালু_করা_হয়_না()
    {
        var obs = Healthy with { InstanceLockHeld = false, ShuttingDown = true };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Hold, d.Action);
        Assert.Equal(WatchdogReason.ShuttingDown, d.Reason);
    }

    /// <summary>শাটডাউনে এজেন্ট মরাটা ব্যর্থতা নয় — মইয়ের একটা ধাপ নষ্ট হওয়া চলবে না।</summary>
    [Fact]
    public void শাটডাউনে_স্থিরতার_হিসাব_নষ্ট_হয়_না()
    {
        var ladder = new RestartLadder();
        ladder.RecordLaunch(T0);
        ladder.Observe(healthy: true, T0);

        WatchdogPolicy.Decide(Healthy with { ShuttingDown = true }, ladder, T0 + TimeSpan.FromSeconds(30));
        WatchdogPolicy.Decide(Healthy, ladder, T0 + RestartPolicy.Default.StabilityWindow);

        Assert.Equal(0, ladder.Failures);
    }

    /// <summary>
    /// lock ধরা আছে কিন্তু pid জানা নেই — অন্য সেশনের এজেন্ট, বা AV/ব্যাকআপ
    /// ফাইলটা ধরে রেখেছে। ভুল করে অপেক্ষা করার খরচ ৩০ সেকেন্ড; ভুল করে দ্বিতীয়টা
    /// চালু করার খরচ দুবার গোনা ঘণ্টা।
    /// </summary>
    [Fact]
    public void অচেনা_কেউ_লক_ধরে_থাকলে_মারাও_হয়_না_চালুও_হয়_না()
    {
        var obs = Healthy with { ProcessId = null, ProcessAlive = false, HeartbeatUnbiasedMs = null };

        var d = WatchdogPolicy.Decide(obs, new RestartLadder(), T0);

        Assert.Equal(WatchdogAction.Hold, d.Action);
        Assert.Equal(AgentHealth.Unreachable, d.Health);
        Assert.Equal(WatchdogReason.ForeignInstance, d.Reason);
    }

    // ── ঝড় ঠেকানো ───────────────────────────────────────────────────────────

    [Fact]
    public void চালু_করার_পরপরই_আবার_চালু_করা_হয়_না()
    {
        var ladder = new RestartLadder();
        var missing = Healthy with { InstanceLockHeld = false, ProcessAlive = false, HeartbeatUnbiasedMs = null };

        Assert.Equal(WatchdogAction.Start, WatchdogPolicy.Decide(missing, ladder, T0).Action);
        ladder.RecordLaunch(T0);

        var d = WatchdogPolicy.Decide(missing, ladder, T0 + TimeSpan.FromSeconds(1));

        Assert.Equal(WatchdogAction.Hold, d.Action);
        Assert.Equal(WatchdogReason.BackoffPending, d.Reason);
        Assert.NotNull(d.RetryIn);
    }

    /// <summary>
    /// ⭐ startup-এ ক্র্যাশ করা এজেন্ট: সরল watchdog এখানে সেকেন্ডে দুবার প্রসেস
    /// বানাতে থাকত। এই টেস্ট বলে — পাঁচবারের পর সেটা থামে আর দৃশ্যমান সংকেত ওঠে।
    /// </summary>
    [Fact]
    public void বারবার_ব্যর্থ_হলে_একবারই_অ্যালার্ম_ওঠে()
    {
        var ladder = new RestartLadder();
        var missing = Healthy with { InstanceLockHeld = false, ProcessAlive = false, HeartbeatUnbiasedMs = null };
        var now = T0;

        for (var i = 0; i < RestartPolicy.Default.GiveUpAfter; i++)
        {
            var d = WatchdogPolicy.Decide(missing, ladder, now);
            Assert.Equal(WatchdogAction.Start, d.Action);
            ladder.RecordLaunch(now);
            now += ladder.DelayAfter(ladder.Failures);
        }

        var alarm = WatchdogPolicy.Decide(missing, ladder, now);
        Assert.Equal(WatchdogAction.GiveUp, alarm.Action);
        Assert.Equal(WatchdogReason.LadderExhausted, alarm.Reason);

        ladder.MarkAlarmRaised();

        // ⚠️ দ্বিতীয়বার আর অ্যালার্ম নয় — নইলে প্রতি ৩০ সেকেন্ডে লগ ভরে যেত
        //    আর গুরুত্বপূর্ণ লাইনগুলো rotate হয়ে হারিয়ে যেত।
        var after = WatchdogPolicy.Decide(missing, ladder, now);
        Assert.Equal(WatchdogAction.Hold, after.Action);
        Assert.Equal(WatchdogReason.CoolOffPending, after.Reason);
    }

    /// <summary>হাল ছাড়া মানে চিরতরে থামা নয় — ৬ ঘণ্টা পর ঠিক একবার চেষ্টা।</summary>
    [Fact]
    public void ঠান্ডা_হওয়ার_পর_একবার_চেষ্টা_হয়()
    {
        var ladder = new RestartLadder();
        var missing = Healthy with { InstanceLockHeld = false, ProcessAlive = false, HeartbeatUnbiasedMs = null };
        var now = T0;

        for (var i = 0; i < RestartPolicy.Default.GiveUpAfter; i++)
        {
            ladder.RecordLaunch(now);
            now += ladder.DelayAfter(ladder.Failures);
        }

        ladder.MarkAlarmRaised();
        var probeAt = ladder.LastLaunchAt!.Value + RestartPolicy.Default.CoolOff;

        var d = WatchdogPolicy.Decide(missing, ladder, probeAt);

        Assert.Equal(WatchdogAction.Start, d.Action);
        Assert.Equal(WatchdogReason.CoolOffProbe, d.Reason);
    }
}
