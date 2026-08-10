using oXeio.Core.Models;

namespace oXeio.Core.Agent;

/// <summary>
/// সিঙ্ক কেমন চলছে — tray আইকনের রং এখান থেকেই ঠিক হয় (J07)।
/// </summary>
public enum SyncHealth
{
    /// <summary>সব পৌঁছাচ্ছে। আইকন স্বাভাবিক।</summary>
    Ok,

    /// <summary>দু-একটা চেষ্টা ব্যর্থ, কিন্তু এখনো চিন্তার নয়। আইকন স্বাভাবিক, টুলটিপে ইঙ্গিত।</summary>
    Degraded,

    /// <summary>
    /// টানা ব্যর্থ হচ্ছে। ⚠️ আইকন <b>লাল</b>, আর টুলটিপে সরাসরি লিখতে হবে যে
    /// ডেটা হারায়নি, লোকালি জমছে — নইলে স্টাফ ধরে নেবে তার ঘণ্টা মুছে যাচ্ছে।
    /// </summary>
    Failing,

    /// <summary>ডিভাইস বাতিল (H06)। ট্র্যাকিং বন্ধ, আইকনে সেটাই দেখাতে হবে।</summary>
    Revoked,
}

/// <summary>
/// tray আইকন যা যা দেখায় — এটুকুই, আর কিছু নয়।
///
/// ⚠️ এখানে কোনো বাটন নেই, কোনো ইনপুট নেই। স্টাফের চাপার মতো কিছু থাকলে
/// সেটা approval workflow-র প্রথম ধাপ হয়ে যেত (ADR-011d), আর এই সিস্টেমে
/// সেরকম কিছু নেই। tray শুধু <b>দেখায়</b> — কারণ আইকনটা সবসময় দৃশ্যমান
/// থাকাটাই covert installation না হওয়ার প্রমাণ।
/// </summary>
public sealed record AgentStatus
{
    public required SegmentState State { get; init; }

    /// <summary>ঢাকার আজকের দিনের ACTIVE সময়।</summary>
    public required TimeSpan ActiveToday { get; init; }

    /// <summary>ঢাকার চলতি মাসের ACTIVE সময়। মাসিক ২০৮ ঘণ্টার সাথে এটাই মেলানো হয়।</summary>
    public required TimeSpan ActiveThisMonth { get; init; }

    /// <summary>
    /// ⭐ <see cref="ActiveThisMonth"/> সত্যিই সার্ভার থেকে এসেছে কি না।
    ///
    /// ⚠️ <b>এই পতাকাটা না থাকলে "এখনো জানি না" আর "শূন্য ঘণ্টা" এক দেখাত।</b>
    /// এজেন্ট নিজে মাসের হিসাব রাখে না (রিবুটে তার সব শূন্য), তাই প্রথম
    /// heartbeat আসার আগ পর্যন্ত এখানে ০ বসে থাকে। ওই ০-টাকে সত্যি ধরে
    /// দেখালে স্টাফ প্রতিবার লগইন করে দেখত "০ / ২০৮ ঘণ্টা · ২০৮ ঘণ্টা পিছিয়ে" —
    /// অর্থাৎ মনে হতো মাসের সব কাজ মুছে গেছে। যে ফিচারটার উদ্দেশ্যই আস্থা
    /// তৈরি করা, সেটাই তখন প্রতিদিন সকালে আস্থা ভাঙত।
    ///
    /// মিথ্যা <c>false</c>-এ দেখানোর জায়গা "হিসাব আসছে" লিখবে, শূন্য নয়।
    /// </summary>
    public bool MonthlyKnown { get; init; }

    /// <summary><see cref="AgentConfig.MonthlyTargetHours"/> — সাধারণত ২০৮।</summary>
    public required double MonthlyTargetHours { get; init; }

