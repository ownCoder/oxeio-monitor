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
}
