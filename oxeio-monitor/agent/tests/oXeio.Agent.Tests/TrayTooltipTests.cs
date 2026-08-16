using oXeio.Agent.Ui;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Tests;

/// <summary>
/// টুলটিপের <b>অগ্রাধিকার ক্রম</b>।
///
/// ⚠️⚠️ এখানে টেস্ট করার আসল জিনিসটা লেখা নয়, <b>ক্রম</b> — কোন খবরটা
/// ৬৩ ঘরের মধ্যে জায়গা পাবে। ভুল ক্রম মানে সবচেয়ে জরুরি খবরটাই কেটে যাওয়া,
/// আর সেটা কোনো কম্পাইলার ধরে না।
/// </summary>
public class TrayTooltipTests
{
    private static AgentStatus Status(
        bool enrolled = true,
        SyncHealth health = SyncHealth.Ok,
        int queued = 0) => new()
    {
        State = SegmentState.Active,
            Update = UpdateStatus.Idle,
        ActiveToday = TimeSpan.FromHours(3),
        ActiveThisMonth = TimeSpan.FromHours(40),
        MonthlyTargetHours = 208,
        QueueDepth = queued,
        Health = health,
        Paused = false,
        Enrolled = enrolled,
    };

    [Fact]
    public void সাইন_ইন_করা_থাকলে_চলতি_অবস্থাই_দেখায() =>
        Assert.Contains("Working", TrayTooltip.Build(Status()), StringComparison.Ordinal);

    /**
     * ⭐⭐ <b>এই ফাইলের মূল টেস্ট।</b> সাইন ইন না করা থাকলে আউটবক্স খালি,
     * তাই <c>SyncHealthPolicy</c> সুস্থ (<c>Ok</c>) বলে — আর সুস্থ পথে
     * টুলটিপ লিখত "Working · 0:00 today"। অর্থাৎ যে একটামাত্র কারণে কিছুই
     * হচ্ছিল না, ঠিক সেটাই ছিল পর্দার একমাত্র অদৃশ্য জিনিস।
     */
    [Fact]
    public void সাইন_ইন_না_করা_থাকলে_সেটাই_প্রথমে()
    {
        var text = TrayTooltip.Build(Status(enrolled: false));

        Assert.Contains(TrayTooltip.NotEnrolledLine, text, StringComparison.Ordinal);
        Assert.DoesNotContain("Working", text, StringComparison.Ordinal);
    }

    /// <summary>
    /// ⚠️ শুধু "Not signed in" নয় — স্টাফকে জানতে হবে <b>এখন ঘণ্টা জমছে না</b>,
    /// নইলে বার্তাটা নিরীহ শোনায় আর সে সাইন ইন করতে দেরি করে।
    /// </summary>
    [Fact]
    public void বার্তায়_ঘণ্টা_না_জমার_কথা_আছে() =>
        Assert.Contains(
            "not counting",
            TrayTooltip.Build(Status(enrolled: false)),
            StringComparison.OrdinalIgnoreCase);

    /**
     * ⚠️ revoke সাইন-ইনের চেয়েও আগে। revoke করলে টোকেন মুছে যায়, তাই
     * <c>Enrolled</c> তখন মিথ্যা — দুটো শর্তই সত্যি। ক্রম উল্টে গেলে বাতিল
     * মেশিনে স্টাফ পড়ত "সাইন ইন করুন"।
     */
    [Fact]
    public void বাতিল_হলে_সাইন_ইনের_কথা_নয়()
    {
        var text = TrayTooltip.Build(
            Status(enrolled: false, health: SyncHealth.Revoked));

        Assert.Contains(TrayTooltip.RevokedLine, text, StringComparison.Ordinal);
        Assert.DoesNotContain("Sign in", text, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>⚠️ টুলটিপ কখনোই খালি হতে পারে না — খালি szTip মানে hover-এ কিছুই নেই।</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void টুলটিপ_কখনো_খালি_নয়(bool enrolled) =>
        Assert.False(string.IsNullOrWhiteSpace(TrayTooltip.Build(Status(enrolled))));

    /// <summary>৬৩ ঘরের সীমা — Win32-র <c>NOTIFYICONDATA.szTip</c>।</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void সীমার_মধ্যে_থাকে(bool enrolled) =>
        Assert.True(TrayTooltip.Build(Status(enrolled)).Length <= TrayTooltip.MaxLength);
}
