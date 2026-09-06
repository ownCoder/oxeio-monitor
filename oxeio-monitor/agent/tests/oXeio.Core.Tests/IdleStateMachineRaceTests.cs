using System.Collections.Concurrent;

using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// ⭐⭐⭐ <b>একাধিক থ্রেড একসাথে</b> <i>(৬ সেপ্টেম্বর ২০২৬, G160)</i>।
///
/// ⚠️⚠️ <b>যে বাগটা এই ফাইলটা পাহারা দেয়:</b> <c>AgentHost</c>-এ লেখা ছিল
/// "<c>_machine</c> এই লুপের সম্পত্তি" — কিন্তু <b>তিনটে</b> থ্রেড ওটাকে
/// বদলাত: ট্র্যাকার (<c>Tick</c>), WinForms মেসেজ-পাম্প
/// (<c>OnPower → OnSuspend/OnResume</c>), আর থ্রেড পুল
/// (<c>DisposeAsync → CloseAll</c>)। কোথাও কোনো তালা ছিল না।
///
/// ⚠️⚠️ দুজন একসাথে <c>EmitAndReopen</c>-এ ঢুকলে দুজনেই একই
/// <c>_openedAt</c> পড়ে, আর <b>একই সময়টুকু</b> দুটো আলাদা
/// <c>ClientUuid</c> নিয়ে সেগমেন্ট বানায়। সার্ভার কেবল <c>client_uuid</c>
/// দেখে ছাঁটে, ওভারল্যাপ দেখে না — <b>ওই সময়টা দুবার গোনা হয়, দুবার
/// টাকাও হয়</b>।
///
/// ⭐ <b>টেস্টটা কীভাবে ধরে:</b> সেগমেন্টগুলো সময়ের রেখায় <b>টালির মতো</b>
/// বসার কথা — একটা শেষ হলে পরেরটা শুরু, কখনো ওভারল্যাপ নয়। তালা তুলে
/// নিলে এই নিয়মটাই ভাঙে।
///
/// ⚠️ <b>এটা সম্ভাবনার টেস্ট, নিশ্চয়তার নয়</b> — তাই ধাক্কাটা ইচ্ছাকৃতভাবে
/// বড় (<see cref="Rounds"/>), আর দুই থ্রেডই একই ঘড়ি থেকে সময় নেয় যাতে
/// তারা সত্যিই একই মুহূর্তে ভেতরে ঢোকে। তালা সরিয়ে চালালে এটা লাল হয়।
/// </summary>
public class IdleStateMachineRaceTests
{
    private static readonly TimeSpan Threshold = TimeSpan.FromSeconds(60);
    private static readonly DateTimeOffset Start =
        new(2026, 9, 6, 4, 0, 0, TimeSpan.Zero); // ঢাকায় সকাল ১০টা

    /// <summary>
    /// ⚠️ কম রাউন্ডে দৌড়টা ধরা পড়ে না। ক্রিটিক্যাল সেকশনটা মাইক্রোসেকেন্ডের
    /// ভগ্নাংশ, তাই সংঘর্ষের সুযোগ তৈরি করতে হলে অনেকবার চালাতে হয়।
    /// </summary>
    private const int Rounds = 60_000;

    /// <summary>
    /// দুই থ্রেড একই ঘড়ি থেকে সময় নেয়। ⚠️ আলাদা ঘড়ি হলে একজন সবসময়
    /// অন্যজনের চেয়ে এগিয়ে থাকত আর ক্ল্যাম্পই সব ঢেকে দিত — দৌড়টা তখন
    /// টেস্টেও ধরা পড়ত না, মাঠেও থেকে যেত।
    /// </summary>
    private sealed class SharedClock
    {
        private long _ticks;
        public DateTimeOffset Next() => Start.AddMilliseconds(Interlocked.Increment(ref _ticks) * 10);
    }

    /// <summary>
    /// ⭐ <b>মূল নিয়ম</b> — সেগমেন্টগুলো টালির মতো বসে, একটাও আরেকটার
    /// উপরে ওঠে না।
    /// </summary>
    private static void AssertNoOverlap(IEnumerable<ActivitySegment> segments)
    {
        var sorted = segments.OrderBy(s => s.StartedAt).ThenBy(s => s.EndedAt).ToList();

        for (var i = 0; i < sorted.Count; i++)
        {
            Assert.True(
                sorted[i].EndedAt >= sorted[i].StartedAt,
                $"সেগমেন্ট #{i} উল্টো: {sorted[i].StartedAt:O} → {sorted[i].EndedAt:O}");

            if (i == 0) continue;

            Assert.True(
                sorted[i].StartedAt >= sorted[i - 1].EndedAt,
                $"ওভারল্যাপ #{i}: আগেরটা শেষ {sorted[i - 1].EndedAt:O}, " +
                $"এটা শুরু {sorted[i].StartedAt:O} — ওই সময়টা দুবার গোনা হতো");
        }
    }

