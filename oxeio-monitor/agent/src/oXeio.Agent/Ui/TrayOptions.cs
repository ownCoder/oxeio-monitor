using oXeio.Core.Agent;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray যা যা জানে — এটুকুই। এর বাইরে সে কিছু জিজ্ঞাসা করে না, কোথাও কল করে না।
///
/// ⚠️ এখানে কোনো <c>ISyncClient</c>, <c>IOutboxStore</c> বা ট্র্যাকিং লুপ নেই,
/// ইচ্ছাকৃতভাবে। tray শুধু <see cref="IAgentStatusSink"/> দিয়ে যা পায় তা আঁকে।
/// একবার তাকে সার্ভারে কল করতে দিলে দুই জায়গায় দুই রকম "সত্য" তৈরি হতো, আর
/// tray-র বাগ ঘণ্টার হিসাব নষ্ট করতে পারত।
///
/// এনরোল হওয়ার আগে tray দেখানো শুরু হয় (আইকনটা সবসময় দৃশ্যমান থাকতে হবে), তাই
/// <see cref="DeviceId"/> ও কর্মীর তথ্য শুরুতে null — পরে
/// <see cref="TrayIcon.UpdateOptions"/> দিয়ে বসানো হয়।
/// </summary>
internal sealed record TrayOptions
{
    public required string AgentVersion { get; init; }

    /// <summary>সার্ভারের বেস URL — শুধু "সম্পর্কে" জানালায় দেখানোর জন্য।</summary>
    public required string ServerUrl { get; init; }

    /// <summary>এনরোল হওয়ার আগে null।</summary>
    public int? DeviceId { get; init; }

    public string? EmployeeName { get; init; }

    public string? EmpCode { get; init; }

    /// <summary>"আমার তথ্য" — স্টাফ পোর্টালের URL। খালি হলে মেনু আইটেম নিষ্ক্রিয়।</summary>
    public string? StaffPortalUrl { get; init; }

    /// <summary>
    /// "পলিসি দেখুন" — http(s) URL, অথবা ইনস্টল করা লোকাল ডকুমেন্টের পাথ।
    /// ⚠️ যা-ই দিন, <see cref="TrayIcon"/> এটাকে অন্ধভাবে ShellExecute করে না —
    /// স্কিম ও এক্সটেনশন যাচাই করে।
    /// </summary>
    public string? PolicyUrl { get; init; }

    /// <summary>
    /// কনফিগ — শুধু "সম্পর্কে" জানালায় স্ক্রিনশটের সময়সীমা দেখাতে। null হলে
    /// <see cref="AgentConfig.Default"/> ধরা হয়।
    /// </summary>
    public AgentConfig? Config { get; init; }

    /// <summary>
    /// "সিঙ্ক এখন" চাপলে যা ডাকা হবে।
    ///
    /// ⚠️ এটা UI থ্রেড থেকে ডাকা হয় <b>না</b> — thread pool-এ ফেলা হয়। তাই
    /// ইমপ্লিমেন্টেশন ব্লক করলে অসুবিধা নেই, কিন্তু থ্রেড-নিরাপদ হতে হবে।
    /// সাধারণত এটা সিঙ্ক লুপের একটা <c>ManualResetEventSlim.Set()</c>-এর মতো
    /// কিছু হওয়া উচিত, সরাসরি HTTP কল নয়।
    /// </summary>
    public Action? RequestSyncNow { get; init; }

    /// <summary>
    /// J03 — মাসের লক্ষ্য পূরণের বেলুন কোন মাসে দেখানো হয়েছে, তার স্মৃতি।
    ///
    /// ⚠️ null দিলে ফিচারটাই বন্ধ, বেলুন "প্রতিবার" হয়ে যায় না। স্মৃতি ছাড়া
    /// একবার-দেখানোর প্রতিশ্রুতি রাখা যায় না, আর প্রতি heartbeat-এ বেলুন
    /// দেখানোর চেয়ে কিছুই না দেখানো নিরাপদ (<see cref="MonthlyMilestone"/>)।
    ///
    /// ⚠️ প্রতিটা <see cref="TrayIcon.UpdateOptions"/>-এ <b>একই ইনস্ট্যান্স</b>
    /// দিতে হবে — নতুন অবজেক্ট দিলে ক্যাশ হারিয়ে ডিস্ক আবার পড়া হতো।
    /// </summary>
    public IMilestoneMemory? Milestone { get; init; }

    /// <summary>UI-তে ধরা পড়া এক্সসেপশন এখানে যায়। null হলে নীরবে গেলা হয়।</summary>
    public Action<Exception>? OnError { get; init; }

    public AgentConfig EffectiveConfig => Config ?? AgentConfig.Default;
}
