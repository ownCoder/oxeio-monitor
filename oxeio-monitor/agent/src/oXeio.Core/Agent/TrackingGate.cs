namespace oXeio.Core.Agent;

/// <summary>
/// এই মুহূর্তে এজেন্টের সময় গোনা উচিত কি না — <b>একটাই জায়গা</b>।
///
/// ⚠️⚠️ <b>কেন এটা লেখা হলো:</b> ইনস্টলের পর সাইন-ইন জানালা আসত, কিন্তু
/// স্টাফ সাইন ইন করার <b>আগেই</b> এজেন্ট গোনা শুরু করে দিত — tray-তে সবুজ
/// "Working", আর আউটবক্সে সারি জমতে থাকত। তিনটে আলাদা ক্ষতি:
/// <list type="number">
///   <item><b>ভুল লোকের নামে ঘণ্টা।</b> অ্যাডমিন PC-টা বসিয়ে আধঘণ্টা কাজ
///   করে গেলে সেই সময়টুকু আউটবক্সে জমা থাকত, আর পরে স্টাফ সাইন ইন করামাত্র
///   ডিভাইসটা তার নামে বাঁধা পড়ত — অর্থাৎ অন্যের আধঘণ্টা তার খাতায়।</item>
///   <item><b>সম্মতির আগেই ছবি।</b> স্ক্রিনশটের নিয়ম "কাজ করার সময়" —
///   কিন্তু যে এখনো সাইন ইনই করেনি, সে এখনো কেউ নয়।</item>
///   <item><b>জানালাটা মিথ্যে বলত।</b> সবুজ বিন্দু আর "Working" মানে সব
///   ঠিকঠাক চলছে; আসলে একটা বাইটও সার্ভারে যেতে পারত না।</item>
/// </list>
///
/// ⭐ Core-এ থাকায় এটা তিন লাইনের বিশুদ্ধ সিদ্ধান্ত, আর
/// <c>AgentHost</c>-এর থ্রেড-লুপের ভেতরে বসে থাকলে যাচাই করতে একটা আসল
/// মেশিন, আসল লগইন আর অপেক্ষা লাগত।
/// </summary>
public static class TrackingGate
{
    public enum Verdict
    {
        Allowed,

        /// <summary>
        /// এখনো সাইন ইন হয়নি — গোনা শুরুর কোনো ভিত্তি নেই, কারণ ঘণ্টাগুলো
        /// <b>কার</b> সেটাই এখনো জানা যায়নি।
        /// </summary>
        NotEnrolled,

        /// <summary>H06 — অফিস এই ডিভাইস বন্ধ করে দিয়েছে।</summary>
        Revoked,
    }

    /// <summary>
    /// ⚠️⚠️ <b>ক্রমটাই এখানকার আসল সিদ্ধান্ত: revoke আগে।</b>
    ///
    /// revoke হলে <c>DeviceCredentials</c> টোকেন মুছে ফেলে, তাই ওই মুহূর্তের
    /// পর ডিভাইসটা "enrolled নয়"-ও বটে — দুটো শর্তই সত্যি। উল্টো ক্রমে
    /// লিখলে বাতিল হওয়া মেশিনে স্টাফ দেখত <i>"Sign in to start"</i>, অর্থাৎ
    /// অফিস যেটা বন্ধ করে দিয়েছে সেটাই আবার চালু করতে বলা হতো।
    ///
    /// (⭐ সত্যিকারের ফাঁক নয় — <c>NeedsEnrollment</c> নিজেই revoke হলে
    /// মিথ্যা ফেরায়, তাই জানালাটা আসেই না। কিন্তু <b>বার্তাটা</b> ভুল হতো,
    /// আর বাতিল ডিভাইসে স্টাফের একমাত্র ব্যাখ্যা ওই এক লাইন।)
    /// </summary>
    public static Verdict Check(bool enrolled, bool revoked)
    {
        if (revoked) return Verdict.Revoked;
        if (!enrolled) return Verdict.NotEnrolled;

        return Verdict.Allowed;
    }

    public static bool Allows(bool enrolled, bool revoked) =>
        Check(enrolled, revoked) == Verdict.Allowed;

    /// <summary>
    /// স্টাফ যা পড়বে। ⚠️ প্রতিটা বাক্য <b>কী করতে হবে</b> বলে — শুধু কী
    /// হচ্ছে না তা নয়। tray-র এই এক লাইনই তার একমাত্র ব্যাখ্যা।
    /// </summary>
    public static string Explain(Verdict verdict) => verdict switch
    {
        // ⚠️⚠️ "কী করতে হবে" যথেষ্ট নয় — **কোথায়** করতে হবে সেটাও লাগে।
        //    আগে শুধু "Sign in to start counting your hours" লেখা ছিল, আর
        //    জানালায় সাইন ইন করার কোনো বোতামই ছিল না। মালিক ঠিক এটাই
        //    ধরেছেন: "sign in korar option nei"। একটা নির্দেশ যেটা মানার
        //    উপায় দেখায় না, সেটা নির্দেশ নয় — সেটা শুধু দোষারোপ।
        Verdict.NotEnrolled =>
            "Sign in to start counting your hours — right-click the oXeio tray icon → Sign in",
        Verdict.Revoked => "This device has been switched off — tell the office",
        _ => "Counting your hours",
    };
}
