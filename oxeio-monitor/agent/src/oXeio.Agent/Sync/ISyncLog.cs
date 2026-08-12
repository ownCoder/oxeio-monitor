namespace oXeio.Agent.Sync;

/// <summary>
/// সিঙ্ক ক্লায়েন্টের লগের সরু সিম।
///
/// পূর্ণ লগিং মডিউল এলে সেটাকে এই ইন্টারফেসে মুড়ে দিলেই হবে। এখানে
/// <c>Microsoft.Extensions.Logging</c> টেনে আনা হয়নি — নতুন NuGet এড়ানো
/// (ঘরের নিয়ম) আর এই মডিউলের দরকার মাত্র তিনটে মেথড।
///
/// ⚠️ ইমপ্লিমেন্টেশন <b>কখনো এক্সসেপশন ছুড়বে না</b>। লগ লিখতে গিয়ে (ডিস্ক ভরা,
/// ফাইল লক) ছুড়লে সেটা সিঙ্ক ওয়ার্কারকে মেরে ফেলত — অর্থাৎ লগ করার সমস্যা
/// ডেটা হারানোর সমস্যা হয়ে যেত।
/// </summary>
internal interface ISyncLog
{
    void Info(string message);

    /// <summary>সাময়িক গোলমাল — নেট নেই, ৫০০, টাইমআউট। রোজকার ঘটনা।</summary>
    void Warn(string message);

    /// <summary>
    /// যা কারো চোখে পড়া দরকার — স্থায়ী প্রত্যাখ্যান (৪০০/৪২২), revoke,
    /// অথবা অপ্রত্যাশিত এক্সসেপশন।
    /// </summary>
    void Error(string message, Exception? error = null);
}

/// <summary>কিছুই করে না। লগার না দিলে এটাই বসে, যাতে null-চেক ছড়াতে না হয়।</summary>
internal sealed class NullSyncLog : ISyncLog
{
    public static readonly NullSyncLog Instance = new();

    private NullSyncLog() { }

    public void Info(string message) { }
    public void Warn(string message) { }
    public void Error(string message, Exception? error = null) { }
}

/*
 * ⚠️⚠️ এখানে আগে `ConsoleSyncLog` ছিল — <b>একমাত্র</b> বাস্তবায়ন, আর
 * `Program.cs` সেটাই এজেন্টে বসাত। কিন্তু প্রজেক্ট `WinExe`, অর্থাৎ
 * **কনসোলই নেই**; প্রতিটা লাইন শূন্যে যেত। H08-এর আসল রূপটা তাই
 * `Storage/FileLog.cs` — ডিস্কে লেখে, ৭ দিন / ৫০ MB সীমা মানে।
 *
 * ক্লাসটা সরিয়ে দেওয়া হয়েছে রেখে না দিয়ে, কারণ রেখে দিলে একদিন কেউ
 * আবার ওটাই বসাত আর লগ আবার শূন্যে যেত — কোনো ভুল বার্তা ছাড়াই।
 */
