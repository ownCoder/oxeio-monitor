using oXeio.Agent.Sync;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Tests;

/// <summary>
/// মেমরিতে চলা আউটবক্স — SQLite ছাড়াই <see cref="SyncWorker"/>-এর আচরণ যাচাই
/// করার জন্য। lease/ack-এর নিয়মগুলো আসলটার মতোই: ack মুছে দেয়, retry ছেড়ে
/// দেয় আর attempts বাড়ায়, abandon কারণসহ মুছে দেয়।
/// </summary>
internal sealed class FakeOutbox : IOutboxStore
{
    private sealed class Row
    {
        public required long RowId { get; init; }
        public required OutboxItem Item { get; init; }
        public int Attempts { get; set; }
        public DateTimeOffset NotBefore { get; set; }
        public Guid? LeaseId { get; set; }
    }

    private readonly List<Row> _rows = [];
    private long _next = 1;

    public List<string> Abandoned { get; } = [];
    public int AckedBatches { get; private set; }
    public int RetriedBatches { get; private set; }

    public IReadOnlyList<Guid> RemainingUuids =>
        _rows.OrderBy(r => r.RowId).Select(r => r.Item.ClientUuid).ToList();

    public Task<long> EnqueueAsync(OutboxItem item, CancellationToken ct = default)
    {
        var id = _next++;
        _rows.Add(new Row { RowId = id, Item = item, NotBefore = item.EnqueuedAt });
        return Task.FromResult(id);
    }

    public async Task<int> EnqueueManyAsync(IReadOnlyList<OutboxItem> items, CancellationToken ct = default)
    {
        foreach (var i in items) await EnqueueAsync(i, ct);
        return items.Count;
    }

    public Task<OutboxLease?> LeaseAsync(
        OutboundKind kind, int maxItems, TimeSpan leaseFor, DateTimeOffset now,
        CancellationToken ct = default)
    {
        var picked = _rows
            .Where(r => r.Item.Kind == kind && r.LeaseId is null && r.NotBefore <= now)
            .OrderBy(r => r.RowId)
            .Take(maxItems)
            .ToList();

        if (picked.Count == 0) return Task.FromResult<OutboxLease?>(null);

        var leaseId = Guid.NewGuid();
        foreach (var r in picked) r.LeaseId = leaseId;

        return Task.FromResult<OutboxLease?>(new OutboxLease
        {
            LeaseId = leaseId,
            Kind = kind,
            ExpiresAt = now + leaseFor,
            Entries = picked.Select(r => new OutboxEntry
            {
                RowId = r.RowId,
                ClientUuid = r.Item.ClientUuid,
                Kind = r.Item.Kind,
                EnqueuedAt = r.Item.EnqueuedAt,
                Payload = r.Item.Payload,
                FilePath = r.Item.FilePath,
                SizeBytes = r.Item.SizeBytes,
                Attempts = r.Attempts,
            }).ToList(),
        });
    }

    public Task AckAsync(Guid leaseId, CancellationToken ct = default)
    {
        AckedBatches++;
        _rows.RemoveAll(r => r.LeaseId == leaseId);
        return Task.CompletedTask;
    }

    public Task RetryAsync(Guid leaseId, DateTimeOffset notBefore, CancellationToken ct = default)
    {
        RetriedBatches++;
        foreach (var r in _rows.Where(r => r.LeaseId == leaseId))
        {
            r.LeaseId = null;
            r.Attempts++;
            r.NotBefore = notBefore;
        }
        return Task.CompletedTask;
    }

    public Task AbandonAsync(Guid leaseId, string reason, CancellationToken ct = default)
    {
        foreach (var r in _rows.Where(r => r.LeaseId == leaseId))
            Abandoned.Add($"{r.Item.ClientUuid}: {reason}");

        _rows.RemoveAll(r => r.LeaseId == leaseId);
        return Task.CompletedTask;
    }

