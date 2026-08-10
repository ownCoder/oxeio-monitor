using oXeio.Agent.Storage;
using oXeio.Agent.Sync;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Tests;

public class SyncWorkerTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 10, 10, 0, 0, TimeSpan.FromHours(6));

    private static ActivitySegment Segment(int i) => new()
    {
        ClientUuid = Guid.Parse($"00000000-0000-0000-0000-{i:D12}"),
        State = SegmentState.Active,
        StartedAt = T0.AddMinutes(i),
        EndedAt = T0.AddMinutes(i + 1),
        DurationSec = 60,
    };

    private static async Task<FakeOutbox> Filled(int count)
    {
        var box = new FakeOutbox();
        for (var i = 1; i <= count; i++)
            await box.EnqueueAsync(OutboxCodec.Item(Segment(i), T0));
        return box;
    }

    private static SyncWorker Worker(FakeOutbox box, FakeSyncClient client) =>
        new(box, client, clock: () => T0);

    [Fact]
    public async Task সফল_হলে_সব_সারি_কিউ_থেকে_চলে_যায়()
    {
        var box = await Filled(10);
        var client = new FakeSyncClient();

        await Worker(box, client).DrainOnceAsync();

        Assert.Empty(box.RemainingUuids);
        Assert.Equal(10, client.AcceptedSegments);
    }

    [Fact]
    public async Task সাময়িক_ব্যর্থতায়_কিছুই_হারায়_না()
    {
        var box = await Filled(10);
        var client = new FakeSyncClient();
        client.ForcedOutcomes.Enqueue(SyncOutcome.Transient);

        await Worker(box, client).DrainOnceAsync();

        Assert.Equal(10, box.RemainingUuids.Count);
        Assert.Empty(box.Abandoned);
        Assert.Equal(1, box.RetriedBatches);
    }

    /// <summary>
    /// ⭐ এটাই সবচেয়ে জরুরি টেস্ট। ২০টার মধ্যে ১টা রেকর্ড বেঠিক — সার্ভার
    /// পুরো ব্যাচেই ৪০০ দেয়। সরল বাস্তবায়ন ২০টাই ফেলে দিত, অর্থাৎ ১৯ জনের
    /// কাজের হিসাব একজনের ভুলের জন্য হারাত।
    /// </summary>
    [Fact]
    public async Task একটা_খারাপ_রেকর্ড_বাকিদের_ডোবায়_না()
    {
        var box = await Filled(20);
        var client = new FakeSyncClient();
        client.PoisonUuids.Add(Segment(7).ClientUuid);

        var worker = new SyncWorker(box, client, clock: () => T0);

        // ব্যাচ অর্ধেক হতে হতে দোষীটা একা পড়ে — কয়েক চক্র লাগে
        for (var i = 0; i < 12; i++) await worker.DrainOnceAsync();

        Assert.Empty(box.RemainingUuids);

        // ঠিক একটা বাদ পড়েছে, আর সেটা দোষীটাই
        Assert.Single(box.Abandoned);
        Assert.Contains(Segment(7).ClientUuid.ToString(), box.Abandoned[0]);

        // বাকি ১৯টা সার্ভারে পৌঁছেছে
        Assert.Equal(19, client.AcceptedSegments);
    }

    [Fact]
    public async Task খারাপ_রেকর্ড_খুঁজতে_ব্যাচ_সত্যিই_ছোট_হয়()
    {
        var box = await Filled(20);
        var client = new FakeSyncClient();
        client.PoisonUuids.Add(Segment(3).ClientUuid);

        var worker = new SyncWorker(box, client, clock: () => T0);
        for (var i = 0; i < 12; i++) await worker.DrainOnceAsync();

        // প্রথম চেষ্টা পুরো ২০টা নিয়ে, তারপর ধাপে ধাপে ছোট
        Assert.Equal(20, client.SegmentBatchSizes[0]);
        Assert.Contains(1, client.SegmentBatchSizes);
        Assert.True(
            client.SegmentBatchSizes.Count >= 4,
            "ব্যাচ ছোট না করেই ফেলে দেওয়া হয়েছে?");
    }

    [Fact]
    public async Task Revoke_হলে_ডেটা_মোছা_হয়_না()
    {
        var box = await Filled(5);
        var client = new FakeSyncClient();
        client.ForcedOutcomes.Enqueue(SyncOutcome.Revoked);

        var worker = new SyncWorker(box, client, clock: () => T0);
        await worker.DrainOnceAsync();

        Assert.True(worker.Revoked);
        Assert.Empty(box.Abandoned);

        // ⚠️ revoke ভুল করেও হতে পারে — সারিগুলো ফেরত পাওয়ার একমাত্র উপায় ওগুলো টিকে থাকা
        Assert.Equal(5, box.RemainingUuids.Count);
    }

    [Fact]
    public async Task Revoke_এর_পর_আর_চেষ্টা_হয়_না()
    {
        var box = await Filled(5);
        var client = new FakeSyncClient();
        client.ForcedOutcomes.Enqueue(SyncOutcome.Revoked);

        var worker = new SyncWorker(box, client, clock: () => T0);
        await worker.DrainOnceAsync();
        var callsAfterRevoke = client.SegmentBatchSizes.Count;

        await worker.DrainOnceAsync();
        await worker.DrainOnceAsync();

        Assert.Equal(callsAfterRevoke, client.SegmentBatchSizes.Count);
    }

    [Fact]
    public async Task পড়া_যায়_না_এমন_সারি_কিউ_আটকে_রাখে_না()
    {
        var box = new FakeOutbox();
        await box.EnqueueAsync(new OutboxItem
        {
            ClientUuid = Guid.NewGuid(),
            Kind = OutboundKind.Segment,
            EnqueuedAt = T0,
            Payload = "{ এটা বৈধ JSON নয়",
            SizeBytes = 20,
        });

        var client = new FakeSyncClient();
        var worker = new SyncWorker(box, client, clock: () => T0);

        await worker.DrainOnceAsync();

        // নষ্ট সারিটা বাদ পড়েছে, কিউ পরিষ্কার — মাথায় বসে সব আটকে রাখেনি
        Assert.Empty(box.RemainingUuids);
        Assert.Single(box.Abandoned);
    }

    [Fact]
    public async Task সেগমেন্ট_স্ক্রিনশটের_আগে_যায়()
    {
        var box = new FakeOutbox();
        await box.EnqueueAsync(OutboxCodec.Item(
            new ScreenshotRecord
            {
                ClientUuid = Guid.NewGuid(),
                SlotStart = T0,
                CapturedAt = T0,
                MonitorIndex = 0,
            },
            webpPath: Path.Combine(Path.GetTempPath(), "oxeio-নেই.webp"),
            fileBytes: 1000,
            now: T0));
        await box.EnqueueAsync(OutboxCodec.Item(Segment(1), T0));

        var client = new FakeSyncClient();
        await Worker(box, client).DrainOnceAsync();

        // সেগমেন্ট গেছে; ছবিটা ফাইল না থাকায় বাদ পড়েছে — কিন্তু সেগমেন্টের
        // পরে, আগে নয়
        Assert.Equal(1, client.AcceptedSegments);
    }

    [Fact]
    public async Task খালি_কিউয়ে_কিছুই_ঘটে_না()
    {
        var box = new FakeOutbox();
        var client = new FakeSyncClient();

        await Worker(box, client).DrainOnceAsync();

        Assert.Empty(client.SegmentBatchSizes);
        Assert.Equal(0, box.AckedBatches);
    }
}
