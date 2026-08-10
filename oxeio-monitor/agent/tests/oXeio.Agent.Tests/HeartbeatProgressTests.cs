using oXeio.Agent.Sync;
using oXeio.Core.Agent;

namespace oXeio.Agent.Tests;

/// <summary>
/// heartbeat-এর উত্তরে আসা <c>progress</c> — tray-র "এ মাসে x / ২০৮ঘ"-এর
/// একমাত্র উৎস।
///
/// ⭐ এই ফিল্ডটা DTO-তে ছিলই না, ফলে সার্ভার সংখ্যাটা পাঠালেও এজেন্ট চুপচাপ
/// ফেলে দিত আর tray চিরকাল <b>০ ঘণ্টা</b> দেখাত। বাগটা নীরব ছিল কারণ সার্ভারের
/// দিকে সব ঠিকই ছিল — শুধু একটা ঘর অনুপস্থিত। J03 (লক্ষ্যপূরণের বেলুন) আর
/// J04 (আজকের হিসাব) দুটোই এর উপর দাঁড়িয়ে।
/// </summary>
public class HeartbeatProgressTests
{
    private static HeartbeatResponse Parse(string json)
    {
        var dto = SyncJson.TryDeserialize<SyncWire.HeartbeatResponseDto>(json);
        Assert.NotNull(dto);
        return SyncWire.ToHeartbeatResponse(dto!);
    }

    /// <summary>সার্ভারের <c>agent.controller.ts</c> ঠিক এই আকৃতিটাই ফেরায়।</summary>
    [Fact]
    public void সার্ভারের_progress_পড়া_হয()
    {
        var response = Parse(
            """
            {
              "commands": [],
              "configVersion": "abc123",
              "progress": {
                "todayActiveSec": 12600,
                "monthActiveSec": 228240,
                "monthlyTargetHours": 208
              }
            }
            """);

        Assert.NotNull(response.Progress);
        Assert.Equal(12_600, response.Progress!.TodayActiveSec);
        Assert.Equal(228_240, response.Progress.MonthActiveSec);
        Assert.Equal(208, response.Progress.MonthlyTargetHours);

        // সার্ভার এখনো pace পাঠায় না — null-ই থাকতে হবে, ০ নয়
        Assert.Null(response.Progress.PaceSec);
    }

    /// <summary>ডিভাইসের সাথে কর্মী যুক্ত না থাকলে সার্ভার <c>null</c> পাঠায়।</summary>
    [Fact]
    public void কর্মী_যুক্ত_না_থাকলে_null()
    {
        var response = Parse("""{"commands":[],"configVersion":"x","progress":null}""");

        Assert.Null(response.Progress);
    }

    /// <summary>
    /// ⚠️ টার্গেট ০ এলে পুরো progress বাতিল। শূন্য টার্গেটে
    /// <see cref="AgentStatus.MonthlyProgress"/> ০ ফেরত দেয়, অর্থাৎ পুরো মাস
    /// কাজ করা মানুষের প্রগ্রেস বার সারা মাস খালি দেখাত।
    /// </summary>
    [Fact]
    public void শূন্য_টার্গেট_মেনে_নেওয়া_হয_না()
    {
        var response = Parse(
            """{"progress":{"todayActiveSec":10,"monthActiveSec":20,"monthlyTargetHours":0}}""");

        Assert.Null(response.Progress);
    }

    /// <summary>
    /// ⭐ সবচেয়ে জরুরি সুরক্ষা: অগ্রগতির একটা ঘর হারানোর দাম যেন
    /// <b>কমান্ড</b> হারানো না হয়। সার্ভার একদিন একটা ফিল্ড বাদ দিলে বা নতুন
    /// ফিল্ড যোগ করলেও revoke/reload_config পৌঁছাতে হবে।
    /// </summary>
    [Fact]
    public void progress_ভাঙা_থাকলেও_কমান্ড_পৌঁছায়()
    {
        var response = Parse(
            """
            {
              "commands": ["revoke"],
              "configVersion": "v9",
              "progress": { "monthActiveSec": 100, "somethingNew": true }
            }
            """);

        Assert.Contains(AgentCommand.Revoke, response.Commands);
        Assert.Equal("v9", response.ConfigVersion);

        // monthlyTargetHours নেই → progress বিশ্বাসযোগ্য নয়, কিন্তু কমান্ড এসেছে
        Assert.Null(response.Progress);
    }

    /// <summary>সার্ভার একদিন pace পাঠালে সেটা যেন আপনাআপনিই কাজে লাগে (B05b)।</summary>
    [Fact]
    public void paceSec_এলে_পড়া_হয()
    {
        var response = Parse(
            """
            {
              "progress": {
                "todayActiveSec": 0,
                "monthActiveSec": 100,
                "monthlyTargetHours": 208,
                "paceSec": -26640
              }
            }
            """);

        Assert.Equal(-26_640, response.Progress!.PaceSec);
    }
}
