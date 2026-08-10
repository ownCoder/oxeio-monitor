using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;

using oXeio.Core.Agent;

namespace oXeio.Agent.Security;

/// <summary>ডিস্ক থেকে ক্রেডেনশিয়াল পড়ার ফলাফল।</summary>
internal enum CredentialLoadStatus
{
    /// <summary>সব ঠিক আছে, টোকেন ব্যবহারযোগ্য।</summary>
    Loaded,

    /// <summary>ফাইলই নেই — এখনো enroll করা হয়নি। এটা ত্রুটি নয়।</summary>
    NotEnrolled,

    /// <summary>ফাইল আছে কিন্তু খোলা গেল না (DPAPI ব্যর্থ, JSON নষ্ট, পড়ার অনুমতি নেই)।</summary>
    Unreadable,

    /// <summary>
    /// ফাইল খুলেছে, কিন্তু ভেতরের machineGuid/hostname এই মেশিনের সাথে মেলে না —
    /// অর্থাৎ টোকেনটা অন্য PC-র। প্রায় সবসময়ই ডিস্ক-ইমেজ ক্লোনের ফল।
    /// </summary>
    BindingMismatch,
}

/// <summary>
/// ডিস্কে যা জমা থাকে। ⚠️ ইচ্ছাকৃতভাবে <c>record</c> নয় —
/// record হলে জেনারেটেড <c>ToString</c> টোকেনসহ সব ছাপত।
/// <see cref="Token"/> নিজেও <see cref="SecretText"/>, তাই দুই স্তরের সুরক্ষা।
/// </summary>
internal sealed class DeviceCredentialRecord
{
    public required int DeviceId { get; init; }
    public required SecretText Token { get; init; }

    /// <summary>enroll করার মুহূর্তে এই মেশিনের পরিচয় — ক্লোন ধরার চাবি।</summary>
    public required string MachineGuid { get; init; }

    /// <inheritdoc cref="MachineGuid"/>
    public required string Hostname { get; init; }

    public required DateTimeOffset EnrolledAt { get; init; }
    public required EnrolledEmployee Employee { get; init; }
    public string? AgentVersion { get; init; }

    public override string ToString() =>
        $"device #{DeviceId} · {Employee.EmpCode} · token={Token} · enrolled {EnrolledAt:u}";
}

/// <summary>পড়ার ফল। <see cref="Record"/> শুধু <see cref="CredentialLoadStatus.Loaded"/>-এ ভরা থাকে।</summary>
internal sealed record CredentialLoad(
    CredentialLoadStatus Status,
    DeviceCredentialRecord? Record,
    string? Detail);

/// <summary>লেখার ফল। enroll-এর উত্তর একবারই আসে, তাই ব্যর্থতা চেপে যাওয়া চলবে না।</summary>
internal readonly record struct CredentialSave(bool Ok, string? Detail);

