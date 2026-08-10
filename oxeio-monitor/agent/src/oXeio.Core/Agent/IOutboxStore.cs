namespace oXeio.Core.Agent;

/// <summary>
/// ⭐ টেকসই আউটবক্স — অফলাইনে জমা, লাইন ফিরলে ক্রম মেনে আপলোড।
///
/// <b>কেন lease/ack, কেন সাধারণ dequeue নয় — এটাই এই ইন্টারফেসের পুরো কারণ:</b>
///
/// <code>
/// (ক) dequeue → upload   : সারি মুছে নিয়ে আপলোড করতে গেলাম, তখনই পাওয়ার গেল।
///                          সারি নেই, সার্ভারেও পৌঁছায়নি। ডেটা <b>হারিয়ে গেল</b>।
/// (খ) upload → delete    : আপলোড হলো, ২০০ আসার আগেই প্রসেস মরল। পরের বার
///                          আবার পাঠাবে। ডেটা <b>ডুপ্লিকেট</b> হলো।
/// (গ) lease → ack        : সারি জায়গাতেই থাকে, শুধু "ধার নেওয়া" চিহ্ন পড়ে।
///                          ২০০ পেলে ack → মুছে যায়। মাঝপথে মরলে লিজ ফুরোয়
///                          আর সারি নিজে থেকে ফিরে আসে।
/// </code>
///
/// (গ)-তেও একই ডেটা দুবার <i>পাঠানো</i> হতে পারে — ঠিক যখন সার্ভার লিখে ফেলেছে
/// কিন্তু উত্তরটা আমরা পাইনি। সেটা সমস্যা নয়, কারণ প্রতিটা রেকর্ডে
/// <c>clientUuid</c> আছে আর সার্ভার <c>ON CONFLICT DO NOTHING</c> করে (§ ২.১-ঘ)।
/// অর্থাৎ ডুপ্লিকেট পাঠানো <b>সস্তা</b>, আর ডেটা হারানো <b>অপূরণীয়</b> —
/// তাই at-least-once বেছে নেওয়া হয়েছে, exactly-once নয়।
///
/// ⚠️ সব মেথড একটাই সিঙ্ক ওয়ার্কার থেকে ডাকা হবে ধরে নেবেন না —
/// <see cref="EnqueueAsync"/> ট্র্যাকিং থ্রেড থেকে আসে। ইমপ্লিমেন্টেশন
/// থ্রেড-সেফ হতে হবে (SQLite-এ WAL + একটাই write connection যথেষ্ট)।
/// </summary>
public interface IOutboxStore : IAsyncDisposable
{
    /// <summary>একটা সারি জমা। ফেরত দেয় নতুন row id।</summary>
    Task<long> EnqueueAsync(OutboxItem item, CancellationToken ct = default);

    /// <summary>
    /// একাধিক সারি <b>একটাই ট্রানজেকশনে</b>। মাঝপথে মরলে হয় সবগুলো ঢোকে,
    /// নয় একটাও না — অর্ধেক ঢোকা ব্যাচ পরে ফাঁক হিসেবে ধরা পড়ত না।
    /// </summary>
    Task<int> EnqueueManyAsync(IReadOnlyList<OutboxItem> items, CancellationToken ct = default);

    /// <summary>
    /// পরের ব্যাচ ধার নেওয়া। কিছু না থাকলে <c>null</c>।
    ///
    /// শর্তগুলো ইমপ্লিমেন্টেশনকেই মানতে হবে:
    /// <list type="bullet">
    /// <item>শুধু <paramref name="kind"/>-এর সারি, <see cref="OutboxEntry.EnqueuedAt"/> অনুসারে <b>পুরোনো আগে</b> (§ ২.১-ঘ: ক্রম বদলালে সার্ভারে সেশন ভাঙে — G43)</item>
    /// <item>যেগুলোর <c>notBefore</c> এখনো আসেনি (<see cref="RetryAsync"/> দেখুন) সেগুলো বাদ</item>
    /// <item>ইতিমধ্যে ধার নেওয়া (লিজ চালু) সারি বাদ</item>
    /// <item><paramref name="maxItems"/> কখনো <see cref="SyncLimits.MaxBatchSize"/> ছাড়াবে না</item>
    /// </list>
    /// </summary>
    Task<OutboxLease?> LeaseAsync(
        OutboundKind kind,
        int maxItems,
        TimeSpan leaseFor,
        DateTimeOffset now,
        CancellationToken ct = default);

