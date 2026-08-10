using oXeio.Core.Models;

namespace oXeio.Core.Agent;

/// <summary>
/// ⭐ সার্ভারের সাথে কথা বলার একমাত্র দরজা — এক endpoint, এক মেথড।
///
/// <b>চুক্তি (ইমপ্লিমেন্টেশনকে এগুলো মানতেই হবে):</b>
/// <list type="number">
/// <item>কোনো মেথড <b>এক্সসেপশন ছোড়ে না</b>। নেটওয়ার্ক ব্যর্থতা এখানে স্বাভাবিক
///       অবস্থা, ব্যতিক্রম নয় — <see cref="SyncResult{T}"/> দেখুন।</item>
/// <item>প্রতিটি রিকোয়েস্টে <see cref="SyncLimits.ClientTimeHeader"/> হেডার যাবে,
///       GET-এও। সার্ভার এখান থেকেই clock drift মাপে; না পাঠালে drift অ্যালার্ট
///       ভুল হবে আর সেটা কেউ দেখবেও না।</item>
/// <item><see cref="EnrollAsync"/> ছাড়া সব কলে <c>Authorization: Bearer</c>।</item>
/// <item>৪০৩-এর বডিতে <c>{ command: "revoke" }</c> পেলে
///       <see cref="SyncOutcome.Revoked"/> ফেরাতে হবে, রিট্রাই নয়।</item>
/// <item>টাইমআউট নিজে সামলাতে হবে। ⚠️ <c>HttpClient</c>-এর ডিফল্ট ১০০ সেকেন্ড
///       টাইমআউট বেশি — একটা ঝুলে থাকা কানেকশন পুরো সিঙ্ক লুপকে দুই মিনিট
///       আটকে রাখে, আর তখন কিউ বাড়তেই থাকে।</item>
/// </list>
///
/// ⚠️ ইমপ্লিমেন্টেশন <b>একটাই</b> <c>HttpClient</c> ব্যবহার করবে, সারা জীবনের জন্য।
/// প্রতি কলে নতুন বানালে সপ্তাহখানেকে socket exhaustion — আর প্রসেসটা তো
/// সপ্তাহের পর সপ্তাহ চলবেই।
/// </summary>
public interface ISyncClient
{
    /// <summary>
    /// enroll-এর পর বা ডিস্ক থেকে পড়ে টোকেন বসানো। null দিলে টোকেন মুছে যায়।
    /// টোকেন ছাড়া <see cref="EnrollAsync"/> ছাড়া বাকি সব কল ৪০১ পাবে।
    /// </summary>
    void SetDeviceToken(string? deviceToken);

    Task<SyncResult<EnrollResponse>> EnrollAsync(
        EnrollRequest request, CancellationToken ct = default);

    Task<SyncResult<ConfigResponse>> GetConfigAsync(CancellationToken ct = default);

    Task<SyncResult<HeartbeatResponse>> HeartbeatAsync(
        HeartbeatRequest request, CancellationToken ct = default);

    /// <summary>
    /// ⚠️ <paramref name="segments"/> <see cref="SyncLimits.MaxBatchSize"/>-এর বেশি
    /// হলে সার্ভার পুরো ব্যাচটাই ৪০০ দেবে — অর্থাৎ একটা বড় ব্যাচ পাঠানোর ভুলে
    /// পাঁচশো সারি "স্থায়ী প্রত্যাখ্যান" হয়ে মুছে যেত। ভাগ করার দায়িত্ব কলারের।
    /// </summary>
    Task<SyncResult<IngestAck>> SendSegmentsAsync(
        IReadOnlyList<ActivitySegment> segments, CancellationToken ct = default);

    /// <inheritdoc cref="SendSegmentsAsync"/>
    Task<SyncResult<IngestAck>> SendAppUsageAsync(
        IReadOnlyList<AppUsageRecord> items, CancellationToken ct = default);

    /// <inheritdoc cref="SendSegmentsAsync"/>
    Task<SyncResult<IngestAck>> SendEventsAsync(
        IReadOnlyList<AgentEventRecord> events, CancellationToken ct = default);

    /// <summary>
    /// একবারে একটাই ছবি — multipart, <c>meta</c> + <c>file</c>।
    ///
    /// <paramref name="webpPath"/> ডিস্কের ফাইল; ইমপ্লিমেন্টেশন সেটা
    /// <b>স্ট্রিম</b> করবে, পুরোটা মেমরিতে তুলবে না।
    ///
    /// ⚠️ ফাইলটা না থাকলে বা <see cref="SyncLimits.MaxScreenshotBytes"/>-এর বড় হলে
    /// নেটওয়ার্কে না গিয়েই <see cref="SyncOutcome.Permanent"/> ফেরাতে হবে —
    /// নইলে একটা হারানো ফাইলের জন্য ওই সারি চিরকাল রিট্রাই হয়ে কিউ আটকে রাখত।
    /// </summary>
    Task<SyncResult<ScreenshotAck>> SendScreenshotAsync(
        ScreenshotRecord meta, string webpPath, CancellationToken ct = default);

    /// <summary>২০৪ = হালনাগাদ আছে; তখন Success কিন্তু <c>Value</c> null।</summary>
    Task<SyncResult<UpdateOffer>> CheckUpdateAsync(
        string currentVersion, CancellationToken ct = default);

    /// <summary>MSI নামিয়ে <paramref name="destinationPath"/>-এ রাখে ও হ্যাশ হিসাব করে।</summary>
    Task<SyncResult<UpdateDownload>> DownloadUpdateAsync(
        string version, string destinationPath, CancellationToken ct = default);
}
