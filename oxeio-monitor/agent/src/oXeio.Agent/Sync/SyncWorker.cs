using System.Runtime.Versioning;

using oXeio.Agent.Storage;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Sync;

/// <summary>
/// আউটবক্স থেকে সার্ভারে — এই লুপটাই মডিউলগুলোকে জুড়ে দেয়।
///
/// <b>ক্রম গুরুত্বপূর্ণ:</b> সেগমেন্ট সবার আগে। লিংক দুর্বল হলে বা ব্যাকলগ
/// বড় হলে যেটা আগে যাবে সেটাই যেন <b>পে-রোলের ডেটা</b> হয়; স্ক্রিনশট
/// (আকারে সবচেয়ে বড়, গুরুত্বে সবচেয়ে কম) সবার শেষে।
///
/// <b>প্রতিটা চক্রে সীমা আছে</b> — এক ধরনের সারি অসীমকাল চললে বাকিরা
/// অভুক্ত থাকত। ৫০,০০০ সারির ব্যাকলগেও সেগমেন্ট আর ইভেন্ট দুটোই এগোতে থাকে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SyncWorker(
    IOutboxStore store,
    ISyncClient client,
    ISyncLog? log = null,
    RetryPolicy? retry = null,
    SyncHealthPolicy? health = null,
    Func<DateTimeOffset>? clock = null)
{
    /// <summary>এক চক্রে প্রতি ধরনে সর্বোচ্চ কত ব্যাচ — starvation ঠেকাতে।</summary>
    private const int MaxBatchesPerKindPerCycle = 4;

    /// <summary>
    /// lease কতক্ষণের। আপলোডের সর্বোচ্চ সময়ের (৬০ সে.) চেয়ে যথেষ্ট বেশি,
    /// যাতে ধীর লিংকে নিজেরই lease মেয়াদোত্তীর্ণ হয়ে দুবার না পাঠায়।
    /// </summary>
    private static readonly TimeSpan LeaseFor = TimeSpan.FromMinutes(5);

    /// <summary>⚠️ সেগমেন্ট আগে, স্ক্রিনশট শেষে — ইচ্ছাকৃত।</summary>
    private static readonly OutboundKind[] Order =
    [
        OutboundKind.Segment,
        OutboundKind.Event,
        OutboundKind.AppUsage,
        OutboundKind.Screenshot,
    ];

    private readonly ISyncLog _log = log ?? NullSyncLog.Instance;
    private readonly RetryPolicy _retry = retry ?? RetryPolicy.Default;
    private readonly SyncHealthPolicy _health = health ?? SyncHealthPolicy.Default;
    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);

    private readonly Dictionary<OutboundKind, BatchNarrowing> _narrowing = new()
    {
        [OutboundKind.Segment] = new BatchNarrowing(SyncLimits.MaxBatchSize),
        [OutboundKind.Event] = new BatchNarrowing(SyncLimits.MaxBatchSize),
        [OutboundKind.AppUsage] = new BatchNarrowing(SyncLimits.MaxBatchSize),

        // ছবি multipart-এ যায়, একটা করেই — ভাগাভাগির প্রশ্নই নেই
        [OutboundKind.Screenshot] = new BatchNarrowing(1),
    };

    private readonly DateTimeOffset _startedAt = (clock ?? (() => DateTimeOffset.UtcNow))();

    public DateTimeOffset? LastSuccessAt { get; private set; }
    public bool Revoked { get; private set; }
    public OutboxDepth Depth { get; private set; }

    public SyncHealth Health =>
        _health.Evaluate(LastSuccessAt, _startedAt, Depth.Total, Revoked, _clock());

    public string? HealthDetail => SyncHealthPolicy.Describe(Health, Depth.Total);

    /// <summary>
    /// একবার নিষ্কাশনের চেষ্টা। ব্যতিক্রম বাইরে যায় না — এই লুপ মরে গেলে
    /// ডেটা আর কখনো সার্ভারে পৌঁছাত না, আর সেটা কেউ দেখতেও পেত না।
    /// </summary>
    public async Task DrainOnceAsync(CancellationToken ct = default)
    {
        if (Revoked) return;

        try
        {
            // ক্র্যাশে আটকে থাকা lease ছাড়িয়ে নেওয়া — নইলে ওই সারিগুলো
            // মেয়াদ শেষ না হওয়া পর্যন্ত অদৃশ্য থাকত
            var reclaimed = await store.ReclaimExpiredLeasesAsync(_clock(), ct);
            if (reclaimed > 0)
                _log.Warn($"{reclaimed}টি আটকে থাকা lease ছাড়ানো হলো (আগের রান ক্র্যাশ করেছিল?)");

            foreach (var kind in Order)
            {
                if (ct.IsCancellationRequested || Revoked) break;
                await DrainKindAsync(kind, ct);
            }

            Depth = await store.GetDepthAsync(ct);
        }
        catch (OperationCanceledException)
        {
            // থামতে বলা হয়েছে — স্বাভাবিক
        }
        catch (Exception ex)
        {
            _log.Error("সিঙ্ক চক্রে অপ্রত্যাশিত ত্রুটি — পরের চক্রে আবার চেষ্টা হবে", ex);
        }
    }

    private async Task DrainKindAsync(OutboundKind kind, CancellationToken ct)
    {
        var narrowing = _narrowing[kind];

        for (var round = 0; round < MaxBatchesPerKindPerCycle; round++)
        {
            if (ct.IsCancellationRequested || Revoked) return;

            var now = _clock();
            var lease = await store.LeaseAsync(kind, narrowing.Current, LeaseFor, now, ct);
            if (lease is null || lease.Count == 0) return;

            var outcome = await SendLeaseAsync(kind, lease, ct);
            await ApplyOutcomeAsync(kind, lease, outcome, narrowing, ct);

            // Permanent-এ ব্যাচ ছোট করে **সাথে সাথেই** আবার চেষ্টা হয়, তাই
            // লুপ চালু থাকে। বাকি সব ক্ষেত্রে ছোট ব্যাচ মানে আর কিছু নেই।
            if (outcome.Outcome != SyncOutcome.Permanent && lease.Count < narrowing.Current) return;
        }
    }

    // ── পাঠানো ──────────────────────────────────────────────────────────────

    private async Task<SyncResult<object>> SendLeaseAsync(
        OutboundKind kind, OutboxLease lease, CancellationToken ct)
    {
        if (kind == OutboundKind.Screenshot) return await SendScreenshotAsync(lease, ct);

        var decoded = Decode(kind, lease, out var unreadable);

        if (unreadable > 0)
        {
            // ⚠️ চুপ করে থাকা যাবে না। নষ্ট সারি মানে হারানো ঘণ্টা, আর সেটা
            //    সার্ভারের দিক থেকে দেখতে স্বাভাবিক লাগবে।
            _log.Error($"{kind}: {unreadable}টি সারি পড়া গেল না — বাদ দেওয়া হচ্ছে");
        }

        if (decoded.Count == 0)
        {
            return SyncResult<object>.Permanent(null, "একটাও সারি পড়া গেল না");
        }

        return kind switch
        {
            OutboundKind.Segment =>
                Erase(await client.SendSegmentsAsync(decoded.Cast<ActivitySegment>().ToList(), ct)),
            OutboundKind.Event =>
                Erase(await client.SendEventsAsync(decoded.Cast<AgentEventRecord>().ToList(), ct)),
            OutboundKind.AppUsage =>
                Erase(await client.SendAppUsageAsync(decoded.Cast<AppUsageRecord>().ToList(), ct)),
            _ => SyncResult<object>.Permanent(null, $"অজানা ধরন {kind}"),
        };
    }

    private async Task<SyncResult<object>> SendScreenshotAsync(
        OutboxLease lease, CancellationToken ct)
    {
        var entry = lease.Entries[0];
        var meta = OutboxCodec.Decode<ScreenshotRecord>(entry.Payload);

        if (meta is null)
            return SyncResult<object>.Permanent(null, "ছবির মেটাডেটা পড়া গেল না");

        if (string.IsNullOrWhiteSpace(entry.FilePath) || !File.Exists(entry.FilePath))
        {
            // ফাইলটাই নেই — সারিটা ধরে রাখার কোনো মানে নেই। এটা ঘটে যদি
            // ডিস্ক বাজেট ছবিটা ছেঁটে ফেলে কিন্তু সারিটা রয়ে যায়।
            return SyncResult<object>.Permanent(null, "ছবির ফাইল ডিস্কে নেই");
        }

        return Erase(await client.SendScreenshotAsync(meta, entry.FilePath, ct));
    }

    private List<object> Decode(OutboundKind kind, OutboxLease lease, out int unreadable)
    {
        var list = new List<object>(lease.Count);
        unreadable = 0;

        foreach (var e in lease.Entries)
        {
            var record = OutboxCodec.Decode(kind, e.Payload);
            if (record is null) unreadable++;
            else list.Add(record);
        }

        return list;
    }

    private static SyncResult<object> Erase<T>(SyncResult<T> r) where T : class => new()
    {
        Outcome = r.Outcome,
        StatusCode = r.StatusCode,
        Detail = r.Detail,
        RetryAfter = r.RetryAfter,
    };

    // ── ফলাফল অনুযায়ী কাজ ───────────────────────────────────────────────────

    private async Task ApplyOutcomeAsync(
        OutboundKind kind,
        OutboxLease lease,
        SyncResult<object> result,
        BatchNarrowing narrowing,
        CancellationToken ct)
    {
        var now = _clock();

        switch (result.Outcome)
        {
            case SyncOutcome.Success:
                await store.AckAsync(lease.LeaseId, ct);
                narrowing.OnSuccess();
                LastSuccessAt = now;
                break;

            case SyncOutcome.Transient:
                narrowing.OnTransient();
                await RetryLaterAsync(lease, result, now, ct);
                break;

            // ⭐ ব্যাচ ভাগ করার মানে হয় **শুধু তখনই যখন সার্ভার রায় দিয়েছে** —
            //    কারণ তখনই আমরা জানি না ৫০০-র মধ্যে কোনটা দোষী।
            //    নিজেরা যখন খারাপ বলি (payload পড়া গেল না, ছবির ফাইল নেই),
            //    তখন কোনটা খারাপ সেটা আগে থেকেই জানা — ভাগ করা নিছক ৮ চক্রের
            //    অপচয়, আর ততক্ষণ কিউয়ের মাথা আটকে থাকে।
            case SyncOutcome.Permanent when result.StatusCode is null:
            case SyncOutcome.Permanent when narrowing.IsIsolated:
                // এক রেকর্ড নিয়েও প্রত্যাখ্যাত — দোষটা নিঃসন্দেহে এটারই
                await store.AbandonAsync(
                    lease.LeaseId,
                    result.Detail ?? $"সার্ভার প্রত্যাখ্যান করেছে (HTTP {result.StatusCode})",
                    ct);

                _log.Error(
                    $"{kind}: একটি রেকর্ড স্থায়ীভাবে বাদ — {result.Detail ?? "কারণ জানা যায়নি"} " +
                    $"(uuid {lease.Entries[0].ClientUuid})");

                narrowing.OnIsolatedDropped();
                break;

            case SyncOutcome.Permanent:
                // ব্যাচে কোথাও একটা খারাপ রেকর্ড আছে। পুরোটা ফেলে দেওয়া যাবে না —
                // অর্ধেক করে আবার, যতক্ষণ না দোষীটা একা পড়ে।
                narrowing.OnPermanent();
                _log.Warn(
                    $"{kind}: {lease.Count}টির ব্যাচ প্রত্যাখ্যাত — " +
                    $"{narrowing.Current}টি নিয়ে আবার দেখা হচ্ছে (খারাপ রেকর্ড খোঁজা)");

                // সাথে সাথেই আবার — অপেক্ষার কিছু নেই, সার্ভারের দোষ নয়
                await store.RetryAsync(lease.LeaseId, now, ct);
                break;

            case SyncOutcome.Revoked:
                Revoked = true;
                _log.Error("⛔ এই ডিভাইস সার্ভার থেকে বাতিল করা হয়েছে — সিঙ্ক বন্ধ");

                // ⚠️ ডেটা মোছা হয় না। revoke ভুল করেও হতে পারে, আর তখন
                //    সারিগুলো ফেরত পাওয়ার একমাত্র উপায় ওগুলো টিকে থাকা।
                await store.RetryAsync(lease.LeaseId, now.AddYears(1), ct);
                break;
        }
    }

    private async Task RetryLaterAsync(
        OutboxLease lease, SyncResult<object> result, DateTimeOffset now, CancellationToken ct)
    {
        var oldest = lease.Entries[0];

        if (_retry.ShouldAbandon(oldest.Attempts + 1, oldest.EnqueuedAt, now))
        {
            await store.AbandonAsync(lease.LeaseId, "৩০ দিনের বেশি পুরোনো — আর কাজে লাগবে না", ct);
            _log.Warn($"{lease.Kind}: {lease.Count}টি সারি বয়সের কারণে বাদ");
            return;
        }

        var next = _retry.NextAttemptAt(
            oldest.Attempts + 1, now, Random.Shared.NextDouble(), result.RetryAfter);

        await store.RetryAsync(lease.LeaseId, next, ct);
    }
}
