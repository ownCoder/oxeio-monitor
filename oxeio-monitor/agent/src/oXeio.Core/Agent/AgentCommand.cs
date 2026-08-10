namespace oXeio.Core.Agent;

/// <summary>
/// heartbeat-এর উত্তরে সার্ভার যা করতে বলতে পারে।
///
/// ⚠️ এটা স্টাফের জন্য কোনো বাটন নয় — কমান্ড শুধু অ্যাডমিন ড্যাশবোর্ড থেকে আসে।
/// </summary>
public enum AgentCommand
{
    /// <summary>কনফিগ ভার্সন মেলেনি — <c>GET /agent/config</c> করে নতুন করে নিন।</summary>
    ReloadConfig,

    /// <summary>স্লটের অপেক্ষা না করে এখনই একটা ছবি (ক্যাপচার উইন্ডোর ভেতরে হলে তবেই)।</summary>
    CaptureNow,

    /// <summary>ট্র্যাকিং সাময়িক থামান। ⚠️ কিউ থামে না — জমা ডেটা আপলোড চলতেই থাকবে।</summary>
    PauseTracking,

    /// <summary><c>GET /agent/update</c> দেখুন।</summary>
    UpdateAgent,

    /// <summary>
    /// এই ডিভাইস বাতিল (H06)। ট্র্যাকিং স্থায়ীভাবে বন্ধ, tray-তে জানানো।
    /// একই কথা ৪০৩-এর বডিতেও আসতে পারে — <see cref="SyncOutcome.Revoked"/> দেখুন।
    /// </summary>
    Revoke,
}

/// <summary>
/// তারে যায় snake_case স্ট্রিং হিসেবে। পাঁচটা মডিউল আলাদা আলাদা
/// <c>switch</c> লিখলে একটাতে টাইপো থাকত আর সেই কমান্ডটা নীরবে হারাত —
/// তাই ম্যাপিংটা একটাই জায়গায়।
/// </summary>
public static class AgentCommands
{
    public const string ReloadConfig = "reload_config";
    public const string CaptureNow = "capture_now";
    public const string PauseTracking = "pause_tracking";
    public const string UpdateAgent = "update_agent";
    public const string Revoke = "revoke";

    /// <summary>অচেনা কমান্ড হলে null — ভবিষ্যতের সার্ভার নতুন কমান্ড পাঠালে যেন এজেন্ট না ভাঙে।</summary>
    public static AgentCommand? Parse(string? wire) => wire switch
    {
        ReloadConfig => AgentCommand.ReloadConfig,
        CaptureNow => AgentCommand.CaptureNow,
        PauseTracking => AgentCommand.PauseTracking,
        UpdateAgent => AgentCommand.UpdateAgent,
        Revoke => AgentCommand.Revoke,
        _ => null,
    };

    public static string ToWire(AgentCommand command) => command switch
    {
        AgentCommand.ReloadConfig => ReloadConfig,
        AgentCommand.CaptureNow => CaptureNow,
        AgentCommand.PauseTracking => PauseTracking,
        AgentCommand.UpdateAgent => UpdateAgent,
        AgentCommand.Revoke => Revoke,
        _ => command.ToString(),
    };
}
