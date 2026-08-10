using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

using oXeio.Agent.Storage;

namespace oXeio.Agent.Security;

/// <summary>
/// এজেন্টের সব স্থায়ী ফাইলের ঘর: <c>%ProgramData%\oXeio</c> —
/// টোকেন, outbox, জমে থাকা .webp, লগ।
///
/// ⚠️ ফোল্ডারটা <b>একটাই জায়গা থেকে</b> তৈরি হয়। আগে <see cref="MachineIdentity"/>
/// আর <see cref="DeviceTokenStore"/> দুজনেই নিজের মতো বানাত, আর তাতে একটা
/// নীরব বাগ ছিল: যে আগে চলত সে <c>Directory.CreateDirectory</c> দিয়ে
/// ProgramData-র <b>উত্তরাধিকারসূত্রে পাওয়া ঢিলে ACL</b> নিয়ে ফোল্ডার বানিয়ে
/// ফেলত, তারপর দ্বিতীয়জন "ফোল্ডার তো আছেই" দেখে ACL আর বসাত না —
/// অর্থাৎ শক্ত অনুমতিগুলো কখনো প্রয়োগই হতো না, অথচ কোড পড়ে মনে হতো হয়েছে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class AgentDataDirectory
{
    /// <summary>
    /// <c>%ProgramData%\oXeio</c>। ফোল্ডারের নামটা
    /// <see cref="OutboxPaths.AppFolderName"/> থেকেই নেওয়া — দুই মডিউল দুরকম
    /// নাম ধরে নিলে টোকেন এক ফোল্ডারে আর outbox আরেকটায় বসত।
    ///
    /// ⚠️ ইচ্ছাকৃতভাবে এটা <see cref="OutboxPaths.Default"/>-এর
    /// <c>Root</c> <b>নয়</b>। ওটা ProgramData-তে লেখা না গেলে
    /// %LOCALAPPDATA%-তে নেমে আসে — কিউয়ের জন্য ঠিক আছে ("কিছুই না গোনার
    /// চেয়ে ভালো"), কিন্তু টোকেনের জন্য মারাত্মক: টোকেন ইউজার প্রোফাইলে গেলে
    /// অন্য অ্যাকাউন্টে লগ-ইন করা মাত্রই এজেন্ট নিজের টোকেন খুঁজে পেত না,
    /// অথচ enroll করা আছে বলে নতুন করে enroll-ও করত না। মেশিন-ব্যাপী গোপন
    /// জিনিস মেশিন-ব্যাপী জায়গাতেই থাকবে, নয়তো কোথাও থাকবে না।
    /// </summary>
    public static string Default { get; } = Path.Combine(
        Environment.GetFolderPath(
            Environment.SpecialFolder.CommonApplicationData,
            Environment.SpecialFolderOption.DoNotVerify),
        OutboxPaths.AppFolderName);

    /// <summary>
    /// না থাকলে শক্ত ACL সহ বানায়; থাকলে <b>কিছুই ছোঁয় না</b>।
    ///
    /// ⚠️ বিদ্যমান ফোল্ডারের ACL জোর করে বসানো হয় না। ইনস্টলার বা অ্যাডমিন
    /// ইচ্ছে করে অনুমতি বদলে থাকতে পারেন (যেমন সার্ভিস অ্যাকাউন্ট যোগ করা);
    /// প্রতি স্টার্টআপে সেটা মুছে দিলে outbox হঠাৎ লেখা বন্ধ করে দিত আর
    /// কারণটা কেউ খুঁজে পেত না।
    ///
    /// ⚠️ <b>এখানে একটা দৌড় আছে, আর সেটা মেনে নেওয়া হয়েছে:</b>
    /// <see cref="OutboxPaths.Resolve"/> নিজেও <c>Directory.CreateDirectory</c>
    /// দিয়ে একই ফোল্ডার বানাতে পারে, আর সে আগে চললে ফোল্ডারটা ProgramData-র
    /// উত্তরাধিকারসূত্রে পাওয়া ঢিলে ACL নিয়ে তৈরি হয়ে যাবে — তখন এই মেথড
    /// কিছুই করবে না। টোকেনের নিরাপত্তা তবু ঠিক থাকে, কারণ
    /// <c>device.dat</c>-এর নিজের ACL protected (উত্তরাধিকার বন্ধ) এবং সেটা
    /// প্রতিবার লেখার সময় স্পষ্ট করে বসানো হয়। ফোল্ডারের ACL শুধু
    /// "কে এখানে ফাইল বানাতে/মুছতে পারে" ঠিক করে, "কে টোকেন পড়তে পারে" নয়।
    /// শক্ত করতে হলে ইনস্টলারই ফোল্ডারটা আগে বানিয়ে ACL বসিয়ে দিক।
    /// </summary>
    public static void Ensure(string path)
    {
        if (Directory.Exists(path)) return;

        var security = new DirectorySecurity();

        // উত্তরাধিকার বন্ধ। ProgramData-র ডিফল্টে Authenticated Users-এর
        // তৈরি/লেখার অধিকার আছে — সেটা টেনে আনলে যেকোনো ইউজার এখানে ফাইল
        // বসিয়ে বা বদলে দিতে পারত।
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

        const InheritanceFlags Inherit =
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;

        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl, Inherit, PropagationFlags.None, AccessControlType.Allow));

        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            FileSystemRights.FullControl, Inherit, PropagationFlags.None, AccessControlType.Allow));

        // Users = Modify, FullControl নয়।
        // ⚠️ FullControl-এ DeleteSubdirectoriesAndFiles থাকত, আর তখন সাধারণ
        //    ইউজার device.dat মুছে (ফাইলে তার শুধু Read থাকা সত্ত্বেও) এজেন্টকে
        //    থামিয়ে দিতে পারত। Modify দিয়ে সে নিজের এজেন্টের outbox লিখতে পারে,
        //    কিন্তু অন্যের বসানো ফাইল মুছতে পারে না।
        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
            FileSystemRights.Modify, Inherit, PropagationFlags.None, AccessControlType.Allow));

        new DirectoryInfo(path).Create(security);
    }

    /// <summary>ব্যর্থ হলে throw নয় — কারণটা ফেরত আসে। স্টার্টআপ পথে ব্যবহারের জন্য।</summary>
    public static bool TryEnsure(string path, out string? error)
    {
        try
        {
            Ensure(path);
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
            return false;
        }
    }
}
