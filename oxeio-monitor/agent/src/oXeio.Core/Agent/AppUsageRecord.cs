using oXeio.Core.Models;

namespace oXeio.Core.Agent;

/// <summary>
/// একটা অ্যাপ/সাইট ব্যবহারের খণ্ড — <c>POST /agent/app-usage</c>-এর
/// <c>items[]</c>-এর একটা এলিমেন্ট।
///
/// <see cref="oXeio.Core.Models.ActivitySegment"/>-এর মতোই <see cref="ClientUuid"/>
/// এজেন্টেই তৈরি হয় ও কিউতে জমা থাকে, তাই রিট্রাইয়ে একই আইডি যায়।
/// </summary>
public sealed record AppUsageRecord
{
    public required Guid ClientUuid { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public required DateTimeOffset EndedAt { get; init; }

    /// <summary>সার্ভার ০–৮৬৪০০ ছাড়া মানে না; দিন পেরোলে সে নিজেই ভাগ করে নেয়।</summary>
    public required int DurationSec { get; init; }

    /// <summary>যেমন <c>chrome.exe</c>। সর্বোচ্চ ২৬০ অক্ষর (Windows MAX_PATH)।</summary>
    public required string ProcessName { get; init; }

    /// <summary>এক্সিকিউটেবলের FileDescription, যেমন "Google Chrome"। না পেলে null।</summary>
    public string? AppName { get; init; }

    /// <summary>সর্বোচ্চ ১০০০ অক্ষর — সার্ভার এর বেশি নিলে ৪০০ দেয়।</summary>
    public string? WindowTitle { get; init; }

    /// <summary>
    /// ⚠️ শুধু ডোমেইন — <b>ফুল URL কখনো নয়</b> (ADR-013)। "facebook.com" চলে,
    /// "facebook.com/messages/t/12345" চলে না। পাথ বা query রাখলে এটা আর
    /// অ্যাপ-ট্র্যাকিং থাকে না, ব্রাউজিং-হিস্ট্রি নজরদারি হয়ে যায়।
    /// </summary>
    public string? Domain { get; init; }

    public bool? IsBrowser { get; init; }

    /// <summary>
    /// ⭐⭐ <b>R22a</b> — এই খণ্ডটা কোন অবস্থায় দেখা হয়েছে।
    ///
    /// আগে app-usage রেকর্ড হতো <b>কেবল ACTIVE</b>-এ, তাই ঘরটার দরকারই
    /// ছিল না। ⚠️⚠️ কিন্তু তাতে একটা প্রশ্নের উত্তর চিরতরে হারাত: "এই
    /// idle সময়টায় সামনে কী ছিল?" — আর ওটাই মিটিং চেনার একমাত্র সূত্র
    /// (কেউ Zoom-এ থাকলে কি-বোর্ড চুপ, অথচ সে কাজেই আছে)।
    ///
    /// ⚠️ ডিফল্ট <see cref="SegmentState.Active"/>, কারণ পুরোনো এজেন্ট এই
    /// ঘরটা পাঠায় না — আর তারা যা পাঠাত তার সবই সংজ্ঞা অনুযায়ী ACTIVE।
    /// সার্ভারেও একই ডিফল্ট, তাই পুরোনো সারিগুলোর মানে বদলায় না।
    ///
    /// ⚠️⚠️ <b>এটা গোনার জিনিস নয়</b>। idle-এ দেখা খণ্ড রিপোর্টে বা D07/D08-এ
    /// যায় না — পড়ার প্রতিটা জায়গায় <c>segment_state = 'active'</c> ছাঁকনি
    /// বসানো। নইলে "লাঞ্চে গিয়ে Excel খোলা রেখে যাওয়া"টাই কাজ হয়ে যেত,
    /// আর সেই নিয়মটাই এই ট্র্যাকারের মূল কথা।
    /// </summary>
    public SegmentState State { get; init; } = SegmentState.Active;
}
