namespace oXeio.Core.Agent;

/// <summary>
/// কখন tray আইকন হলুদ হবে, আর কখন লাল (J07)।
///
/// <b>কেন সময়ের ভিত্তিতে, ব্যর্থতার সংখ্যায় নয়:</b> "টানা ৫ বার ব্যর্থ" শোনায়
/// পরিষ্কার, কিন্তু ব্যাকঅফের কারণে ৫ বার ব্যর্থতা ২ মিনিটেও হতে পারে, আবার
/// ৪০ মিনিটেও। স্টাফ বা অ্যাডমিন যেটা জানতে চায় সেটা হলো
/// <b>"আমার ডেটা কতক্ষণ ধরে আটকে আছে"</b> — সংখ্যা নয়, সময়।
///
/// <b>কেন খালি কিউ সবসময় সুস্থ:</b> রাত ৩টায় কিছু পাঠানোর মতো নেই বলে
/// আইকন লাল হওয়া উচিত নয়। লাল রং তখনই অর্থবহ যখন সত্যিই ডেটা আটকে আছে।
/// </summary>
public sealed record SyncHealthPolicy(TimeSpan DegradedAfter, TimeSpan FailingAfter)
{
    /// <summary>
    /// ১৫ মিনিট — তিনটে স্ক্রিনশট স্লট। এর কমে অফিসের সাধারণ নেট-ঝাঁকুনিতেও
    /// আইকন রং বদলাত, আর তখন রং বদলানোর মানেই থাকত না।
    /// </summary>
    public static readonly TimeSpan DefaultDegradedAfter = TimeSpan.FromMinutes(15);

    /// <summary>
    /// ২ ঘণ্টা — এতক্ষণে সাধারণ নেট-সমস্যা মিটে যেত। এখনো আটকে থাকা মানে
    /// কেউ না দেখলে সমস্যাটা মিটবে না।
    /// </summary>
    public static readonly TimeSpan DefaultFailingAfter = TimeSpan.FromHours(2);

    public static SyncHealthPolicy Default { get; } =
        new(DefaultDegradedAfter, DefaultFailingAfter);

    /// <param name="lastSuccessAt">শেষ সফল সিঙ্ক। কখনো সফল না হলে <c>null</c>।</param>
    /// <param name="startedAt">এজেন্ট চালু হওয়ার সময় — প্রথম সিঙ্কের আগে এটাই ভিত্তি।</param>
    /// <param name="queueDepth">কতগুলো সারি পাঠানোর অপেক্ষায়।</param>
    /// <param name="revoked">সার্ভার এই ডিভাইস বাতিল করেছে কি না।</param>
    public SyncHealth Evaluate(
        DateTimeOffset? lastSuccessAt,
        DateTimeOffset startedAt,
        int queueDepth,
        bool revoked,
        DateTimeOffset now)
    {
        // ⚠️ সবার আগে — revoke হলে বাকি কিছুই আর গুরুত্বপূর্ণ নয়।
        if (revoked) return SyncHealth.Revoked;

        // পাঠানোর কিছু নেই মানে আটকে থাকারও কিছু নেই।
        if (queueDepth <= 0) return SyncHealth.Ok;

        // কখনো সফল হয়নি — তাহলে চালু হওয়ার সময় থেকে গোনা। নইলে সদ্য
        // ইনস্টল করা এজেন্ট প্রথম মিনিট থেকেই লাল দেখাত।
        var since = now - (lastSuccessAt ?? startedAt);

        if (since >= FailingAfter) return SyncHealth.Failing;
        if (since >= DegradedAfter) return SyncHealth.Degraded;

        return SyncHealth.Ok;
    }

    /// <summary>স্টাফকে যা দেখানো হবে — J07-এর নির্দিষ্ট বাক্যটি সহ।</summary>
    public static string? Describe(SyncHealth health, int queueDepth) => health switch
    {
        SyncHealth.Ok => null,
        SyncHealth.Degraded => $"Reaching the server is slow — {queueDepth} waiting",
        SyncHealth.Failing => $"Can't reach server, data saved locally ({queueDepth} waiting)",
        SyncHealth.Revoked => "This device has been switched off — tell the office",
        _ => null,
    };
}
