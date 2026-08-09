namespace oXeio.Core.Tracking;

/// <summary>
/// "শেষ ইনপুট কতক্ষণ আগে" — এই একটা বিয়োগই পুরো ঘণ্টার হিসাবের ভিত্তি।
///
/// Win32 থেকে আলাদা রাখা হয়েছে যাতে এটা টেস্ট করা যায়। <c>GetLastInputInfo</c>
/// শুধু কাঁচা সংখ্যা দেয়; সেই সংখ্যা দুটো নিয়ে কী করতে হবে তার নিয়ম এখানে।
/// </summary>
public static class IdleMath
{
    /// <summary>
    /// এর চেয়ে বড় ফল মানে বিয়োগটা উল্টো দিকে গেছে (ভবিষ্যতের টাইমস্ট্যাম্প),
    /// প্রকৃত ৪৯ দিনের নিষ্ক্রিয়তা নয়।
    /// </summary>
    public const uint FutureGuard = 0x8000_0000u;

    /// <summary>
    /// <paramref name="nowTicks32"/> ও <paramref name="lastInputTicks32"/> — দুটোই
    /// <c>GetTickCount</c>-এর ৩২-বিট ঘড়িতে। ইচ্ছাকৃতভাবে <c>unchecked</c>:
    /// ৪৯.৭ দিনে ঘড়ি উল্টে গেলেও modular বিয়োগ নিজে থেকেই ঠিক উত্তর দেয়।
    /// </summary>
    /// <param name="clampedFuture">
    /// শেষ ইনপুটের সময় "এখনকার" চেয়ে পরে দেখাচ্ছিল কি না। Microsoft বলে dwTime
    /// "not guaranteed to be incremental" — মাত্র ৫ সেকেন্ড এগিয়ে থাকলেই এই বিয়োগ
    /// ৪৯ দিনের ভুয়া নিষ্ক্রিয়তা দিত, আর ওই স্টাফের সারাদিনের কাজ মুছে যেত।
    /// ৬৪-বিটে নিলেও এটা ঠিক হয় না — সমস্যাটা wrap নয়, unsigned underflow।
    /// </param>
    public static TimeSpan Elapsed(uint nowTicks32, uint lastInputTicks32, out bool clampedFuture)
    {
        var delta = unchecked(nowTicks32 - lastInputTicks32);

        clampedFuture = delta > FutureGuard;
        if (clampedFuture) delta = 0u;

        return TimeSpan.FromMilliseconds(delta);
    }

    /// <inheritdoc cref="Elapsed(uint, uint, out bool)"/>
    public static TimeSpan Elapsed(uint nowTicks32, uint lastInputTicks32) =>
        Elapsed(nowTicks32, lastInputTicks32, out _);
}
