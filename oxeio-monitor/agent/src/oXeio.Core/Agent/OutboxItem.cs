namespace oXeio.Core.Agent;

/// <summary>
/// আউটবক্সে ঢোকানোর জন্য তৈরি একটা সারি (এখনো row id নেই)।
///
/// <see cref="Payload"/> ইচ্ছাকৃতভাবে <b>স্ট্রিং</b>, টাইপ করা অবজেক্ট নয়।
/// আউটবক্সকে জানতে দেওয়া হয়নি ভেতরে কী আছে — <see cref="Kind"/> দেখে সিঙ্ক
/// ওয়ার্কার নিজে ডিসিরিয়ালাইজ করে। এতে নতুন কোনো endpoint যোগ করতে গেলে
/// স্টোরের কোড বা স্কিমা ছুঁতে হয় না।
///
/// ⚠️ সিরিয়ালাইজেশন <b>ফরওয়ার্ড-কম্প্যাটিবল</b> রাখতেই হবে। আপডেটের পর নতুন
/// এজেন্ট পুরোনো এজেন্টের লেখা সারি পড়বে — অফলাইন থাকা মেশিনে ওই সারিগুলো
/// কয়েক দিনের পুরোনো হতে পারে। ফিল্ডের নাম বদলানো মানে ওই ডেটা চিরতরে হারানো।
/// তাই: নতুন ফিল্ড শুধু <i>যোগ</i> করুন, কখনো নাম বদলাবেন না বা মুছবেন না।
/// </summary>
public sealed record OutboxItem
{
    /// <summary>সার্ভারের ডিডুপের চাবি। সারিতেও জমা থাকে, তাই রিট্রাইয়ে অপরিবর্তিত।</summary>
    public required Guid ClientUuid { get; init; }

    public required OutboundKind Kind { get; init; }

    /// <summary>রেকর্ড <b>তৈরির</b> সময় — আপলোডের চেষ্টার সময় নয়। বয়স এখান থেকেই মাপা হয়।</summary>
    public required DateTimeOffset EnqueuedAt { get; init; }

    /// <summary>রেকর্ডটার JSON। স্ক্রিনশটের ক্ষেত্রে <see cref="ScreenshotRecord"/>-এর JSON।</summary>
    public required string Payload { get; init; }

    /// <summary>
    /// শুধু <see cref="OutboundKind.Screenshot"/>-এ — .webp ফাইলের পুরো পাথ।
    /// বাকি সবার জন্য null।
    /// </summary>
    public string? FilePath { get; init; }

    /// <summary>
    /// ডিস্কে এই সারিটা মোটামুটি কত জায়গা নিচ্ছে (payload + ফাইল)।
    /// <see cref="OutboxBudget"/> এই সংখ্যাটাই যোগ করে। আন্দাজ হলেও চলবে,
    /// কিন্তু স্ক্রিনশটে ফাইলের আসল সাইজ বসানো জরুরি — নইলে ক্যাপ অর্থহীন।
    /// </summary>
    public required long SizeBytes { get; init; }
}

/// <summary>
/// আউটবক্স থেকে ফেরত আসা একটা সারি — <see cref="OutboxItem"/> + স্টোরের নিজস্ব হিসাব।
/// </summary>
public sealed record OutboxEntry
{
    /// <summary>স্টোরের ভেতরের আইডি (SQLite rowid)। ack/evict এটাই ধরে চলে।</summary>
    public required long RowId { get; init; }

    public required Guid ClientUuid { get; init; }
    public required OutboundKind Kind { get; init; }
    public required DateTimeOffset EnqueuedAt { get; init; }
    public required string Payload { get; init; }
    public string? FilePath { get; init; }
    public required long SizeBytes { get; init; }

    /// <summary>
    /// এ পর্যন্ত কতবার আপলোড ব্যর্থ হয়েছে। ০ = কখনো চেষ্টা হয়নি।
    /// <see cref="RetryPolicy"/>-তে <c>attempt</c> হিসেবে এটাই যায়।
    /// </summary>
    public required int Attempts { get; init; }
}

/// <summary>
/// বাজেট হিসাবের জন্য হালকা সংস্করণ — <see cref="OutboxEntry.Payload"/> ছাড়া।
///
/// আলাদা টাইপ কেন: এক সপ্তাহ অফলাইন থাকা মেশিনে লাখখানেক সারি জমতে পারে।
/// বাজেট মেলাতে গিয়ে প্রতিটার JSON স্ট্রিং RAM-এ তুললে ছাঁটাই করতে গিয়েই
/// প্রসেসটা OOM-এ মরত — অর্থাৎ ঠিক যে সমস্যা ঠেকাতে এসেছি সেটাই ঘটাত।
/// </summary>
public readonly record struct OutboxEntryInfo(
    long RowId,
    OutboundKind Kind,
    DateTimeOffset EnqueuedAt,
    long SizeBytes,
    bool Leased);

/// <summary>
/// আপলোডের জন্য ধার নেওয়া এক ব্যাচ সারি।
///
/// লিজ ফুরোনোর আগে <see cref="IOutboxStore.AckAsync"/>,
/// <see cref="IOutboxStore.RetryAsync"/> বা <see cref="IOutboxStore.AbandonAsync"/>
/// না ডাকলে সারিগুলো নিজে থেকেই আবার pending হয়ে যাবে।
/// </summary>
public sealed record OutboxLease
{
    /// <summary>এই ধারের আইডি। ack/retry/abandon — সবই এটা দিয়ে।</summary>
    public required Guid LeaseId { get; init; }

    /// <summary>এক ব্যাচে এক ধরনের সারিই থাকে — এক endpoint, এক রিকোয়েস্ট।</summary>
    public required OutboundKind Kind { get; init; }

    public required IReadOnlyList<OutboxEntry> Entries { get; init; }

    /// <summary>এর পরে <see cref="IOutboxStore.ReclaimExpiredLeasesAsync"/> সারিগুলো ফিরিয়ে নেবে।</summary>
    public required DateTimeOffset ExpiresAt { get; init; }

    public int Count => Entries.Count;
}

/// <summary>
/// কিউতে কী পড়ে আছে — heartbeat-এর <c>queueDepth</c> আর tray টুলটিপে যায়।
/// </summary>
public readonly record struct OutboxDepth(
    int Segments,
    int AppUsage,
    int Events,
    int Screenshots,
    long BytesTotal)
{
    public int Total => Segments + AppUsage + Events + Screenshots;

    /// <summary>
    /// heartbeat-এ যায়। সার্ভার ঋণাত্মক মানে না, আর কিউ খালি থাকলেও ০ পাঠানোই ভালো —
    /// null পাঠালে ড্যাশবোর্ড "জানি না" আর "সব পাঠানো হয়ে গেছে" আলাদা করতে পারত না।
    /// </summary>
    public int ForHeartbeat => Total;

    public static OutboxDepth Empty => default;
}
