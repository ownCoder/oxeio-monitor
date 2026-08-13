namespace oXeio.Core.Agent;

/// <summary>
/// এই মুহূর্তে সাইন আউট করা যাবে কি না, আর করলে <b>কী হারাবে</b> —
/// <see cref="TrackingGate"/>-এর জোড়া।
///
/// ⚠️⚠️ <b>কেন এটা একটা নিয়ম, শুধু একটা মেনু আইটেম নয়:</b> সাইন আউট মানে
/// ডিভাইস টোকেন মুছে ফেলা। কিন্তু আউটবক্সে তখনো যা পড়ে থাকে — সেগমেন্ট,
/// অ্যাপ-ব্যবহার, স্ক্রিনশট — সেগুলো <b>ডিস্কেই থেকে যায়</b>। পরের জন ওই
/// একই PC-তে সাইন ইন করলে সিঙ্ক ওয়ার্কার সেগুলো <b>তার</b> টোকেন দিয়ে
/// পাঠাত, আর আগের জনের ঘণ্টা ও ছবি নতুন জনের খাতায় গিয়ে বসত।
///
/// ⭐ এটা হুবহু <b>G79</b>-এর ক্ষতি, উল্টো দিক থেকে। G79-এ সাইন ইনের
/// <i>আগের</i> সারিগুলো ভুল লোকের নামে যেত; এখানে সাইন আউটের <i>পরের</i>
/// সাইন-ইনে। তাই সমাধানও একই ধাঁচের — সিদ্ধান্তটা Core-এ, খাঁটি, আর
/// প্রতিটা কলার একই নিয়ম মানে।
///
/// ⚠️ ফলে সাইন আউটের সময় অপাঠানো সারিগুলো <b>ফেলে দিতে হয়</b>। তথ্য হারানো
/// খারাপ, কিন্তু <b>ভুল লোকের নামে তথ্য বসা আরও খারাপ</b> — প্রথমটা
/// স্টাফ টের পায় (ঘণ্টা কম), দ্বিতীয়টা কেউ কোনোদিন টের পায় না।
/// </summary>
public static class SignOutGate
{
    public enum Verdict
    {
        /// <summary>কেউ সাইন ইনই করেনি — মেনু আইটেমটা দেখা যাবে, কিন্তু নিষ্ক্রিয়।</summary>
        NotSignedIn,

        /// <summary>
        /// H06 — অফিস ডিভাইসটা বন্ধ করে দিয়েছে। টোকেন এমনিতেই মুছে গেছে,
        /// তাই সাইন আউট করার কিছু নেই।
        /// </summary>
        Revoked,

        /// <summary>সব পাঠানো হয়ে গেছে — নিশ্চিত করে নিয়ে সরাসরি।</summary>
        Ready,

        /// <summary>
        /// আউটবক্সে সারি পড়ে আছে। সাইন আউট করা যাবে, কিন্তু ⚠️ সেগুলো
        /// ফেলে দেওয়া হবে — তাই সংখ্যাটা স্টাফকে দেখিয়ে জিজ্ঞাসা করতে হবে।
        /// </summary>
        PendingUpload,
    }

    /// <param name="pendingItems">
    /// আউটবক্সে এখনো পড়ে থাকা সারির সংখ্যা (<c>OutboxDepth.Total</c>)।
    /// ⚠️ ঋণাত্মক বা শূন্য — দুটোই "কিছু নেই"। গণনায় বাগ থাকলে সেটা যেন
    /// অতিরিক্ত সতর্কবার্তা না বানায়; বাগের শাস্তি স্টাফের পাওয়া উচিত নয়।
    /// </param>
    /// <remarks>
    /// ⚠️⚠️ <b>ক্রমটা <see cref="TrackingGate.Check"/>-এর সাথে হুবহু এক:
    /// revoke আগে।</b> revoke হলে টোকেন মুছে যায়, অর্থাৎ তখন "enrolled নয়"-ও
    /// সত্যি — দুটো শর্তই মেলে। উল্টো লিখলে বাতিল মেশিনে স্টাফ দেখত
    /// <i>"সাইন ইন করা নেই"</i>, অথচ আসল কথা হলো অফিস এটা বন্ধ করে দিয়েছে।
    /// দুই গেট দুই রকম উত্তর দিলে tray-র দুই জায়গায় দুই রকম ব্যাখ্যা যেত।
    /// </remarks>
    public static Verdict Check(bool enrolled, bool revoked, int pendingItems)
    {
        if (revoked) return Verdict.Revoked;
        if (!enrolled) return Verdict.NotSignedIn;

        return pendingItems > 0 ? Verdict.PendingUpload : Verdict.Ready;
    }

