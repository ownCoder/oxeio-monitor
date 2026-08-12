namespace oXeio.Core.Agent;

/// <summary>
/// A05 — কিউয়ের ডিস্ক-বাজেট কখন প্রয়োগ করতে হবে।
///
/// ⭐ নিয়মটা <see cref="oXeio.Core.Agent.OutboxBudget"/>-এর ডকে লেখাই ছিল:
/// <i>"স্টার্টআপে একবার, তারপর ঘণ্টায় একবার আর <c>LastWriteError</c> দেখা
/// দিলেই সঙ্গে সঙ্গে"</i>। ⚠️ কিন্তু নিয়মটা কোথাও **কোড হয়ে ওঠেনি** —
/// কলারটাই লেখা হয়নি, তাই গোটা বাজেট-ব্যবস্থা তৈরি হয়ে অচল পড়ে ছিল।
///
/// এখানে থাকায় তিনটে শাখাই ইউনিট টেস্টে ধরা যায়।
/// </summary>
public static class OutboxSweep
{
    public enum Reason
    {
        /// <summary>এখন দরকার নেই।</summary>
        No,

        /// <summary>এজেন্ট সবে চালু — কিউ কতটা বেড়েছে কেউ জানে না।</summary>
        Startup,

        /// <summary>নিয়মিত ঝাড়ু।</summary>
        Due,

        /// <summary>
        /// ⭐ লেখা ব্যর্থ হয়েছে — ডিস্ক ভরে গেছে, ঠিক এখনই জায়গা দরকার।
        /// ঘণ্টার অপেক্ষায় থাকলে মাঝের সময়টুকুর ডেটা নীরবে হারাত।
        /// </summary>
        WriteFailed,
    }

    /// <param name="lastSweep">
    /// শেষ কবে চলেছে। কখনো না চললে <see cref="DateTimeOffset.MinValue"/>।
    /// </param>
    public static Reason Check(
        DateTimeOffset lastSweep,
        DateTimeOffset now,
        TimeSpan every,
        bool hasWriteError)
    {
        // ⚠️ লেখা ব্যর্থ হওয়াটা সবার আগে — ওটাই একমাত্র জরুরি অবস্থা।
        if (hasWriteError) return Reason.WriteFailed;

        if (lastSweep == DateTimeOffset.MinValue) return Reason.Startup;

        // ⚠️ `>=`, `>` নয় — ঠিক এক ঘণ্টার মাথায় চললে ঝাড়ুটা প্রতিবার এক
        //    টিক করে পিছিয়ে যেত, আর দিন শেষে কয়েকবার কম চলত।
        return now - lastSweep >= every ? Reason.Due : Reason.No;
    }

    public static bool IsDue(
        DateTimeOffset lastSweep,
        DateTimeOffset now,
        TimeSpan every,
        bool hasWriteError) =>
        Check(lastSweep, now, every, hasWriteError) != Reason.No;
}
