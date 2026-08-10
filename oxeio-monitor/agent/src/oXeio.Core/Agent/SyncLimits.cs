namespace oXeio.Core.Agent;

/// <summary>
/// সার্ভার যা যা মানে না — <c>server/src/agent/agent.constants.ts</c>-এর প্রতিরূপ।
///
/// সংখ্যাগুলো এখানে রাখা আছে যাতে এজেন্ট <b>পাঠানোর আগেই</b> আটকাতে পারে।
/// সার্ভারকে ৪১৩ বলতে দেওয়া মানে ৫ MiB আপলোড করে তারপর জানা যে ওটা নেওয়া হবে না —
/// মোবাইল ব্রডব্যান্ডের সাইটে সেটা দিনে কয়েকশো মেগাবাইট নষ্ট।
/// </summary>
public static class SyncLimits
{
    /// <summary>এক ব্যাচে সর্বোচ্চ কতটা রেকর্ড — <c>MAX_BATCH_SIZE</c>।</summary>
    public const int MaxBatchSize = 500;

    /// <summary>একটা .webp-র সর্বোচ্চ সাইজ। এর বড় হলে ৪১৩ = স্থায়ী প্রত্যাখ্যান।</summary>
    public const long MaxScreenshotBytes = 5L * 1024 * 1024;

    public const string ScreenshotMimeType = "image/webp";

    /// <summary>এজেন্টের নিজের ঘড়ি — সার্ভার এখান থেকেই drift মাপে। প্রতিটি রিকোয়েস্টে, GET-এও।</summary>
    public const string ClientTimeHeader = "x-client-time";

    /// <summary>
    /// ISO-8601 round-trip। ব্যবহার:
    /// <c>DateTimeOffset.UtcNow.ToString(SyncLimits.ClientTimeFormat, CultureInfo.InvariantCulture)</c>
    ///
    /// ⚠️ হাতে <c>"yyyy-MM-ddTHH:mm:ssZ"</c> লিখবেন না — কাস্টম ফরম্যাটে ':' ও '.'
    /// কালচার-নির্ভর সেপারেটর, আর 'Z' কে .NET আক্ষরিক ধরে না। "O" এসবের বাইরে।
    /// </summary>
    public const string ClientTimeFormat = "O";

    /// <summary>প্রতি ডিভাইস, প্রতি মিনিটে। এর বেশি হলে ৪২৯।</summary>
    public const int RateLimitIngestPerMinute = 60;

    /// <inheritdoc cref="RateLimitIngestPerMinute"/>
    public const int RateLimitScreenshotPerMinute = 20;
}
