using System.Security.Cryptography;
using System.Text;

namespace oXeio.Agent.Security;

/// <summary>
/// ⭐ গোপন লেখা (device token, enrollment code) — যেটা কখনো লগে যাবে না।
///
/// <b>কেন একটা আলাদা টাইপ, শুধু string না রেখে:</b> টোকেন ফাঁস হওয়ার আসল পথ
/// অসাবধান <c>$"..."</c>। প্রসেসটা সপ্তাহের পর সপ্তাহ চলে আর লগ ফাইল মাসখানেক
/// ডিস্কে পড়ে থাকে — একটাবার <c>Line($"enroll ok: {response}")</c> লিখলেই
/// পে-রোল সার্ভারের টোকেন প্লেইন টেক্সটে জমা হয়ে গেল, আর কেউ কোনোদিন টেরও পেত না।
/// এখানে <see cref="ToString"/> ওভাররাইড করা আছে, তাই ওই লাইনটা লিখলেও
/// «secret:a1b2c3d4» ছাড়া কিছু বেরোয় না।
///
/// ⚠️ এটাকে <c>record</c> বানাবেন না। record-এর কম্পাইলার-জেনারেটেড
/// <c>ToString</c> সব public member ছাপে — অর্থাৎ ঠিক যেটা ঠেকাতে চাইছি সেটাই
/// ফিরে আসত। একই কারণে ভেতরের মানটা কোনো public property হিসেবে রাখা হয়নি;
/// পেতে হলে <see cref="Reveal"/> ডাকতেই হবে, আর সেটা grep করে খুঁজে বের করা যায়।
///
/// ⚠️ <b>যা এটা করতে পারে না:</b> .NET-এ <c>string</c> immutable ও GC মুভ করে,
/// তাই ভেতরের মানটা মেমরি থেকে মোছা <b>অসম্ভব</b>। ফুল crash dump নিলে টোকেন
/// পাওয়া যাবে। তাই ডিপ্লয়মেন্টে <c>DOTNET_DbgEnableMiniDump</c> চালু করা যাবে না।
/// এই ক্লাস লগ ফাঁস ঠেকায়, মেমরি ফরেনসিক নয় — এটুকুই দাবি।
/// </summary>
internal sealed class SecretText
{
    private readonly string _value;

    public SecretText(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        _value = value;
        Fingerprint = ComputeFingerprint(value);
    }

    /// <summary>
    /// লগে ব্যবহারের জন্য নিরাপদ পরিচয় — sha256-এর প্রথম ৮ হেক্স অক্ষর।
    ///
    /// এটা থাকায় "টোকেন বদলেছে কি না" বা "দুই মেশিনে একই টোকেন কি না" লগ দেখেই
    /// বলা যায়, অথচ টোকেনটা লেখা লাগে না। ৩২ বাইট এলোমেলো টোকেনের ৩২ বিট হ্যাশ
    /// থেকে মূল টোকেন বের করা যায় না।
    /// </summary>
    public string Fingerprint { get; }

    public int Length => _value.Length;

    /// <summary>
    /// আসল মান। ⚠️ শুধু নেটওয়ার্কে পাঠানোর বা ডিস্কে এনক্রিপ্ট করার ঠিক আগে।
    ///
    /// পুরো এজেন্টে এর কল-সাইট মোট <b>চারটে</b>, আর <c>Reveal(</c> grep করলেই
    /// সবগুলো পাওয়া যায় — নিরীক্ষা করার সময় এটাই পুরো তালিকা:
    /// <list type="number">
    /// <item><see cref="DeviceCredentials.ApplyTo"/> — টোকেন সিঙ্ক ক্লায়েন্টে।</item>
    /// <item><c>DeviceCredentials.IDeviceTokenSource.CurrentToken</c> — একই কাজ, টানা পদ্ধতিতে।</item>
    /// <item><c>DeviceTokenStore.Serialize</c> — DPAPI-তে ঢোকার আগে।</item>
    /// <item><c>EnrollmentClient.EnrollAsync</c> — enrollment code রিকোয়েস্ট বডিতে।</item>
    /// </list>
    /// নতুন কল-সাইট যোগ করার আগে দুবার ভাবুন; এই তালিকাটাও হালনাগাদ করুন।
    /// </summary>
    public string Reveal() => _value;

    /// <summary>খালি বা শুধু ফাঁকা অক্ষর — সার্ভারে পাঠানোর আগে নাকচ করার জন্য।</summary>
    public bool IsBlank => string.IsNullOrWhiteSpace(_value);

    public override string ToString() => $"«secret:{Fingerprint}»";

    /// <summary>
    /// ⚠️ constant-time নয় এবং সেটাই ঠিক আছে — এখানে টোকেন যাচাই করা হয় না,
    /// শুধু "ডিস্কেরটা আর মেমরিরটা এক কি না" দেখা হয়। টাইমিং অ্যাটাকের কেউ নেই।
    /// </summary>
    public bool SameAs(SecretText? other) =>
        other is not null && string.Equals(_value, other._value, StringComparison.Ordinal);

    private static string ComputeFingerprint(string value)
    {
        // ⚠️ Encoding.UTF8 — Encoding.Default ব্যবহার করলে একই টোকেনের fingerprint
        //    কোড-পেজভেদে বদলে যেত, আর "টোকেন বদলে গেছে" বলে ভুল অ্যালার্ম উঠত।
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash, 0, 4).ToLowerInvariant();
    }
}
