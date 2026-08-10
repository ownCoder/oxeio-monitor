using System.Globalization;

namespace oXeio.Core.Watchdog;

/// <summary>
/// এজেন্ট নিয়মিত যে এক লাইন লিখে রাখে, আর watchdog যেটা পড়ে।
///
/// <b>কেন ফাইল, mutex নয়:</b> mutex শুধু বলে "একটা প্রসেস আছে"। কিন্তু জমে যাওয়া
/// (wedged) প্রসেসও দিব্যি বেঁচে থাকে আর তার mutex-ও ধরে রাখে — অর্থাৎ যে
/// ব্যর্থতাটা ধরার জন্য watchdog লেখা হচ্ছে, mutex ঠিক সেটাই ধরতে পারে না।
/// টাইমস্ট্যাম্প লেখা ফাইল প্রমাণ করে এজেন্টের লুপ <b>ঘুরছে</b>, শুধু বেঁচে নেই।
///
/// ⚠️ এজেন্ট IDLE বা LOCKED অবস্থাতেও এই ফাইল লিখতে থাকবে। liveness মানে
/// এজেন্টের লুপ চলছে কি না — ইউজার কাজ করছে কি না, সেটা সম্পূর্ণ আলাদা প্রশ্ন।
/// দুটো মিলিয়ে ফেললে দুপুরের খাওয়ার সময় প্রতিদিন এজেন্ট খুন হতো।
/// </summary>
public sealed record AgentHeartbeat
{
    /// <summary>ফরম্যাটের সংস্করণ — পুরোনো watchdog নতুন এজেন্টকে যেন ভুল না বোঝে।</summary>
    public required int Version { get; init; }

    /// <summary>জমে যাওয়া এজেন্টকে মারতে হলে এটাই লাগে।</summary>
    public required int ProcessId { get; init; }

    /// <summary>কোন Windows সেশনে চলছে — শুধু লগের জন্য।</summary>
    public required uint SessionId { get; init; }

    /// <summary>
    /// ⭐ <c>QueryUnbiasedInterruptTime</c> মিলিসেকেন্ডে — লেখার মুহূর্তে।
    ///
    /// দেয়াল-ঘড়ি নয়, ইচ্ছাকৃতভাবে। কেউ PC-র ঘড়ি এক ঘণ্টা পিছিয়ে দিলে প্রতিটা
    /// হার্টবিট এক ঘণ্টা বাসি দেখাত আর watchdog সুস্থ এজেন্টকে মেরে ফেলত।
    ///
    /// ⚠️ <c>GetTickCount64</c>-ও নয়: ওটা ঘুমের সময় গোনে, তাই ল্যাপটপ রাতে
    /// ঘুমিয়ে সকালে উঠলে হার্টবিট ৮ ঘণ্টা বাসি দেখাত — জেগে ওঠার সাথে সাথেই
    /// এজেন্ট খুন। unbiased ঘড়ি ঘুমের সময় থেমে থাকে, তাই ঘুম শেষে বয়স যা ছিল
    /// তা-ই থাকে।
    ///
    /// দুই প্রসেসই একই মেশিনের একই কাউন্টার পড়ে, তাই বিয়োগটা অর্থবহ।
    /// বুট হলে কাউন্টার শূন্য থেকে শুরু — সেই কারণেই আগের বুটের ফাইল
    /// "ভবিষ্যতের" দেখায়, আর <see cref="AgentLiveness.Age"/> সেটাকে
    /// তাজা না ধরে <c>null</c> ফেরায়।
    /// </summary>
    public required long UnbiasedMs { get; init; }

    /// <summary>
    /// মানুষের পড়ার জন্য। ⚠️ তাজা কি না ঠিক করতে এটা <b>কখনো</b> ব্যবহার হয় না —
    /// এটা দেয়াল-ঘড়ি, আর দেয়াল-ঘড়ি পিছিয়ে যেতে পারে।
    /// </summary>
    public required DateTimeOffset WrittenAtUtc { get; init; }
}

/// <summary>
/// এজেন্ট আর watchdog-এর মধ্যেকার চুক্তি — ফাইলের নাম, সময়ের সীমা, আর
/// এক লাইনের ফরম্যাট। দুই প্রসেস এই একটাই ক্লাস ব্যবহার করে, নইলে একদিন
/// একজন <c>agent.alive</c> লিখত আর অন্যজন <c>agent.heartbeat</c> খুঁজত।
/// </summary>
public static class AgentLiveness
{
    public const int CurrentVersion = 1;

    /// <summary>এজেন্ট লেখে (%ProgramData%\oXeio\ এর ভেতরে)।</summary>
    public const string HeartbeatFileName = "agent.alive";

    /// <summary>
    /// এজেন্ট পুরো আয়ু জুড়ে <c>FileShare.None</c>-এ খুলে ধরে রাখে —
    /// এটাই single-instance interlock (<see cref="RestartLadder"/>-এর মন্তব্য দেখুন)।
    /// </summary>
    public const string AgentLockFileName = "agent.lock";

    /// <summary>watchdog নিজে দুবার না চলার জন্য একই কৌশল।</summary>
    public const string WatchdogLockFileName = "watchdog.lock";

    /// <summary>হাল ছেড়ে দেওয়ার দৃশ্যমান চিহ্ন।</summary>
    public const string AlarmFileName = "watchdog.alarm";

    public const string WatchdogLogFileName = "watchdog.log";

    /// <summary>ইনস্টলার/আনইনস্টলার এই ফাইল বানিয়ে watchdog-কে ভদ্রভাবে থামাতে পারে।</summary>
    public const string StopFileName = "watchdog.stop";

