using System.Runtime.Versioning;
using System.Text.Json;
using System.Text.Json.Serialization;

using oXeio.Agent.Security;

namespace oXeio.Agent;

/// <summary>
/// এজেন্ট কোথায় কথা বলবে — MSI ইনস্টল করার সময় লিখে দেয়।
///
/// ⚠️ এখানে <b>কোনো গোপন তথ্য থাকে না</b>। ডিভাইস টোকেন আলাদা ফাইলে,
/// DPAPI দিয়ে সুরক্ষিত (<see cref="DeviceTokenStore"/>)। এই ফাইলটা
/// পড়তে পারা মানে শুধু সার্ভারের ঠিকানা জানা।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed record AgentSettings
{
    /// <summary>উদাহরণ: <c>https://oxeio.office.local</c> — শেষে <c>/api/v1</c> নয়।</summary>
    public required string ServerUrl { get; init; }

    /// <summary>স্টাফ নিজের ডেটা যেখানে দেখবে (J02)। না থাকলে মেনু আইটেমটা নিষ্ক্রিয়।</summary>
    public string? StaffPortalUrl { get; init; }

    /// <summary>সই করা মনিটরিং পলিসির কপি (J04)।</summary>
    public string? PolicyUrl { get; init; }

    /// <summary>ইনস্টলের সময় দেওয়া একবার-ব্যবহার্য কোড (H05)। enroll হয়ে গেলে অগ্রাহ্য।</summary>
    public string? EnrollmentCode { get; init; }

    [JsonIgnore]
    public bool IsUsable => Uri.TryCreate(ServerUrl, UriKind.Absolute, out var u)
                            && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp);

    /// <summary>ফাইলের নাম — ডেটা ফোল্ডারেই, টোকেনের পাশে।</summary>
    public const string FileName = "agent.json";

    /// <summary>
    /// ⚠️ ডেভেলপমেন্টে ফাইল ছাড়া চালানোর একমাত্র পথ। প্রোডাকশনে এই
    /// পরিবেশ-চলক থাকে না, তাই ভুল করে কারো মেশিনে অন্য সার্ভারে ডেটা
    /// যাওয়ার ঝুঁকি নেই।
    /// </summary>
    public const string ServerUrlEnvVar = "OXEIO_SERVER_URL";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>
    /// পড়া যায়নি মানে কনফিগার করা হয়নি — <c>null</c> ফেরে, ব্যতিক্রম নয়।
    /// কলার তখন স্পষ্ট বার্তা দেখাতে পারে, স্ট্যাক ট্রেস নয়।
    /// </summary>
    public static AgentSettings? Load(out string source) => Load(null, out source);

    public static AgentSettings? Load(string? directory, out string source)
    {
        var env = Environment.GetEnvironmentVariable(ServerUrlEnvVar);
        if (!string.IsNullOrWhiteSpace(env))
        {
            source = $"পরিবেশ-চলক {ServerUrlEnvVar}";
            return new AgentSettings { ServerUrl = env.Trim() };
        }

        var dir = directory ?? AgentDataDirectory.Default;
        var path = Path.Combine(dir, FileName);
        source = path;

        try
        {
            if (!File.Exists(path)) return null;

            var settings = JsonSerializer.Deserialize<AgentSettings>(File.ReadAllText(path), Json);
            return settings?.IsUsable == true ? settings : null;
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