    /// <summary>
    /// ⭐⭐⭐ <b>এই ফাইলের মূল টেস্ট</b> — ট্র্যাকার টিক করছে, আর ঠিক তখনই
    /// মেসেজ-পাম্প থেকে পর্দা ঘুমানো/জাগার খবর আসছে।
    ///
    /// ⚠️ মাঠে এটাই সবচেয়ে চেনা মুহূর্ত: অফিসের idle টাইমআউটে মনিটর
    /// নিভে যায়, উইন্ডোজ <c>PBT_POWERSETTINGCHANGE</c> পাঠায়, আর সেটা
    /// UI থ্রেডে সরাসরি <c>OnSuspend</c> ডাকে — ট্র্যাকার তখনো টিকের ভেতরে।
    /// </summary>
    [Fact]
    public void ট্র্যাকার_আর_পাওয়ার_একসাথে_ঢুকলেও_সময়_দুবার_গোনা_হয়_না()
    {
        var clock = new SharedClock();
        var sm = new IdleStateMachine(Threshold, Start);
        var all = new ConcurrentBag<ActivitySegment>();

        var tracker = new Thread(() =>
        {
            for (var i = 0; i < Rounds; i++)
            {
                // ⚠️ ইনপুট থাকা আর না-থাকা পালা করে — নইলে স্টেট বদলাত না
                //    আর `EmitAndReopen` কখনো ডাকাই হতো না।
                var sinceInput = i % 2 == 0 ? TimeSpan.Zero : Threshold + TimeSpan.FromSeconds(1);

                foreach (var s in sm.Tick(clock.Next(), sinceInput, locked: false, screenFrozen: false))
                    all.Add(s);
            }
        });

        var pump = new Thread(() =>
        {
            for (var i = 0; i < Rounds; i++)
            {
                foreach (var s in sm.OnSuspend(clock.Next())) all.Add(s);
                foreach (var s in sm.OnResume(clock.Next())) all.Add(s);
            }
        });

        tracker.Start();
        pump.Start();
        Assert.True(tracker.Join(TimeSpan.FromMinutes(2)), "ট্র্যাকার থ্রেড আটকে গেছে");
        Assert.True(pump.Join(TimeSpan.FromMinutes(2)), "পাম্প থ্রেড আটকে গেছে");

        Assert.NotEmpty(all);
        AssertNoOverlap(all);
    }

    /// <summary>
    /// ⚠️ <c>DisposeAsync</c> থ্রেড পুল থেকে <c>CloseAll</c> ডাকে ঠিক যখন
    /// ট্র্যাকার টিকের মাঝপথে — <c>_stopping</c> বাতিল করা মানেই ট্র্যাকার
    /// থেমে গেছে নয়, সে টোকেনটা দেখে কেবল লুপের মাথায়।
    /// </summary>
    [Fact]
    public void বন্ধ_হওয়ার_সময়_শেষ_সেগমেন্টও_ওভারল্যাপ_করে_না()
    {
        var clock = new SharedClock();
        var sm = new IdleStateMachine(Threshold, Start);
        var all = new ConcurrentBag<ActivitySegment>();

        var tracker = new Thread(() =>
        {
            for (var i = 0; i < Rounds; i++)
                foreach (var s in sm.Tick(clock.Next(), TimeSpan.Zero, locked: i % 3 == 0, screenFrozen: false))
                    all.Add(s);
        });

        var closer = new Thread(() =>
        {
            for (var i = 0; i < Rounds; i++)
                foreach (var s in sm.CloseAll(clock.Next())) all.Add(s);
        });

        tracker.Start();
        closer.Start();
        Assert.True(tracker.Join(TimeSpan.FromMinutes(2)), "ট্র্যাকার থ্রেড আটকে গেছে");
        Assert.True(closer.Join(TimeSpan.FromMinutes(2)), "বন্ধ করার থ্রেড আটকে গেছে");

        Assert.NotEmpty(all);
        AssertNoOverlap(all);
    }

    /// <summary>
    /// ⚠️⚠️ <b>ঘড়ি পিছিয়ে গেলেও <c>CloseAll</c> সময় পিছোতে পারে না</b>
    /// <i>(G160)</i>। আগে <c>_openedAt = at</c> শর্তহীন ছিল: পিছিয়ে যাওয়া
    /// সময় দিলে সেগমেন্ট বেরোত না (দৈর্ঘ্য শূন্য), অথচ <c>_openedAt</c>
    /// <b>পিছিয়ে</b> যেত — আর পরের সেগমেন্টটা আগেরটার ভেতরে ঢুকে পড়ত।
    ///
    /// ⭐ এটা সম্ভাবনার নয়, <b>নিশ্চিত</b> টেস্ট — তাই তালা ঠিক থাকলেও
    /// এই একটা লাইন ফিরিয়ে দিলে এটা লাল হয়।
    /// </summary>
    [Fact]
    public void পিছিয়ে_যাওয়া_ঘড়িতে_CloseAll_সময়_পিছোয়_না()
    {
        var sm = new IdleStateMachine(Threshold, Start);

        var first = sm.CloseAll(Start.AddMinutes(10));
        Assert.Single(first);

        // ⚠️ ঘড়ি ৫ মিনিট পিছিয়ে গেল (NTP সংশোধন, বা drift ঠিক হওয়া)
        Assert.Empty(sm.CloseAll(Start.AddMinutes(5)));

        var third = sm.CloseAll(Start.AddMinutes(12));

        Assert.Single(third);
        Assert.Equal(Start.AddMinutes(10), third[0].StartedAt);
        AssertNoOverlap(first.Concat(third));
    }
}