/// <summary>
/// ⭐ device token ডিস্কে রাখা ও ফিরিয়ে আনা — DPAPI (LocalMachine) দিয়ে ঢাকা,
/// %ProgramData%\oXeio\device.dat-এ, নিজের ACL সহ।
///
/// <b>১· LocalMachine স্কোপ, CurrentUser নয় — কেন:</b>
/// enroll হয় ইনস্টলারের সময়, প্রায়ই IT অ্যাডমিনের অ্যাকাউন্টে (বা SYSTEM-এ);
/// এজেন্ট পরে চলে স্টাফের অ্যাকাউন্টে। CurrentUser স্কোপে ব্লবটা ইউজারের
/// DPAPI master key দিয়ে ঢাকা পড়ত, আর <b>অন্য কোনো অ্যাকাউন্ট সেটা খুলতেই পারত না</b> —
/// অর্থাৎ ইনস্টল করার পরদিন সকালে এজেন্ট ৪০১ খেয়ে চুপ করে বসে থাকত।
/// একই কারণে প্রোফাইল রিসেট বা পাসওয়ার্ড রিসেটে (ডোমেইন ছাড়া মেশিনে DPAPI
/// master key নষ্ট হয়ে যায়) টোকেন চিরতরে হারাত, আর প্রতিবার নতুন enrollment
/// code লাগত। LocalMachine স্কোপে ওই দুটোর কোনোটাই ঘটে না।
///
/// <b>২· LocalMachine স্কোপ কী দেয় আর কী দেয় না — সৎ হিসাব:</b>
/// দেয়: ডিস্ক খুলে নিয়ে গেলে, ব্যাকআপ ফাঁস হলে, বা ফাইলটা অন্য PC-তে কপি করলে
/// টোকেন খোলা যায় না (DPAPI master key ওই মেশিনেই থাকে)।
/// দেয় না: <b>এই</b> PC-র যেকোনো লোকাল ইউজার, যে ফাইলটা পড়তে পারে, সে
/// <c>Unprotect</c>ও করতে পারে। ফাইল ACL-ই তাই আসল সীমানা, DPAPI নয়।
/// শক্ত করতে হলে একমাত্র পথ এজেন্টকে LocalSystem সার্ভিস বানানো (তখন
/// <c>restrictToAdministrators: true</c>) — সেটা আলাদা সিদ্ধান্ত, এখানে নয়।
///
/// <b>৩· ACL যা বসানো হয়:</b> ফাইলে inheritance বন্ধ (protected), তারপর
/// SYSTEM = Full, BUILTIN\Administrators = Full, BUILTIN\Users = <b>Read</b>।
/// Users-কে Read দিতেই হয়, কারণ এজেন্ট স্টাফের অ্যাকাউন্টে চলে অথচ ফাইলটা
/// অ্যাডমিনের হাতে তৈরি হয়। Users-এর Write নেই, আর ফোল্ডারে
/// <c>DeleteSubdirectoriesAndFiles</c> নেই — তাই সাধারণ ইউজার টোকেন মুছে
/// এজেন্টকে থামাতেও পারে না।
///
/// ⚠️ ডিরেক্টরিটা ইতিমধ্যে থাকলে তার ACL <b>ছোঁয়া হয় না</b> — outbox মডিউলও
/// ওখানেই লেখে, আর তাদের ইচ্ছাকৃত সেটিং পাল্টে দিলে ওদিকে ডেটা লেখা বন্ধ হয়ে যেত।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class DeviceTokenStore
{
    /// <summary>স্কিমা ভার্সন — ভবিষ্যতে ফরম্যাট বদলালে পুরোনো ফাইল চেনার জন্য।</summary>
    private const int SchemaVersion = 1;

    public const string DefaultFileName = "device.dat";

    /// <summary>
    /// বাতিল হয়ে যাওয়া ক্রেডেনশিয়াল এখানে সরানো হয়, মোছা হয় না।
    /// ⚠️ মুছে ফেললে "কেন হঠাৎ re-enroll চাইছে" প্রশ্নের উত্তর আর কোথাও থাকত না।
    /// </summary>
    public const string QuarantineFileName = "device.dat.orphaned";

    /// <summary>
    /// DPAPI-র optional entropy। ⚠️ এটা গোপন কিছু <b>নয়</b> — বাইনারিতেই আছে।
    /// কাজ একটাই: একই মেশিনের অন্য কোনো LocalMachine-DPAPI অ্যাপ যেন ভুল করে
    /// আমাদের ব্লব খুলে না ফেলে। একে "বাড়তি নিরাপত্তা" বলে দাবি করা হচ্ছে না।
    /// </summary>
    private static readonly byte[] Entropy =
        "oXeio.agent.device-credentials.v1"u8.ToArray();

    private readonly Action<string>? _log;
    private readonly bool _restrictToAdministrators;

    public DeviceTokenStore(
        string? directoryPath = null,
        Action<string>? log = null,
        bool restrictToAdministrators = false)
    {
        DirectoryPath = directoryPath ?? DefaultDirectory();
        FilePath = Path.Combine(DirectoryPath, DefaultFileName);
        _log = log;
        _restrictToAdministrators = restrictToAdministrators;
    }

    public string DirectoryPath { get; }

    public string FilePath { get; }

    /// <summary><c>%ProgramData%\oXeio</c> — <see cref="AgentDataDirectory"/> দেখুন।</summary>
    public static string DefaultDirectory() => AgentDataDirectory.Default;

    // ── পড়া ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ কখনো throw করে না। এটা স্টার্টআপ পথ; এখানে একটা এক্সসেপশন মানে
    /// এজেন্ট চালুই হলো না, আর তখন ওই PC-র কেউ সারা মাস ঘণ্টা পেত না।
    /// </summary>
    public CredentialLoad Load(MachineIdentity identity)
    {
        byte[]? plaintext = null;

        try
        {
            if (!File.Exists(FilePath))
                return new CredentialLoad(CredentialLoadStatus.NotEnrolled, null, null);

            var blob = File.ReadAllBytes(FilePath);
            if (blob.Length == 0)
                return new CredentialLoad(CredentialLoadStatus.Unreadable, null, "ফাইল খালি");

            try
            {
                plaintext = ProtectedData.Unprotect(blob, Entropy, DataProtectionScope.LocalMachine);
            }
            catch (CryptographicException ex)
            {
                // ⚠️ এখানে এলে সবচেয়ে সম্ভাব্য কারণ: ফাইলটা অন্য মেশিন থেকে কপি
                //    হয়েছে (DPAPI master key মেলেনি), অথবা Windows আবার ইনস্টল
                //    হয়েছে। রিট্রাই করে লাভ নেই — নতুন enroll লাগবে।
                return new CredentialLoad(
                    CredentialLoadStatus.Unreadable, null,
                    "DPAPI খুলতে পারল না (সম্ভবত ফাইলটা অন্য মেশিনের): " + ex.Message);
            }

            var record = Parse(plaintext, out var parseError);
            if (record is null)
                return new CredentialLoad(CredentialLoadStatus.Unreadable, null, parseError);

            var mismatch = DescribeBindingMismatch(record, identity);
            if (mismatch is not null)
            {
                Quarantine(mismatch);
                return new CredentialLoad(CredentialLoadStatus.BindingMismatch, null, mismatch);
            }

            return new CredentialLoad(CredentialLoadStatus.Loaded, record, null);
        }
        catch (Exception ex)
        {
            return new CredentialLoad(
                CredentialLoadStatus.Unreadable, null, ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            // প্লেইনটেক্সট বাফারটা যত কম সময় মেমরিতে থাকে তত ভালো।
            // ⚠️ এতে টোকেন-string মোছে না (string মোছা যায় না) — এটা
            //    defence-in-depth, গ্যারান্টি নয়। SecretText-এর মন্তব্য দেখুন।
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    /// <summary>
    /// ⭐ ক্লোন ধরার একমাত্র নির্ভরযোগ্য জায়গা।
    ///
    /// ডিস্ক-ইমেজ ক্লোনে <b>সবকিছুই</b> কপি হয় — MachineGuid, DPAPI master key,
    /// এমনকি এই device.dat-ও। তাই DPAPI বা GUID দিয়ে ক্লোন চেনা যায় না।
    /// একটাই জিনিস আলাদা হতে বাধ্য: <b>hostname</b> (Windows একই নামের দুটো
    /// মেশিন নেটওয়ার্কে থাকতে দেয় না, আর ইমেজ বসানোর পর নাম বদলাতেই হয়)।
    ///
    /// তাই hostname না মিললে টোকেন ব্যবহার করা হয় না।
    /// দাম: কেউ ইচ্ছে করে PC-র নাম বদলালে একবার re-enroll লাগবে।
    /// লাভ: ১৫টা PC নীরবে একজনের নামে ঘণ্টা জমা করবে না।
    /// এই দুটোর মধ্যে দ্বিতীয়টা অপূরণীয়, প্রথমটা পাঁচ মিনিটের কাজ — তাই এই পছন্দ।
    /// </summary>
    private static string? DescribeBindingMismatch(DeviceCredentialRecord record, MachineIdentity identity)
    {
        if (!string.Equals(record.MachineGuid, identity.MachineGuid, StringComparison.OrdinalIgnoreCase))
        {
            return $"machineGuid বদলে গেছে (জমা ছিল {record.MachineGuid}, এখন {identity.MachineGuid}) — " +
                   "Windows আবার ইনস্টল হয়েছে বা ফাইলটা অন্য মেশিন থেকে এসেছে।";
        }

        if (!string.Equals(record.Hostname, identity.Hostname, StringComparison.OrdinalIgnoreCase))
        {
            return $"hostname বদলে গেছে (জমা ছিল {record.Hostname}, এখন {identity.Hostname}) — " +
                   "PC রিনেম হয়েছে, অথবা এটা ক্লোন করা ইমেজ। নতুন enrollment code দিয়ে আবার enroll করুন।";
        }

        return null;
    }

    // ── লেখা ────────────────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ enroll-এর উত্তরে টোকেন <b>একবারই</b> আসে (সার্ভারে শুধু sha256 থাকে)।
    /// তাই এটা ব্যর্থ হলে টোকেনটা চিরতরে গেল — কলারকে জোরে জানাতে হবে যে
    /// নতুন enrollment code ছাড়া আর কিছু করার নেই। নীরবে false ফেরানো চলবে না।
    /// </summary>
    public CredentialSave Save(DeviceCredentialRecord record)
    {
        byte[]? plaintext = null;

        try
        {
            EnsureDirectory();

            plaintext = Serialize(record);
            var blob = ProtectedData.Protect(plaintext, Entropy, DataProtectionScope.LocalMachine);

            WriteAtomic(blob);

            _log?.Invoke($"ক্রেডেনশিয়াল জমা হলো: {record} → {FilePath}");
            return new CredentialSave(true, null);
        }
        catch (Exception ex)
        {
            // ⚠️ ex.Message-এ টোকেন নেই — record-এর ToString-ও নিরাপদ।
            //    এখানে record ছাপা হলেও শুধু fingerprint যেত।
            return new CredentialSave(false, ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    /// <summary>
    /// ⚠️ ACL <b>অস্থায়ী ফাইলে</b> বসানো হয়, তারপর move।
    /// <c>File.Move(..., overwrite: true)</c> ভেতরে MoveFileEx/REPLACE_EXISTING —
    /// গন্তব্যের security descriptor বাতিল হয়ে <b>উৎসেরটা</b> সাথে আসে।
    /// অর্থাৎ শেষ ফাইলে ACL বসিয়ে তারপর overwrite করলে ACL নীরবে হারিয়ে যেত
    /// আর টোকেন ProgramData-র ঢিলে ACL নিয়ে পড়ে থাকত।
    ///
    /// move নিজে NTFS-এ atomic, তাই বিদ্যুৎ চলে গেলেও অর্ধেক লেখা ফাইল থাকে না —
    /// হয় পুরোনো টোকেন, নয় নতুনটা।
    /// </summary>
    private void WriteAtomic(byte[] blob)
    {
        var temp = FilePath + ".tmp";

        // আগের চেষ্টার আবর্জনা পড়ে থাকলে — না মুছলে নিচের CreateNew ব্যর্থ হতো।
        if (File.Exists(temp)) File.Delete(temp);

        // খালি ফাইল বানিয়ে আগে ACL, তারপর বাইট। এই ক্রমে গোপন বাইট কখনো
        // উত্তরাধিকারসূত্রে পাওয়া ঢিলে ACL নিয়ে ডিস্কে বসে না।
        using (new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }

        new FileInfo(temp).SetAccessControl(BuildFileSecurity());

        using (var fs = new FileStream(temp, FileMode.Open, FileAccess.Write, FileShare.None))
        {
            fs.Write(blob, 0, blob.Length);

            // ⚠️ flushToDisk: true — নইলে enroll-এর পরপরই বিদ্যুৎ গেলে
            //    ফাইলটা ০ বাইট থাকত, আর টোকেন আর কোনোদিন পাওয়া যেত না।
            fs.Flush(flushToDisk: true);
        }

        File.Move(temp, FilePath, overwrite: true);
    }

    private FileSecurity BuildFileSecurity()
    {
        var security = new FileSecurity();

        // ⚠️ প্রথম কাজ: উত্তরাধিকার বন্ধ। ProgramData-র ডিফল্ট ACL-এ
        //    Authenticated Users-এর লেখার অধিকার আছে; সেটা টেনে আনলে
        //    যেকোনো ইউজার টোকেন ফাইল বদলে দিতে পারত।
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl, AccessControlType.Allow));

        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            FileSystemRights.FullControl, AccessControlType.Allow));

        if (!_restrictToAdministrators)
        {
            // ইনস্টলার (অ্যাডমিন) লেখে, এজেন্ট (স্টাফের অ্যাকাউন্ট) পড়ে।
            // Read ছাড়া কম দিলে এজেন্ট নিজের টোকেনই পড়তে পারত না।
            security.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
                FileSystemRights.Read, AccessControlType.Allow));
        }

        return security;
    }

    /// <summary>ফোল্ডার না থাকলে শক্ত ACL সহ বানায় — <see cref="AgentDataDirectory"/>।</summary>
    private void EnsureDirectory() => AgentDataDirectory.Ensure(DirectoryPath);

    // ── মোছা ও সরানো ────────────────────────────────────────────────────────

    /// <summary>
    /// ডিভাইস revoke হলে (H06) বা binding ভাঙলে। ⚠️ NTFS/SSD-তে "নিরাপদ মুছে
    /// ফেলা" বলে কিছু নেই (journal, TRIM, shadow copy) — চেষ্টাও করা হচ্ছে না।
    /// টোকেন সার্ভারে ইতিমধ্যে বাতিল, তাই পড়ে থাকা বাইট দিয়ে কিছু হয় না।
    /// </summary>
    public bool TryDelete(string reason)
    {
        try
        {
            if (File.Exists(FilePath)) File.Delete(FilePath);
            _log?.Invoke($"ক্রেডেনশিয়াল মুছে ফেলা হলো — {reason}");
            return true;
        }
        catch (Exception ex)
        {
            _log?.Invoke($"❌ ক্রেডেনশিয়াল মোছা গেল না ({reason}): {ex.Message}");
            return false;
        }
    }

    private void Quarantine(string reason)
    {
        try
        {
            var target = Path.Combine(DirectoryPath, QuarantineFileName);
            File.Move(FilePath, target, overwrite: true);
            _log?.Invoke($"⚠️ ক্রেডেনশিয়াল সরিয়ে রাখা হলো ({QuarantineFileName}) — {reason}");
        }
        catch (Exception ex)
        {
            _log?.Invoke($"⚠️ ক্রেডেনশিয়াল সরানো গেল না: {ex.Message}");
        }
    }

    // ── JSON ────────────────────────────────────────────────────────────────

    /// <summary>
    /// হাতে লেখা JSON, রিফ্লেকশন-নির্ভর <c>JsonSerializer.Serialize&lt;T&gt;</c> নয়।
    /// কারণ দুটো: (ক) কোন ফিল্ড ডিস্কে যাচ্ছে তা এক নজরে দেখা যায় — গোপন কিছু
    /// ভুল করে ঢুকে পড়ার সুযোগ নেই; (খ) ভবিষ্যতে trimming চালু করলে
    /// রিফ্লেকশন নীরবে ভেঙে পড়ত।
    /// </summary>
    private static byte[] Serialize(DeviceCredentialRecord record)
    {
        using var buffer = new MemoryStream(512);

        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("v", SchemaVersion);
            writer.WriteNumber("deviceId", record.DeviceId);
            writer.WriteString("deviceToken", record.Token.Reveal());
            writer.WriteString("machineGuid", record.MachineGuid);
            writer.WriteString("hostname", record.Hostname);
            writer.WriteString("enrolledAt", record.EnrolledAt.ToString("O"));
            writer.WriteNumber("employeeId", record.Employee.Id);
            writer.WriteString("empCode", record.Employee.EmpCode);
            writer.WriteString("fullName", record.Employee.FullName);

            if (record.AgentVersion is { } version)
                writer.WriteString("agentVersion", version);

            writer.WriteEndObject();
            writer.Flush();
        }

        var length = (int)buffer.Length;
        var exact = new byte[length];
        Buffer.BlockCopy(buffer.GetBuffer(), 0, exact, 0, length);

        // MemoryStream-এর ভেতরের বাফারেও টোকেন ছিল — সেটাও মুছে দেওয়া হচ্ছে।
        CryptographicOperations.ZeroMemory(buffer.GetBuffer());

        return exact;
    }

    private static DeviceCredentialRecord? Parse(byte[] utf8Json, out string? error)
    {
        try
        {
            using var document = JsonDocument.Parse(utf8Json);
            var root = document.RootElement;

            var version = root.TryGetProperty("v", out var v) ? v.GetInt32() : 0;
            if (version != SchemaVersion)
            {
                error = $"অচেনা স্কিমা ভার্সন {version} (চাই {SchemaVersion})";
                return null;
            }

            var token = root.GetProperty("deviceToken").GetString();
            if (string.IsNullOrWhiteSpace(token))
            {
                error = "deviceToken খালি";
                return null;
            }

            error = null;
            return new DeviceCredentialRecord
            {
                DeviceId = root.GetProperty("deviceId").GetInt32(),
                Token = new SecretText(token),
                MachineGuid = root.GetProperty("machineGuid").GetString() ?? string.Empty,
                Hostname = root.GetProperty("hostname").GetString() ?? string.Empty,
                EnrolledAt = DateTimeOffset.TryParse(
                    root.GetProperty("enrolledAt").GetString(),
                    null,
                    System.Globalization.DateTimeStyles.RoundtripKind,
                    out var enrolledAt)
                    ? enrolledAt
                    : DateTimeOffset.MinValue,
                Employee = new EnrolledEmployee(
                    root.TryGetProperty("employeeId", out var eid) ? eid.GetInt32() : 0,
                    root.TryGetProperty("empCode", out var code) ? code.GetString() ?? "?" : "?",
                    root.TryGetProperty("fullName", out var name) ? name.GetString() ?? "?" : "?"),
                AgentVersion = root.TryGetProperty("agentVersion", out var av) ? av.GetString() : null,
            };
        }
        catch (Exception ex)
        {
            // ⚠️ JsonException-এর মেসেজে কখনো কখনো আশপাশের কাঁচা টেক্সট থাকে,
            //    আর সেই টেক্সটে টোকেন থাকতে পারে। তাই ex.Message ব্যবহার করা হয় না।
            error = "ক্রেডেনশিয়াল ফাইল পড়া গেল না (" + ex.GetType().Name + ")";
            return null;
        }
    }
}
