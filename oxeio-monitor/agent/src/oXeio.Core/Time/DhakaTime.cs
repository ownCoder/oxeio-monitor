namespace oXeio.Core.Time;

/// <summary>
/// Asia/Dhaka = UTC+06:00, কোনো DST নেই — তাই অফসেট ধ্রুবক ধরে হিসাব করা নিরাপদ।
///
/// সার্ভারের <c>server/src/agent/util/dhaka-time.ts</c>-এর হুবহু প্রতিরূপ।
/// দুই দিকেই একই নিয়ম না থাকলে এজেন্ট আর সার্ভার আলাদা <c>work_date</c> বের করত।
///
/// ⚠️ v1-এ শুধু Asia/Dhaka। অন্য টাইমজোনে যেতে হলে এখানে
/// <c>TimeZoneInfo</c> বসাতে হবে — DST থাকলে এই সরল হিসাব ভাঙবে।
/// </summary>
public static class DhakaTime
{
    public static readonly TimeSpan Offset = TimeSpan.FromHours(6);

    /// <summary>ওই মুহূর্তটা ঢাকার সময়ে কোন তারিখে পড়ে।</summary>
    public static DateOnly WorkDateOf(DateTimeOffset instant)
    {
        var local = instant.ToUniversalTime() + Offset;
        return DateOnly.FromDateTime(local.UtcDateTime);
    }

    /// <summary>ওই মুহূর্তটা ঢাকার ঘড়িতে কটা বাজে।</summary>
    public static TimeOnly LocalTimeOf(DateTimeOffset instant)
    {
        var local = instant.ToUniversalTime() + Offset;
        return TimeOnly.FromDateTime(local.UtcDateTime);
    }

    /// <summary>ওই মুহূর্তের ঠিক পরের <b>স্থানীয়</b> মধ্যরাত (§ ২.১-ক)।</summary>
    public static DateTimeOffset NextLocalMidnight(DateTimeOffset instant)
    {
        var date = WorkDateOf(instant);
        var localMidnightUtc = date.ToDateTime(TimeOnly.MinValue) - Offset;
        return new DateTimeOffset(localMidnightUtc, TimeSpan.Zero).AddDays(1);
    }

    public static bool SameWorkDate(DateTimeOffset a, DateTimeOffset b) =>
        WorkDateOf(a) == WorkDateOf(b);
}