    /// <summary>এজেন্ট কত পরপর লেখে।</summary>
    public static TimeSpan HeartbeatInterval => TimeSpan.FromSeconds(15);

    /// <summary>
    /// এর চেয়ে বাসি হলে এজেন্ট জমে গেছে ধরা হয় — অর্থাৎ টানা ৮টা লেখা মিস।
    ///
    /// ⚠️ ব্যবধানের ২ বা ৩ গুণ রাখা <b>যাবে না</b>। AV-র ফুল স্ক্যান, ডিস্কের
    /// এক মুহূর্তের ঝিমুনি বা GC-র একটা লম্বা pause — এসবে একটা-দুটো লেখা মিস
    /// হওয়া স্বাভাবিক। ৮ গুণ ব্যবধান রেখে ভুল করে সুস্থ এজেন্ট মারার ঝুঁকি
    /// কমানো হয়েছে; বিনিময়ে সত্যিকারের জমে যাওয়া ধরতে ২ মিনিট দেরি হয়, যেটা
    /// মাসিক ২০৮ ঘণ্টার হিসাবে ধর্তব্যই নয়।
    /// </summary>
    public static TimeSpan StaleAfter => TimeSpan.FromSeconds(120);

    /// <summary>watchdog কত পরপর তাকায়।</summary>
    public static TimeSpan CheckInterval => TimeSpan.FromSeconds(30);

    public static string Format(AgentHeartbeat beat)
    {
        ArgumentNullException.ThrowIfNull(beat);

        // ⚠️ InvariantCulture বাধ্যতামূলক। বাংলা locale-এ সংখ্যা বাংলা অঙ্কে
        //    লেখা হলে watchdog-এর parse ব্যর্থ হতো, আর তখন সুস্থ এজেন্টকেই
        //    "হার্টবিট নেই" ধরে মারা হতো।
        return string.Create(
            CultureInfo.InvariantCulture,
            $"v={beat.Version} pid={beat.ProcessId} session={beat.SessionId} unbiased={beat.UnbiasedMs} utc={beat.WrittenAtUtc.UtcDateTime:O}");
    }

    /// <summary>
    /// ভাঙা বা অসম্পূর্ণ লাইন হলে <c>null</c>।
    ///
    /// অচেনা ক্ষেত্র ইচ্ছাকৃতভাবে উপেক্ষা করা হয়: এজেন্ট আপডেট হয়ে একটা নতুন
    /// ক্ষেত্র যোগ করলে পুরোনো watchdog যেন parse-এ ব্যর্থ হয়ে গোটা বহরকে
    /// রিস্টার্ট-লুপে না ফেলে। আপডেটের সময়টাই সবচেয়ে নাজুক মুহূর্ত।
    /// </summary>
    public static AgentHeartbeat? TryParse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;

        int? version = null;
        int? pid = null;
        uint? session = null;
        long? unbiased = null;
        DateTimeOffset? utc = null;

        foreach (var token in line.Split(
                     ' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var eq = token.IndexOf('=');
            if (eq <= 0 || eq == token.Length - 1) continue;

            var key = token[..eq];
            var value = token[(eq + 1)..];

            switch (key)
            {
                case "v":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v))
                        version = v;
                    break;

                case "pid":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var p))
                        pid = p;
                    break;

                case "session":
                    if (uint.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s))
                        session = s;
                    break;

                case "unbiased":
                    if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var u))
                        unbiased = u;
                    break;

                case "utc":
                    if (DateTimeOffset.TryParse(
                            value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t))
                        utc = t;
                    break;
            }
        }

        // ⚠️ অর্ধেক লেখা ফাইল (এজেন্ট লেখার মাঝপথে মরেছে) এখানেই আটকায়।
        //    pid বা unbiased ছাড়া হার্টবিটের কোনো মানে নেই।
        if (version is null || pid is not > 0 || unbiased is not >= 0) return null;

        return new AgentHeartbeat
        {
            Version = version.Value,
            ProcessId = pid.Value,
            SessionId = session ?? 0,
            UnbiasedMs = unbiased.Value,
            WrittenAtUtc = utc ?? DateTimeOffset.MinValue,
        };
    }

    /// <summary>
    /// হার্টবিট কত পুরোনো। <c>null</c> মানে "এই বুটের নয়" — অর্থাৎ ব্যবহারের অযোগ্য।
    ///
    /// ⚠️ ঋণাত্মক বয়সকে "খুব তাজা" ধরা <b>যাবে না</b>। unbiased কাউন্টার এক বুটের
    /// ভেতরে কখনো পিছায় না, তাই ভবিষ্যতের মান মানে ফাইলটা <b>আগের বুটে</b> লেখা
    /// (রিবুটের পর ফাইল ডিস্কে থেকে যায়, কাউন্টার শূন্য থেকে শুরু হয়)। ওটাকে তাজা
    /// ধরলে watchdog মৃত এজেন্টকে চিরকাল সুস্থ ভাবত আর কোনোদিন চালু করত না —
    /// অর্থাৎ রিবুটের পর কারো সময় গোনাই হতো না।
    /// </summary>
    public static TimeSpan? Age(AgentHeartbeat beat, long nowUnbiasedMs)
    {
        ArgumentNullException.ThrowIfNull(beat);

        return nowUnbiasedMs < beat.UnbiasedMs
            ? null
            : TimeSpan.FromMilliseconds(nowUnbiasedMs - beat.UnbiasedMs);
    }
}
