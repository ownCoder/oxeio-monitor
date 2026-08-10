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

/// <summary>
/// Program.cs এখনো কনসোল ডায়াগনস্টিক — হাতে চালিয়ে দেখার জন্য এটুকুই যথেষ্ট।
/// </summary>
internal sealed class ConsoleSyncLog : ISyncLog
{
    public static readonly ConsoleSyncLog Instance = new();

    public void Info(string message) => Write("ℹ", message);
    public void Warn(string message) => Write("⚠", message);

    public void Error(string message, Exception? error = null) =>
        Write("❌", error is null ? message : $"{message}\n      {error.GetType().Name}: {error.Message}");

    private static void Write(string mark, string message)
    {
        // ⚠️ লগ লেখা কখনো কলারকে ফেলতে পারবে না — রিডাইরেক্ট করা stdout বন্ধ
        //    হয়ে গেলে Console.WriteLine IOException ছোড়ে।
        try
        {
            Console.WriteLine($"  {DateTimeOffset.Now:HH:mm:ss} {mark} sync: {message}");
        }
        catch (Exception)
        {
            // ইচ্ছাকৃত নীরবতা
        }
    }
}
