using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using Microsoft.Win32;

namespace oXeio.Agent.Security;

/// <summary>এই মেশিনের পরিচয়টা আসলে কোথা থেকে এসেছে।</summary>
internal enum MachineIdSource
{
    /// <summary>HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid — কাম্য অবস্থা।</summary>
    Registry,

    /// <summary>রেজিস্ট্রি পড়া যায়নি, তাই %ProgramData%-তে নিজেদের বানানো একটা GUID।</summary>
    LocalFile,

    /// <summary>ডিস্কেও লেখা গেল না — শুধু এই প্রসেসের আয়ু পর্যন্ত টেকে।</summary>
    Volatile,
}

/// <summary>
/// enroll করতে যা যা লাগে: স্থায়ী machineGuid, hostname, Windows ইউজার, OS ভার্সন।
///
/// <b>⚠️ ইমেজ থেকে ক্লোন করা PC — এই ফাইলের সবচেয়ে গুরুত্বপূর্ণ ফাঁদ।</b>
/// <c>MachineGuid</c> তৈরি হয় Windows ইনস্টলের সময়। <c>sysprep /generalize</c>
/// চালালে সেটা নতুন করে বসে, কিন্তু অফিসে সাধারণত যা হয় — একটা PC সাজিয়ে
/// ডিস্ক ইমেজ করে বাকি ১৪টায় ঢেলে দেওয়া — তাতে <b>MachineGuid হুবহু এক থাকে</b>।
/// তখন সার্ভারের দিক থেকে ১৫টা PC একটাই ডিভাইস; ১৫ জনের ঘণ্টা একজনের নামে
/// জমা হয় আর বাকিদের খাতা ফাঁকা থাকে। সবচেয়ে খারাপ দিক হলো এটা নীরব —
/// এজেন্ট দিব্যি চলে, ড্যাশবোর্ডেও সবুজ দেখায়, শুধু সংখ্যাগুলো ভুল।
///
/// এখানে সেটা "ঠিক" করার চেষ্টা করা হয় <b>না</b> (machineGuid-এ hostname মিশিয়ে
/// দিলে PC-র নাম বদলালেই পরিচয় হারাত, আর তখন প্রতিটা রিনেমে ইতিহাস মুছে যেত)।
/// আসল প্রতিরক্ষা <see cref="DeviceTokenStore"/>-এ: টোকেনের সাথে machineGuid ও
/// hostname দুটোই বাঁধা থাকে, আর ক্লোন করা মেশিনে hostname মেলে না বলে ওই টোকেন
/// ব্যবহারই করা হয় না — ট্রে লাল হয়ে "আবার enroll করুন" বলে।
/// অর্থাৎ ভুলটা নীরব না থেকে দৃশ্যমান হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed record MachineIdentity
{
    private const string CryptographyKeyPath = @"SOFTWARE\Microsoft\Cryptography";
    private const string MachineGuidValueName = "MachineGuid";

    /// <summary>রেজিস্ট্রি পড়া না গেলে যেখানে নিজেদের বানানো GUID রাখা হয়।</summary>
    public const string FallbackFileName = "machine-id.txt";

    public required string MachineGuid { get; init; }
    public required MachineIdSource Source { get; init; }
    public required string Hostname { get; init; }
    public required string WindowsUsername { get; init; }
    public required string OsVersion { get; init; }

    /// <summary>
    /// ⚠️ <see cref="MachineIdSource.Volatile"/> হলে false। তখন enroll করা
    /// <b>নিষিদ্ধ</b> — প্রতি রিবুটে নতুন GUID মানে সার্ভারে প্রতিদিন নতুন ডিভাইস,
    /// আর একজন স্টাফের ঘণ্টা ডজনখানেক ভুতুড়ে ডিভাইসে ছড়িয়ে যেত।
    /// </summary>
    public required bool UsableForEnrollment { get; init; }

    /// <summary>null না হলে অ্যাডমিনকে দেখানোর মতো সমস্যা আছে। নীরবে গিলে ফেলা হয় না।</summary>
    public string? Warning { get; init; }

    /// <summary>
    /// <paramref name="dataDirectory"/> = <c>%ProgramData%\oXeio</c>।
    /// ফলব্যাক GUID ওখানেই লেখা/পড়া হয়। ⚠️ কখনো throw করে না — পরিচয় জোগাড়
    /// করতে না পারা মানেই এজেন্ট মরে যাওয়া নয়, শুধু enroll আটকে থাকা।
    /// </summary>
    public static MachineIdentity Collect(string dataDirectory)
    {
        var hostname = ReadHostname();
        var username = ReadUsername();
        var os = ReadOsVersion();

        var registry = TryReadRegistryMachineGuid(out var registryError);
        if (registry is not null)
        {
            return new MachineIdentity
            {
                MachineGuid = registry,
                Source = MachineIdSource.Registry,
                Hostname = hostname,
                WindowsUsername = username,
                OsVersion = os,
                UsableForEnrollment = true,
            };
        }

        var fallback = TryReadOrCreateFallback(dataDirectory, out var fileError);
        if (fallback is not null)
        {
            return new MachineIdentity
            {
                MachineGuid = fallback,
                Source = MachineIdSource.LocalFile,
                Hostname = hostname,
                WindowsUsername = username,
                OsVersion = os,
                UsableForEnrollment = true,
                Warning =
                    $"MachineGuid রেজিস্ট্রি থেকে পড়া গেল না ({registryError}) — " +
                    $"{FallbackFileName} থেকে বানানো আইডি ব্যবহার হচ্ছে। " +
                    "⚠️ %ProgramData%\\oXeio মুছে ফেললে বা Windows আবার ইনস্টল করলে " +
                    "এই মেশিন সার্ভারে নতুন ডিভাইস হিসেবে ধরা পড়বে।",
            };
        }

        // ⚠️ এখানে পৌঁছানো মানে রেজিস্ট্রি ও ডিস্ক দুটোই ব্যর্থ। GUID দেওয়া হচ্ছে
        //    শুধু যাতে বাকি কোড null নিয়ে নাক গলাতে না হয়; UsableForEnrollment=false
        //    বলে দিচ্ছে এটাকে বিশ্বাস করা যাবে না।
        return new MachineIdentity
        {
            MachineGuid = Guid.NewGuid().ToString("D"),
            Source = MachineIdSource.Volatile,
            Hostname = hostname,
            WindowsUsername = username,
            OsVersion = os,
            UsableForEnrollment = false,
            Warning =
                $"❌ স্থায়ী মেশিন-আইডি বানানো গেল না। রেজিস্ট্রি: {registryError}; " +
                $"ফাইল: {fileError}. enroll করা হবে না — নইলে প্রতি রিবুটে নতুন ডিভাইস তৈরি হতো।",
        };
    }

    /// <summary>ডিফল্ট ডেটা ফোল্ডার ধরে — <c>%ProgramData%\oXeio</c>।</summary>
    public static MachineIdentity Collect() => Collect(AgentDataDirectory.Default);

    /// <summary>
    /// ⚠️ <see cref="RegistryView.Registry64"/> স্পষ্ট করে দেওয়া হয়েছে। ৩২-বিট
    /// প্রসেস হিসেবে চললে (কেউ win-x86 publish করলেই হবে) WOW64 রিডাইরেকশন
    /// আমাদের <c>SOFTWARE\Wow6432Node\Microsoft\Cryptography</c>-তে পাঠাত,
    /// যেখানে MachineGuid <b>নেই</b> — অর্থাৎ প্রতিটা ৩২-বিট বিল্ড নীরবে
    /// ফলব্যাক আইডিতে নেমে যেত আর সব মেশিন "নতুন ডিভাইস" হয়ে যেত।
    /// ৩২-বিট Windows-এ এই ভিউ উপেক্ষিত হয়, তাই ক্ষতি নেই।
    /// </summary>
    private static string? TryReadRegistryMachineGuid(out string error)
    {
        try
        {
            using var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = hklm.OpenSubKey(CryptographyKeyPath, writable: false);

            if (key is null)
            {
                error = $@"HKLM\{CryptographyKeyPath} নেই";
                return null;
            }

            var raw = key.GetValue(MachineGuidValueName) as string;
            if (string.IsNullOrWhiteSpace(raw))
            {
                error = $"{MachineGuidValueName} খালি";
                return null;
            }

            // ⚠️ যাচাই না করে পাঠালে সার্ভার ৪০০ দিত আর enroll চিরকাল আটকে থাকত।
            //    সব-শূন্য GUID কিছু ভাঙা ইমেজে সত্যিই দেখা যায়।
            var trimmed = raw.Trim();
            if (!Guid.TryParseExact(trimmed, "D", out var parsed) || parsed == Guid.Empty)
            {
                error = "MachineGuid-এর মান GUID নয়";
                return null;
            }

            error = string.Empty;
            return parsed.ToString("D");
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
            return null;
        }
    }

    private static string? TryReadOrCreateFallback(string dataDirectory, out string error)
    {
        try
        {
            var path = Path.Combine(dataDirectory, FallbackFileName);

            if (File.Exists(path))
            {
                var text = File.ReadAllText(path).Trim();
                if (Guid.TryParseExact(text, "D", out var existing) && existing != Guid.Empty)
                {
                    error = string.Empty;
                    return existing.ToString("D");
                }
                // ফাইল আছে কিন্তু নষ্ট — নিচে নতুন করে লেখা হবে।
            }

            // ⚠️ Directory.CreateDirectory নয়। ওটা ProgramData-র ঢিলে ACL
            //    উত্তরাধিকারসূত্রে নিয়ে ফোল্ডার বানাত, আর পরে DeviceTokenStore
            //    "ফোল্ডার তো আছেই" দেখে শক্ত ACL আর বসাত না।
            AgentDataDirectory.Ensure(dataDirectory);

            var created = Guid.NewGuid().ToString("D");
            File.WriteAllText(path, created);

            error = string.Empty;
            return created;
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
            return null;
        }
    }

    /// <summary>
    /// ⚠️ <c>Dns.GetHostName()</c> নয়। ওটা DNS suffix জুড়তে পারে এবং নেটওয়ার্ক
    /// কনফিগ বদলালে বদলে যায় — অথচ এই মানটা টোকেনের সাথে বাঁধা থাকে, তাই
    /// অস্থির হলে প্রতিবার "ক্লোন সন্দেহ" হয়ে অকারণে re-enroll চাইত।
    /// <c>Environment.MachineName</c> NetBIOS নাম, রিনেম না করলে বদলায় না।
    /// </summary>
    private static string ReadHostname()
    {
        try
        {
            var name = Environment.MachineName.Trim();
            return string.IsNullOrEmpty(name) ? "unknown-host" : name;
        }
        catch
        {
            return "unknown-host";
        }
    }

    private static string ReadUsername()
    {
        try
        {
            var domain = Environment.UserDomainName;
            var user = Environment.UserName;

            if (string.IsNullOrWhiteSpace(user)) return "unknown-user";

            return string.IsNullOrWhiteSpace(domain) ? user : $@"{domain}\{user}";
        }
        catch
        {
            return "unknown-user";
        }
    }

    /// <summary>
    /// <c>RuntimeInformation.OSDescription</c> বিল্ড নম্বর সহ দেয়
    /// ("Microsoft Windows 10.0.26100")। app.manifest-এ compatibility ঘোষণা
    /// থাকায় এটা আসল ভার্সনই দেখায়, Windows 8-এ আটকে থাকা মান নয়।
    /// </summary>
    private static string ReadOsVersion()
    {
        try
        {
            var description = RuntimeInformation.OSDescription?.Trim();
            if (!string.IsNullOrEmpty(description)) return description;
        }
        catch
        {
            // নিচের ফলব্যাকে
        }

        try
        {
            return "Windows " + Environment.OSVersion.Version.ToString();
        }
        catch
        {
            return "Windows (অজানা ভার্সন)";
        }
    }

    /// <summary>লগের এক লাইন — এখানে কোনো গোপন কিছু নেই, machineGuid গোপন নয়।</summary>
    public string Describe() => string.Create(
        CultureInfo.InvariantCulture,
        $"machineGuid={MachineGuid} ({Source})  host={Hostname}  user={WindowsUsername}  os={OsVersion}");
}