    /// <summary>
    /// গতি — মাসের এই দিনে যতটা হওয়ার কথা ছিল তার চেয়ে কত বেশি/কম।
    /// ধনাত্মক মানে এগিয়ে (<see cref="EmployeeProgress.PaceSec"/>)।
    ///
    /// ⚠️ <c>null</c> মানে "সার্ভার বলেনি", "শূন্য" নয়। শূন্য মানে ঠিক লক্ষ্যে
    /// আছে — দুটোকে এক করে ফেললে সার্ভার চুপ থাকা প্রতিটা মুহূর্তে স্টাফ
    /// নিজেকে নিখুঁত অবস্থানে দেখত। null হলে দেখানোর জায়গা নিজে আনুমানিক
    /// হিসাব করে, এবং "আনুমানিক" কথাটা লিখে দেয়।
    ///
    /// ⚠️ নামটা <c>MonthlyPace</c> নয় — <c>Ui.MonthlyPace</c> নামে ক্লাসও আছে,
    /// আর প্রপার্টি ও টাইপের নাম এক হলে কল-সাইটে কোনটা বোঝানো হচ্ছে তা
    /// অস্পষ্ট হয়ে যায় (<see cref="Health"/>-এর মন্তব্য দেখুন)।
    /// </summary>
    public TimeSpan? Pace { get; init; }

    /// <summary>এখনো আপলোড হয়নি এমন সারির সংখ্যা।</summary>
    public required int QueueDepth { get; init; }

    /// <summary>শেষ যেবার সার্ভার সত্যিই কিছু নিয়েছে। কখনো না হলে null।</summary>
    public DateTimeOffset? LastSyncAt { get; init; }

    /// <summary>
    /// ⚠️ প্রপার্টির নাম <c>Health</c>, <c>SyncHealth</c> নয় — প্রপার্টি আর তার
    /// টাইপের নাম এক হলে ("Color Color" সমস্যা) স্ট্যাটিক কনটেক্সটে
    /// <c>SyncHealth.Ok</c> লেখাটাই অস্পষ্ট হয়ে যেত।
    /// </summary>
    public required SyncHealth Health { get; init; }

    /// <summary>টুলটিপের দ্বিতীয় লাইন — যেমন "সার্ভারে পৌঁছাচ্ছে না, ডেটা লোকালি জমছে"।</summary>
    public string? HealthDetail { get; init; }

    /// <summary><see cref="AgentCommand.PauseTracking"/> চালু আছে কি না।</summary>
    public required bool Paused { get; init; }

    /// <summary>
    /// ০ = কিছু হয়নি, ১ = লক্ষ্য পূর্ণ। ⚠️ উপরে ক্ল্যাম্প করা <b>হয় না</b> —
    /// ২২০ ঘণ্টা কাজ করা মানুষকে ১০০% দেখানো তার বাড়তি কাজটাকে অদৃশ্য করে দিত।
    /// প্রোগ্রেস বার আঁকার সময় কলার নিজে <c>Math.Min(1, …)</c> করবে।
    /// </summary>
    public double MonthlyProgress =>
        MonthlyTargetHours <= 0 ? 0 : Math.Max(0, ActiveThisMonth.TotalHours / MonthlyTargetHours);

    /// <summary>লক্ষ্য ছুঁতে আর কত। পূর্ণ হয়ে গেলে <see cref="TimeSpan.Zero"/>।</summary>
    public TimeSpan MonthlyRemaining
    {
        get
        {
            var left = TimeSpan.FromHours(MonthlyTargetHours) - ActiveThisMonth;
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }
    }

    /// <summary>চালু হওয়ার পর প্রথম টিক আসার আগে tray যা দেখাবে।</summary>
    public static AgentStatus Starting => new()
    {
        State = SegmentState.Idle,
        ActiveToday = TimeSpan.Zero,
        ActiveThisMonth = TimeSpan.Zero,
        MonthlyTargetHours = 208,
        QueueDepth = 0,
        Health = SyncHealth.Ok,
        Paused = false,
    };
}

/// <summary>
/// স্ট্যাটাস দেখানোর জায়গা — বাস্তবে tray আইকন, টেস্টে একটা তালিকা।
///
/// ⚠️ <see cref="Publish"/> ডাকা হবে ট্র্যাকিং ও সিঙ্ক থ্রেড থেকে, UI থ্রেড
/// থেকে নয়। WinForms-এ UI ছোঁয়ার আগে ইমপ্লিমেন্টেশনকেই মার্শাল করতে হবে
/// (<c>SynchronizationContext</c> / <c>Control.BeginInvoke</c>)। ভুলে গেলে
/// ক্র্যাশটা সাথে সাথে হয় না — সপ্তাহ দুয়েক পর একবার হয়, আর তখন কেউ দেখে না।
///
/// ⚠️ <see cref="Publish"/> কখনো ব্লক করবে না ও এক্সসেপশন ছুড়বে না। tray-র
/// দোষে ঘণ্টা গোনা থামা চলবে না।
/// </summary>
public interface IAgentStatusSink
{
    void Publish(AgentStatus status);
}
