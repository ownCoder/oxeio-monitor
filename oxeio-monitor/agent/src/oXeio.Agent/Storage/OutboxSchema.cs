using System.Runtime.Versioning;

using Microsoft.Data.Sqlite;

using oXeio.Core.Agent;

namespace oXeio.Agent.Storage;

/// <summary>
/// ⭐ আউটবক্সের SQL — স্কিমা, মাইগ্রেশন আর pragma। ORM নেই, মাইগ্রেশন ফ্রেমওয়ার্কও নেই।
///
/// <b>কেন হাতে-লেখা SQL:</b> এখানে একটাই টেবিল আর সাতটা কোয়েরি। EF Core আনলে
/// ~৩ MB নির্ভরতা, স্টার্টআপে model building, আর মাইগ্রেশন ইতিহাসের নিজস্ব টেবিল
/// যোগ হতো — যার প্রত্যেকটাই ঠিক ওই মুহূর্তে ভাঙার সুযোগ পায় যখন মেশিন সাত দিন
/// অফলাইন থেকে ফিরেছে আর হাতে এক সপ্তাহের বেতনের ডেটা।
///
/// <b>মাইগ্রেশন:</b> <c>PRAGMA user_version</c> — SQLite ফাইল-হেডারের ভেতরের
/// একটা পূর্ণসংখ্যা। আলাদা টেবিল লাগে না, আর এটা ট্রানজেকশনের অংশ, তাই
/// "স্কিমা বদলাল কিন্তু ভার্সন বাড়ল না" অবস্থা তৈরি হতে পারে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class OutboxSchema
{
    /// <summary>
    /// এই বিল্ড যে স্কিমা বোঝে। নতুন কলাম যোগ করলে এটা বাড়িয়ে
    /// <see cref="Migrate"/>-এ একটা নতুন <c>if (from &lt; N)</c> ধাপ লিখুন।
    /// ⚠️ পুরোনো ধাপগুলো কখনো বদলাবেন না — মাঠে থাকা মেশিন যেকোনো ভার্সন থেকে
    /// শুরু করতে পারে।
    /// </summary>
    public const int Version = 1;

    /// <summary>
    /// ⚠️ AUTOINCREMENT ইচ্ছাকৃত, আর এটাই এই টেবিলের সবচেয়ে জরুরি সিদ্ধান্ত।
    ///
    /// সাধারণ INTEGER PRIMARY KEY-তে SQLite নতুন rowid দেয় "এখনকার সর্বোচ্চ + ১"।
    /// অর্থাৎ সারি মুছে ফেলার পর <b>আইডি আবার ব্যবহার হয়</b>। আমরা আপলোডের ক্রম
    /// row_id দিয়েই ঠিক করি, তাই আইডি পুনর্ব্যবহার হলে পুরোনো ডেটা নতুন ডেটার
    /// পেছনে চলে যেত আর সাত দিনের ব্যাকলগ এলোমেলো ক্রমে যেত।
    /// AUTOINCREMENT sqlite_sequence-এ সর্বোচ্চ মান মনে রাখে — কখনো পিছোয় না।
    ///
    /// ⚠️ সময় INTEGER (unix ms, UTC) হিসেবে জমা, টেক্সট নয়। ISO-8601 টেক্সটে
    /// অফসেট থাকে (+06:00), আর লেক্সিকোগ্রাফিক তুলনায় "+06:00"-এর ২টা সময়
    /// "+00:00"-এর সময়ের সাথে ভুলভাবে মেলে — <c>not_before</c>-এর তুলনা তখন
    /// নীরবে ভুল হতো আর রিট্রাই হয় খুব আগে নয় খুব পরে চলত।
    ///
    /// kind টেক্সট হিসেবে (<see cref="OutboundKind"/>-এর মন্তব্য দেখুন): সংখ্যা
    /// জমালে ভবিষ্যতে enum-এর মাঝখানে সদস্য যোগ করলেই পুরোনো সারি ভুল endpoint-এ যেত।
    /// </summary>
    private const string CreateV1 = """
        CREATE TABLE IF NOT EXISTS outbox (
            row_id            INTEGER PRIMARY KEY AUTOINCREMENT,
            client_uuid       TEXT    NOT NULL,
            kind              TEXT    NOT NULL,
            enqueued_at_ms    INTEGER NOT NULL,
            payload           TEXT    NOT NULL,
            file_path         TEXT    NULL,
            size_bytes        INTEGER NOT NULL,
            attempts          INTEGER NOT NULL DEFAULT 0,
            not_before_ms     INTEGER NULL,
            lease_id          TEXT    NULL,
            lease_expires_ms  INTEGER NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_uuid
            ON outbox(client_uuid);

        CREATE INDEX IF NOT EXISTS ix_outbox_pending
            ON outbox(kind, row_id)
            WHERE lease_id IS NULL;

        CREATE INDEX IF NOT EXISTS ix_outbox_leased
            ON outbox(lease_expires_ms)
            WHERE lease_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS ix_outbox_kind
            ON outbox(kind);
        """;

    /// <summary>
    /// লেখার কানেকশনের pragma। ⚠️ ক্রম গুরুত্বপূর্ণ:
    /// <c>auto_vacuum</c> শুধু <b>টেবিল তৈরির আগে</b> বদলানো যায় (নইলে পুরো VACUUM লাগে),
    /// আর <c>journal_mode</c> ট্রানজেকশনের ভেতরে বদলানো যায় না।
    ///
    /// <b>WAL কেন:</b> লেখা চলাকালীন পড়া আটকায় না। tray থ্রেড প্রতি কয়েক সেকেন্ডে
    /// কিউর গভীরতা পড়ে; rollback-journal মোডে ওই পড়াটা সিঙ্ক ওয়ার্কারের লেখার
    /// সাথে ধাক্কা খেয়ে "database is locked" দিত।
    ///
    /// <b>অপরিচ্ছন্ন শাটডাউনে WAL-এর কী হয়:</b> <c>outbox.db-wal</c> আর
    /// <c>-shm</c> ডিস্কে পড়ে থাকে। পরের বার যে কানেকশন DB খোলে সে-ই রিকভারি
    /// চালায়: WAL-এর ফ্রেমগুলো পড়ে, প্রতিটার চেকসাম যাচাই করে, আর <b>শেষ বৈধ
    /// commit রেকর্ড পর্যন্ত</b> রিপ্লে করে; তার পরের আধা-লেখা ফ্রেম চুপচাপ বাদ যায়।
    /// ফলে DB কখনো আধা-লেখা অবস্থায় থাকে না। ⚠️ তাই ক্র্যাশের পর -wal ফাইল
    /// হাতে মুছে দেওয়া চলবে না — ওটা মোছা মানে commit হয়ে যাওয়া ট্রানজেকশন
    /// ফেলে দেওয়া (এবং তার সাথে জমা হওয়া ঘণ্টা)।
    ///
    /// <b>synchronous=FULL কেন, NORMAL নয়:</b> WAL + NORMAL-এ প্রতি commit-এ
    /// fsync হয় না, শুধু checkpoint-এ হয়। তাতে DB কখনো নষ্ট হয় না ঠিকই, কিন্তু
    /// <b>পাওয়ার চলে গেলে শেষ কয়েকটা commit হারায়</b>। আমাদের লেখার হার মিনিটে
    /// একটা ছোট সারি — অর্থাৎ fsync-এর দাম এখানে অদৃশ্য (অপারেটিং প্রোফাইল
    /// পরিষ্কার বলছে থ্রুপুট অপ্রাসঙ্গিক), অথচ হারানো commit মানে হারানো বেতন।
    /// দামটা যেখানে শূন্যের কাছাকাছি সেখানে টেকসইতা কেনাই ঠিক।
    ///
    /// <c>wal_autocheckpoint=256</c> (~১ MB): WAL ছোট রাখে, যাতে ক্র্যাশ-রিকভারিতে
    /// রিপ্লে করার মতো কিছু কম থাকে আর ডিস্কেও বাড়তি ফাইল বড় না হয়।
    /// </summary>
    private static readonly string[] WritePragmas =
    [
        // ⚠️ লক পেলে সঙ্গে সঙ্গে হাল ছাড়া নয় — ব্যাকআপ সফটওয়্যার বা AV
        // মুহূর্তের জন্য ফাইল ধরে রাখতে পারে।
        "PRAGMA busy_timeout = 10000;",
        "PRAGMA journal_mode = WAL;",
        "PRAGMA synchronous = FULL;",
        "PRAGMA wal_autocheckpoint = 256;",
        "PRAGMA temp_store = MEMORY;",
        // নতুন DB-তেই কেবল কার্যকর; পুরোনোতে নিঃশব্দে উপেক্ষিত হয়।
        "PRAGMA auto_vacuum = INCREMENTAL;",
    ];

    /// <summary>
    /// পড়ার কানেকশন। <c>query_only</c> দিয়ে গ্যারান্টি — tray-র পথ থেকে
    /// ভুল করেও একটা বাইট লেখা যাবে না, তাই লেখার কানেকশনের সাথে কখনো
    /// রাইট-লক নিয়ে টানাটানি হবে না।
    ///
    /// ⚠️ কানেকশনটা <c>Mode=ReadOnly</c> করা হয়নি ইচ্ছাকৃতভাবে: WAL ডাটাবেসে
    /// শুধু-পড়া কানেকশনকেও <c>-shm</c> শেয়ার্ড-মেমরি ফাইলে লিখতে হয়; ফাইলটা
    /// আগে থেকে না থাকলে ReadOnly কানেকশন সেটা বানাতে পারে না আর
    /// SQLITE_CANTOPEN দিয়ে ব্যর্থ হয়। তাই কানেকশন read-write, কিন্তু আচরণ
    /// pragma দিয়ে শুধু-পড়ায় বাঁধা।
    /// </summary>
    private static readonly string[] ReadPragmas =
    [
        "PRAGMA busy_timeout = 5000;",
        "PRAGMA temp_store = MEMORY;",
        "PRAGMA query_only = ON;",
    ];

    public static void ApplyWritePragmas(SqliteConnection conn)
    {
        foreach (var pragma in WritePragmas) Execute(conn, pragma);

        // journal_mode ফেরত মান দেয়; WAL না পেলে জানা দরকার — নেটওয়ার্ক ড্রাইভে
        // বা কিছু ফিল্টার-ড্রাইভারে WAL পাওয়া যায় না আর SQLite চুপচাপ delete-journal
        // মোডে থেকে যায়।
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode;";
        JournalMode = cmd.ExecuteScalar() as string ?? "?";
    }

    public static void ApplyReadPragmas(SqliteConnection conn)
    {
        foreach (var pragma in ReadPragmas) Execute(conn, pragma);
    }

    /// <summary>শেষবার যা পাওয়া গেছে — স্টার্টআপ লগে দেখানোর জন্য ("wal" আশা করা হয়)।</summary>
    public static string JournalMode { get; private set; } = "?";

    /// <summary>
    /// স্কিমা এগিয়ে নেওয়া। ফেরত দেয় (আগের ভার্সন, এখনকার ভার্সন)।
    ///
    /// ⚠️ পুরো কাজটা একটাই ট্রানজেকশনে, আর <c>user_version</c>-ও সেই ট্রানজেকশনের
    /// ভেতরে বাড়ানো হয়। মাইগ্রেশনের মাঝপথে পাওয়ার গেলে হয় পুরোটা হয়েছে,
    /// নয় কিছুই হয়নি — "অর্ধেক মাইগ্রেট হওয়া" DB পরের বার খুললে চেনার উপায়ই থাকত না।
    /// </summary>
    public static (int From, int To) Migrate(SqliteConnection conn, Action<string> log)
    {
        var from = ReadUserVersion(conn);

        if (from == Version) return (from, Version);

        if (from > Version)
        {
            // ডাউনগ্রেড (নতুন এজেন্ট থেকে পুরোনোয় ফেরত)। থামিয়ে দিলে মেশিনটা
            // ডেটা জমানোই বন্ধ করত; কলামগুলো কেবল যোগ হয় বলে পুরোনো কোয়েরি
            // চলতে থাকার সম্ভাবনাই বেশি। তাই সরবে অভিযোগ করে এগিয়ে যাই।
            log($"⚠️ outbox schema is v{from}, but this build understands v{Version} — " +
                "the agent was probably downgraded. Carrying on.");
            return (from, from);
        }

        using var tx = conn.BeginTransaction();

        if (from < 1)
        {
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = CreateV1;
            cmd.ExecuteNonQuery();
        }

        // ভবিষ্যতের ধাপ এখানে:  if (from < 2) { ... ALTER TABLE outbox ADD COLUMN ... }

        using (var bump = conn.CreateCommand())
        {
            bump.Transaction = tx;
            // ⚠️ PRAGMA-তে প্যারামিটার বাঁধা যায় না; Version একটা const int,
            // তাই এখানে স্ট্রিং জোড়ায় ইনজেকশনের সুযোগ নেই।
            bump.CommandText = $"PRAGMA user_version = {Version};";
            bump.ExecuteNonQuery();
        }

        tx.Commit();
        return (from, Version);
    }

    public static int ReadUserVersion(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt32(cmd.ExecuteScalar() ?? 0);
    }

    /// <summary>
    /// ফাইলটা আদৌ পড়ার মতো কি না। ফেরত দেয় <c>"ok"</c> বা সমস্যার বর্ণনা।
    ///
    /// <c>quick_check</c> নেওয়া হয়েছে, পুরো <c>integrity_check</c> নয় — quick_check
    /// প্রতিটা পেজের গঠন যাচাই করে কিন্তু ইনডেক্সের বিষয়বস্তু মেলায় না, ফলে
    /// অনেক দ্রুত। আমাদের দরকার শুধু "ফাইলটা কি আবর্জনা?" — সেটা এতেই ধরা পড়ে।
    /// </summary>
    public static string QuickCheck(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA quick_check(1);";
        return cmd.ExecuteScalar() as string ?? "unknown";
    }

    private static void Execute(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}
