using System.Runtime.Versioning;

namespace oXeio.Agent.Storage;

/// <summary>
/// ⭐ এজেন্টের ডিস্কের সব পাথ ঠিক এখানেই — আর কোথাও ডিরেক্টরির নাম লেখা হবে না।
///
/// এক জায়গায় রাখার কারণ শুধু পরিপাটি কোড নয়। আউটবক্সের সারি আর .webp ফাইল
/// দুটো আলাদা মডিউল লেখে; দুজন দুরকম ফোল্ডার ধরে নিলে সারি বলবে ফাইল আছে
/// আর ডিস্কে ফাইল থাকবে অন্য কোথাও — তখন আপলোড চিরকাল ব্যর্থ হবে আর অনাথ
/// ফাইলগুলো কোনো বাজেটের হিসাবে ধরাই পড়বে না।
///
/// <b>কেন %ProgramData%:</b> ইউজার প্রোফাইল মুছে দিলে বা রোমিং প্রোফাইল রিসেট
/// করলেও এটা টিকে থাকে, আর মেশিনে একটাই কপি — অফিসের PC-তে IT নিয়মিত প্রোফাইল
/// রিসেট করে, তখন %AppData%-তে রাখা এক সপ্তাহের কিউ নিঃশব্দে উবে যেত।
///
/// ⚠️ ACL-এর ফাঁদ: ইনস্টলার (elevated) যদি <c>C:\ProgramData\oXeio</c> বানায়,
/// সাধারণ ইউজার সেখানে শুধু পড়তে পারবে — লিখতে পারবে না, কারণ ProgramData-র
/// ডিফল্ট ACL-এ Users পায় read+execute, আর CREATOR OWNER-এর full control শুধু
/// যে বানিয়েছে তার জন্য। ফল: এজেন্ট চালু হয় কিন্তু একটাও সারি লিখতে পারে না।
/// তাই ইনস্টলারকে ওই ফোল্ডারে Users-কে Modify দিতেই হবে, আর এখানে
/// <see cref="Resolve"/> সত্যিকারের একটা ফাইল লিখে যাচাই করে নেয় — না পারলে
/// %LOCALAPPDATA%-তে নেমে আসে (কিউ প্রোফাইল-মোছায় হারাবে, কিন্তু এজেন্ট অন্তত
/// ডেটা জমাতে থাকবে; "কিছুই না গোনার" চেয়ে ভালো)।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class OutboxPaths
{
    public const string AppFolderName = "oXeio";

    /// <summary>লেখার অনুমতি যাচাইয়ের ফাইল। থেকে গেলেও ক্ষতি নেই, তাই নাম স্থির।</summary>
    private const string ProbeFileName = ".write-probe";

    private static OutboxPaths? _default;

    private OutboxPaths(string root, bool isFallback, string resolutionNote)
    {
        Root = root;
        IsFallback = isFallback;
        ResolutionNote = resolutionNote;

        Database = Path.Combine(root, "outbox.db");
        QueueRoot = Path.Combine(root, "queue");
        ScreenshotQueue = Path.Combine(QueueRoot, "screenshots");
        Logs = Path.Combine(root, "logs");
        Updates = Path.Combine(root, "updates");
        State = Path.Combine(root, "state");
    }

    public string Root { get; }

    /// <summary>%ProgramData% ব্যবহার করা যায়নি বলে %LOCALAPPDATA%-তে নামতে হয়েছে।</summary>
    public bool IsFallback { get; }

    /// <summary>কেন এই রুট বেছে নেওয়া হলো — স্টার্টআপ লগে হুবহু লেখার জন্য।</summary>
    public string ResolutionNote { get; }

    public string Database { get; }

    /// <summary>WAL ফাইলগুলো SQLite নিজেই বানায়; এখানে শুধু ডায়াগনস্টিক ও ব্যাকআপ সরানোর জন্য।</summary>
    public string DatabaseWal => Database + "-wal";
    public string DatabaseShm => Database + "-shm";

    public string QueueRoot { get; }

    /// <summary>
    /// .webp বাইটগুলো এখানে, DB-র ভেতরে নয়।
    ///
    /// ⚠️ ছবি BLOB হিসেবে সারিতে রাখলে ২০০ KB × দিনে ৮৬৪টা ছবি DB-কে দিনে ১৭০ MB
    /// করে ফোলাত, আর প্রতিটা DELETE-এর পরে ওই পেজগুলো ফাইলের ভেতরে ফাঁকা পড়ে
    /// থাকত — VACUUM ছাড়া ডিস্ক ফেরত আসে না, আর VACUUM-এর সময় পুরো DB লক হয়।
    /// আলাদা ফাইল রাখলে মোছা মানেই সঙ্গে সঙ্গে জায়গা ফেরত।
    /// </summary>
    public string ScreenshotQueue { get; }

    public string Logs { get; }
    public string Updates { get; }
    public string State { get; }

    /// <summary>প্রসেসে একবারই হিসাব হয় — প্রতিবার ডিস্ক প্রোব করা হয় না।</summary>
    public static OutboxPaths Default => _default ??= Resolve();

    /// <summary>টেস্ট বা ভিন্ন রুট চাপিয়ে দেওয়ার জন্য (যাচাই ছাড়াই)।</summary>
    public static OutboxPaths ForRoot(string root) =>
        new(Path.GetFullPath(root), isFallback: false, resolutionNote: "explicit root");

    /// <summary>
    /// রুট বাছাই। ⚠️ কখনো throw করে না — স্টার্টআপে পাথ ঠিক করতে গিয়ে প্রসেস মরলে
    /// এজেন্ট চিরকাল ক্র্যাশ-লুপে থাকত আর কেউ টেরও পেত না।
    /// </summary>
    public static OutboxPaths Resolve()
    {
        var programData = SafeFolder(Environment.SpecialFolder.CommonApplicationData);
        if (programData is not null)
        {
            var root = Path.Combine(programData, AppFolderName);
            if (TryPrepare(root, out var why))
                return new OutboxPaths(root, isFallback: false, $"%ProgramData%\\{AppFolderName}");

            var localAppData = SafeFolder(Environment.SpecialFolder.LocalApplicationData);
            if (localAppData is not null)
            {
                var alt = Path.Combine(localAppData, AppFolderName);
                if (TryPrepare(alt, out _))
                {
                    return new OutboxPaths(alt, isFallback: true,
                        $"%LOCALAPPDATA%\\{AppFolderName} — ProgramData was not writable ({why})");
                }
            }

            // দুটোই ব্যর্থ: তবু ProgramData-র পাথটাই ফেরত দিই, যাতে লগে আসল
            // পাথ আর আসল কারণ দেখা যায়। স্টোর খুলতে গিয়ে পরিষ্কার এরর দেবে।
            return new OutboxPaths(root, isFallback: false, $"⚠️ nowhere is writable ({why})");
        }

        // SpecialFolder খালি স্ট্রিং দিলে (অস্বাভাবিক, তবু) — অন্তত temp-এ চলুক
        var temp = Path.Combine(Path.GetTempPath(), AppFolderName);
        return new OutboxPaths(temp, isFallback: true, "⚠️ temp — SpecialFolder was not available");
    }

    /// <summary>সব ফোল্ডার বানিয়ে নেওয়া। বারবার ডাকা নিরাপদ।</summary>
    public void EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(QueueRoot);
        Directory.CreateDirectory(ScreenshotQueue);
        Directory.CreateDirectory(Logs);
        Directory.CreateDirectory(Updates);
        Directory.CreateDirectory(State);
    }

    /// <summary>
    /// একটা স্ক্রিনশটের গন্তব্য। ফোল্ডার তৈরি করেই দেয়।
    ///
    /// তারিখ ধরে সাবফোল্ডার কেন: সাত দিনে ২৮৮ স্লট × ৩ মনিটর ≈ ৬,০০০ ফাইল।
    /// এক ফোল্ডারে রাখলেও NTFS সামলাবে, কিন্তু অনাথ-ফাইল ঝাড়ু দিতে গিয়ে প্রতিবার
    /// পুরো তালিকা পড়তে হতো; তারিখে ভাগ থাকলে পুরোনো দিনের ফোল্ডার খালি হলেই
    /// পুরোটা একবারে সরিয়ে দেওয়া যায়।
    ///
    /// ⚠️ ফোল্ডার/ফাইলের নাম UTC ধরে — লোকাল সময় নিলে ঘড়ি পেছালে বা DST-জাতীয়
    /// লাফে একই নাম দুবার আসতে পারত। তার ওপরেও নামের ভেতরে
    /// <paramref name="clientUuid"/> আছে, তাই সংঘর্ষ অসম্ভব।
    /// </summary>
    public string NewScreenshotPath(DateTimeOffset slotStart, int monitorIndex, Guid clientUuid)
    {
        var utc = slotStart.UtcDateTime;
        var dayDir = Path.Combine(ScreenshotQueue, utc.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(dayDir);

        var name = $"{utc:HHmmss}-m{monitorIndex}-{clientUuid:N}.webp";
        return Path.Combine(dayDir, name);
    }

    /// <summary>
    /// A06 — ওই ছবির ৩২০px থাম্বনেইল কোথায় থাকবে।
    ///
    /// ⭐ <b>নিয়মটার একমাত্র সংজ্ঞা এখানেই।</b> চারটে জায়গা এই পথটা জানে —
    /// লেখা (AgentHost), পাঠানো (HttpSyncClient), মোছা (DeleteFiles), আর
    /// অনাথ-ঝাড়ু (SweepOrphanFiles)। যেকোনো একটা আলাদা নিয়ম মানলে হয়
    /// থাম্বনেইল কখনো যেত না, নয়তো ঝাড়ুদার সব থাম্বনেইল <b>মুছে দিত</b>।
    ///
    /// ⚠️ শেষটা <c>.webp</c>-ই রাখা হয়েছে যাতে ঝাড়ুদারের <c>*.webp</c>
    /// প্যাটার্নে ধরা পড়ে — অনাথ ছবির থাম্বনেইলও যেন পড়ে না থাকে।
    /// </summary>
    public static string ThumbPathFor(string webpPath) =>
        Path.ChangeExtension(webpPath, null) + "-thumb.webp";

    /// <summary>
    /// খালি হয়ে যাওয়া তারিখ-ফোল্ডার সরানো। ফেরত দেয় কতগুলো গেল।
    /// ব্যর্থতা গিলে ফেলা হয় — ফোল্ডার সাফ করতে গিয়ে ট্র্যাকিং থামানোর মানে হয় না।
    /// </summary>
    public int PruneEmptyScreenshotFolders()
    {
        var removed = 0;
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(ScreenshotQueue))
            {
                try
                {
                    if (Directory.EnumerateFileSystemEntries(dir).Any()) continue;
                    Directory.Delete(dir);
                    removed++;
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        catch (DirectoryNotFoundException) { }
        catch (UnauthorizedAccessException) { }

        return removed;
    }

    /// <summary>
    /// ফোল্ডারটা সত্যিই লেখা যায় কি না — <c>Directory.CreateDirectory</c> সফল হওয়া
    /// যথেষ্ট প্রমাণ নয়, কারণ ফোল্ডার আগে থেকেই থাকলে ওটা কিছু না করেই সফল হয়
    /// যদিও আমাদের লেখার অনুমতি নেই। তাই সত্যিকারের একটা ফাইল লিখে দেখা হয়।
    /// </summary>
    private static bool TryPrepare(string root, out string why)
    {
        try
        {
            Directory.CreateDirectory(root);

            var probe = Path.Combine(root, ProbeFileName);
            File.WriteAllBytes(probe, []);
            File.Delete(probe);

            why = "";
            return true;
        }
        // ⚠️ সব ব্যতিক্রম ধরা হচ্ছে ইচ্ছাকৃতভাবে। এখানে SecurityException,
        // PathTooLongException, ফিল্টার-ড্রাইভারের অদ্ভুত IOException — যেকোনো
        // কিছুই আসতে পারে, আর স্টার্টআপে পাথ বাছতে গিয়ে প্রসেস মরলে মেশিনটা
        // চিরকাল ক্র্যাশ-লুপে থাকত। উত্তর একটাই দরকার: "এখানে লেখা যায় কি না"।
        catch (Exception ex)
        {
            why = $"{ex.GetType().Name}: {ex.Message}";
            return false;
        }
    }

    private static string? SafeFolder(Environment.SpecialFolder folder)
    {
        try
        {
            var path = Environment.GetFolderPath(folder);
            return string.IsNullOrWhiteSpace(path) ? null : path;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
