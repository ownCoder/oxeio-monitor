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
    /// সাইন-ইন জানালাটা আবার খোলা।
    ///
    /// ⚠️⚠️ <b>কেন এটা লাগল:</b> জানালাটা আসত <b>শুধু চালু হওয়ার সময়</b>,
    /// একবার। স্টাফ সেটা বন্ধ করে দিলে (বা ইনস্টলের দিন তাড়া থাকলে) ফেরার
    /// একমাত্র পথ ছিল লগ-অফ করে আবার লগ-ইন। G79-এর পর জানালায় বড় করে লেখা
    /// থাকে <i>"Sign in to start counting your hours"</i> — অথচ সাইন ইন
    /// করার কোনো উপায়ই ছিল না। বার্তাটা কাজ বলছে, কিন্তু কাজটা করার
    /// দরজা নেই — এটাই মালিক ধরেছেন ০.৩.৪-এ।
    /// </summary>
    public Action? RequestSignIn { get; init; }

    /// <summary>
    /// ⭐⭐ যাচাই হয়ে যাওয়া নতুন MSI বসানো — স্টাফ নিজেই চাপবেন।
    ///
    /// ⚠️⚠️ <b>নীরবে বসানো হয় না — সম্ভবও নয়।</b> এজেন্ট চলে লগইন করা
    /// ইউজারের অধিকারে (installer-এ <c>Group=Users</c>), আর <c>msiexec</c>
    /// অ্যাডমিন চায়। তাই UAC জানালা উঠবেই — "ব্যাকগ্রাউন্ডে" করার একমাত্র
    /// পথ হতো SYSTEM হিসেবে চলা একটা সার্ভিস, যেটা আলাদা ও বড় সিদ্ধান্ত।
    ///
    /// ⚠️ আর সেটা <b>খারাপও নয়</b>: G58 বলে খারাপ MSI একবার চললে ফেরানোর
    /// পথ নেই। একটা মানুষের ক্লিক ওই ঝুঁকির শেষ বাঁধ।
    /// </summary>
    public Action? InstallUpdate { get; init; }

    /// <summary>
    /// স্টাফ নিজে সাইন আউট করতে চাইলে।
    ///
    /// ⚠️⚠️ <b>tray নিজে কিছু মুছে ফেলে না, নিশ্চিতও করে না</b> — শুধু খবর
    /// দেয়। কারণ সাইন আউট মানে অপাঠানো সারিগুলো ফেলে দেওয়া, আর কতগুলো পড়ে
    /// আছে তা জানতে আউটবক্স পড়তে হয়। tray-কে আউটবক্স ছোঁয়ালে এই ফাইলের
    /// উপরের নিয়মটাই ভাঙত, আর "কত বাকি" নিয়ে দুই জায়গায় দুই রকম উত্তর
    /// তৈরি হতো। সিদ্ধান্ত ও জিজ্ঞাসা দুটোই <c>AgentHost</c>-এ
    /// (<see cref="oXeio.Core.Agent.SignOutGate"/>)।
    ///
    /// ⚠️ null হলে মেনু আইটেমটা দেখা যায় না — "প্রস্থান" আইটেম না রাখার
    /// নিয়মটার মতোই, এটাও ইচ্ছাকৃতভাবে বন্ধ করা যায়।
    /// </summary>
    public Action? RequestSignOut { get; init; }

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
