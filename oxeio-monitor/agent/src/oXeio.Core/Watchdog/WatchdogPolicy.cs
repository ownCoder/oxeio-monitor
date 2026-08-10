namespace oXeio.Core.Watchdog;

/// <summary>এজেন্টের অবস্থা — "চলছে কি না" নয়, "কাজ করছে কি না"।</summary>
public enum AgentHealth
{
    /// <summary>জানা যায়নি (ডিস্ক/ACL গোলমাল)। ⚠️ "নেই"-এর সমান ধরা যাবে না।</summary>
    Unknown,

    /// <summary>কেউ instance lock ধরে নেই — মেশিনে কোনো এজেন্ট নেই।</summary>
    NotRunning,

    /// <summary>lock ধরা আছে আর হার্টবিট তাজা।</summary>
    Healthy,

    /// <summary>lock ধরা আছে কিন্তু হার্টবিট থেমে গেছে, আর pid-টা আমরা মারতে পারি।</summary>
    Wedged,

    /// <summary>
    /// lock ধরা আছে, হার্টবিট নেই, কিন্তু কাকে মারব জানি না —
    /// অন্য সেশনের প্রসেস, বা AV/ব্যাকআপ ফাইলটা ধরে রেখেছে।
    /// </summary>
    Unreachable,
}

/// <summary>watchdog এই টিকে কী করবে।</summary>
public enum WatchdogAction
{
    None,

    /// <summary>এজেন্ট চালু করো।</summary>
    Start,

    /// <summary>জমে যাওয়া এজেন্টকে মেরে তারপর চালু করো।</summary>
    Restart,

    /// <summary>কিছু একটা ঠিক নেই, কিন্তু এখন হাত দেওয়া চলবে না।</summary>
    Hold,

    /// <summary>মই ফুরিয়েছে — দৃশ্যমান সংকেত দাও, তারপর ঠান্ডা হও।</summary>
    GiveUp,
}

/// <summary>
/// সিদ্ধান্তের কারণ। ⚠️ enum, স্ট্রিং নয় — লগের বাংলা লেখা watchdog প্রজেক্টে
/// তৈরি হয়, যাতে Core টেস্টযোগ্য আর ভাষা-নিরপেক্ষ থাকে।
/// </summary>
public enum WatchdogReason
{
    Healthy,
    AgentMissing,
    HeartbeatStale,
    ForeignInstance,
    BackoffPending,
    CoolOffPending,
    CoolOffProbe,
    LadderExhausted,
    ShuttingDown,
    SessionNotUsable,
    ProbeFailed,
}

/// <summary>এক টিকে বাইরের দুনিয়া থেকে যা যা জানা গেল।</summary>
public sealed record AgentObservation
{
    /// <summary>lock ফাইল probe করা গেছে কি না। false = কিছুই জানি না।</summary>
    public required bool ProbeSucceeded { get; init; }

    /// <summary>কেউ <c>agent.lock</c> ধরে আছে — অর্থাৎ কোথাও একটা এজেন্ট জীবিত।</summary>
    public required bool InstanceLockHeld { get; init; }

    /// <summary>হার্টবিট ফাইল থেকে পাওয়া pid (না পেলে null)।</summary>
    public int? ProcessId { get; init; }

    /// <summary>ওই pid-এ সত্যিই একটা এজেন্ট প্রসেস চলছে কি না।</summary>
    public required bool ProcessAlive { get; init; }

    /// <summary>হার্টবিটে লেখা unbiased মিলিসেকেন্ড (ফাইল না পড়া গেলে null)।</summary>
    public long? HeartbeatUnbiasedMs { get; init; }

    /// <summary>watchdog-এর নিজের unbiased মিলিসেকেন্ড, এই মুহূর্তে।</summary>
    public required long NowUnbiasedMs { get; init; }

    /// <summary>watchdog ইন্টারঅ্যাকটিভ সেশনে আছে কি না (Session 0 নয়)।</summary>
    public required bool SessionUsable { get; init; }

