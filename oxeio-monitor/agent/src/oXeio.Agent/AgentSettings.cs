using System.Runtime.Versioning;
using System.Security;
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
    /// <summary>
    /// উদাহরণ: <c>https://oxeio.office.local</c> — <b>শুধু ঠিকানা</b>, কোনো পথ নয়।
    ///
    /// ⚠️ API-র prefix (<c>/api/v1</c>) এখানে লিখতে হয় না; <see cref="ApiRoot"/>
    /// নিজে জুড়ে নেয়। ওটা সার্ভারের ভেতরের ব্যাপার — অফিসের অ্যাডমিনকে
    /// মনে রাখতে বলা মানে একদিন কেউ ভুলে যাবে, আর তখন এজেন্ট প্রতিটা
    /// রিকোয়েস্টে ৪০৪ খেয়ে চুপচাপ কিছুই পাঠাবে না।
    /// </summary>
    public required string ServerUrl { get; init; }

    /// <summary>সার্ভারের গ্লোবাল prefix — <c>server/src/main.ts</c>-এ সেট করা।</summary>
    public const string ApiPrefix = "api/v1";

    /// <summary>
    /// <see cref="ServerUrl"/> + <see cref="ApiPrefix"/>। শেষে স্ল্যাশ থাকে,
    /// কারণ <c>Uri</c> আপেক্ষিক পথ জোড়ার সময় শেষ খণ্ডটা <b>কেটে ফেলে</b> —
    /// স্ল্যাশ ছাড়া <c>…/api/v1</c> + <c>agent/enroll</c> হতো
    /// <c>…/api/agent/enroll</c>।
    /// </summary>
    [JsonIgnore]
    public Uri ApiRoot => new(new Uri(ServerUrl.TrimEnd('/') + "/"), ApiPrefix + "/");

    /// <summary>স্টাফ নিজের ডেটা যেখানে দেখবে (J02)। না থাকলে মেনু আইটেমটা নিষ্ক্রিয়।</summary>
    public string? StaffPortalUrl { get; init; }

    /// <summary>সই করা মনিটরিং পলিসির কপি (J04)।</summary>
    public string? PolicyUrl { get; init; }

    /// <summary>ইনস্টলের সময় দেওয়া একবার-ব্যবহার্য কোড (H05)। enroll হয়ে গেলে অগ্রাহ্য।</summary>
    public string? EnrollmentCode { get; init; }

    /// <summary>
    /// **I01** — সার্ভারের সার্টের SPKI হ্যাশ (base64), কমা দিয়ে ভাগ করা।
    ///
    /// ⭐ অফিসের সার্ভারে স্ব-স্বাক্ষরিত সার্ট, তাই "বিশ্বস্ত CA" বলে
    /// কিছু নেই — পিনই একমাত্র উপায় যাতে এজেন্ট নিশ্চিত হতে পারে ওপাশে
    /// আমাদের সার্ভারই আছে (রানবুক § ৬)।
    ///
    /// ⚠️ **একাধিক পিন রাখা যায়, আর নবায়নের দিন রাখতেই হবে** — পুরোনো ও
    /// নতুন দুটোই কিছুক্ষণ বৈধ না থাকলে সার্ট বদলানোর মুহূর্তে ১৫টা
    /// এজেন্ট একসাথে সংযোগ হারাত (§ ৭.১)।
    ///
    /// ⚠️ না দিলে পিনিং **বন্ধ** থাকে — তখন শুধু Windows-এর নিজের যাচাই।
    /// এটা আজকের ইচ্ছাকৃত ট্রেড-অফ: রানবুক § ৬.৪ সুপারিশ করেছিল পিন
    /// বাধ্যতামূলক করার, কিন্তু তাতে আজকের পাইলট (যেখানে সার্টই বসানো
    /// হয়নি) সংযোগই করতে পারত না। প্রোডাকশনে `SERVERPIN` দেওয়া
    /// চেকলিস্টের অংশ, আর না দিলে এজেন্ট লগে সেটা স্পষ্ট করে বলে।
    /// </summary>
    public string? ServerPin { get; init; }

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

    /// <summary>MSI এখানে লেখে। আনইনস্টলে Windows নিজেই মুছে দেয়।</summary>
    public const string RegistryKey = @"SOFTWARE\oXeio\Agent";

    public static AgentSettings? Load(out string source) => Load(null, out source);

    /// <summary>
    /// পড়া যায়নি মানে কনফিগার করা হয়নি — <c>null</c> ফেরে, ব্যতিক্রম নয়।
    /// কলার তখন স্পষ্ট বার্তা দেখাতে পারে, স্ট্যাক ট্রেস নয়।
    ///
    /// তিন জায়গায় খোঁজা হয়, এই ক্রমে:
    /// <list type="number">
    /// <item>পরিবেশ-চলক — শুধু ডেভেলপমেন্টে</item>
    /// <item>রেজিস্ট্রি <c>HKLM\SOFTWARE\oXeio\Agent</c> — MSI যেখানে লেখে</item>
    /// <item><c>agent.json</c> — হাতে বসানোর পথ</item>
    /// </list>
    /// </summary>
    public static AgentSettings? Load(string? directory, out string source)
    {
        var env = Environment.GetEnvironmentVariable(ServerUrlEnvVar);
        if (!string.IsNullOrWhiteSpace(env))
        {
            source = $"environment variable {ServerUrlEnvVar}";
            return new AgentSettings { ServerUrl = env.Trim() };
        }

        var fromRegistry = FromRegistry();
        if (fromRegistry is not null)
        {
            source = $@"HKLM\{RegistryKey}";
            return fromRegistry;
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

    /// <summary>
    /// ⚠️ <c>Registry.LocalMachine</c> খোলা হয় <b>64-বিট ভিউতে</b> জোর করে।
    /// এজেন্ট 32-বিট হিসেবে চললে (বা ভবিষ্যতে কেউ AnyCPU বানালে) Windows
    /// নীরবে <c>WOW6432Node</c>-এ পাঠাত, যেখানে MSI কিছু লেখেইনি — আর তখন
    /// এজেন্ট "কনফিগার করা হয়নি" বলে বসে থাকত, অথচ ইনস্টল ঠিকই হয়েছে।
    /// </summary>
    private static AgentSettings? FromRegistry()
    {
        try
        {
            using var root = RegistryKey64();
            using var key = root.OpenSubKey(RegistryKey);
            if (key is null) return null;

            var url = key.GetValue("ServerUrl") as string;
            if (string.IsNullOrWhiteSpace(url)) return null;

            var settings = new AgentSettings
            {
                ServerUrl = url.Trim(),
                StaffPortalUrl = Trimmed(key, "StaffPortalUrl"),
                PolicyUrl = Trimmed(key, "PolicyUrl"),
                EnrollmentCode = Trimmed(key, "EnrollmentCode"),
                ServerPin = Trimmed(key, "ServerPin"),
            };

            return settings.IsUsable ? settings : null;
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }

    private static Microsoft.Win32.RegistryKey RegistryKey64() =>
        Microsoft.Win32.RegistryKey.OpenBaseKey(
            Microsoft.Win32.RegistryHive.LocalMachine,
            Microsoft.Win32.RegistryView.Registry64);

    private static string? Trimmed(Microsoft.Win32.RegistryKey key, string name)
    {
        var value = (key.GetValue(name) as string)?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}
