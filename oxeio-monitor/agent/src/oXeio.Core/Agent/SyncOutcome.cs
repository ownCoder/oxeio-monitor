namespace oXeio.Core.Agent;

/// <summary>
/// ⭐ একটা আপলোডের চেষ্টা ঠিক চার রকম ভাবে শেষ হতে পারে — এর কমে নামালেই
/// হয় ডেটা হারায়, নয় অনন্তকাল রিট্রাই চলে।
/// </summary>
public enum SyncOutcome
{
    /// <summary>সার্ভার নিয়েছে (ডুপ্লিকেট হিসেবে বাদ দিলেও "নিয়েছে")। → ack</summary>
    Success,

    /// <summary>পরে আবার চেষ্টা করলে চলবে — নেট নেই, ৫০০, ৪২৯, টাইমআউট। → retry</summary>
    Transient,

    /// <summary>এই রেকর্ড সার্ভার কোনোদিনই নেবে না — ৪০০/৪২২/৪১৩। → abandon</summary>
    Permanent,

    /// <summary>
    /// এই ডিভাইস revoke হয়েছে (H06)। ট্র্যাকিং <b>স্থায়ীভাবে</b> বন্ধ করতে হবে,
    /// রিট্রাই নয়। বাকি তিনটার সাথে গুলিয়ে ফেললে একটা বাতিল ডিভাইস চিরকাল
    /// সার্ভারে ধাক্কা দিয়ে যেত।
    /// </summary>
    Revoked,
}

/// <summary>
/// HTTP স্ট্যাটাস → <see cref="SyncOutcome"/>। পুরোপুরি pure, তাই টেস্ট করা যায়।
///
/// <b>মূল নীতি:</b> সন্দেহ হলে <see cref="SyncOutcome.Transient"/>। ভুল করে
/// রিট্রাই করলে সবচেয়ে খারাপ যা হয় তা হলো কিউ কিছুক্ষণ বড় থাকে; ভুল করে
/// <see cref="SyncOutcome.Permanent"/> বললে কারো বেতনের ঘণ্টা মুছে যায়।
/// </summary>
public static class SyncOutcomeClassifier
{
    /// <param name="statusCode">HTTP স্ট্যাটাস। ০ বা ঋণাত্মক = রেসপন্সই আসেনি।</param>
    /// <param name="revokeCommandInBody">
    /// ৪০৩-এর বডিতে <c>{ "command": "revoke" }</c> ছিল কি না। সার্ভারের
    /// <c>device-auth.guard.ts</c> ঠিক এটাই পাঠায়।
    /// </param>
    public static SyncOutcome FromHttpStatus(int statusCode, bool revokeCommandInBody = false)
    {
        if (statusCode is >= 200 and <= 299) return SyncOutcome.Success;

        // ⚠️ ৩xx হাতে সামলানো হয় না — HttpClient নিজেই redirect অনুসরণ করে।
        // এখানে এসে পড়া মানে redirect বন্ধ ছিল, অর্থাৎ কনফিগের ভুল, রেকর্ডের নয়।
        if (statusCode is >= 300 and <= 399) return SyncOutcome.Transient;

        return statusCode switch
        {
            // ⚠️ ৪০১-কে Permanent বলা যেত ("টোকেন খারাপ, রেকর্ড কোনোদিন যাবে না"),
            //    কিন্তু তাতে টোকেন রিফ্রেশ বা ঘড়ির গোলমালের সময় পুরো কিউ মুছে যেত।
            //    ডেটা ধরে রাখা হয়; tray লাল হয়ে অ্যাডমিনকে জানায় (J07)।
            401 => SyncOutcome.Transient,

            403 => revokeCommandInBody ? SyncOutcome.Revoked : SyncOutcome.Transient,

            // ভুল base URL বা reverse proxy-র ভুল রুট — অ্যাডমিন ঠিক করলেই চলবে।
            // রেকর্ডের দোষ নয়, তাই ফেলে দেওয়া যাবে না।
            404 => SyncOutcome.Transient,

            408 or 425 or 429 => SyncOutcome.Transient,

            // ৪১৩: ৫ MiB-র বড় .webp — আবার পাঠালেও একই উত্তরই আসবে।
            413 => SyncOutcome.Permanent,

            _ when statusCode is >= 500 and <= 599 => SyncOutcome.Transient,

            // বাকি সব ৪xx (৪০০ ভ্যালিডেশন, ৪১৫ ভুল mime, ৪২২ clientUuid নেই):
            // রেকর্ডটাই বেঠিক, রিট্রাই অর্থহীন।
            _ when statusCode is >= 400 and <= 499 => SyncOutcome.Permanent,

            // ০ = কানেক্ট করা যায়নি; অজানা কিছু = সন্দেহের সুবিধা।
            _ => SyncOutcome.Transient,
        };
    }

    /// <summary>
    /// রেসপন্সই আসেনি — DNS, TCP, TLS, টাইমআউট, ল্যান কেবল খোলা।
    /// অফিসে ইন্টারনেট না থাকার স্বাভাবিক অবস্থা, তাই সবসময় Transient।
    /// </summary>
    public static SyncOutcome FromTransportFailure() => SyncOutcome.Transient;
}
