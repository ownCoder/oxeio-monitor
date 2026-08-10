namespace oXeio.Core.Agent;

/// <summary>
/// আউটবক্সের প্রতিটি সারি ঠিক একটা endpoint-এর জন্য — এই enum-টাই বলে কোনটা।
///
/// ক্রমটা ইচ্ছাকৃত: ঘোষণার এই ক্রমই <see cref="OutboxBudget"/>-এ "কোনটা আগে ফেলে
/// দেওয়া যায়" বোঝাতে ব্যবহার হয় না — সেখানে আলাদা rank আছে, কারণ enum-এর ক্রম
/// বদলালে নীরবে ভুল জিনিস মুছে যেত।
///
/// ⚠️ এই enum-এর নাম SQLite-এ <b>টেক্সট</b> হিসেবে জমা হবে, সংখ্যা হিসেবে নয়।
/// সংখ্যা জমালে ভবিষ্যতে মাঝখানে একটা সদস্য যোগ করলেই পুরোনো সারিগুলো অন্য
/// endpoint-এ চলে যেত — আর সেটা কেউ টেরও পেত না।
/// </summary>
public enum OutboundKind
{
    /// <summary><c>POST /agent/segments</c> — payload <see cref="oXeio.Core.Models.ActivitySegment"/></summary>
    Segment,

    /// <summary><c>POST /agent/app-usage</c> — payload <see cref="AppUsageRecord"/></summary>
    AppUsage,

    /// <summary><c>POST /agent/events</c> — payload <see cref="AgentEventRecord"/></summary>
    Event,

    /// <summary>
    /// <c>POST /agent/screenshots</c> — payload <see cref="ScreenshotRecord"/>,
    /// আর আসল বাইটগুলো ডিস্কে (<see cref="OutboxItem.FilePath"/>)।
    /// </summary>
    Screenshot,
}
