using oXeio.Core.Agent;

namespace oXeio.Agent.Sync;

/// <summary>
/// <see cref="HttpSyncClient"/>-এর সব নব একজায়গায়। কোডে ছড়িয়ে না রেখে এখানে
/// রাখার কারণ: টাইমআউট আর রেট-লিমিটের সংখ্যাগুলো একে অপরের সাথে সম্পর্কিত —
/// একটা বদলালে আরেকটা না দেখে বদলানো বিপজ্জনক (নিচের মন্তব্যগুলো দেখুন)।
///
/// ⚠️ এখানে কোনো টোকেন বা সিক্রেট নেই, ইচ্ছাকৃতভাবে। টোকেন আসে
/// <see cref="IDeviceTokenSource"/> দিয়ে — secrets মডিউল তার মালিক।
/// </summary>
internal sealed record SyncClientOptions
{
    /// <summary>
    /// সার্ভারের বেস URL, যেমন <c>https://oxeio.office.local/api/v1</c>।
    ///
    /// ⚠️ শেষে '/' না থাকলে <see cref="Uri"/>-র relative জোড়া লাগানোর নিয়ম
    /// শেষ খণ্ডটা <b>কেটে ফেলে</b>: "…/api/v1" + "agent/segments" = "…/api/agent/segments"।
    /// তাই ক্লায়েন্ট নিজেই '/' বসিয়ে নেয়, কনফিগে ভুল থাকলেও।
    /// </summary>
    public required Uri BaseAddress { get; init; }

    /// <summary>User-Agent হেডারে যায়। সার্ভারের লগে কোন এজেন্ট কথা বলছে বোঝা যায়।</summary>
    public string AgentVersion { get; init; } = "0.0.0";

    // ── টাইমআউট ─────────────────────────────────────────────────────────────
    //
    // ⚠️ HttpClient.Timeout ব্যবহার করা হয় না (Infinite করা আছে) — ওটা পুরো
    //    ক্লায়েন্টের জন্য একটাই মান, অথচ একটা heartbeat আর একটা ৫ MiB আপলোডের
    //    সহনীয় সময় এক নয়। প্রতি কলে নিজস্ব CancellationTokenSource।

    /// <summary>enroll / config / heartbeat / update-check — ছোট JSON, দ্রুত হওয়ার কথা।</summary>
    public TimeSpan ControlTimeout { get; init; } = TimeSpan.FromSeconds(20);

