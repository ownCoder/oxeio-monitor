namespace oXeio.Core.Agent;

/// <summary>
/// H04 — নামানো আপডেট কোন অবস্থায় আছে।
///
/// ⭐ <b>এজেন্ট নিজে থেকে MSI চালায় না।</b> সে শুধু নামায়, হ্যাশ মেলায়,
/// আর "প্রস্তুত" বলে রেখে দেয়।
///
/// কারণটা এই রিপোর নিজেরই অভিজ্ঞতা
/// ([G58](../../../../docs/08-Gap-Analysis.md)): একটা ভুল LaunchCondition
/// নিয়ে MSI বিলি হয়ে গিয়েছিল, আর তারপর দেখা গেল <b>নতুন MSI দিয়ে সেটা
/// ঠিক করা যায় না</b> — মেজর আপগ্রেডে পুরোনো প্যাকেজ নিজের ক্যাশ করা MSI
/// দিয়েই সরে, বাগসহ। ওই এক মেশিনে হাতে গিয়ে ঠিক করতে হয়েছিল।
/// ১৫টা PC-তে রাত ৩টায় নিজে থেকে সেটা ঘটলে সকালে পুরো অফিসের ট্র্যাকিং
/// বন্ধ থাকত, আর ১৫ বার হাতে যেতে হতো।
///
/// তাই ভাগটা ইচ্ছাকৃত: <b>নামানো ও যাচাই স্বয়ংক্রিয়, বসানো মানুষের হাতে।</b>
/// সার্ভারের ধাপে ধাপে রোলআউট (canary → partial → all) ঠিক করে দেয়
/// কোন মেশিন কখন প্রস্তাব পাবে; মালিক ড্যাশবোর্ড থেকে দেখে সিদ্ধান্ত নেন।
/// </summary>
public enum UpdateStage
{
    /// <summary>নতুন কিছু নেই।</summary>
    None,

    /// <summary>সার্ভার প্রস্তাব দিয়েছে, নামানো এখনো হয়নি।</summary>
    Offered,

    /// <summary>নামানো হয়েছে, কিন্তু হ্যাশ এখনো মেলানো হয়নি।</summary>
    Downloaded,

    /// <summary>⭐ হ্যাশ মিলেছে — বসানোর জন্য প্রস্তুত।</summary>
    Verified,

    /// <summary>
    /// নামানো গেছে কিন্তু হ্যাশ মেলেনি — ফাইলটা মুছে ফেলা হয়েছে।
    /// ⚠️ এটা নীরবে চাপা দেওয়ার জিনিস নয়: হয় ট্রান্সফার নষ্ট হয়েছে,
    /// নয় কেউ মাঝপথে ফাইল বদলেছে। দ্বিতীয়টা সত্যি হলে সেটা আক্রমণ।
    /// </summary>
    Corrupt,
}

/// <summary>এই মুহূর্তে আপডেটের ছবি — tray ও ডায়াগনস্টিক দুটোই এটা দেখায়।</summary>
public sealed record UpdateStatus
{
    public static readonly UpdateStatus Idle = new() { Stage = UpdateStage.None };

    public required UpdateStage Stage { get; init; }

    public string? Version { get; init; }

    /// <summary>যাচাই হয়ে গেলে MSI-টা ডিস্কে ঠিক কোথায়।</summary>
    public string? MsiPath { get; init; }

    public bool Mandatory { get; init; }

    /// <summary>কী ভুল হয়েছিল — ব্যর্থ হলে।</summary>
    public string? Detail { get; init; }

    /// <summary>স্টাফকে দেখানোর মতো এক লাইন।</summary>
    public string Describe() => Stage switch
    {
        UpdateStage.None => "Running the latest version",
        UpdateStage.Offered => $"New version {Version} — downloading",
        UpdateStage.Downloaded => $"New version {Version} — verifying",
        UpdateStage.Verified => $"New version {Version} is ready to install",

        // ⚠️ "সমস্যা হয়েছে" বললে কেউ কিছু করত না। কী করতে হবে সেটা বলা হচ্ছে।
        UpdateStage.Corrupt => $"Version {Version} downloaded but the file did not match — tell IT",

        _ => "Unknown",
    };
}
