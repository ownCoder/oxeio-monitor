using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

public class SyncHealthPolicyTests
{
    private static readonly DateTimeOffset Start =
        new(2026, 8, 10, 9, 0, 0, TimeSpan.FromHours(6));

    private static readonly SyncHealthPolicy P = SyncHealthPolicy.Default;

    [Fact]
    public void কিউ_খালি_থাকলে_সবসময়_সুস্থ()
    {
        // রাত ৩টায় পাঠানোর কিছু নেই — তখন লাল দেখানোর মানে হয় না
        var h = P.Evaluate(
            lastSuccessAt: Start,
            startedAt: Start,
            queueDepth: 0,
            revoked: false,
            now: Start.AddDays(3));

        Assert.Equal(SyncHealth.Ok, h);
    }

    [Fact]
    public void সদ্য_সিঙ্ক_হলে_সুস্থ()
    {
        var h = P.Evaluate(Start.AddMinutes(10), Start, 40, false, Start.AddMinutes(12));

        Assert.Equal(SyncHealth.Ok, h);
    }

    [Fact]
    public void পনেরো_মিনিট_আটকে_থাকলে_হলুদ()
    {
        var h = P.Evaluate(Start, Start, 40, false, Start.AddMinutes(15));

        Assert.Equal(SyncHealth.Degraded, h);
    }

    [Fact]
    public void দুই_ঘণ্টা_আটকে_থাকলে_লাল()
    {
        var h = P.Evaluate(Start, Start, 40, false, Start.AddHours(2));

        Assert.Equal(SyncHealth.Failing, h);
    }

    /// <summary>
    /// সদ্য ইনস্টল করা এজেন্ট এখনো একবারও সফল হয়নি। চালু হওয়ার সময় থেকে
    /// না গুনলে সে প্রথম মিনিট থেকেই লাল দেখাত — আর স্টাফের প্রথম অভিজ্ঞতাই
    /// হতো "কিছু একটা নষ্ট"।
    /// </summary>
    [Fact]
    public void কখনো_সফল_না_হলে_চালু_হওয়ার_সময়_থেকে_গোনা_হয়()
    {
        Assert.Equal(
            SyncHealth.Ok,
            P.Evaluate(null, Start, 5, false, Start.AddMinutes(5)));

        Assert.Equal(
            SyncHealth.Failing,
            P.Evaluate(null, Start, 5, false, Start.AddHours(3)));
    }

    [Fact]
    public void Revoke_সবকিছুর_আগে()
    {
        // কিউ খালি, সদ্য সিঙ্ক হয়েছে — তবু revoked-ই জিতবে
        var h = P.Evaluate(Start, Start, 0, revoked: true, now: Start);

        Assert.Equal(SyncHealth.Revoked, h);
    }

    [Fact]
    public void J07_এর_বাক্যটি_হুবহু_আছে()
    {
        var text = SyncHealthPolicy.Describe(SyncHealth.Failing, 42);

        Assert.NotNull(text);
        Assert.Contains("সার্ভারে পৌঁছাচ্ছে না, ডেটা লোকালি জমছে", text);
        Assert.Contains("42", text);
    }

    [Fact]
    public void সুস্থ_অবস্থায়_কোনো_বার্তা_নেই()
    {
        Assert.Null(SyncHealthPolicy.Describe(SyncHealth.Ok, 0));
    }

    [Fact]
    public void ডিফল্ট_সময়সীমাগুলো_যা_হওয়ার_কথা()
    {
        Assert.Equal(TimeSpan.FromMinutes(15), SyncHealthPolicy.DefaultDegradedAfter);
        Assert.Equal(TimeSpan.FromHours(2), SyncHealthPolicy.DefaultFailingAfter);
    }
}
