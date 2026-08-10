namespace oXeio.Core.Agent;

/// <summary>
/// একটা স্ক্রিনশটের <b>মেটাডেটা</b> — <c>POST /agent/screenshots</c>-এর
/// multipart-এর <c>meta</c> অংশ। ছবির বাইট এখানে নেই।
///
/// ⚠️ ছবি কখনো কিউয়ের সারিতে ঢোকে না। ২৮৮টা স্লট × ৩ মনিটর × ~২০০ KB মানে
/// দিনে ~১৭০ MB; সেটা DB-র ভেতরে blob হিসেবে রাখলে প্রতিটা VACUUM ও ব্যাকআপ
/// ভয়ংকর হয়ে যেত, আর একটা সারি পড়তে গেলেই পুরো ছবি RAM-এ উঠত। বাইটগুলো
/// ডিস্কে আলাদা ফাইলে থাকে, সারি শুধু <see cref="OutboxItem.FilePath"/> ধরে রাখে।
/// </summary>
public sealed record ScreenshotRecord
{
    public required Guid ClientUuid { get; init; }

    /// <summary>৫ মিনিটের স্লটের শুরু — <see cref="oXeio.Core.Capture.SlotScheduler"/> দেয়।</summary>
    public required DateTimeOffset SlotStart { get; init; }

    /// <summary>স্লটের ভেতরের আসল র‍্যান্ডম মুহূর্ত।</summary>
    public required DateTimeOffset CapturedAt { get; init; }

    /// <summary>০-ভিত্তিক। সার্ভার ০–৭ ছাড়া মানে না।</summary>
    public required int MonitorIndex { get; init; }

    public int? Width { get; init; }
    public int? Height { get; init; }

    /// <summary>ছবি তোলার মুহূর্তের foreground প্রসেস, যেমন <c>excel.exe</c>।</summary>
    public string? ActiveApp { get; init; }

    /// <summary>সর্বোচ্চ ১০০০ অক্ষর।</summary>
    public string? ActiveTitle { get; init; }
}
