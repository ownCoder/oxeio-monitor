using oXeio.Agent.Storage;

namespace oXeio.Agent.Tests;

/// <summary>
/// H08 — এজেন্টের লগ ফাইল সত্যিই ডিস্কে লেখে কি না।
///
/// ⚠️ এখানে সত্যিকারের ফাইলই লেখা হয়, মক নয় — কারণ যে জিনিসগুলো ভুল হতে
/// পারে সেগুলো ঠিক ফাইল-সিস্টেমেই: ফোল্ডার নেই, ফাইল খোলা অবস্থায় লেখা,
/// দিন বদলালে নাম বদলানো। মক দিয়ে এর একটাও পরীক্ষা হতো না।
/// </summary>
public class FileLogTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "oxeio-logtest-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private string Read() => File.ReadAllText(Path.Combine(_dir, FileLog.CurrentFileName));

    /// <summary>⚠️ ফোল্ডারটা **নেই** — প্রথম বুটে ঠিক এই অবস্থাটাই থাকে।</summary>
    [Fact]
    public void ফোল্ডার_না_থাকলেও_লেখে()
    {
        var log = new FileLog(_dir);

        log.Info("hello");

        Assert.Contains("hello", Read());
    }

    [Fact]
    public void তিনটে_মাত্রাই_আলাদা_করে_চেনা_যায়()
    {
        var log = new FileLog(_dir);

        log.Info("ok");
        log.Warn("hmm");
        log.Error("bad", new InvalidOperationException("boom"));

        var text = Read();

        Assert.Contains("INFO ", text);
        Assert.Contains("WARN ", text);
        Assert.Contains("ERROR", text);
        // ⚠️ এক্সসেপশনের ধরন ও বার্তা দুটোই — শুধু "bad" লিখলে লগ পড়ে
        //    কেউ বুঝত না আসলে কী ঘটেছে।
        Assert.Contains("InvalidOperationException", text);
        Assert.Contains("boom", text);
    }

    /// <summary>
    /// ⚠️ লগ লেখা কখনোই কলারকে ফেলতে পারবে না। এখানে ফোল্ডারের জায়গায়
    /// একটা **ফাইল** বসিয়ে দেওয়া হয়েছে — `Directory.CreateDirectory`
    /// ছুড়বে। ছোড়াটা উপরে পৌঁছালে সিঙ্ক ওয়ার্কার মরত, অর্থাৎ লগের সমস্যা
    /// ডেটা হারানোর সমস্যা হয়ে যেত।
    /// </summary>
    [Fact]
    public void লিখতে_না_পারলেও_ছোড়ে_না()
    {
        var blocked = Path.Combine(_dir, "blocked");
        Directory.CreateDirectory(_dir);
        File.WriteAllText(blocked, "i am a file, not a folder");

        var log = new FileLog(blocked);

        log.Info("this goes nowhere");
        log.Error("neither does this", new Exception("x"));
    }

    [Fact]
    public void স্টার্টআপ_লাইনে_ভার্সন_সার্ভার_আর_পাথ_থাকে()
    {
        var log = new FileLog(_dir);

        log.Startup("0.1.0", "https://oxeio.office.local", @"C:\ProgramData\oXeio");

        var text = Read();

        Assert.Contains("0.1.0", text);
        Assert.Contains("oxeio.office.local", text);
        Assert.Contains(@"C:\ProgramData\oXeio", text);
    }

    /// <summary>
    /// ⭐ দিন বদলালে চলতি ফাইলটা তারিখওয়ালা নামে সরে। এখানে সেটা সরাসরি
    /// পরীক্ষা করা যায় না (ঘড়ি বদলানো যাবে না), তাই নাম-পড়ার নিয়মটাই
    /// যাচাই — ছাঁটাইয়ের গোটা হিসাবটা এর উপরেই দাঁড়ানো।
    /// </summary>
    [Theory]
    [InlineData("agent-2026-08-12.log", true)]
    [InlineData("agent-2026-13-40.log", false)]  // অসম্ভব তারিখ
    [InlineData("agent.log", false)]             // চলতি ফাইল — কখনো মুছবে না
    [InlineData("outbox-drops.log", false)]      // ⚠️ অন্য মডিউলের লগ
    [InlineData("outbox-drops.log.1", false)]
    [InlineData("watchdog.log", false)]
    public void শুধু_নিজের_আর্কাইভই_চেনে(string name, bool expected) =>
        Assert.Equal(expected, FileLog.DayFromName(name) is not null);

    [Fact]
    public void নাম_থেকে_তারিখটা_ঠিকঠাক_পড়ে() =>
        Assert.Equal(new DateOnly(2026, 8, 12), FileLog.DayFromName("agent-2026-08-12.log"));

    /**
     * ⚠️⚠️ রানবুক অ্যাডমিনকে `Get-Content …gent.log` চালাতে বলে, আর
     * **Windows PowerShell 5.1 BOM ছাড়া ফাইলকে ANSI ধরে** — তখন প্রতিটা
     * `·` `—` `✅` ভেঙে `Â·` `â€”` `âœ…` হয়ে দেখায়। ফাইলটা ঠিকই লেখা,
     * শুধু পড়াই যায় না।
     *
     * ⭐ ১২ আগস্ট আসল মেশিনে চালিয়ে ধরা পড়েছে — টেস্টে নয়, চোখে।
     */
    [Fact]
    public void নতুন_ফাইলের_শুরুতে_utf8_bom_বসে()
    {
        var log = new FileLog(_dir);
        log.Info("hello · world — ✅");

        var raw = System.IO.File.ReadAllBytes(Path.Combine(_dir, FileLog.CurrentFileName));

        Assert.Equal(0xEF, raw[0]);
        Assert.Equal(0xBB, raw[1]);
        Assert.Equal(0xBF, raw[2]);
    }

    /** ⚠️ প্রতি লাইনে বসালে মাঝখানে BOM জমত আর লেখাগুলো নষ্ট হতো */
    [Fact]
    public void bom_একবারই_বসে()
    {
        var log = new FileLog(_dir);
        log.Info("এক");
        log.Info("দুই");
        log.Info("তিন");

        var raw = System.IO.File.ReadAllBytes(Path.Combine(_dir, FileLog.CurrentFileName));
        var count = 0;
        for (var i = 0; i + 2 < raw.Length; i++)
        {
            if (raw[i] == 0xEF && raw[i + 1] == 0xBB && raw[i + 2] == 0xBF) count++;
        }

        Assert.Equal(1, count);
    }
}
