using oXeio.Core.Capture;

namespace oXeio.Core.Tests;

public class SlotSchedulerTests
{
    private static readonly DateTimeOffset Nine =
        new(2026, 8, 9, 3, 0, 0, TimeSpan.Zero); // ঢাকায় সকাল ৯টা

    [Fact]
    public void ছবি_সবসময়_নিজের_স্লটের_ভেতরেই_ওঠে()
    {
        var s = new SlotScheduler(5, new Random(42));
        var at = Nine;

        for (var i = 0; i < 500; i++)
        {
            var slot = s.Next(at);
            Assert.InRange(slot.FireAt, slot.SlotStart, slot.SlotStart.AddMinutes(5));
            at = slot.FireAt;
        }
    }

    [Fact]
    public void দুই_ঘণ্টায়_চব্বিশটা_স্লট()
    {
        var s = new SlotScheduler(5, new Random(7));

        // Next() সবসময় *পরের* স্লট দেয়, তাই ৯টার স্লটটা পেতে একটু আগে থেকে শুরু
        var at = Nine.AddMinutes(-5);
        var count = 0;

        while (true)
        {
            var slot = s.Next(at);
            if (slot.SlotStart >= Nine.AddHours(2)) break;
            count++;
            at = slot.SlotStart;
        }

        Assert.Equal(24, count); // ঘণ্টায় ১২টা × ২
    }

    [Fact]
    public void পরপর_দুটো_ছবির_ব্যবধান_একরকম_হয়_না()
    {
        var s = new SlotScheduler(5, new Random(1234));
        var at = Nine;
        var gaps = new List<double>();

        for (var i = 0; i < 30; i++)
        {
            var slot = s.Next(at);
            gaps.Add((slot.FireAt - at).TotalSeconds);
            at = slot.FireAt;
        }

        // অনুমান করা গেলে পুরো ব্যবস্থাটাই অর্থহীন (A01)
        Assert.True(gaps.Distinct().Count() > 25, "ব্যবধানগুলো যথেষ্ট আলাদা নয়");
    }

    [Fact]
    public void স্লটের_শুরু_সবসময়_পাঁচ_মিনিটের_ঘরে()
    {
        var s = new SlotScheduler(5, new Random(9));

        for (var i = 0; i < 100; i++)
        {
            var slot = s.Next(Nine.AddSeconds(i * 37));
            Assert.Equal(0, slot.SlotStart.Minute % 5);
            Assert.Equal(0, slot.SlotStart.Second);
        }
    }
}
