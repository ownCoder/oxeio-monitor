using System.Text.Json;
using System.Text.Json.Serialization;

using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Storage;

/// <summary>
/// আউটবক্সের সারিতে রেকর্ড কীভাবে জমা থাকে।
///
/// ⚠️ <b>এটা সার্ভারের wire ফরম্যাট নয়</b> — ওটা <c>Sync/SyncWire.cs</c>।
/// দুটো ইচ্ছাকৃতভাবে আলাদা: সার্ভারের চুক্তি বদলালে ডিস্কে পড়ে থাকা পুরোনো
/// সারিগুলো যেন অপাঠ্য না হয়ে যায়।
///
/// ⭐ <b>সবচেয়ে জরুরি নিয়ম — পুরোনো সারি সবসময় পড়া যেতে হবে।</b>
/// এজেন্ট আপডেট হয় রাতে, আর ঠিক তখনই কোনো PC-তে এক সপ্তাহের অফলাইন
/// ব্যাকলগ জমে থাকতে পারে। নতুন ভার্সন সেগুলো পড়তে না পারলে ওই স্টাফের
/// পুরো সপ্তাহের ঘণ্টা হারিয়ে যাবে — আর কেউ টেরও পাবে না, কারণ সার্ভারের
/// দিক থেকে সব স্বাভাবিক দেখাবে।
///
/// তাই:
/// <list type="bullet">
/// <item>অচেনা property উপেক্ষা করা হয় (পুরোনো এজেন্টের লেখা নতুন ফিল্ড)</item>
/// <item>নতুন ফিল্ড সবসময় <b>nullable বা ডিফল্টসহ</b> — required নয়</item>
/// <item>কোনো ফিল্ডের নাম বদলানো বা মুছে ফেলা <b>যাবে না</b>, শুধু যোগ করা যাবে</item>
/// </list>
/// </summary>
internal static class OutboxCodec
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,

        // পুরোনো এজেন্টের লেখা সারিতে নতুন ফিল্ড থাকতে পারে — ফেলে দিলেই হলো,
        // ব্যতিক্রম ছোড়ার কিছু নেই।
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,

        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public static string Encode<T>(T record) where T : class =>
        JsonSerializer.Serialize(record, Options);

    /// <summary>
    /// পড়তে না পারলে <c>null</c> — ব্যতিক্রম নয়।
    ///
    /// ⚠️ এটা ইচ্ছাকৃত। একটা নষ্ট সারি (বিদ্যুৎ যাওয়ার সময় অর্ধেক লেখা,
    /// বা ভবিষ্যতের কোনো ফরম্যাট) যদি ব্যতিক্রম ছুড়ত, তাহলে সেটা কিউয়ের
    /// মাথায় বসে <b>তার পেছনের সবকিছু চিরতরে আটকে দিত</b>। এখন কলার
    /// ওই একটা সারি বাদ দিয়ে এগোতে পারে।
    /// </summary>
    public static T? Decode<T>(string payload) where T : class
    {
        if (string.IsNullOrWhiteSpace(payload)) return null;

        try
        {
            return JsonSerializer.Deserialize<T>(payload, Options);
        }
        catch (JsonException)
        {
            return null;
        }
        catch (NotSupportedException)
        {
            return null;
        }
    }

    /// <summary>সারির ধরন অনুযায়ী কোন টাইপে পড়তে হবে।</summary>
    public static object? Decode(OutboundKind kind, string payload) => kind switch
    {
        OutboundKind.Segment => Decode<ActivitySegment>(payload),
        OutboundKind.AppUsage => Decode<AppUsageRecord>(payload),
        OutboundKind.Event => Decode<AgentEventRecord>(payload),
        OutboundKind.Screenshot => Decode<ScreenshotRecord>(payload),
        _ => null,
    };

    // ── enqueue করার সহজ পথ ─────────────────────────────────────────────────

    public static OutboxItem Item(ActivitySegment s, DateTimeOffset now) =>
        Wrap(s.ClientUuid, OutboundKind.Segment, Encode(s), now);

    public static OutboxItem Item(AppUsageRecord a, DateTimeOffset now) =>
        Wrap(a.ClientUuid, OutboundKind.AppUsage, Encode(a), now);

    public static OutboxItem Item(AgentEventRecord e, DateTimeOffset now) =>
        Wrap(e.ClientUuid, OutboundKind.Event, Encode(e), now);

    /// <summary>
    /// ছবির বাইটগুলো DB-তে যায় না — সারিতে থাকে শুধু ফাইলের পথ।
    /// <paramref name="fileBytes"/> বাজেটের হিসাবের জন্য, যাতে ডিস্ক ভরে
    /// গেলে ছবিগুলোই আগে ছাঁটা যায়।
    /// </summary>
    public static OutboxItem Item(
        ScreenshotRecord s, string webpPath, long fileBytes, DateTimeOffset now) =>
        new()
        {
            ClientUuid = s.ClientUuid,
            Kind = OutboundKind.Screenshot,
            EnqueuedAt = now,
            Payload = Encode(s),
            FilePath = webpPath,
            SizeBytes = fileBytes,
        };

    private static OutboxItem Wrap(
        Guid uuid, OutboundKind kind, string payload, DateTimeOffset now) =>
        new()
        {
            ClientUuid = uuid,
            Kind = kind,
            EnqueuedAt = now,
            Payload = payload,
            SizeBytes = payload.Length,
        };
}
