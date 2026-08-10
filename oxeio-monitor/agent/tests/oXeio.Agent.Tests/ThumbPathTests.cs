using oXeio.Agent.Storage;

namespace oXeio.Agent.Tests;

/// <summary>
/// A06 — থাম্বনেইলের পথ।
///
/// ⭐ চারটে আলাদা জায়গা এই নিয়মটা মানে: লেখা · পাঠানো · মোছা · অনাথ-ঝাড়ু।
/// একটাও আলাদা হলে হয় থাম্বনেইল কখনো যেত না, নয়তো ঝাড়ুদার প্রতিটা
/// থাম্বনেইল অনাথ ভেবে <b>মুছে দিত</b> — আর কেউ বুঝতই না কেন গ্যালারি
/// হঠাৎ আবার ধীর হয়ে গেল।
/// </summary>
public class ThumbPathTests
{
    [Fact]
    public void মূল_ছবির_পাশেই_থাকে()
    {
        var main = @"C:\ProgramData\oXeio\queue\2026-08-11\140500-m0-abc.webp";

        Assert.Equal(
            @"C:\ProgramData\oXeio\queue\2026-08-11\140500-m0-abc-thumb.webp",
            OutboxPaths.ThumbPathFor(main));
    }

    /// <summary>⚠️ শেষটা .webp থাকতেই হবে — ঝাড়ুদার `*.webp` খোঁজে।</summary>
    [Fact]
    public void থাম্বনেইলও_webp_থাকে() =>
        Assert.EndsWith(".webp", OutboxPaths.ThumbPathFor("x/y.webp"));

    /// <summary>দুবার ডাকলে যেন `-thumb-thumb` না হয়ে যায়।</summary>
    [Fact]
    public void নিজের_উপর_আবার_চালালে_আলাদা_পথ()
    {
        var once = OutboxPaths.ThumbPathFor("a.webp");

        Assert.NotEqual(once, OutboxPaths.ThumbPathFor(once));
    }
}
