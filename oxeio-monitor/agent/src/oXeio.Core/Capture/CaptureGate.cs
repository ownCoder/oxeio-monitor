using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Capture;

/// <summary>
/// ছবি তোলা হবে কি না — চারটে শর্ত, এক জায়গায়।
///
/// ⭐ <b>কেন আলাদা টাইপ:</b> শর্তগুলো <c>AgentHost.CaptureSlotAsync</c>-এর
/// ভেতরে guard clause হিসেবে ছড়ানো ছিল, আর ওখানে বসে সেগুলো যাচাই করা
/// যেত না (Win32, থ্রেড, ডিস্ক — সব জড়ানো)। ⚠️ ফলে একটা শর্ত
/// <b>অনুপস্থিত</b> থাকলেও কোনো টেস্ট সেটা ধরত না — আর ঠিক সেটাই ঘটেছিল:
/// <see cref="Revoked"/> শর্তটা কোনোদিন লেখাই হয়নি।
/// </summary>
public static class CaptureGate
{
    /// <summary>ছবি না ওঠার কারণ — লগে ও টেস্টে দুটোতেই কাজে লাগে।</summary>
    public enum Verdict
    {
        Allowed,

        /// <summary>A04 — ACTIVE ছাড়া কোনো অবস্থাতেই ছবি নয়।</summary>
        NotActive,

        /// <summary>A04b — ০৭:০০–২৩:০০-এর বাইরে। ⚠️ সময় গোনা তবু চলে।</summary>
        OutsideWindow,

        /// <summary>
        /// H06 — ডিভাইস বাতিল।
        ///
        /// ⚠️⚠️ <b>এই শর্তটাই এতদিন ছিল না।</b> revoke করলে শুধু আপলোড থামত;
        /// ছবি ঠিকই উঠত আর ডিস্কে জমত। অর্থাৎ ছাঁটাই হওয়া কর্মীর PC-তে
        /// স্ক্রিনশট জমতেই থাকত — কেউ দেখত না, কোথাও যেত না, কিন্তু
        /// থাকত। ডিভাইস বাতিল করার পুরো মানেই সেটা।
        /// </summary>
        Revoked,
    }

    public static Verdict Check(
        SegmentState state,
        bool revoked,
        CaptureWindow window,
        DateTimeOffset fireAt)
    {
        ArgumentNullException.ThrowIfNull(window);

        // ⚠️ revoke সবার আগে — বাতিল ডিভাইসে "কেন ছবি ওঠেনি" প্রশ্নের
        //    উত্তর "ও তখন idle ছিল" হওয়া উচিত নয়।
        if (revoked) return Verdict.Revoked;
        if (state != SegmentState.Active) return Verdict.NotActive;
        if (!window.Allows(fireAt)) return Verdict.OutsideWindow;

        return Verdict.Allowed;
    }

    public static bool Allows(
        SegmentState state,
        bool revoked,
        CaptureWindow window,
        DateTimeOffset fireAt) =>
        Check(state, revoked, window, fireAt) == Verdict.Allowed;
}
