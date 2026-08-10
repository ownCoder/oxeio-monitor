using System.Text.Json;
using System.Text.Json.Serialization;

namespace oXeio.Agent.Sync;

/// <summary>
/// সার্ভারের সাথে কথা বলার JSON নিয়ম — একটাই <see cref="JsonSerializerOptions"/>,
/// পুরো মডিউলে।
///
/// ⭐ <b>কেন একটাই ইনস্ট্যান্স:</b> প্রথম ব্যবহারে <c>JsonSerializerOptions</c>
/// নিজের ভেতরে টাইপগুলোর metadata cache বানিয়ে ফেলে আর তারপর read-only হয়ে যায়।
/// প্রতি কলে নতুন বানালে সেই cache প্রতিবার নতুন করে তৈরি হতো — সপ্তাহখানেক চলা
/// প্রসেসে সেটা নীরব CPU ও মেমরি খরচ, অথচ কেউ প্রোফাইলার নিয়ে বসবে না।
/// </summary>
internal static class SyncJson
{
    /// <summary>
    /// <b>camelCase কেন বাধ্যতামূলক:</b> সার্ভারের DTO-গুলো class-validator দিয়ে
    /// যাচাই হয় আর তাদের প্রপার্টি camelCase (<c>clientUuid</c>, <c>durationSec</c>)।
    /// PascalCase পাঠালে NestJS ওগুলোকে অচেনা ফিল্ড ধরে, required ফিল্ডগুলো
    /// "অনুপস্থিত" হয় আর পুরো ব্যাচ ৪০০ খায় — অর্থাৎ
    /// <see cref="oXeio.Core.Agent.SyncOutcome.Permanent"/>, অর্থাৎ ৫০০ সারি মুছে যায়।
    /// একটা নামকরণ নীতির ভুলে পে-রোল ডেটা হারানোর পথ ঠিক এতটাই ছোট।
    ///
    /// <b>DateTimeOffset কেন হাতে ফরম্যাট করা হয়নি:</b> System.Text.Json ডিফল্টেই
    /// ISO-8601 round-trip লেখে অফসেট সহ (<c>2026-08-09T14:03:02.1234567+06:00</c>),
    /// যেটা JS-এর <c>new Date(...)</c> — অর্থাৎ সার্ভারের
    /// <c>@Type(() =&gt; Date) @IsDate()</c> — হুবহু মেনে নেয়। কাস্টম কনভার্টার
    /// লিখলে ঠিক এই জায়গাতেই অফসেট হারিয়ে ঢাকার সময় UTC ধরে নেওয়া হতো, আর
    /// সবার ৬ ঘণ্টা ভুল দিনে বসত।
    ///
    /// ⚠️ <see cref="JsonIgnoreCondition.WhenWritingNull"/> ছাড়া <c>appName: null</c>
    /// এর মতো ফিল্ড তারে যেত; <c>@IsOptional()</c> null পেলে কিছু ভ্যালিডেটরে
    /// সেটা "আছে কিন্তু ভুল টাইপ" হয়ে ৪০০ দেয়। না পাঠানোই নিরাপদ।
    /// </summary>
    internal static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,

        // সার্ভার ভবিষ্যতে PascalCase-এ কিছু ফেরালেও পড়া যাবে।
        PropertyNameCaseInsensitive = true,

        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,

        // ⚠️ NestJS-এর কিছু রূপান্তর সংখ্যা স্ট্রিং হিসেবে ফেরায় ("accepted": "12")।
        //    পড়ার সময় সেটা মেনে নেওয়া হয়, লেখার সময় নয়।
        NumberHandling = JsonNumberHandling.AllowReadingFromString,

        // অচেনা ফিল্ড থাকলে চুপচাপ বাদ (ডিফল্ট) — সার্ভার নতুন ফিল্ড যোগ করলে
        // পুরোনো এজেন্ট যেন না ভাঙে।
        WriteIndented = false,
    };

    /// <summary>
    /// কখনো ছোড়ে না — খারাপ JSON মানে <c>null</c>।
    ///
    /// ⚠️ কল করার জায়গায় ঠিক করতে হবে null মানে কী: ২xx-এর পরে null মানে
    /// "সার্ভার নিয়েছে কিন্তু উত্তরটা পড়তে পারিনি" — সেটা সফলতাই, ব্যর্থতা নয়।
    /// </summary>
    internal static T? TryDeserialize<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;

        try
        {
            return JsonSerializer.Deserialize<T>(json, Options);
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

    internal static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}