    /// <summary>Windows এই মুহূর্তে বন্ধ/লগঅফ হচ্ছে কি না।</summary>
    public required bool ShuttingDown { get; init; }
}

public sealed record WatchdogDecision
{
    public required WatchdogAction Action { get; init; }
    public required WatchdogReason Reason { get; init; }
    public required AgentHealth Health { get; init; }

    /// <summary><see cref="WatchdogAction.Restart"/> হলে কাকে মারতে হবে।</summary>
    public int? KillProcessId { get; init; }

    /// <summary>অপেক্ষা করতে বলা হলে আর কতক্ষণ।</summary>
    public TimeSpan? RetryIn { get; init; }
}

/// <summary>
/// ⭐ পুরো watchdog-এর সিদ্ধান্ত এই একটা ফাংশনে — কোনো I/O নেই, তাই Windows
/// ছাড়াই টেস্ট করা যায়।
///
/// <b>নকশার মূল অসামঞ্জস্য:</b> ভুল করে "এজেন্ট নেই" ভাবার খরচ আর ভুল করে
/// "এজেন্ট আছে" ভাবার খরচ এক নয়।
/// <list type="bullet">
/// <item>ভুলে "আছে" ভাবলে — ৩০ সেকেন্ড দেরিতে চালু হয়। ঘণ্টার হিসাবে অদৃশ্য।</item>
/// <item>ভুলে "নেই" ভাবলে — দ্বিতীয় একটা এজেন্ট চালু হয়, আর দুজন মিলে একই ঘণ্টা
/// দুবার গোনে। পে-রোল নষ্ট, আর কেউ টেরই পায় না।</item>
/// </list>
/// তাই সন্দেহের সব সুবিধা "এজেন্ট আছে" দিকেই যায় — probe ব্যর্থ, lock কে ধরেছে
/// জানা নেই, শাটডাউন চলছে: সবগুলোতেই <see cref="WatchdogAction.Hold"/>।
/// </summary>
public static class WatchdogPolicy
{
    /// <summary>
    /// পর্যবেক্ষণ → স্বাস্থ্য। lock ফাইলই একমাত্র প্রশ্নের ("কেউ আছে?") উত্তর;
    /// হার্টবিট দ্বিতীয় প্রশ্নের ("সে কাজ করছে?")।
    /// </summary>
    public static AgentHealth Classify(AgentObservation observation, TimeSpan staleAfter)
    {
        ArgumentNullException.ThrowIfNull(observation);

        if (!observation.ProbeSucceeded) return AgentHealth.Unknown;
        if (!observation.InstanceLockHeld) return AgentHealth.NotRunning;

        if (observation.HeartbeatUnbiasedMs is { } beat)
        {
            // ⚠️ ঋণাত্মক বয়স = আগের বুটের ফাইল, তাজা নয়।
            //    AgentLiveness.Age-এর মন্তব্য দেখুন।
            var age = observation.NowUnbiasedMs - beat;
            if (age >= 0 && age <= (long)staleAfter.TotalMilliseconds) return AgentHealth.Healthy;
        }

        // lock ধরা আছে অথচ হার্টবিট থেমে গেছে — জমে গেছে। কিন্তু মারতে হলে
        // pid লাগে, আর সেই pid-এ সত্যিই আমাদের প্রসেস চলতে হবে।
        return observation.ProcessAlive && observation.ProcessId is > 0
            ? AgentHealth.Wedged
            : AgentHealth.Unreachable;
    }

