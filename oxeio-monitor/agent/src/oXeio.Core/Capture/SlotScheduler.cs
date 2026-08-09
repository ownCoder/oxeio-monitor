namespace oXeio.Core.Capture;

/// <summary>
/// ⭐ র‍্যান্ডম স্ক্রিনশটের সময় ঠিক করে (A01)।
///
/// প্রতি ৫ মিনিটের একটা "স্লট", আর স্লটের ভেতরে ছবি ওঠে <b>র‍্যান্ডম</b> সেকেন্ডে।
/// ফলে ঘণ্টায় ১২টা ছবি নিয়মিতই আসে, কিন্তু <b>ঠিক কখন</b> আসবে তা কেউ আগে থেকে
/// জানতে পারে না — এটাই পুরো ব্যবস্থার মূল কথা।
///
/// <code>
/// [09:00–09:05] → 09:03:47      [09:15–09:20] → 09:19:55
/// [09:05–09:10] → 09:06:12      [09:20–09:25] → ⏭ স্কিপ (idle ছিল)
/// </code>
/// </summary>
public sealed class SlotScheduler
{
    private readonly TimeSpan _slot;
    private readonly Random _rng;

    public SlotScheduler(int slotMinutes, Random? rng = null)
    {
        if (slotMinutes <= 0) throw new ArgumentOutOfRangeException(nameof(slotMinutes));
        _slot = TimeSpan.FromMinutes(slotMinutes);
        _rng = rng ?? Random.Shared;
    }

    public sealed record Slot(DateTimeOffset SlotStart, DateTimeOffset FireAt);

    /// <summary>
    /// <paramref name="after"/>-এর পরের স্লট আর তার ভেতরে ছবি তোলার মুহূর্ত।
    /// </summary>
    public Slot Next(DateTimeOffset after)
    {
        var slotStart = FloorToSlot(after) + _slot;
        var offset = _rng.NextDouble() * _slot.TotalSeconds;
        return new Slot(slotStart, slotStart + TimeSpan.FromSeconds(offset));
    }

    /// <summary>ওই মুহূর্তটা যে স্লটে পড়ে, তার শুরু।</summary>
    public DateTimeOffset FloorToSlot(DateTimeOffset t)
    {
        var ticks = t.UtcTicks - (t.UtcTicks % _slot.Ticks);
        return new DateTimeOffset(ticks, TimeSpan.Zero);
    }
}
