using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// **I01** — সার্ট পিনিংয়ের সিদ্ধান্ত।
///
/// ⚠️⚠️ এই ফাইলের অর্ধেক টেস্ট একটাই ভুলের পাহারা: <b>পিন মিলেছে বলেই
/// `true` বলে দেওয়া</b>। .NET-এ কলব্যাক বসানোর মানে তার নিজের সব যাচাই
/// বন্ধ — হোস্টনেম, মেয়াদ, চেইন। পিন মিলে গেলেই ছেড়ে দিলে ওগুলো নীরবে
/// চলে যেত, আর কেউ কোনোদিন টের পেত না, কারণ সংযোগ তো ঠিকই হচ্ছে।
/// </summary>
public class CertificatePinTests
{
    private const string PinA = "aGFzaC1vZi1zZXJ2ZXItYQ==";
    private const string PinB = "aGFzaC1vZi1zZXJ2ZXItYg==";

    private static string[] Pins(params string[] pins) => pins;

    [Fact]
    public void পিন_না_থাকলে_যাচাই_ওএসের_হাতে() =>
        Assert.Equal(
            CertificatePin.Verdict.NoPinConfigured,
            CertificatePin.Check([], PinA, chainOk: true));

    [Fact]
    public void পিন_মিললে_আর_চেইন_ঠিক_থাকলে_চলে() =>
        Assert.Equal(
            CertificatePin.Verdict.Trusted,
            CertificatePin.Check(Pins(PinA), PinA, chainOk: true));

    [Fact]
    public void পিন_না_মিললে_প্রত্যাখ্যান() =>
        Assert.Equal(
            CertificatePin.Verdict.PinMismatch,
            CertificatePin.Check(Pins(PinA), PinB, chainOk: true));

    /**
     * ⭐⭐ এই ফাইলের সবচেয়ে জরুরি টেস্ট। পিনটা মিলেছে, তবু **না** —
     * কারণ হোস্টনেম মেলেনি, বা মেয়াদ শেষ, বা চেইন ভাঙা। কলব্যাক বসানোর
     * পর .NET আর নিজে থেকে এগুলো দেখে না; না দেখলে একটা মেয়াদোত্তীর্ণ
     * সার্ট চিরকাল চলত।
     */
    [Fact]
    public void পিন_মিললেও_চেইন_ভাঙা_থাকলে_প্রত্যাখ্যান() =>
        Assert.Equal(
            CertificatePin.Verdict.ChainInvalid,
            CertificatePin.Check(Pins(PinA), PinA, chainOk: false));

    [Fact]
    public void সার্টই_না_এলে_প্রত্যাখ্যান() =>
        Assert.Equal(
            CertificatePin.Verdict.NoCertificate,
            CertificatePin.Check(Pins(PinA), null, chainOk: true));

    /**
     * ⚠️ সার্ট নবায়নের দিন পুরোনো ও নতুন — দুটোই কিছুক্ষণ বৈধ থাকা দরকার।
     * একটাই পিন রাখলে নবায়নের মুহূর্তে ১৫টা এজেন্ট একসাথে সংযোগ হারাত
     * (রানবুক § ৭.১-এর ক্রমটাই এই কারণে)।
     */
    [Fact]
    public void দুটো_পিনের_যেকোনো_একটা_মিললেই_চলে()
    {
        Assert.Equal(
            CertificatePin.Verdict.Trusted,
            CertificatePin.Check(Pins(PinA, PinB), PinB, chainOk: true));

        Assert.Equal(
            CertificatePin.Verdict.Trusted,
            CertificatePin.Check(Pins(PinA, PinB), PinA, chainOk: true));
    }

    /** ⚠️ base64 case-sensitive — এক অক্ষরের হেরফেরও আলাদা কী */
    [Fact]
    public void তুলনাটা_অক্ষরের_ছাঁদ_মেনে_চলে() =>
        Assert.Equal(
            CertificatePin.Verdict.PinMismatch,
            CertificatePin.Check(Pins(PinA), PinA.ToLowerInvariant(), chainOk: true));

    // ── Parse ───────────────────────────────────────────────────────────────

    [Fact]
    public void খালি_কনফিগে_কোনো_পিন_নেই()
    {
        Assert.Empty(CertificatePin.Parse(null));
        Assert.Empty(CertificatePin.Parse(""));
        Assert.Empty(CertificatePin.Parse("   "));
    }

    /**
     * ⚠️ রেজিস্ট্রিতে হাতে বসানো মান প্রায়ই শেষে একটা কমা বা বাড়তি ফাঁকা
     * জায়গা নিয়ে আসে। ছেঁকে না নিলে একটা **খালি স্ট্রিং** পিন হিসেবে
     * ঢুকত — যা কোনোদিন কিছুর সাথে মিলত না, কিন্তু তালিকাটাকে "অখালি"
     * বানিয়ে রাখত, অর্থাৎ পিনিং চালু অথচ সবসময় ব্যর্থ।
     */
    [Fact]
    public void ফাঁকা_জায়গা_ও_বাড়তি_কমা_ছেঁকে_নেয()
    {
        var pins = CertificatePin.Parse($" {PinA} , {PinB} , ");

        Assert.Equal(2, pins.Count);
        Assert.Equal(PinA, pins[0]);
        Assert.Equal(PinB, pins[1]);
    }

    [Fact]
    public void একটা_পিনও_চলে() =>
        Assert.Single(CertificatePin.Parse(PinA));

    /** প্রতিটা অবস্থার জন্য মানুষের পড়ার মতো একটা বাক্য থাকতেই হবে */
    [Theory]
    [InlineData(CertificatePin.Verdict.Trusted)]
    [InlineData(CertificatePin.Verdict.PinMismatch)]
    [InlineData(CertificatePin.Verdict.ChainInvalid)]
    [InlineData(CertificatePin.Verdict.NoCertificate)]
    [InlineData(CertificatePin.Verdict.NoPinConfigured)]
    public void প্রতিটা_অবস্থার_ব্যাখ্যা_আছে(CertificatePin.Verdict verdict) =>
        Assert.False(string.IsNullOrWhiteSpace(CertificatePin.Explain(verdict)));
}