    /// <summary>মেনু আইটেমটা <c>Enabled</c> হবে কি না।</summary>
    public static bool Allows(Verdict verdict) =>
        verdict is Verdict.Ready or Verdict.PendingUpload;

    public static bool Allows(bool enrolled, bool revoked, int pendingItems) =>
        Allows(Check(enrolled, revoked, pendingItems));

    /// <summary>
    /// নিশ্চিতকরণের জানালায় যা লেখা থাকবে।
    ///
    /// ⚠️ <b>নিষ্ক্রিয় অবস্থার জন্য কোনো লেখা নেই</b> — <see cref="Allows(Verdict)"/>
    /// মিথ্যা হলে জানালাটা খোলাই হয় না। এখানে একটা বার্তা রাখলে কোনোদিন
    /// কেউ সেটা দেখাত, আর স্টাফ এমন একটা "নিশ্চিত করুন?" পড়ত যার কোনো
    /// ফলই নেই।
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">
    /// এমন verdict যেটায় সাইন আউট করাই যায় না।
    /// </exception>
    public static string Confirm(Verdict verdict, int pendingItems) => verdict switch
    {
        // ⚠️ "আবার সাইন ইন করা যাবে" কথাটা ইচ্ছাকৃত। এটা না থাকলে স্টাফ
        //    ভাবত সাইন আউট মানে চিরতরে বাদ পড়া (revoke), আর ভয়ে কেউ
        //    শেয়ার করা PC-তে সাইন আউট করত না — তখন ঘণ্টা ভুল লোকের নামে।
        Verdict.Ready =>
            "Sign out of oXeio?\n\n"
            + "Your hours stop being counted until someone signs in again. "
            + "Everything measured so far has already reached the office.",

        // ⚠️⚠️ সংখ্যাটা বাক্যের **শুরুতে**, কারণ এটাই একমাত্র জিনিস যা
        //    স্টাফের সিদ্ধান্ত বদলাতে পারে। আর "Sync now" বলে দেওয়া হয়,
        //    নইলে বার্তাটা শুধু ক্ষতির খবর দিত, বাঁচার পথ নয়।
        Verdict.PendingUpload =>
            $"{Describe(pendingItems)} not reached the office yet.\n\n"
            + "Signing out now will discard them — they cannot be sent later, "
            + "because the next person to sign in would get them counted as theirs.\n\n"
            + "If you are online, close this and choose \"Sync now\" first.\n\n"
            + "Sign out and discard?",

        _ => throw new ArgumentOutOfRangeException(
            nameof(verdict), verdict, "Sign out is not available in this state"),
    };

    /// <summary>
    /// ⚠️ একবচন/বহুবচন আলাদা। "1 items" লেখাটা ছোট ব্যাপার মনে হয়, কিন্তু
    /// এই বাক্যটাই স্টাফকে তথ্য ফেলে দিতে রাজি করাচ্ছে — এখানে অযত্নের ছাপ
    /// থাকলে পুরো সতর্কবার্তাটাই কম বিশ্বাসযোগ্য শোনায়।
    /// </summary>
    private static string Describe(int pendingItems) =>
        pendingItems == 1 ? "1 measurement has" : $"{pendingItems} measurements have";
}