    /// <summary>৫০০ রেকর্ডের একটা ব্যাচ। ধীর ADSL-এও ~২০০ KB এক মিনিটে যায়।</summary>
    public TimeSpan IngestTimeout { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>
    /// একটা .webp আপলোড।
    ///
    /// ⭐ এই সংখ্যাটা স্লটের দৈর্ঘ্যের সাথে বাঁধা: ৩ মনিটর × ৬০ সেকেন্ড = ৩ মিনিট,
    /// অর্থাৎ সবচেয়ে খারাপ অবস্থাতেও ৫ মিনিটের স্লট শেষ হওয়ার আগেই হাত খালি।
    /// এটা বাড়ালে একটা ঝুলে থাকা কানেকশন পরের স্লটের ছবিগুলোকেও আটকে দেবে,
    /// আর কিউ তখন প্রতি স্লটে বাড়তেই থাকবে।
    /// </summary>
    public TimeSpan ScreenshotTimeout { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>MSI নামানো — কিউয়ের বাইরের কাজ, তাই লম্বা সময় দেওয়া যায়।</summary>
    public TimeSpan DownloadTimeout { get; init; } = TimeSpan.FromMinutes(10);

    /// <summary>TCP/TLS ধরতে কতক্ষণ। লাইন মরা থাকলে দ্রুত হাল ছেড়ে রিট্রাইয়ে যাওয়াই ভালো।</summary>
    public TimeSpan ConnectTimeout { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// ⭐ সপ্তাহের পর সপ্তাহ চলা প্রসেসের DNS সমস্যার একমাত্র সমাধান।
    /// একটা static <c>HttpClient</c> কানেকশন পুল ধরে রাখে আর DNS আর কখনো দেখে না —
    /// সার্ভারের IP বদলালে (নতুন রিভার্স প্রক্সি, DHCP) এজেন্ট চিরতরে ভুল ঠিকানায়
    /// ধাক্কা দিতে থাকত। এই মেয়াদ শেষে কানেকশন ফেলে দেওয়া হয়, ফলে DNS আবার দেখা হয়।
    /// </summary>
    public TimeSpan PooledConnectionLifetime { get; init; } = TimeSpan.FromMinutes(5);

    // ── রেট লিমিট ───────────────────────────────────────────────────────────

    /// <summary>
    /// segments / app-usage / events — প্রতি মিনিটে কতটা রিকোয়েস্ট।
    ///
    /// ⭐ সার্ভারের সীমা <see cref="SyncLimits.RateLimitIngestPerMinute"/> = ৬০।
    /// এখানে ৫৫ রাখা হয়েছে ইচ্ছাকৃতভাবে — বাকি ৫টা heartbeat (৩০ সেকেন্ডে একটা,
    /// অর্থাৎ ২/মিনিট), config reload আর update-check-এর জন্য তোলা। ওগুলোকেও
    /// একই লিমিটারে ঢোকালে কিউ ড্রেন করার সময় heartbeat আটকে যেত আর ড্যাশবোর্ড
    /// মেশিনটাকে "অফলাইন" দেখাত — অথচ সে তখন প্রাণপণে আপলোড করছে।
    ///
    /// ৫০,০০০ সারির ব্যাকলগের হিসাব: ৫০,০০০ ÷ ৫০০ (MaxBatchSize) = ১০০ রিকোয়েস্ট;
    /// ১০০ ÷ ৫৫ ≈ ১.৮ মিনিট। অর্থাৎ ৪২৯ না খেয়েই পুরোটা যায়।
    /// </summary>
    public int IngestPermitsPerMinute { get; init; } = 55;

    /// <summary>
    /// সার্ভারের সীমা <see cref="SyncLimits.RateLimitScreenshotPerMinute"/> = ২০;
    /// এখানে ১৮ — সীমার গায়ে গা লাগিয়ে চললে ঘড়ির সামান্য অমিলেই ৪২৯।
    ///
    /// হিসাব: এক দিনে সর্বোচ্চ ২ মনিটর × ১২ স্লট/ঘণ্টা × ১৬ ঘণ্টা = ৩৮৪টা ছবি।
    /// ১৮/মিনিটে সেটা ~২২ মিনিট। সাত দিন অফলাইন থাকলে ২,৬৮৮টা ≈ আড়াই ঘণ্টা —
    /// লাইন ফেরার পর নিজে নিজেই শেষ হয়ে যায়, কারো কিছু করার দরকার নেই।
    /// </summary>
    public int ScreenshotPermitsPerMinute { get; init; } = 18;

    /// <summary>
    /// নামানো MSI এর চেয়ে বড় হলে থামিয়ে দেওয়া হয়।
    /// ⚠️ ছাড়া দিলে একটা ভুল রুট (HTML স্ট্রিম) ডিস্ক ভরিয়ে দিতে পারত, আর তখন
    /// আউটবক্স আর কিছু লিখতে পারত না — অর্থাৎ ডেটা হারাত।
    /// </summary>
    public long MaxUpdateBytes { get; init; } = 256L * 1024 * 1024;

    /// <summary>স্ট্রিং URL থেকে — কনফিগ ফাইল থেকে পড়ার সহজ পথ।</summary>
    public static SyncClientOptions For(string baseUrl, string agentVersion = "0.0.0") =>
        new() { BaseAddress = new Uri(baseUrl, UriKind.Absolute), AgentVersion = agentVersion };
}
