namespace oXeio.Core.Agent;

/// <summary>
/// <see cref="ISyncClient"/>-এর প্রতিটা কলের ফল।
///
/// ⚠️ এখান থেকে কখনো এক্সসেপশন ছোড়া হয় না — নেটওয়ার্ক ব্যর্থতা এই সিস্টেমে
/// ব্যতিক্রম নয়, স্বাভাবিক অবস্থা (সাইটের লাইন দিনের পর দিন বন্ধ থাকে)।
/// এক্সসেপশন ছুড়লে সিঙ্ক লুপকে try/catch দিয়ে মুড়তে হতো, আর একটা ফসকে যাওয়া
/// catch পুরো ওয়ার্কার থ্রেড মেরে দিত — সপ্তাহখানেক পর কেউ টের পেত।
/// </summary>
/// <typeparam name="T">সফল হলে যা ফেরে। কিছু না ফিরলে <see cref="NoContent"/>।</typeparam>
public sealed record SyncResult<T> where T : class
{
    public required SyncOutcome Outcome { get; init; }

    /// <summary>
    /// <see cref="SyncOutcome.Success"/> হলে ভরা থাকে — একটাই ব্যতিক্রম
    /// <see cref="ISyncClient.CheckUpdateAsync"/>, যেখানে ২০৪ মানে "নতুন কিছু নেই"
    /// আর তখন এটা null।
    /// </summary>
    public T? Value { get; init; }

    /// <summary>রেসপন্স এলে তার স্ট্যাটাস; না এলে null। লগের জন্য।</summary>
    public int? StatusCode { get; init; }

    /// <summary>মানুষের পড়ার মতো কারণ — লগ ও tray টুলটিপে যায়।</summary>
    public string? Detail { get; init; }

    /// <summary>
    /// সার্ভারের <c>Retry-After</c> হেডার (৪২৯/৫০৩)। থাকলে
    /// <see cref="RetryPolicy"/>-র নিজের হিসাবের বদলে এটাকেই মানতে হবে।
    /// </summary>
    public TimeSpan? RetryAfter { get; init; }

    public bool IsSuccess => Outcome == SyncOutcome.Success;

    public static SyncResult<T> Ok(T? value, int? statusCode = 200) =>
        new() { Outcome = SyncOutcome.Success, Value = value, StatusCode = statusCode };

    public static SyncResult<T> Transient(int? statusCode, string? detail, TimeSpan? retryAfter = null) =>
        new()
        {
            Outcome = SyncOutcome.Transient,
            StatusCode = statusCode,
            Detail = detail,
            RetryAfter = retryAfter,
        };

    public static SyncResult<T> Permanent(int? statusCode, string? detail) =>
        new() { Outcome = SyncOutcome.Permanent, StatusCode = statusCode, Detail = detail };

    public static SyncResult<T> Revoked(string? detail = null) =>
        new() { Outcome = SyncOutcome.Revoked, StatusCode = 403, Detail = detail };
}

/// <summary>
/// "কিছুই ফেরে না" বোঝাতে। <c>SyncResult&lt;void&gt;</c> C#-এ লেখা যায় না,
/// আর <c>SyncResult&lt;object&gt;</c> পড়ে কেউ বুঝত না সেখানে কী থাকার কথা।
/// </summary>
public sealed record NoContent
{
    public static readonly NoContent Value = new();

    private NoContent() { }
}