    /// <summary>
    /// ⚠️ এই মেথড <paramref name="ladder"/>-এর স্বাস্থ্য-পর্যবেক্ষণ হালনাগাদ করে
    /// (<see cref="RestartLadder.Observe"/>), কিন্তু <see cref="RestartLadder.RecordLaunch"/>
    /// <b>করে না</b> — সেটা কলারের কাজ, চালু করার চেষ্টার ঠিক আগে।
    /// </summary>
    public static WatchdogDecision Decide(
        AgentObservation observation,
        RestartLadder ladder,
        DateTimeOffset now,
        TimeSpan? staleAfter = null)
    {
        ArgumentNullException.ThrowIfNull(observation);
        ArgumentNullException.ThrowIfNull(ladder);

        var limit = staleAfter ?? AgentLiveness.StaleAfter;
        var health = Classify(observation, limit);

        // ── যেসব ক্ষেত্রে হাত দেওয়াই ভুল ─────────────────────────────────────

        // Windows বন্ধ হচ্ছে — এজেন্ট এখন মরবেই, সেটা ব্যর্থতা নয়। এই সময়ে চালু
        // করলে নতুন প্রসেসটা শাটডাউন আটকে দিতে পারে, আর মই এক ধাপ নষ্ট হতো।
        if (observation.ShuttingDown)
            return Hold(WatchdogReason.ShuttingDown, health);

        // ⚠️ Session 0 থেকে চালু করলে সন্তানও Session 0-তে যায়, আর সেখানে এজেন্টের
        //    SessionGuard তাকে সাথে সাথে বন্ধ করে দেয় — অর্থাৎ নিশ্চিত-ব্যর্থ প্রসেস
        //    বারবার তৈরি করা। ঝড়ের নিখুঁত রেসিপি।
        if (!observation.SessionUsable)
            return Hold(WatchdogReason.SessionNotUsable, health);

        // probe-ই হয়নি মানে lock খালি কি না জানি না। "খালি" ধরে নিলে দ্বিতীয়
        // এজেন্ট চালু হতো — উপরের অসামঞ্জস্য দেখুন।
        if (health == AgentHealth.Unknown)
            return Hold(WatchdogReason.ProbeFailed, health);

        // ── সুস্থ ────────────────────────────────────────────────────────────

        ladder.Observe(health == AgentHealth.Healthy, now);

        if (health == AgentHealth.Healthy)
            return new WatchdogDecision
            {
                Action = WatchdogAction.None,
                Reason = WatchdogReason.Healthy,
                Health = health,
            };

        // lock কে ধরে আছে জানি না — মারা যাবে না, চালুও করা যাবে না।
        // ভুল হলে খরচ ৩০ সেকেন্ড; উল্টোটা করলে খরচ দুবার গোনা ঘণ্টা।
        if (health == AgentHealth.Unreachable)
            return Hold(WatchdogReason.ForeignInstance, health);

        // ── হাল ছাড়ার সংকেত ─────────────────────────────────────────────────

        if (ladder.IsExhausted && !ladder.AlarmRaised)
            return new WatchdogDecision
            {
                Action = WatchdogAction.GiveUp,
                Reason = WatchdogReason.LadderExhausted,
                Health = health,
                RetryIn = ladder.TimeUntilNextLaunch(now),
            };

        // ── ব্যাকঅফ ──────────────────────────────────────────────────────────

        if (!ladder.MayLaunch(now))
            return new WatchdogDecision
            {
                Action = WatchdogAction.Hold,
                Reason = ladder.IsExhausted ? WatchdogReason.CoolOffPending : WatchdogReason.BackoffPending,
                Health = health,
                RetryIn = ladder.TimeUntilNextLaunch(now),
            };

        // ── চালু / রিস্টার্ট ─────────────────────────────────────────────────

        var reason = ladder.IsExhausted
            ? WatchdogReason.CoolOffProbe
            : health == AgentHealth.Wedged
                ? WatchdogReason.HeartbeatStale
                : WatchdogReason.AgentMissing;

        return health == AgentHealth.Wedged
            ? new WatchdogDecision
            {
                Action = WatchdogAction.Restart,
                Reason = reason,
                Health = health,
                KillProcessId = observation.ProcessId,
            }
            : new WatchdogDecision
            {
                Action = WatchdogAction.Start,
                Reason = reason,
                Health = health,
            };
    }

    private static WatchdogDecision Hold(WatchdogReason reason, AgentHealth health) => new()
    {
        Action = WatchdogAction.Hold,
        Reason = reason,
        Health = health,
    };
}
