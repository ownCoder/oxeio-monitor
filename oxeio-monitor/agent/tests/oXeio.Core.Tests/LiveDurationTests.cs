using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// পর্দার চলন্ত ঘড়ি (<see cref="LiveDuration"/>)।
///
/// ⚠️⚠️ মালিকের অভিযোগ থেকে: <i>"0.4.7 e login korar pore sec change hocche na"</i>।
/// অঙ্কে সেকেন্ড বসানো হয়েছিল, কিন্তু গোনা সংখ্যাটা নিজে লাফিয়ে বাড়ে
/// (heartbeat / সেগমেন্ট বন্ধ), তাই পর্দায় কিছুই নড়ত না।
/// </summary>
public class LiveDurationTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 18, 10, 0, 0, TimeSpan.FromHours(6));

    private static TimeSpan Min(double m) => TimeSpan.FromMinutes(m);

    /// <summary>⭐⭐ মূল দাবি — গোনা সংখ্যা না বদলালেও ঘড়ি এগোয়।</summary>
    [Fact]
    public void কাজ_চলাকালীন_সেকেন্ড_এগোয়()
    {
        var live = new LiveDuration();

        var at5 = live.Next(Min(120), T0, T0.AddSeconds(5), counting: true);
        var at9 = live.Next(Min(120), T0, T0.AddSeconds(9), counting: true);

        Assert.Equal(Min(120) + TimeSpan.FromSeconds(5), at5);
        Assert.Equal(Min(120) + TimeSpan.FromSeconds(9), at9);
    }

    /// <summary>
    /// ⭐ idle-এ ঘড়ি থামা — নিয়মই "৬০ সেকেন্ড হাত না চললে গোনা বন্ধ"।
    /// idle-এও চললে জানালা নিজের লেখা কথার বিরুদ্ধে যেত।
    /// </summary>
    [Fact]
    public void Idle_হলে_ঘড়ি_থেমে_থাকে()
    {
        var live = new LiveDuration();

        var shown = live.Next(Min(120), T0, T0.AddMinutes(3), counting: false);

        Assert.Equal(Min(120), shown);
    }

    /// <summary>⚠️ anchor জানা না থাকলে এক সেকেন্ডও বানানো হয় না।</summary>
    [Fact]
    public void Anchor_না_থাকলে_কিছুই_যোগ_হয়_না()
    {
        var live = new LiveDuration();

        var shown = live.Next(Min(120), countedAt: null, T0.AddHours(2), counting: true);

        Assert.Equal(Min(120), shown);
    }

    /// <summary>
    /// ⚠️⚠️ সবচেয়ে জরুরি পাহারা — সার্ভার চুপ হয়ে গেলে জানালা যেন নিজে থেকে
    /// ঘণ্টার পর ঘণ্টা <b>বানিয়ে</b> না ফেলে। ছাদে ঠেকলে সংখ্যাটা জমে যায়।
    /// </summary>
    [Fact]
    public void পুরোনো_anchor_ছাদে_আটকায়()
    {
        var live = new LiveDuration();

        var shown = live.Next(Min(120), T0, T0.AddHours(3), counting: true);

        Assert.Equal(Min(120) + LiveDuration.MaxDrift, shown);
    }

    /// <summary>
    /// ⭐⭐ heartbeat-এর সংখ্যা আপলোড হওয়া সেগমেন্টের যোগফল, তাই সেটা মাঝে
    /// মাঝে আমাদের দেখানো সংখ্যার চেয়ে <b>কম</b> আসে। তখনো ঘড়ি পিছোবে না —
    /// "কাজ করলাম, অথচ সময় কমে গেল" দেখলে গোটা ব্যবস্থাই অবিশ্বাস্য হতো।
    /// </summary>
    [Fact]
    public void সংখ্যা_কম_এলেও_ঘড়ি_পিছোয়_না()
    {
        var live = new LiveDuration();

        var before = live.Next(Min(120), T0, T0.AddMinutes(2), counting: true); // ১২২
        // পরের heartbeat: সার্ভার বলল ১২১ (কিউয়ে কিছু পড়ে আছে)
        var after = live.Next(Min(121), T0.AddMinutes(2), T0.AddMinutes(2), counting: true);

        Assert.Equal(Min(122), before);
        Assert.Equal(Min(122), after);
    }

    /// <summary>
    /// ⚠️ ঢাকার মধ্যরাতে আজকের হিসাব শূন্য হয়। তখন আগের মান ধরে রাখলে
    /// জানালা কাল সারাদিন গতকালের মোট দেখাত।
    /// </summary>
    [Fact]
    public void মধ্যরাতে_শূন্য_হলে_আবার_গোড়া_থেকে()
    {
        var live = new LiveDuration();
        live.Next(Min(300), T0, T0.AddMinutes(1), counting: true);

        var afterMidnight = live.Next(
            TimeSpan.Zero, T0.AddHours(14), T0.AddHours(14), counting: true);

        Assert.Equal(TimeSpan.Zero, afterMidnight);
    }

    /// <summary>⚠️ মেশিনের ঘড়ি পিছিয়ে গেলে ঋণাত্মক সময় যোগ হয় না।</summary>
    [Fact]
    public void ঘড়ি_পিছিয়ে_গেলে_কিছু_যোগ_হয়_না()
    {
        var live = new LiveDuration();

        var shown = live.Next(Min(120), T0, T0.AddMinutes(-5), counting: true);

        Assert.Equal(Min(120), shown);
    }

    /// <summary>
    /// ⚠️⚠️ <b>মাঠের অভিযোগ — "sec barte barte atoke jacche"।</b>
    ///
    /// ০.৪.৮-এ <c>counted</c> আসত সার্ভারের heartbeat থেকে, যেটা সবসময়
    /// <b>পিছিয়ে</b> (আপলোড বাকি সেগমেন্ট কিউয়ে)। নতুন heartbeat এলে candidate
    /// আগের দেখানো মানের চেয়ে কম হতো, আর "পিছোবে না" নিয়মটা তখন ঘড়িটাকে
    /// <b>আটকে রাখত</b> যতক্ষণ না candidate ওই মান ছাড়ায় — অর্থাৎ প্রতি
    /// চক্রে কয়েক মিনিট থমকে থাকা।
    ///
    /// ⭐ সমাধান: <c>counted</c> এখন হোস্ট দেয় খোলা সেগমেন্টসহ, তাই সেটা
    /// নিজেই ধারাবাহিকভাবে বাড়ে। এই টেস্ট সেই ধারাবাহিকতাটাই পাহারা দেয়:
    /// প্রতিটা সেকেন্ডে ঘড়ি <b>কঠোরভাবে</b> এগোবে, snapshot বদলানোর
    /// মুহূর্তেও।
    /// </summary>
    [Fact]
    public void Snapshot_বদলানোর_মুহূর্তেও_ঘড়ি_থামে_না()
    {
        var live = new LiveDuration();
        var previous = TimeSpan.MinValue;

        // হোস্ট প্রতি ৫ মিনিটে নতুন snapshot দেয়; মাঝের সেকেন্ডগুলো জানালা গোনে
        for (var second = 0; second <= 15 * 60; second++)
        {
            var snapshotSecond = second / 300 * 300;          // শেষ snapshot কখন
            var snapshotAt = T0.AddSeconds(snapshotSecond);

            // ⭐ হোস্টের সংখ্যা খোলা সেগমেন্টসহ — snapshot-এর মুহূর্ত পর্যন্ত সঠিক
            var counted = Min(120) + TimeSpan.FromSeconds(snapshotSecond);

            var shown = live.Next(counted, snapshotAt, T0.AddSeconds(second), counting: true);

            Assert.True(
                shown > previous,
                $"{second} সেকেন্ডে ঘড়ি আটকে গেছে ({previous} → {shown})");

            previous = shown;
        }

        // ১৫ মিনিট কাজের পর ঠিক ১৫ মিনিটই বেড়েছে — এক সেকেন্ডও বেশি নয়
        Assert.Equal(Min(135), previous);
    }

    /// <summary>
    /// ⚠️ ছাদটা স্ট্যাটাস প্রকাশের সর্বোচ্চ ব্যবধানের (৫ মিনিট — heartbeat ও
    /// <c>MaxSegmentLength</c> দুটোই) চেয়ে বড় হতেই হবে। সমান হলে ঘড়ি ঠিক
    /// শেষ মুহূর্তে থমকে যেত — ০.৪.৮-এ ঠিক সেটাই হয়েছিল।
    /// </summary>
    [Fact]
    public void ছাদ_প্রকাশের_ব্যবধানের_চেয়ে_বড়()
    {
        Assert.True(LiveDuration.MaxDrift > TimeSpan.FromMinutes(5));
    }

    /// <summary>নতুন গোনা সংখ্যা এলে সেটাই ভিত্তি — ঘড়ি সেখান থেকে চলে।</summary>
    [Fact]
    public void নতুন_সংখ্যা_এলে_সেখান_থেকেই_চলে()
    {
        var live = new LiveDuration();
        live.Next(Min(120), T0, T0.AddSeconds(30), counting: true); // ১২০:৩০

        var t1 = T0.AddMinutes(1);
        var shown = live.Next(Min(125), t1, t1.AddSeconds(10), counting: true);

        Assert.Equal(Min(125) + TimeSpan.FromSeconds(10), shown);
    }
}
