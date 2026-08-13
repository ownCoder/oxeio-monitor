using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Security;

/// <summary>
/// ⭐ সিঙ্ক মডিউল ডিস্কের দিকে যে একমাত্র জানালা দিয়ে তাকায়।
///
/// <b>কেন টোকেনটা এখানে property হিসেবে নেই:</b> থাকলে সিঙ্ক লুপকে
/// <c>SetDeviceToken(credentials.Token)</c> লিখতে হতো, আর ঠিক তার পাশেই
/// একদিন কেউ <c>_log($"token={credentials.Token}")</c> লিখে ফেলত।
/// বদলে <see cref="ApplyTo"/> — টোকেনটা এক হাত থেকে আরেক হাতে যায়, কোথাও
/// থামে না। ইমপ্লিমেন্টেশন <c>oXeio.Agent.Sync.IDeviceTokenSource</c>-ও
/// explicit করে বাস্তবায়ন করে, যাতে <c>HttpSyncClient</c> নিজেই টেনে নিতে পারে;
/// সেটাও এই ইন্টারফেসের সারফেসে দেখা যায় না।
/// "টোকেন কোথায় কোথায় খোলা হয়" প্রশ্নের উত্তর একটা grep: <c>Reveal(</c> —
/// তালিকাটা <see cref="SecretText.Reveal"/>-এর মন্তব্যে লেখা আছে।
///
/// ⚠️ ইমপ্লিমেন্টেশন thread-safe হতে হবে: enroll হয় স্টার্টআপ থ্রেডে,
/// পড়া হয় সিঙ্ক ওয়ার্কারে, আর revoke আসে heartbeat-এর উত্তরে — তিনটে আলাদা থ্রেড।
/// </summary>
[SupportedOSPlatform("windows")]
internal interface IDeviceCredentials
{
    /// <summary>টোকেন হাতে আছে ও এই মেশিনের জন্যই বৈধ।</summary>
    bool IsEnrolled { get; }

    /// <summary>
    /// enroll করা দরকার — হয় কখনো করা হয়নি, নয় ফাইলটা আর ব্যবহারযোগ্য নয়।
    /// ⚠️ <see cref="IsEnrolled"/>-এর উল্টো নয়: revoke হওয়া ডিভাইসে দুটোই false,
    /// কারণ revoke-এর উত্তর আবার enroll করা নয়, স্থায়ীভাবে থেমে যাওয়া (H06)।
    /// </summary>
    bool NeedsEnrollment { get; }

    /// <summary>সার্ভার এই ডিভাইস বাতিল করেছে। ট্র্যাকিং আর চালু হবে না।</summary>
    bool IsRevoked { get; }

    int? DeviceId { get; }

    EnrolledEmployee? Employee { get; }

    /// <summary>লগে লেখার মতো নিরাপদ পরিচয় (sha256-এর ৮ হেক্স), টোকেন নয়।</summary>
    string? TokenFingerprint { get; }

    CredentialLoadStatus Status { get; }

    /// <summary>মানুষের পড়ার মতো কারণ — ট্রে টুলটিপ ও লগে যায়। এখানে গোপন কিছু থাকে না।</summary>
    string? Detail { get; }

    MachineIdentity Identity { get; }

    /// <summary>
    /// টোকেনটা <paramref name="client"/>-এ বসিয়ে দেয়। enroll না থাকলে
    /// <c>null</c> বসে, অর্থাৎ ক্লায়েন্ট ৪০১ পাবে — সেটাই কাম্য,
    /// কারণ টোকেন ছাড়া রিকোয়েস্ট পাঠানো বন্ধ করার দায়িত্ব সিঙ্ক লুপের নয়।
    /// </summary>
    void ApplyTo(ISyncClient client);

    /// <summary>
    /// ডিস্ক থেকে আবার পড়ে। ইনস্টলার আলাদা প্রসেসে enroll করলে
    /// (এজেন্ট তখন চলছিল) এভাবেই টোকেনটা এসে পৌঁছায়। true = অবস্থা বদলেছে।
    /// </summary>
    bool Reload();

    /// <summary>
    /// ৪০৩ + <c>{command:"revoke"}</c> পেলে। টোকেন ডিস্ক থেকেও মুছে যায়,
    /// নইলে রিবুটের পর এজেন্ট আবার বাতিল টোকেন নিয়ে সার্ভারে ধাক্কা দিত।
    /// </summary>
    void Revoke(string reason);

    /// <summary>
    /// স্টাফ নিজে tray থেকে সাইন আউট করলে। টোকেন ডিস্ক থেকেও মুছে যায়।
    ///
    /// ⚠️⚠️ <b><see cref="Revoke"/> নয় — আর এই পার্থক্যটাই এখানকার সবকিছু।</b>
    /// revoke স্থায়ী: <c>IsRevoked</c> সত্যি হয়ে যায়, আর
    /// <see cref="NeedsEnrollment"/> চিরকাল মিথ্যা থাকে, তাই সাইন-ইন জানালা
    /// আর কোনোদিন আসে না। সাইন আউটে ঠিক উল্টোটা দরকার — মেশিনটা যেন
    /// ইনস্টলের পরের মুহূর্তের মতো হয়ে যায়, আর পরের জন সাইন ইন করতে পারেন।
    ///
    /// ⚠️ এখানে <c>Revoke</c> ডেকে ফেলা খুব সহজ ভুল হতো, আর ফলটা নীরব:
    /// স্টাফ সাইন আউট করতেন, তারপর tray বলত <i>"This device has been
    /// switched off — tell the office"</i>, আর ফেরার একমাত্র পথ হতো
    /// টোকেন-ফাইল হাতে মুছে দেওয়া।
    ///
    /// ⚠️ অপাঠানো আউটবক্স সারির দায়িত্ব <b>এই মেথডের নয়</b> — সেটা
    /// <c>AgentHost</c> আগেই সাফ করে (<see cref="oXeio.Core.Agent.SignOutGate"/>)।
    /// এখানে করলে ক্রেডেনশিয়ালের ক্লাসটা আউটবক্স চিনত, আর দুটো আলাদা
    /// জিনিস জড়িয়ে যেত।
    /// </summary>
    void SignOut(string reason);

    /// <summary>
    /// enroll / reload / revoke — যেকোনোটায় ওঠে। সিঙ্ক লুপ এখানে বসে
    /// <see cref="ApplyTo"/> ডাকে, তাই তাকে পোল করতে হয় না।
    ///
    /// ⚠️ হ্যান্ডলার UI থ্রেডে ডাকা হয় <b>না</b>, আর তার এক্সসেপশন গিলে ফেলা হয় —
    /// একটা ভাঙা হ্যান্ডলার যেন enroll-এর পথ আটকে না দেয়।
    /// </summary>
    event Action<IDeviceCredentials>? Changed;
}
