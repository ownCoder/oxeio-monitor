namespace oXeio.Core.Agent;

/// <summary>
/// দুটো কনফিগের মধ্যে <b>কী কী</b> বদলেছে — খাঁটি হিসাব, কোনো পার্শ্বপ্রতিক্রিয়া নেই।
///
/// ⭐ <b>কেন আলাদা টাইপ:</b> কনফিগ প্রয়োগ করার কাজটা <c>AgentHost</c>-এ,
/// যেখানে Win32, থ্রেড আর tray সব জড়ানো — ওখানে বসে "কোনটা বদলালে কী করতে
/// হবে" যাচাই করা যায় না। সিদ্ধান্তটুকু এখানে থাকায় প্রতিটা শাখা ইউনিট
/// টেস্টে ধরা যায়।
///
/// ⚠️ <b>যা বদলায়নি তাতে হাত দেওয়া চলবে না</b> — এটাই এই টাইপের গোটা কারণ।
/// idle থ্রেশহোল্ড বদলাতে চলতি সেগমেন্ট বন্ধ করতে হয়; অ্যাপ ট্র্যাকিং
/// বদলাতে খোলা রেকর্ড বন্ধ করতে হয়। "কনফিগ এসেছে, সব নতুন করে বসাই" লিখলে
/// সার্ভারে কেউ Settings-এ **save** চাপলেই ১৫টা PC-র সবার সেগমেন্ট অকারণে
/// কাটা পড়ত — আর দিনে কয়েকবার সেটা হলে রিপোর্ট ভরে যেত টুকরো সারিতে।
/// </summary>
public readonly record struct ConfigChange
{
    /// <summary>A04b — ছবির সময়সীমা (<c>07:00–23:00</c>)।</summary>
    public bool CaptureWindow { get; init; }

    /// <summary>A01 — স্লটের দৈর্ঘ্য।</summary>
    public bool Slots { get; init; }

    /// <summary>D01–D04 — অ্যাপ ট্র্যাকিং চালু/বন্ধ হলো।</summary>
    public bool AppTrackingToggled { get; init; }

    /// <summary>D04 — কত কম সময় উপেক্ষা করা হবে।</summary>
    public bool AppMinDuration { get; init; }

    /// <summary>B02 — নিষ্ক্রিয়তার সীমা। ⚠️ সবচেয়ে ব্যয়বহুল বদল।</summary>
    public bool IdleThreshold { get; init; }

    /// <summary>heartbeat-এর ব্যবধান — পরের delay থেকেই কার্যকর, কিছু বন্ধ করতে হয় না।</summary>
    public bool Heartbeat { get; init; }

    /// <summary>কিছু কি আদৌ বদলেছে?</summary>
    public bool Any =>
        CaptureWindow || Slots || AppTrackingToggled || AppMinDuration || IdleThreshold || Heartbeat;

    /// <summary>
    /// চলতি সেগমেন্ট বা খোলা রেকর্ড বন্ধ করতে হবে কি না — অর্থাৎ বদলটা
    /// "নিখরচার" নয়।
    /// </summary>
    public bool TouchesTracking => IdleThreshold || AppTrackingToggled || AppMinDuration;

    public static ConfigChange Between(AgentConfig old, AgentConfig now)
    {
        ArgumentNullException.ThrowIfNull(old);
        ArgumentNullException.ThrowIfNull(now);

        return new ConfigChange
        {
            // ⚠️ স্ট্রিং তুলনা Ordinal — "07:00" আর "7:00" আলাদা মান, আর
            //    culture-নির্ভর তুলনা এখানে অর্থহীন।
            CaptureWindow =
                !string.Equals(old.ScreenshotFrom, now.ScreenshotFrom, StringComparison.Ordinal) ||
                !string.Equals(old.ScreenshotTo, now.ScreenshotTo, StringComparison.Ordinal),

            // ⚠️ শূন্য বা ঋণাত্মক স্লট "বদল" হিসেবে গোনা হয় না — SlotScheduler
            //    ওতে ছুড়ে ফেলত, আর একটা ভুল কনফিগ পুরো ক্যাপচার লুপ নামিয়ে দিত।
            Slots = now.SlotMinutes > 0 && now.SlotMinutes != old.SlotMinutes,

            AppTrackingToggled = old.AppTracking.Enabled != now.AppTracking.Enabled,

            // ⚠️ শুধু চালু থাকা অবস্থাতেই অর্থবহ — বন্ধ থাকলে সীমা বদলানোর
            //    জন্য কিছু বন্ধ করার নেই।
            AppMinDuration =
                now.AppTracking.Enabled &&
                old.AppTracking.Enabled &&
                old.AppTracking.MinDurationSec != now.AppTracking.MinDurationSec,

            IdleThreshold = now.IdleThresholdSec > 0 && now.IdleThresholdSec != old.IdleThresholdSec,

            Heartbeat = now.HeartbeatSec > 0 && now.HeartbeatSec != old.HeartbeatSec,
        };
    }
}
