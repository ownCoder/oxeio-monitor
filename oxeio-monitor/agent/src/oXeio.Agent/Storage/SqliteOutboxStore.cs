using System.Runtime.Versioning;

using Microsoft.Data.Sqlite;

using oXeio.Core.Agent;

namespace oXeio.Agent.Storage;

/// <summary>
/// ⭐ <see cref="IOutboxStore"/>-এর SQLite বাস্তবায়ন — এক সপ্তাহের ইন্টারনেট
/// বিভ্রাটে অফিসের বেতনের হিসাব বাঁচবে কি না, সেটা এই ফাইলটাই ঠিক করে।
///
/// <b>lease/ack চক্রটা কোন ধাপে মরলে কী হয়</b> (প্রতিটা ধাপে kill করে ভাবুন):
/// <code>
/// ১. LeaseAsync  — সারি জায়গাতেই, শুধু lease_id বসল (এক ট্রানজেকশন)।
///                  এখন মরলে: সারি "ধার নেওয়া" অবস্থায় থাকে। পরের স্টার্টআপে
///                  সব লিজ ছেড়ে দেওয়া হয় → আবার আপলোড হবে। ক্ষতি নেই।
/// ২. HTTP POST   — মরলে: সার্ভার হয়তো লিখেছে, হয়তো লেখেনি। সারি টিকে আছে,
///                  তাই আবার যাবে; clientUuid-এ সার্ভার ডিডুপ করবে। ক্ষতি নেই।
/// ৩. AckAsync    — সারি DELETE + commit। commit-এর আগে মরলে ধাপ ২-এর মতোই।
///                  commit-এর পরে, .webp মোছার আগে মরলে ফাইলটা অনাথ হয় —
///                  <see cref="SweepOrphanFilesAsync"/> পরের স্টার্টআপে তুলে নেয়।
/// </code>
/// অর্থাৎ কোনো ধাপেই ডেটা <b>হারায় না</b>; সবচেয়ে খারাপ ফল হলো একবার বাড়তি
/// পাঠানো, যেটার দাম শূন্য (§ IOutboxStore-এর ডক)।
///
/// <b>থ্রেডিং:</b> দুটো কানেকশন।
/// <list type="bullet">
/// <item><b>লেখার</b> কানেকশন একটাই, আর <see cref="_writeGate"/> (SemaphoreSlim)
/// সেটাকে একবারে একজনের হাতে রাখে। ট্র্যাকিং থ্রেড Enqueue করে আর সিঙ্ক ওয়ার্কার
/// lease/ack করে — SQLite কানেকশন অবজেক্ট থ্রেড-সেফ নয়, তাই এই গেটটা
/// আলোচনার বিষয় নয়, বাধ্যতামূলক।</item>
/// <item><b>পড়ার</b> কানেকশন আলাদা, <see cref="_readGate"/>-এ। tray প্রতি কয়েক
/// সেকেন্ডে গভীরতা চায়; একই গেটে ফেললে ৫০০ সারির একটা ব্যাচ-ইনসার্টের পেছনে
/// tray আটকে থাকত। WAL-এ পড়া আর লেখা একসাথে চলে, তাই আলাদা কানেকশন মানেই
/// tray কখনো লেখার জন্য অপেক্ষা করে না।</item>
/// </list>
/// গেট দুটো <c>async</c>, তাই অপেক্ষা করতে গিয়ে কোনো থ্রেড ব্লক হয় না।
///
/// ⚠️ ভেতরে সিঙ্ক্রোনাস ADO.NET কল ব্যবহার করা হয়েছে (<c>ExecuteReader</c>,
/// <c>ExecuteNonQuery</c>) — ইচ্ছাকৃত। SQLite-এ সত্যিকারের অ্যাসিঙ্ক I/O নেই;
/// <c>ExecuteNonQueryAsync</c> ভেতরে ওই একই ব্লকিং কলই করে, শুধু একটা বাড়তি
/// state machine জুড়ে দেয়। বাইরের API অ্যাসিঙ্ক রাখা হয়েছে ইন্টারফেসের জন্য
/// আর গেটে অপেক্ষাটা সত্যিই অ্যাসিঙ্ক বলে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SqliteOutboxStore : IOutboxStore
{
    /// <summary>একই এররের লগ কত ঘন ঘন। ডিস্ক ভরে গেলে সেকেন্ডে একবার লিখে ডিস্ক আরও ভরানো চলবে না।</summary>
    private static readonly TimeSpan ErrorLogWindow = TimeSpan.FromMinutes(1);

    /// <summary>লিজ চাওয়ার সময় ভুল করে ০ বা ঋণাত্মক দিলে এটাই ধরা হয়।</summary>
    private static readonly TimeSpan DefaultLeaseFor = TimeSpan.FromMinutes(5);

    /// <summary>ড্রপ-লগে সর্বোচ্চ কতটা সারি ধরে ধরে লেখা হবে; এর বেশি হলে শুধু সারাংশ।</summary>
    private const int MaxDropLogLines = 50;

    private readonly SqliteConnection _write;
    private readonly SqliteConnection _read;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _readGate = new(1, 1);
    private readonly Action<string> _log;
    private readonly DropLog _drops;

    private DateTimeOffset _lastWriteErrorLoggedAt = DateTimeOffset.MinValue;
    private int _evictionsSinceVacuum;
    private bool _disposed;

    private SqliteOutboxStore(
        OutboxPaths paths, SqliteConnection write, SqliteConnection read,
        Action<string> log, DropLog drops)
    {
        Paths = paths;
        _write = write;
        _read = read;
        _log = log;
        _drops = drops;
    }

    /// <summary>স্ক্রিনশট লেখার মডিউল এখান থেকেই গন্তব্য পাথ নেবে — নিজে ফোল্ডার বানাবে না।</summary>
    public OutboxPaths Paths { get; }

    /// <summary>
    /// শেষবার লেখা ব্যর্থ হওয়ার কারণ (সাধারণত ডিস্ক ভরা), না হলে null।
    /// সিঙ্ক ওয়ার্কার এটা দেখে তখনই একটা ছাঁটাই-পাস চালাতে পারে, আর tray
    /// স্বাস্থ্য "Degraded" দেখাতে পারে।
    /// </summary>
    public string? LastWriteError { get; private set; }

    public DateTimeOffset? LastWriteErrorAt { get; private set; }

    /// <summary>ড্রপ-লগের পাথ — স্টার্টআপে একবার দেখিয়ে দেওয়ার জন্য।</summary>
    public string DropLogPath => _drops.FilePath;

    // ── খোলা ────────────────────────────────────────────────────────────────

    /// <summary>
    /// আউটবক্স খোলা। স্টার্টআপে একবার। সিঙ্ক্রোনাস, কারণ এর পরে আর কিছুই
    /// শুরু হতে পারে না — অ্যাসিঙ্ক করলে শুধু ভান হতো।
    ///
    /// ⚠️ ফাইলটা নষ্ট থাকলে (পাওয়ার-লস-এর সময় ফাইল সিস্টেম নিজেই ভুল লিখেছে,
    /// বা AV ফাইলটা কেটে দিয়েছে) এখানে ব্যতিক্রম ছুড়ে দিলে এজেন্ট প্রতিবার
    /// চালু হয়ে সঙ্গে সঙ্গে মরত — অর্থাৎ ওই মেশিন <b>চিরতরে</b> ট্র্যাকিং হারাত।
    /// তাই নষ্ট ফাইল পাশে সরিয়ে রেখে নতুন DB বানানো হয়: যা জমেছিল তা যায়
    /// (এবং সেটা ড্রপ-লগে লেখা থাকে), কিন্তু কাল থেকে হিসাব আবার চলে।
    /// </summary>
    public static SqliteOutboxStore Open(OutboxPaths? paths = null, Action<string>? log = null)
    {
        paths ??= OutboxPaths.Default;
        var write = log ?? new Action<string>(_ => { });

        paths.EnsureCreated();
        var drops = new DropLog(paths.Logs);

        if (paths.IsFallback)
        {
            write($"⚠️ আউটবক্স {paths.Root}-এ ({paths.ResolutionNote}) — প্রোফাইল মুছলে কিউ হারাবে");
        }

        QuarantineIfCorrupt(paths, write, drops);

        var writeConn = OpenConnection(paths.Database);
        OutboxSchema.ApplyWritePragmas(writeConn);

        var (from, to) = OutboxSchema.Migrate(writeConn, write);
        if (from != to) write($"outbox স্কিমা v{from} → v{to}");

        var readConn = OpenConnection(paths.Database);
        OutboxSchema.ApplyReadPragmas(readConn);

        var store = new SqliteOutboxStore(paths, writeConn, readConn, write, drops);

        store.ReclaimAllLeases();
        store.PurgeUnknownKinds();

        var depth = ReadDepth(writeConn);
        write($"outbox: {paths.Database} (journal={OutboxSchema.JournalMode}) — " +
              $"সারি {depth.Total}টি, {depth.BytesTotal / 1024.0 / 1024.0:F1} MB");

        return store;
    }

    private static SqliteConnection OpenConnection(string dbPath)
    {
        // ⚠️ Pooling বন্ধ। কানেকশন দুটো প্রসেসের আয়ু জুড়ে খোলা থাকে, তাই পুলে
        // কোনো লাভ নেই; উল্টো Dispose-এর পরেও পুল ফাইলটা ধরে রাখত আর নষ্ট DB
        // পাশে সরানোর সময় "file in use" দিত।
        var cs = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
            DefaultTimeout = 30,
        }.ToString();

        var conn = new SqliteConnection(cs);
        conn.Open();
        return conn;
    }

    /// <summary>
    /// খোলার আগে একবার স্বাস্থ্য পরীক্ষা। নষ্ট হলে DB (এবং তার -wal/-shm)
    /// পাশে সরিয়ে রাখা হয় — মুছে ফেলা হয় না, কারণ পরে হাতে উদ্ধারের সুযোগ
    /// রাখাটাই সস্তা।
    /// </summary>
    private static void QuarantineIfCorrupt(OutboxPaths paths, Action<string> log, DropLog drops)
    {
        if (!File.Exists(paths.Database)) return;

        string verdict;
        try
        {
            using var probe = OpenConnection(paths.Database);
            verdict = OutboxSchema.QuickCheck(probe);
        }
        catch (SqliteException ex)
        {
            verdict = $"SQLite {ex.SqliteErrorCode}: {ex.Message}";
        }
        catch (InvalidOperationException ex)
        {
            verdict = ex.Message;
        }

        if (verdict == "ok") return;

        var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
        var moved = 0;
        foreach (var file in new[] { paths.Database, paths.DatabaseWal, paths.DatabaseShm })
        {
            try
            {
                if (!File.Exists(file)) continue;
                File.Move(file, $"{file}.corrupt-{stamp}", overwrite: true);
                moved++;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        var line = $"CORRUPT\tডাটাবেস নষ্ট ({verdict}) — {moved}টি ফাইল পাশে সরানো হলো, " +
                   "নতুন খালি আউটবক্স তৈরি হচ্ছে। জমে থাকা সব সারি এখানেই শেষ।";
        drops.Write(line);
        log("⚠️ " + line);
    }

    // ── জমা ─────────────────────────────────────────────────────────────────

    private const string InsertSql = """
        INSERT INTO outbox (client_uuid, kind, enqueued_at_ms, payload, file_path, size_bytes)
        VALUES ($uuid, $kind, $at, $payload, $file, $size)
        ON CONFLICT(client_uuid) DO NOTHING;
        """;

    /// <summary>
    /// ⚠️ এখানে <paramref name="ct"/> ইচ্ছাকৃতভাবে গেটে দেওয়া হয় না।
    /// শাটডাউনের টোকেন বাতিল হয়ে গেলে যদি Enqueue ছুড়ে দিত, তাহলে ঠিক
    /// বন্ধ হওয়ার মুহূর্তে তৈরি হওয়া সেগমেন্টগুলো — অর্থাৎ যেগুলো সবচেয়ে নতুন
    /// আর কেবল RAM-এ আছে — চিরতরে হারাত। গেটটা কয়েক মিলিসেকেন্ডের বেশি ধরা
    /// থাকে না, তাই অপেক্ষা করে লিখে ফেলাই নিরাপদ।
    ///
    /// ব্যর্থ হলে ফেরত দেয় <c>-1</c>, ছুড়ে দেয় না (ডিস্ক ভরার আচরণ, নিচে দেখুন)।
    /// </summary>
    public async Task<long> EnqueueAsync(OutboxItem item, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        ThrowIfDisposed();

        await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            using var cmd = _write.CreateCommand();
            cmd.CommandText = InsertSql;
            AddInsertParameters(cmd, item);

            var changed = cmd.ExecuteNonQuery();
            ClearWriteError();

            if (changed > 0) return LastRowId();

            // ON CONFLICT DO NOTHING — একই clientUuid আগেই সারিতে আছে।
            // এটা ব্যর্থতা নয়, বরং কাম্য: প্রোডিউসার ক্র্যাশ করে একই রেকর্ড
            // আবার জমা দিলে দুটো কপি ডিস্ক খায়, অথচ সার্ভার শেষমেশ একটাই রাখে।
            return FindRowIdByUuid(item.ClientUuid);
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 1, item.Kind);
            return -1;
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// এক ট্রানজেকশনে অনেকগুলো। ব্যর্থ হলে ফেরত দেয় <c>0</c> — অর্ধেক ঢোকা
    /// ব্যাচ কখনো তৈরি হয় না (ইন্টারফেসের শর্ত)।
    /// </summary>
    public async Task<int> EnqueueManyAsync(IReadOnlyList<OutboxItem> items, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(items);
        ThrowIfDisposed();
        if (items.Count == 0) return 0;

        await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            using var tx = _write.BeginTransaction();
            using var cmd = _write.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = InsertSql;

            // প্যারামিটার একবারই তৈরি, তারপর শুধু মান বদলানো — ৫০০ বার
            // নতুন কমান্ড বানালে ৫০০ বার SQL প্রস্তুত করতে হতো।
            var pUuid = cmd.Parameters.AddWithValue("$uuid", "");
            var pKind = cmd.Parameters.AddWithValue("$kind", "");
            var pAt = cmd.Parameters.AddWithValue("$at", 0L);
            var pPayload = cmd.Parameters.AddWithValue("$payload", "");
            var pFile = cmd.Parameters.AddWithValue("$file", DBNull.Value);
            var pSize = cmd.Parameters.AddWithValue("$size", 0L);

            var inserted = 0;
            foreach (var item in items)
            {
                pUuid.Value = item.ClientUuid.ToString("D");
                pKind.Value = item.Kind.ToString();
                pAt.Value = ToMs(item.EnqueuedAt);
                pPayload.Value = item.Payload;
                pFile.Value = (object?)item.FilePath ?? DBNull.Value;
                pSize.Value = item.SizeBytes;

                inserted += cmd.ExecuteNonQuery();
            }

            tx.Commit();
            ClearWriteError();
            return inserted;
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, items.Count, items[0].Kind);
            return 0;
        }
        finally
        {
            _writeGate.Release();
        }
    }

    // ── ধার নেওয়া ───────────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ ক্রম <c>row_id</c> ধরে, <c>enqueued_at_ms</c> ধরে নয় — যদিও ইন্টারফেস
    /// বলেছে "পুরোনো আগে"। কারণ: ইউজার (বা NTP) ঘড়ি পিছিয়ে দিলে পরে তৈরি
    /// হওয়া সারির টাইমস্ট্যাম্প আগের সারির চেয়ে ছোট হয়ে যায়, আর তখন সময় ধরে
    /// সাজালে ব্যাকলগ এলোমেলো ক্রমে সার্ভারে যেত। row_id (AUTOINCREMENT) হলো
    /// খাঁটি সন্নিবেশ-ক্রম, যা কোনো ঘড়ির উপর নির্ভর করে না — ব্যবহারিকভাবে
    /// সেটাই "পুরোনো আগে"-র সঠিক সংজ্ঞা।
    /// </summary>
    public async Task<OutboxLease?> LeaseAsync(
        OutboundKind kind, int maxItems, TimeSpan leaseFor, DateTimeOffset now,
        CancellationToken ct = default)
    {
        ThrowIfDisposed();
        if (maxItems <= 0) return null;
        if (maxItems > SyncLimits.MaxBatchSize) maxItems = SyncLimits.MaxBatchSize;
        if (leaseFor <= TimeSpan.Zero) leaseFor = DefaultLeaseFor;

        await _writeGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var leaseId = Guid.NewGuid();
            var expiresAt = now + leaseFor;

            using var tx = _write.BeginTransaction();

            var entries = new List<OutboxEntry>(Math.Min(maxItems, 64));
            using (var sel = _write.CreateCommand())
            {
                sel.Transaction = tx;
                sel.CommandText = """
                    SELECT row_id, client_uuid, kind, enqueued_at_ms, payload,
                           file_path, size_bytes, attempts
                    FROM outbox
                    WHERE kind = $kind
                      AND lease_id IS NULL
                      AND (not_before_ms IS NULL OR not_before_ms <= $now)
                    ORDER BY row_id
                    LIMIT $max;
                    """;
                sel.Parameters.AddWithValue("$kind", kind.ToString());
                sel.Parameters.AddWithValue("$now", ToMs(now));
                sel.Parameters.AddWithValue("$max", maxItems);

                using var reader = sel.ExecuteReader();
                while (reader.Read())
                {
                    entries.Add(new OutboxEntry
                    {
                        RowId = reader.GetInt64(0),
                        ClientUuid = ParseGuid(reader.GetString(1)),
                        Kind = kind,
                        EnqueuedAt = FromMs(reader.GetInt64(3)),
                        Payload = reader.GetString(4),
                        FilePath = reader.IsDBNull(5) ? null : reader.GetString(5),
                        SizeBytes = reader.GetInt64(6),
                        Attempts = reader.GetInt32(7),
                    });
                }
            }

            if (entries.Count == 0)
            {
                // commit করা হয়নি — using dispose নিজেই rollback করবে।
                return null;
            }

            using (var upd = _write.CreateCommand())
            {
                upd.Transaction = tx;
                // "AND lease_id IS NULL" বাড়তি সুরক্ষা: একই ট্রানজেকশনের ভেতরে
                // অবস্থা বদলানোর কথা নয়, কিন্তু শর্তটা রাখলে কোনো অবস্থাতেই
                // অন্যের লিজ ছিনিয়ে নেওয়া সম্ভব হয় না।
                upd.CommandText = """
                    UPDATE outbox
                       SET lease_id = $lid, lease_expires_ms = $exp
                     WHERE row_id = $id AND lease_id IS NULL;
                    """;
                var pId = upd.Parameters.AddWithValue("$id", 0L);
                upd.Parameters.AddWithValue("$lid", leaseId.ToString("D"));
                upd.Parameters.AddWithValue("$exp", ToMs(expiresAt));

                foreach (var entry in entries)
                {
                    pId.Value = entry.RowId;
                    upd.ExecuteNonQuery();
                }
            }

            tx.Commit();
            ClearWriteError();

            return new OutboxLease
            {
                LeaseId = leaseId,
                Kind = kind,
                Entries = entries,
                ExpiresAt = expiresAt,
            };
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 0, kind);
            return null;
        }
        finally
        {
            _writeGate.Release();
        }
    }

    // ── লিজ শেষ করা ─────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public Task AckAsync(Guid leaseId, CancellationToken ct = default) =>
        CompleteLeaseAsync(leaseId, reason: null);

    /// <inheritdoc/>
    public Task AbandonAsync(Guid leaseId, string reason, CancellationToken ct = default) =>
        CompleteLeaseAsync(leaseId, string.IsNullOrWhiteSpace(reason) ? "(কারণ দেওয়া হয়নি)" : reason);

    /// <summary>
    /// ack আর abandon-এর SQL এক — পার্থক্য শুধু ড্রপ-লগে। এক জায়গায় রাখা
    /// হয়েছে যাতে ভবিষ্যতে একটার ফাইল-মোছা ঠিক করে অন্যটার ভুলে যাওয়া না হয়।
    ///
    /// <b>ক্রম:</b> আগে সারি DELETE + commit, <b>তারপর</b> ফাইল আনলিংক।
    /// উল্টোটা করলে (আগে ফাইল) commit-এর আগে মরলে সারিটা এমন একটা ফাইল
    /// দেখাত যা নেই, আর পরের আপলোড "file missing" বলে Permanent হয়ে ড্রপ-লগে
    /// মিথ্যা বিপদসংকেত লিখত — অথচ ডেটা তো সার্ভারে পৌঁছেই গেছে।
    /// এই ক্রমে সবচেয়ে খারাপ ফল একটাই অনাথ .webp, আর সেটা
    /// <see cref="SweepOrphanFilesAsync"/> তুলে নেয়।
    ///
    /// ⚠️ <c>ct</c> নেওয়া হয় না: এই কলটা মানে সার্ভার ইতিমধ্যেই ডেটা নিয়ে
    /// নিয়েছে। শাটডাউনে বাতিল করলে সারিগুলো থেকে যেত আর পরের বার পুরোটা
    /// আবার পাঠানো হতো — নিরীহ, কিন্তু অকারণ।
    /// </summary>
    private async Task CompleteLeaseAsync(Guid leaseId, string? reason)
    {
        ThrowIfDisposed();
        if (leaseId == Guid.Empty) return;

        await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            var lid = leaseId.ToString("D");
            var files = new List<string>();
            var logLines = reason is null ? null : new List<string>();
            var rows = 0;
            var bytes = 0L;

            using (var sel = _write.CreateCommand())
            {
                sel.CommandText = """
                    SELECT row_id, client_uuid, kind, file_path, size_bytes, attempts
                    FROM outbox WHERE lease_id = $lid ORDER BY row_id;
                    """;
                sel.Parameters.AddWithValue("$lid", lid);

                using var reader = sel.ExecuteReader();
                while (reader.Read())
                {
                    rows++;
                    bytes += reader.GetInt64(4);
                    if (!reader.IsDBNull(3)) files.Add(reader.GetString(3));

                    if (logLines is not null && logLines.Count < MaxDropLogLines)
                    {
                        logLines.Add(
                            $"ABANDON\t{reader.GetString(2)}\trow={reader.GetInt64(0)}\t" +
                            $"uuid={reader.GetString(1)}\tattempts={reader.GetInt32(5)}\t{reason}");
                    }
                }
            }

            if (rows == 0)
            {
                // অজানা বা ফুরিয়ে যাওয়া লিজ — ইন্টারফেস বলেছে চুপচাপ উপেক্ষা করতে।
                // কিন্তু abandon-এর ক্ষেত্রে সেটাও জানা দরকার, নইলে "মুছেছি ভেবেছিলাম"
                // অবস্থা তৈরি হয়।
                if (reason is not null)
                    _drops.Write($"ABANDON\tলিজ {lid} পাওয়া যায়নি (মেয়াদ ফুরিয়ে ফিরে গেছে?)\t{reason}");
                return;
            }

            using (var del = _write.CreateCommand())
            {
                del.CommandText = "DELETE FROM outbox WHERE lease_id = $lid;";
                del.Parameters.AddWithValue("$lid", lid);
                del.ExecuteNonQuery();
            }

            if (logLines is not null)
            {
                if (rows > MaxDropLogLines)
                    logLines.Add($"ABANDON\t… আরও {rows - MaxDropLogLines}টি সারি, মোট {rows}টি\t{reason}");

                _drops.WriteMany(logLines);
                _log($"⚠️ আউটবক্স থেকে {rows}টি সারি ({bytes / 1024.0:F0} KB) স্থায়ীভাবে বাদ: {reason}");
            }

            ClearWriteError();
            DeleteFiles(files);
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 0, null);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// সাময়িক ব্যর্থতা — লিজ ছেড়ে দেওয়া, attempts বাড়ানো, notBefore বসানো।
    /// ⚠️ <c>ct</c> নেওয়া হয় না: এটা না চললে সারিগুলো লিজ ফুরোনো পর্যন্ত
    /// আটকে থাকত, অর্থাৎ শাটডাউনের বাতিল-টোকেন পরের রিট্রাইকে দেরি করাত।
    /// </summary>
    public async Task RetryAsync(Guid leaseId, DateTimeOffset notBefore, CancellationToken ct = default)
    {
        ThrowIfDisposed();
        if (leaseId == Guid.Empty) return;

        await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            using var cmd = _write.CreateCommand();
            cmd.CommandText = """
                UPDATE outbox
                   SET attempts = attempts + 1,
                       lease_id = NULL,
                       lease_expires_ms = NULL,
                       not_before_ms = $nb
                 WHERE lease_id = $lid;
                """;
            cmd.Parameters.AddWithValue("$lid", leaseId.ToString("D"));
            cmd.Parameters.AddWithValue("$nb", ToMs(notBefore));
            cmd.ExecuteNonQuery();
            ClearWriteError();
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 0, null);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// ⚠️ এখানে <c>attempts</c> বাড়ানো হয় না, ইচ্ছাকৃতভাবে। ফুরিয়ে যাওয়া লিজ
    /// মানে সাধারণত প্রসেস মরে গিয়ে আবার চালু হয়েছে — সার্ভার কিছু বলেনি।
    /// attempts বাড়ালে রিবুটের ঠিক পরেই ব্যাকঅফ শুরু হতো, অথচ ঠিক তখনই
    /// জমে থাকা ব্যাকলগ দ্রুত পাঠানো দরকার।
    /// </summary>
    public async Task<int> ReclaimExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        ThrowIfDisposed();

        await _writeGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            using var cmd = _write.CreateCommand();
            cmd.CommandText = """
                UPDATE outbox
                   SET lease_id = NULL, lease_expires_ms = NULL
                 WHERE lease_id IS NOT NULL
                   AND (lease_expires_ms IS NULL OR lease_expires_ms <= $now);
                """;
            cmd.Parameters.AddWithValue("$now", ToMs(now));
            var n = cmd.ExecuteNonQuery();
            ClearWriteError();

            if (n > 0) _log($"outbox: {n}টি সারির লিজ ফুরিয়েছিল, ফিরিয়ে নেওয়া হলো");
            return n;
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 0, null);
            return 0;
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// স্টার্টআপে <b>সব</b> লিজ ছেড়ে দেওয়া, মেয়াদ যাই হোক।
    ///
    /// যুক্তি: এজেন্ট মেশিনে একটাই চলে (SessionGuard কনসোল সেশনে বাঁধে), তাই
    /// এই মুহূর্তে DB-তে যেসব লিজ আছে সেগুলো সবই <i>মরে যাওয়া</i> প্রসেসের।
    /// মেয়াদ ফুরোনোর জন্য অপেক্ষা করলে রিবুটের পর ৫ মিনিট ধরে ওই ব্যাচটা
    /// আটকে থাকত — কোনো লাভ ছাড়াই।
    ///
    /// ⚠️ ধরে নেওয়াটা ভুল হলেও (কোনোভাবে দুটো ইনস্ট্যান্স) সবচেয়ে খারাপ ফল
    /// একই ব্যাচ দুবার পাঠানো, যেটা clientUuid-এর কারণে নিরীহ।
    /// </summary>
    private void ReclaimAllLeases()
    {
        try
        {
            using var cmd = _write.CreateCommand();
            cmd.CommandText = "UPDATE outbox SET lease_id = NULL, lease_expires_ms = NULL WHERE lease_id IS NOT NULL;";
            var n = cmd.ExecuteNonQuery();
            if (n > 0) _log($"outbox: আগের রানের {n}টি ধার-নেওয়া সারি ফিরিয়ে নেওয়া হলো");
        }
        catch (SqliteException ex)
        {
            _log($"⚠️ outbox: পুরোনো লিজ ফেরানো গেল না — {ex.Message}");
        }
    }

    /// <summary>
    /// এই বিল্ড চেনে না এমন <c>kind</c>-এর সারি মুছে ফেলা।
    ///
    /// এটা কেবল ডাউনগ্রেডে সম্ভব (নতুন এজেন্ট নতুন ধরনের সারি লিখে গেছে,
    /// তারপর পুরোনো এজেন্ট চালু হয়েছে)। রেখে দিলে সারিগুলো কোনোদিন লিজ পেত না,
    /// অথচ <see cref="OutboxBudget"/>-এর জরিপেও ধরা পড়ত না — অর্থাৎ এমন জায়গা
    /// দখল করে থাকত যা কোনো নিয়মে কখনো ফেরত আসত না। ড্রপ-লগে লেখা হয় বলে
    /// অন্তত নীরব নয়।
    /// </summary>
    private void PurgeUnknownKinds()
    {
        var known = string.Join(", ", Enum.GetNames<OutboundKind>().Select(n => $"'{n}'"));

        try
        {
            var files = new List<string>();
            var kinds = new List<string>();

            using (var sel = _write.CreateCommand())
            {
                sel.CommandText = $"SELECT row_id, kind, file_path FROM outbox WHERE kind NOT IN ({known});";
                using var reader = sel.ExecuteReader();
                while (reader.Read())
                {
                    kinds.Add(reader.GetString(1));
                    if (!reader.IsDBNull(2)) files.Add(reader.GetString(2));
                }
            }

            if (kinds.Count == 0) return;

            using (var del = _write.CreateCommand())
            {
                del.CommandText = $"DELETE FROM outbox WHERE kind NOT IN ({known});";
                del.ExecuteNonQuery();
            }

            DeleteFiles(files);

            var distinct = string.Join(",", kinds.Distinct());
            var line = $"UNKNOWN-KIND\t{kinds.Count}টি সারি মুছে ফেলা হলো (ধরন: {distinct}) — " +
                       "সম্ভবত এজেন্ট ডাউনগ্রেড হয়েছে";
            _drops.Write(line);
            _log("⚠️ " + line);
        }
        catch (SqliteException ex)
        {
            _log($"⚠️ outbox: অচেনা ধরনের সারি সাফ করা গেল না — {ex.Message}");
        }
    }

    // ── জরিপ ও গভীরতা (পড়ার কানেকশন) ───────────────────────────────────────

    public async Task<OutboxDepth> GetDepthAsync(CancellationToken ct = default)
    {
        if (_disposed) return OutboxDepth.Empty;

        await _readGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return ReadDepth(_read);
        }
        catch (SqliteException ex)
        {
            // tray-র জন্য গভীরতা না পাওয়া মানে শুধু টুলটিপ ফাঁকা — ট্র্যাকিং
            // থামানোর কারণ নয়।
            _log($"⚠️ outbox গভীরতা পড়া গেল না — {ex.Message}");
            return OutboxDepth.Empty;
        }
        finally
        {
            _readGate.Release();
        }
    }

    /// <summary>
    /// এক পাসে GROUP BY — চারটা আলাদা COUNT চালানোর দরকার নেই।
    /// ধার নেওয়া সারিও গোনা হয়: সেগুলো এখনো সার্ভারে পৌঁছায়নি, তাই
    /// "কত বাকি"-র হিসাবে অবশ্যই থাকবে।
    /// </summary>
    private static OutboxDepth ReadDepth(SqliteConnection conn)
    {
        int segments = 0, appUsage = 0, events = 0, screenshots = 0;
        var bytes = 0L;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT kind, COUNT(*), COALESCE(SUM(size_bytes), 0) FROM outbox GROUP BY kind;";

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var count = reader.GetInt32(1);
            bytes += reader.GetInt64(2);

            if (!TryParseKind(reader.GetString(0), out var kind)) continue;

            switch (kind)
            {
                case OutboundKind.Segment: segments += count; break;
                case OutboundKind.AppUsage: appUsage += count; break;
                case OutboundKind.Event: events += count; break;
                case OutboundKind.Screenshot: screenshots += count; break;
            }
        }

        return new OutboxDepth(segments, appUsage, events, screenshots, bytes);
    }

    /// <summary>
    /// পুরো আউটবক্সের হালকা জরিপ। ⚠️ payload আনা হয় না — এক সপ্তাহ অফলাইন
    /// থাকা মেশিনে লাখখানেক সারির JSON RAM-এ তুললে ছাঁটাই করতে গিয়েই OOM হতো।
    /// </summary>
    public async Task<IReadOnlyList<OutboxEntryInfo>> SurveyAsync(CancellationToken ct = default)
    {
        if (_disposed) return [];

        await _readGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var list = new List<OutboxEntryInfo>();

            using var cmd = _read.CreateCommand();
            cmd.CommandText = """
                SELECT row_id, kind, enqueued_at_ms, size_bytes, (lease_id IS NOT NULL)
                FROM outbox ORDER BY row_id;
                """;

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                if (!TryParseKind(reader.GetString(1), out var kind)) continue;

                list.Add(new OutboxEntryInfo(
                    reader.GetInt64(0),
                    kind,
                    FromMs(reader.GetInt64(2)),
                    reader.GetInt64(3),
                    reader.GetInt64(4) != 0));
            }

            return list;
        }
        catch (SqliteException ex)
        {
            _log($"⚠️ outbox জরিপ ব্যর্থ — {ex.Message}");
            return [];
        }
        finally
        {
            _readGate.Release();
        }
    }

    // ── ছাঁটাই ──────────────────────────────────────────────────────────────

    /// <summary>
    /// <see cref="OutboxBudget.Plan"/>-এর সিদ্ধান্ত কার্যকর করা।
    ///
    /// ⚠️ প্রতিটা DELETE-এ <c>AND lease_id IS NULL</c> — জরিপ আর মোছার মাঝখানে
    /// সিঙ্ক ওয়ার্কার ওই সারিটা ধার নিয়ে ফেলতে পারে, আর তখন নিচ থেকে .webp
    /// সরিয়ে নিলে চলতি আপলোড ভেঙে পড়ত।
    /// </summary>
    public async Task<int> EvictAsync(IReadOnlyList<long> rowIds, string reason, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(rowIds);
        ThrowIfDisposed();
        if (rowIds.Count == 0) return 0;

        await _writeGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var files = new List<string>();
            var logLines = new List<string>();
            var deleted = 0;
            var bytes = 0L;

            using (var tx = _write.BeginTransaction())
            {
                using var sel = _write.CreateCommand();
                sel.Transaction = tx;
                sel.CommandText = """
                    SELECT kind, client_uuid, file_path, size_bytes
                    FROM outbox WHERE row_id = $id AND lease_id IS NULL;
                    """;
                var pSel = sel.Parameters.AddWithValue("$id", 0L);

                using var del = _write.CreateCommand();
                del.Transaction = tx;
                del.CommandText = "DELETE FROM outbox WHERE row_id = $id AND lease_id IS NULL;";
                var pDel = del.Parameters.AddWithValue("$id", 0L);

                foreach (var rowId in rowIds)
                {
                    pSel.Value = rowId;

                    string kind, uuid;
                    string? file = null;
                    long size;

                    using (var reader = sel.ExecuteReader())
                    {
                        if (!reader.Read()) continue;   // নেই, বা এইমাত্র ধার নেওয়া হয়েছে

                        kind = reader.GetString(0);
                        uuid = reader.GetString(1);
                        if (!reader.IsDBNull(2)) file = reader.GetString(2);
                        size = reader.GetInt64(3);
                    }

                    pDel.Value = rowId;

                    // ⚠️ হিসাব DELETE-এর *পরে* — SELECT আর DELETE-এর মাঝে সারিটা
                    // ধার নেওয়া হয়ে গেলে DELETE ০ ফেরত দেয়, আর তখন ওই বাইটগুলো
                    // "খালি হয়েছে" বলে গোনা হলে বাজেটের হিসাব ভুল দিকে যেত।
                    if (del.ExecuteNonQuery() == 0) continue;

                    deleted++;
                    bytes += size;
                    if (file is not null) files.Add(file);

                    if (logLines.Count < MaxDropLogLines)
                        logLines.Add($"EVICT\t{kind}\trow={rowId}\tuuid={uuid}\tbytes={size}\t{reason}");
                }

                tx.Commit();
            }

            ClearWriteError();

            if (deleted == 0) return 0;

            if (deleted > MaxDropLogLines)
                logLines.Add($"EVICT\t… আরও {deleted - MaxDropLogLines}টি সারি, মোট {deleted}টি\t{reason}");

            _drops.WriteMany(logLines);
            _log($"⚠️ outbox ছাঁটাই: {deleted}টি সারি, {bytes / 1024.0 / 1024.0:F1} MB — {reason}");

            DeleteFiles(files);
            Paths.PruneEmptyScreenshotFolders();
            MaybeIncrementalVacuum();

            return deleted;
        }
        catch (SqliteException ex)
        {
            NoteWriteFailure(ex, 0, null);
            return 0;
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// জরিপ → <see cref="OutboxBudget.Plan"/> → ছাঁটাই, এক কলে। সিঙ্ক ওয়ার্কার
    /// শুধু এটাই ডাকবে (স্টার্টআপে একবার, তারপর ঘণ্টায় একবার আর
    /// <see cref="LastWriteError"/> দেখা দিলেই সঙ্গে সঙ্গে)।
    ///
    /// দুটো তালিকা আলাদা করে <see cref="EvictAsync"/>-এ পাঠানো হয় ইচ্ছাকৃতভাবে —
    /// ড্রপ-লগে "পুরোনো হয়ে বাদ" আর "জায়গা নেই বলে বাদ" আলাদা দেখালে তবেই বোঝা
    /// যায় রিটেনশন বাড়াতে হবে নাকি ডিস্ক।
    ///
    /// ⚠️ হিসাবটা শুধু সারিতে থাকা <c>size_bytes</c> ধরে। ডিস্কে পড়ে থাকা অনাথ
    /// .webp এতে গোনা হয় না — সেগুলোর দায়িত্ব <see cref="SweepOrphanFilesAsync"/>-এর।
    /// </summary>
    public async Task<EvictionPlan> EnforceBudgetAsync(
        OutboxBudget budget, DateTimeOffset now, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(budget);
        if (_disposed) return EvictionPlan.Nothing(0);

        var survey = await SurveyAsync(ct).ConfigureAwait(false);
        var plan = budget.Plan(survey, now);
        if (plan.IsEmpty) return plan;

        if (plan.ExpiredRowIds.Count > 0)
        {
            await EvictAsync(plan.ExpiredRowIds, "বয়সসীমা পেরিয়েছে", ct).ConfigureAwait(false);
        }

        if (plan.OverBudgetRowIds.Count > 0)
        {
            var capMb = budget.CapBytes / 1024 / 1024;
            await EvictAsync(plan.OverBudgetRowIds, $"ডিস্ক বাজেট ({capMb} MB) ছাড়িয়েছে", ct)
                .ConfigureAwait(false);
        }

        return plan;
    }

    /// <summary>
    /// ⚠️ ছাঁটাইয়ের পর SQLite নিজে থেকে ফাইলটা ছোট করে না — মুক্ত পেজগুলো
    /// ভেতরেই পড়ে থাকে। auto_vacuum=INCREMENTAL থাকায় আমরা মাঝে মাঝে সেগুলো
    /// OS-কে ফেরত দিতে পারি। পুরো <c>VACUUM</c> ডাকা হয় না ইচ্ছাকৃতভাবে:
    /// ওটা পুরো DB-র একটা কপি বানায় (অর্থাৎ ডিস্ক ভরা অবস্থায় ঠিক তখনই ব্যর্থ
    /// হতো যখন সবচেয়ে দরকার) আর পুরোটা সময় ডাটাবেস লক করে রাখে।
    /// </summary>
    private void MaybeIncrementalVacuum()
    {
        if (++_evictionsSinceVacuum < 10) return;
        _evictionsSinceVacuum = 0;

        try
        {
            using var cmd = _write.CreateCommand();
            cmd.CommandText = "PRAGMA incremental_vacuum(1000);";
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException)
        {
            // auto_vacuum=NONE হলে এটা নিছক no-op/এরর — কোনো ক্ষতি নেই।
        }
    }

    // ── অনাথ ফাইল ───────────────────────────────────────────────────────────

    /// <summary>
    /// ডিস্কে পড়ে থাকা যেসব .webp-র কোনো সারি নেই, সেগুলো মোছা। ফেরত দেয় কতগুলো গেল।
    ///
    /// এগুলো তৈরি হয় দুইভাবে: (ক) ack-এর commit আর ফাইল-মোছার মাঝখানে প্রসেস
    /// মরলে, (খ) স্ক্রিনশট লেখা হয়ে গেছে কিন্তু সারিতে ঢোকানোর আগেই মরেছে।
    /// দুটোই বিরল, কিন্তু অনাথ ফাইল <b>কোনো বাজেটের হিসাবে ধরা পড়ে না</b> —
    /// অর্থাৎ এটা এমন ফুটো যা মাসের পর মাস চলতে পারে আর কেউ টেরও পায় না।
    ///
    /// ⚠️ <paramref name="grace"/> ছাড়া চালানো যাবে না: ক্যাপচার মডিউল ফাইল
    /// লিখে তারপর Enqueue করে; ওই কয়েক মিলিসেকেন্ডে ঝাড়ু দিলে সদ্য তোলা
    /// ছবিটাই মুছে যেত।
    /// </summary>
    public async Task<int> SweepOrphanFilesAsync(
        DateTimeOffset now, TimeSpan? grace = null, CancellationToken ct = default)
    {
        if (_disposed) return 0;
        var cutoff = (now - (grace ?? TimeSpan.FromHours(1))).UtcDateTime;

        HashSet<string> known;
        await _readGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using var cmd = _read.CreateCommand();
            cmd.CommandText = "SELECT file_path FROM outbox WHERE file_path IS NOT NULL;";
            using var reader = cmd.ExecuteReader();
            while (reader.Read()) known.Add(NormalizePath(reader.GetString(0)));
        }
        catch (SqliteException ex)
        {
            _log($"⚠️ outbox: অনাথ ফাইল ঝাড়ু দেওয়া গেল না — {ex.Message}");
            return 0;
        }
        finally
        {
            _readGate.Release();
        }

        var removed = 0;
        var freed = 0L;

        try
        {
            foreach (var file in Directory.EnumerateFiles(Paths.ScreenshotQueue, "*.webp", SearchOption.AllDirectories))
            {
                ct.ThrowIfCancellationRequested();

                try
                {
                    var info = new FileInfo(file);
                    if (info.LastWriteTimeUtc > cutoff) continue;
                    if (known.Contains(NormalizePath(file))) continue;

                    var size = info.Length;
                    File.Delete(file);
                    removed++;
                    freed += size;
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        catch (DirectoryNotFoundException) { }
        catch (UnauthorizedAccessException) { }

        if (removed > 0)
        {
            Paths.PruneEmptyScreenshotFolders();
            _log($"outbox: {removed}টি অনাথ .webp মোছা হলো ({freed / 1024.0 / 1024.0:F1} MB ফেরত)");
        }

        return removed;
    }

    // ── বন্ধ করা ────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            // ⚠️ TRUNCATE checkpoint — WAL-এর সব কিছু মূল ফাইলে লিখে WAL-টা
            // শূন্য করে দেয়। এটা না করলে পরের স্টার্টআপে রিকভারি চালাতে হতো
            // (নিরাপদ, তবু ধীর), আর ব্যাকআপ সফটওয়্যার শুধু .db কপি করে নিলে
            // WAL-এ পড়ে থাকা শেষ কয়েক দিনের সারি ব্যাকআপে যেত না।
            using var cmd = _write.CreateCommand();
            cmd.CommandText = "PRAGMA wal_checkpoint(TRUNCATE);";
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException)
        {
            // বন্ধ করার সময় ব্যর্থ হলেও কিছু করার নেই — ডেটা ইতিমধ্যে commit করা।
        }
        finally
        {
            _writeGate.Release();
        }

        _read.Dispose();
        _write.Dispose();
        _writeGate.Dispose();
        _readGate.Dispose();
    }

    // ── ছোট সহায়ক ───────────────────────────────────────────────────────────

    private long LastRowId()
    {
        using var cmd = _write.CreateCommand();
        cmd.CommandText = "SELECT last_insert_rowid();";
        return Convert.ToInt64(cmd.ExecuteScalar() ?? 0L);
    }

    private long FindRowIdByUuid(Guid uuid)
    {
        using var cmd = _write.CreateCommand();
        cmd.CommandText = "SELECT row_id FROM outbox WHERE client_uuid = $uuid;";
        cmd.Parameters.AddWithValue("$uuid", uuid.ToString("D"));
        var value = cmd.ExecuteScalar();
        return value is null or DBNull ? -1 : Convert.ToInt64(value);
    }

    private static void AddInsertParameters(SqliteCommand cmd, OutboxItem item)
    {
        cmd.Parameters.AddWithValue("$uuid", item.ClientUuid.ToString("D"));
        cmd.Parameters.AddWithValue("$kind", item.Kind.ToString());
        cmd.Parameters.AddWithValue("$at", ToMs(item.EnqueuedAt));
        cmd.Parameters.AddWithValue("$payload", item.Payload);
        cmd.Parameters.AddWithValue("$file", (object?)item.FilePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$size", item.SizeBytes);
    }

    /// <summary>
    /// সারি মুছে যাওয়ার পর তার .webp। ⚠️ ব্যর্থতা গিলে ফেলা হয়: ফাইলটা AV
    /// বা ইনডেক্সার ধরে রাখলে মোছা যায় না, কিন্তু সারি তো ইতিমধ্যেই গেছে —
    /// এখানে ব্যতিক্রম ছুড়লে পুরো ack/evict পথটা ভাঙত। যা পড়ে রইল তা
    /// <see cref="SweepOrphanFilesAsync"/> পরে তুলে নেবে।
    /// </summary>
    private void DeleteFiles(List<string> files)
    {
        foreach (var file in files)
        {
            try
            {
                File.Delete(file);   // না থাকলে ব্যতিক্রম দেয় না
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>
    /// লেখা ব্যর্থ — সাধারণত ডিস্ক ভরা (SQLITE_FULL) বা ACL (SQLITE_READONLY)।
    ///
    /// ⚠️ এখানে ব্যতিক্রম ছড়ানো <b>হয় না</b>। ট্র্যাকিং থ্রেড প্রতি মিনিটে
    /// Enqueue করে; সেখান থেকে ছুড়লে থ্রেডটা মরত আর মেশিনটা চুপচাপ কিছুই
    /// গোনা বন্ধ করত। বদলে: এই সেকেন্ডের রেকর্ডটা হারায় (দুঃখজনক, কিন্তু
    /// সীমিত), <see cref="LastWriteError"/> সেট হয় যাতে tray "Degraded"
    /// দেখায়, আর সিঙ্ক ওয়ার্কার এটা দেখে বাজেট-ছাঁটাই চালিয়ে জায়গা করতে পারে।
    ///
    /// লগও থ্রটল করা — ডিস্ক ভরে যাওয়ার কারণেই যদি ব্যর্থতা হয়, তাহলে
    /// সেকেন্ডে একটা করে লগ লাইন লিখে সমস্যাটা আরও বাড়ানো হতো।
    /// </summary>
    private void NoteWriteFailure(SqliteException ex, int lostItems, OutboundKind? kind)
    {
        LastWriteError = $"SQLite {ex.SqliteErrorCode}: {ex.Message}";
        LastWriteErrorAt = DateTimeOffset.UtcNow;

        var now = DateTimeOffset.UtcNow;
        if (now - _lastWriteErrorLoggedAt < ErrorLogWindow) return;
        _lastWriteErrorLoggedAt = now;

        var free = TryGetFreeBytes(Paths.Root);
        var freeText = free is null ? "?" : $"{free.Value / 1024.0 / 1024.0:F0} MB";

        var line = $"WRITE-FAIL\t{kind?.ToString() ?? "-"}\tlost≈{lostItems}\tfree={freeText}\t{LastWriteError}";
        _drops.Write(line);
        _log($"⚠️ outbox লিখতে পারছে না (খালি জায়গা {freeText}) — {LastWriteError}");
    }

    private void ClearWriteError()
    {
        if (LastWriteError is null) return;
        LastWriteError = null;
        LastWriteErrorAt = null;
        _log("outbox: আবার লেখা যাচ্ছে");
    }

    private static long? TryGetFreeBytes(string path)
    {
        try
        {
            return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path))!).AvailableFreeSpace;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// ⚠️ <c>Enum.TryParse</c> সংখ্যাও মেনে নেয় — "0" দিলে সেটা নিঃশব্দে
    /// <see cref="OutboundKind.Segment"/> হয়ে যেত। আমরা সবসময় নাম লিখি, তাই
    /// প্রথম অক্ষর সংখ্যা হলে সেটা নষ্ট ডেটা, আর সেটাকে সেগমেন্ট বানানো
    /// মানে ভুল endpoint-এ আবর্জনা পাঠানো।
    /// </summary>
    private static bool TryParseKind(string text, out OutboundKind kind)
    {
        kind = default;
        if (string.IsNullOrEmpty(text) || !char.IsLetter(text[0])) return false;
        return Enum.TryParse(text, ignoreCase: false, out kind);
    }

    private static Guid ParseGuid(string text) => Guid.TryParse(text, out var g) ? g : Guid.Empty;

    private static string NormalizePath(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch (Exception)
        {
            return path;
        }
    }

    /// <summary>
    /// ⚠️ unix ms, UTC-তে। DateTimeOffset-এর অফসেট হারায় — ইচ্ছাকৃত। সারির
    /// বয়সের হিসাব আর <c>not_before</c>-এর তুলনা দুটোই নিখুঁত UTC মুহূর্ত
    /// চায়; আসল টাইমস্ট্যাম্প (অফসেটসহ) payload-এর JSON-এই থেকে যায়, আর
    /// সার্ভারে সেটাই যায়।
    /// </summary>
    private static long ToMs(DateTimeOffset value) => value.ToUnixTimeMilliseconds();

    private static DateTimeOffset FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms);

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(SqliteOutboxStore));
    }
}
