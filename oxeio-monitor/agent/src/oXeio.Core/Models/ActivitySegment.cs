using oXeio.Core.Time;

namespace oXeio.Core.Models;

/// <summary>
/// একটা বন্ধ হয়ে যাওয়া সেগমেন্ট — সার্ভারে <c>POST /agent/segments</c>-এ যাবে।
///
/// <see cref="ClientUuid"/> এজেন্টেই তৈরি হয় এবং queue-তে জমা থাকে, তাই
/// রিট্রাইয়ে একই আইডি যায় — সার্ভার তখন ডুপ্লিকেট বাদ দিতে পারে (§ ২.১-ঘ)।
/// </summary>
public sealed record ActivitySegment
{
    public required Guid ClientUuid { get; init; }
    public required SegmentState State { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public required DateTimeOffset EndedAt { get; init; }

    /// <summary>
    /// monotonic ঘড়ি থেকে মাপা — তাই PC-র ঘড়ি বদলালেও এই সংখ্যা অটুট।
    /// </summary>
    public required int DurationSec { get; init; }

    /// <summary>০–১০০, ওই খণ্ডে কতটা অ্যাক্টিভ ছিল। কীলগিং নয় (B13)।</summary>
    public int? InputScore { get; init; }

    public DateOnly WorkDate => DhakaTime.WorkDateOf(StartedAt);

    /// <summary>একমাত্র <see cref="SegmentState.Active"/> ঘণ্টার হিসাবে যোগ হয়।</summary>
    public bool CountsAsWork => State == SegmentState.Active;
}