    public Task<int> ReclaimExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct = default) =>
        Task.FromResult(0);

    public Task<OutboxDepth> GetDepthAsync(CancellationToken ct = default) =>
        Task.FromResult(new OutboxDepth(
            _rows.Count(r => r.Item.Kind == OutboundKind.Segment),
            _rows.Count(r => r.Item.Kind == OutboundKind.AppUsage),
            _rows.Count(r => r.Item.Kind == OutboundKind.Event),
            _rows.Count(r => r.Item.Kind == OutboundKind.Screenshot),
            _rows.Sum(r => r.Item.SizeBytes)));

    public Task<IReadOnlyList<OutboxEntryInfo>> SurveyAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<OutboxEntryInfo>>(_rows
            .Select(r => new OutboxEntryInfo(
                r.RowId, r.Item.Kind, r.Item.EnqueuedAt, r.Item.SizeBytes, r.LeaseId is not null))
            .ToList());

    public Task<int> EvictAsync(IReadOnlyList<long> rowIds, string reason, CancellationToken ct = default)
    {
        var n = _rows.RemoveAll(r => rowIds.Contains(r.RowId));
        return Task.FromResult(n);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>
/// নকল সার্ভার। কোন <see cref="ClientUuid"/> "বিষাক্ত" সেটা আগে থেকে বলে
/// দেওয়া যায় — ওটা ব্যাচে থাকলেই পুরো ব্যাচ ৪০০ খাবে, ঠিক যেমন আসল
/// সার্ভারের <c>ValidationPipe</c> করে।
/// </summary>
internal sealed class FakeSyncClient : ISyncClient
{
    public HashSet<Guid> PoisonUuids { get; } = [];
    public Queue<SyncOutcome> ForcedOutcomes { get; } = new();
    public List<int> SegmentBatchSizes { get; } = [];
    public int AcceptedSegments { get; private set; }

    public void SetDeviceToken(string? deviceToken) { }

    public Task<SyncResult<IngestAck>> SendSegmentsAsync(
        IReadOnlyList<ActivitySegment> segments, CancellationToken ct = default)
    {
        SegmentBatchSizes.Add(segments.Count);

        if (ForcedOutcomes.Count > 0)
        {
            var forced = ForcedOutcomes.Dequeue();
            if (forced != SyncOutcome.Success) return Task.FromResult(Fail<IngestAck>(forced));
        }

        if (segments.Any(s => PoisonUuids.Contains(s.ClientUuid)))
            return Task.FromResult(SyncResult<IngestAck>.Permanent(400, "বেঠিক রেকর্ড"));

        AcceptedSegments += segments.Count;
        return Task.FromResult(SyncResult<IngestAck>.Ok(
            new IngestAck { Accepted = segments.Count, Duplicates = 0, Split = 0 }));
    }

    private static SyncResult<T> Fail<T>(SyncOutcome o) where T : class => o switch
    {
        SyncOutcome.Transient => SyncResult<T>.Transient(503, "নকল সাময়িক ত্রুটি"),
        SyncOutcome.Permanent => SyncResult<T>.Permanent(400, "নকল স্থায়ী ত্রুটি"),
        _ => SyncResult<T>.Revoked("নকল revoke"),
    };

    // ── এই টেস্টগুলোয় ব্যবহার হয় না ─────────────────────────────────────────

    public Task<SyncResult<EnrollResponse>> EnrollAsync(EnrollRequest r, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<EnrollLoginResponse>> EnrollWithLoginAsync(
        EnrollLoginRequest r, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<ConfigResponse>> GetConfigAsync(CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<HeartbeatResponse>> HeartbeatAsync(HeartbeatRequest r, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<IngestAck>> SendAppUsageAsync(
        IReadOnlyList<AppUsageRecord> items, CancellationToken ct = default) =>
        Task.FromResult(SyncResult<IngestAck>.Ok(
            new IngestAck { Accepted = items.Count, Duplicates = 0, Split = 0 }));

    public Task<SyncResult<IngestAck>> SendEventsAsync(
        IReadOnlyList<AgentEventRecord> events, CancellationToken ct = default) =>
        Task.FromResult(SyncResult<IngestAck>.Ok(
            new IngestAck { Accepted = events.Count, Duplicates = 0, Split = 0 }));

    public Task<SyncResult<ScreenshotAck>> SendScreenshotAsync(
        ScreenshotRecord meta, string webpPath, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<UpdateOffer>> CheckUpdateAsync(string v, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<SyncResult<UpdateDownload>> DownloadUpdateAsync(
        string v, string dest, CancellationToken ct = default) =>
        throw new NotSupportedException();
}
