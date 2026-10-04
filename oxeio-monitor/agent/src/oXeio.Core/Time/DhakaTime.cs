namespace oXeio.Core.Time;

/// <summary>
/// Asia/Dhaka = UTC+06:00, কোনো DST নেই — তাই অফসেট ধ্রুবক ধরে হিসাব করা নিরাপদ।
///
/// সার্ভারের <c>server/src/agent/util/dhaka-time.ts</c>-এর হুবহু প্রতিরূপ।
/// দুই দিকেই একই নিয়ম না থাকলে এজেন্ট আর সার্ভার আলাদা <c>work_date</c> বের করত।
///
/// ⚠️ v1-এ শুধু Asia/Dhaka। অন্য টাইমজোনে যেতে হলে এখানে
/// <c>TimeZoneInfo</c> বসাতে হবে — DST থাকলে এই সরল হিসাব ভাঙবে।
///
/// Update: the server may now run on another zone without DST
/// (<c>WORK_TIMEZONE</c>) and sends its fixed offset in the config
/// (<c>utcOffsetMinutes</c>). <see cref="TrySet"/> applies it; until then, and
/// on a server that does not send it, the offset stays UTC+06:00.
/// </summary>
public static class DhakaTime
{
    /// <summary>Asia/Dhaka — what the agent uses before any config arrives.</summary>
    public static readonly TimeSpan DefaultOffset = TimeSpan.FromHours(6);

    public const string DefaultTimeZone = "Asia/Dhaka";

    /// <summary>
    /// Real offsets run from UTC−12:00 to UTC+14:00. Anything outside is a
    /// broken config, and applying it would move every work date.
    /// </summary>
    public const int MinOffsetMinutes = -12 * 60;
    public const int MaxOffsetMinutes = 14 * 60;

    // Read by the tracking loop and the UI thread at once; one immutable
    // object swapped atomically, so nobody sees a new offset with an old name.
    private sealed record Zone(string Name, TimeSpan Offset);

    private static volatile Zone _zone = new(DefaultTimeZone, DefaultOffset);

    /// <summary>The work-day offset — UTC+06:00 unless the server said otherwise.</summary>
    public static TimeSpan Offset => _zone.Offset;

    /// <summary>IANA name of the work-day zone, e.g. <c>Asia/Dhaka</c>.</summary>
    public static string TimeZoneName => _zone.Name;

    /// <summary>
    /// Short place name for the tray: <c>Asia/Dhaka</c> → <c>Dhaka</c>,
    /// <c>America/Sao_Paulo</c> → <c>Sao Paulo</c>.
    /// </summary>
    public static string Label
    {
        get
        {
            var name = _zone.Name;
            var slash = name.LastIndexOf('/');
            return (slash < 0 ? name : name[(slash + 1)..]).Replace('_', ' ');
        }
    }

    /// <summary>
    /// Switches the work-day zone. <c>false</c> (and nothing changes) when the
    /// offset is out of range or the name is empty.
    /// </summary>
    public static bool TrySet(string? timeZone, int offsetMinutes)
    {
        if (string.IsNullOrWhiteSpace(timeZone)) return false;
        if (offsetMinutes is < MinOffsetMinutes or > MaxOffsetMinutes) return false;

        _zone = new Zone(timeZone.Trim(), TimeSpan.FromMinutes(offsetMinutes));
        return true;
    }

    /// <summary>
    /// One line to keep on disk, e.g. <c>America/Sao_Paulo|-180</c>, so a
    /// restart without network still counts days in the last zone it was told.
    /// </summary>
    public static string ToMemoryLine()
    {
        var zone = _zone;
        return $"{zone.Name}|{(int)zone.Offset.TotalMinutes}";
    }

    /// <summary>
    /// Applies a line written by <see cref="ToMemoryLine"/>. Anything else
    /// (missing file, a hand-edited or truncated line) is <c>false</c> and the
    /// zone stays as it is.
    /// </summary>
    public static bool TryRestore(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;

        var bar = line.LastIndexOf('|');
        if (bar <= 0) return false;

        return int.TryParse(
                   line.AsSpan(bar + 1).Trim(),
                   System.Globalization.NumberStyles.AllowLeadingSign,
                   System.Globalization.CultureInfo.InvariantCulture,
                   out var minutes)
               && TrySet(line[..bar], minutes);
    }

    /// <summary>Back to Asia/Dhaka — for tests.</summary>
    public static void Reset() => _zone = new Zone(DefaultTimeZone, DefaultOffset);

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
        var offset = Offset;
        var date = DateOnly.FromDateTime((instant.ToUniversalTime() + offset).UtcDateTime);
        var localMidnightUtc = date.ToDateTime(TimeOnly.MinValue) - offset;
        return new DateTimeOffset(localMidnightUtc, TimeSpan.Zero).AddDays(1);
    }

    public static bool SameWorkDate(DateTimeOffset a, DateTimeOffset b) =>
        WorkDateOf(a) == WorkDateOf(b);
}
