namespace oXeio.Core.Agent;

/// <summary>
/// ⭐ <b>একটা খারাপ রেকর্ডের জন্য ৪৯৯টা ভালো রেকর্ড ফেলে দেওয়া যাবে না।</b>
///
/// সার্ভার পুরো ব্যাচ একসাথে যাচাই করে। ৫০০টার মধ্যে একটার
/// <c>windowTitle</c> সীমার চেয়ে বড় হলে <b>পুরো ব্যাচেই</b> ৪০০ আসে, আর
/// ৪০০ মানে <see cref="SyncOutcome.Permanent"/> — অর্থাৎ "এটা কোনোদিন
/// নেওয়া হবে না, ফেলে দাও"।
///
/// সরল বাস্তবায়ন পুরো lease-টাই abandon করত। তাতে একটা বেঠিক রেকর্ডের দাম
/// হতো <b>বাকি সবার কয়েক ঘণ্টার কাজের হিসাব</b> — আর সেটা কোথাও দেখা যেত না,
/// কারণ সার্ভারের দিক থেকে সব স্বাভাবিক।
///
/// তাই: <c>Permanent</c> পেলে ব্যাচ অর্ধেক করে আবার চেষ্টা। ৫০০ → ২৫০ → …
/// → ১। মাত্র ১টা রেকর্ড নিয়েও <c>Permanent</c> এলে <b>তখনই</b> নিশ্চিত হওয়া
/// যায় দোষটা ওই রেকর্ডেরই — সেটাই একমাত্র ফেলে দেওয়া হয়।
///
/// ৫০০ থেকে ১-এ নামতে ৮ ধাপ। <see cref="RetryPolicy.Default"/>-এ চেষ্টার
/// কোনো সীমা নেই (শুধু ৩০ দিনের বয়স), তাই এই ধাপগুলোয় কিছু হারায় না।
/// </summary>
public sealed class BatchNarrowing(int fullSize)
{
    /// <summary>একটার নিচে নামা যায় না — ওটাই সবচেয়ে ছোট যাচাইযোগ্য একক।</summary>
    public const int MinSize = 1;

    private int _current = Guard(fullSize);

    /// <summary>পরের বার কত রেকর্ড নিয়ে চেষ্টা করা হবে।</summary>
    public int Current => _current;

    /// <summary>
    /// এখন একটামাত্র রেকর্ড নিয়ে চেষ্টা হচ্ছে — অর্থাৎ পরের
    /// <c>Permanent</c> নিঃসন্দেহে ওই রেকর্ডেরই দোষ।
    /// </summary>
    public bool IsIsolated => _current <= MinSize;

    /// <summary>ব্যাচ গেছে — পুরো মাপে ফিরে যাওয়া।</summary>
    public void OnSuccess() => _current = Guard(fullSize);

    /// <summary>
    /// সাময়িক ব্যর্থতা (নেটওয়ার্ক, ৫০০, ৪২৯) — মাপ <b>বদলানো হয় না</b>।
    /// এতে ব্যাচের কোনো দোষ নেই, তাই ছোট করে লাভ নেই; বরং লিংক ফিরলে
    /// পুরো মাপেই দ্রুত নিষ্কাশন হবে।
    /// </summary>
    public void OnTransient() { }

    /// <summary>ব্যাচে খারাপ রেকর্ড আছে — অর্ধেক করে আবার দেখা।</summary>
    public void OnPermanent()
    {
        if (_current <= MinSize) return;
        _current = Math.Max(MinSize, _current / 2);
    }

    /// <summary>
    /// খারাপ রেকর্ডটা ফেলে দেওয়ার পর — পুরো মাপে ফেরা।
    ///
    /// ⚠️ এখানে ফেরাটা জরুরি। না ফিরলে একটা বেঠিক রেকর্ডের পর সারা জীবন
    /// একটা-একটা করে পাঠানো হতো; ৫০,০০০ সারির ব্যাকলগ তখন rate limit-এ
    /// আটকে কয়েক দিনেও শেষ হতো না।
    /// </summary>
    public void OnIsolatedDropped() => _current = Guard(fullSize);

    private static int Guard(int size) =>
        size < MinSize ? MinSize
        : size > SyncLimits.MaxBatchSize ? SyncLimits.MaxBatchSize
        : size;
}