    /// <summary>
    /// সার্ভার নিয়েছে (<see cref="SyncOutcome.Success"/>) — সারিগুলো মুছে ফেলুন।
    ///
    /// ⚠️ স্ক্রিনশটে <see cref="OutboxItem.FilePath"/>-এর ফাইলটাও এখানেই মুছতে হবে।
    /// শুধু সারি মুছলে ডিস্কে অনাথ .webp জমতে থাকবে, আর সেগুলো কোনো বাজেট
    /// হিসাবেও ধরা পড়বে না — মাস দুয়েকে ড্রাইভ ভরে যাবে।
    /// অজানা বা ফুরিয়ে যাওয়া <paramref name="leaseId"/> চুপচাপ উপেক্ষা করুন।
    /// </summary>
    Task AckAsync(Guid leaseId, CancellationToken ct = default);

    /// <summary>
    /// সাময়িক ব্যর্থতা (<see cref="SyncOutcome.Transient"/>) — লিজ ছেড়ে দিন,
    /// <see cref="OutboxEntry.Attempts"/> এক বাড়ান, আর
    /// <paramref name="notBefore"/>-এর আগে এগুলো আবার লিজ দেবেন না।
    ///
    /// <paramref name="notBefore"/> আসে <see cref="RetryPolicy.NextAttemptAt"/> থেকে।
    /// </summary>
    Task RetryAsync(Guid leaseId, DateTimeOffset notBefore, CancellationToken ct = default);

    /// <summary>
    /// স্থায়ী প্রত্যাখ্যান (<see cref="SyncOutcome.Permanent"/>) — সারিগুলো মুছে দিন,
    /// কিন্তু <paramref name="reason"/> সহ লগে লিখুন।
    ///
    /// ⚠️ নীরবে মোছা চলবে না। ৪২২ পাওয়া মানে এজেন্ট এমন কিছু বানাচ্ছে যা সার্ভার
    /// কোনোদিনই নেবে না; লগে না থাকলে একটা মেশিন মাসের পর মাস নিঃশব্দে ডেটা
    /// ফেলে দিত আর রিপোর্টে শুধু "ঘণ্টা কম" দেখা যেত।
    /// </summary>
    Task AbandonAsync(Guid leaseId, string reason, CancellationToken ct = default);

    /// <summary>
    /// ফুরিয়ে যাওয়া লিজ ফিরিয়ে নেওয়া (ক্র্যাশ বা রিবুটের পর)। ফেরত দেয় কতগুলো ফিরল।
    /// স্টার্টআপে একবার, তারপর সিঙ্ক লুপে মাঝে মাঝে ডাকুন।
    ///
    /// এটাই (গ)-র নিরাপত্তা জাল — এটা না ডাকলে ক্র্যাশের সময় ধার নেওয়া ব্যাচ
    /// চিরকাল আটকে থাকত আর কিউ কখনো খালি হতো না।
    /// </summary>
    Task<int> ReclaimExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct = default);

    /// <summary>heartbeat ও tray-র জন্য। সস্তা রাখুন — প্রতি ৩০ সেকেন্ডে ডাকা হয়।</summary>
    Task<OutboxDepth> GetDepthAsync(CancellationToken ct = default);

    /// <summary>
    /// <see cref="OutboxBudget"/>-এর খোরাক — প্রতিটা সারির id, ধরন, বয়স ও সাইজ।
    /// Payload আনা হয় না (<see cref="OutboxEntryInfo"/>-র মন্তব্য দেখুন)।
    /// </summary>
    Task<IReadOnlyList<OutboxEntryInfo>> SurveyAsync(CancellationToken ct = default);

    /// <summary>
    /// বাজেট মেলাতে সারি ফেলে দেওয়া। <see cref="AckAsync"/>-এর মতোই ফাইলও মুছবে।
    /// ফেরত দেয় কতগুলো সত্যিই মুছল।
    ///
    /// ⚠️ ধার নেওয়া সারি কখনো মুছবেন না — ওগুলো এই মুহূর্তে আপলোড হচ্ছে।
    /// </summary>
    Task<int> EvictAsync(IReadOnlyList<long> rowIds, string reason, CancellationToken ct = default);
}
