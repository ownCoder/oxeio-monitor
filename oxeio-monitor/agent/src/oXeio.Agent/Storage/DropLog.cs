using System.Runtime.Versioning;
using System.Text;

namespace oXeio.Agent.Storage;

/// <summary>
/// ⭐ যেসব ডেটা কোনোদিন সার্ভারে পৌঁছাবে না, তার একমাত্র সাক্ষী।
///
/// আউটবক্স থেকে ডেটা তিনভাবে চিরতরে যায়: সার্ভারের স্থায়ী প্রত্যাখ্যান
/// (<c>AbandonAsync</c>), ডিস্কের বাজেট (<c>EvictAsync</c>), আর বয়স।
/// <see cref="oXeio.Core.Agent.IOutboxStore.AbandonAsync"/>-এর ডকে বলা আছে —
/// নীরবে মোছা চলবে না। কারণটা নিষ্ঠুর রকমের বাস্তব: একটা মেশিন ৪২২ পেয়ে মাসের
/// পর মাস চুপচাপ ডেটা ফেলে দিতে পারে, আর রিপোর্টে শুধু "ওর ঘণ্টা কম" দেখা যাবে।
/// কেউ তখন এজেন্টকে সন্দেহ করবে না, স্টাফকে করবে।
///
/// ⚠️ এটা সাধারণ লগার নয় আর হতেও চায় না। এজেন্টের আসল লগার যে-ই লিখুক, সে
/// ক্র্যাশ করলে, বন্ধ থাকলে বা এখনো তৈরি না হলেও এই ফাইলটা লেখা হবে — কারণ
/// "ডেটা মুছে ফেলেছি" কথাটা হারিয়ে গেলে সেটা ডেটা হারানোর চেয়েও খারাপ।
/// তাই এর কোনো নির্ভরতা নেই আর এটা কখনো ব্যতিক্রম ছড়ায় না।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class DropLog
{
    /// <summary>
    /// ১ MiB ছাড়ালে একবার ঘোরানো হয়। ছোট রাখা ইচ্ছাকৃত — ডিস্ক ভরে যাওয়ার
    /// কারণেই যদি ছাঁটাই চলতে থাকে, তখন লগ লিখে ডিস্ক আরও ভরানোটা হাস্যকর হতো।
    /// </summary>
    private const long MaxBytes = 1024 * 1024;

    private readonly object _gate = new();
    private readonly string _path;
    private readonly string _rotated;

    public DropLog(string logsDirectory)
    {
        _path = Path.Combine(logsDirectory, "outbox-drops.log");
        _rotated = _path + ".1";
    }

    /// <summary>স্টার্টআপ লগে "ফেলে দেওয়া ডেটার হিসাব এখানে" বলে দেখানোর জন্য।</summary>
    public string FilePath => _path;

    /// <summary>
    /// এক লাইন লেখা। ⚠️ কখনো throw করে না — ড্রপ লগ লিখতে না পারা মানে
    /// আপলোড থামানো নয়।
    /// </summary>
    public void Write(string line)
    {
        // একই ফাইলে ট্র্যাকিং থ্রেড আর সিঙ্ক থ্রেড দুজনেই লিখতে পারে।
        // lock ছাড়া দুটো append মিশে গিয়ে লাইন ভেঙে যেত।
        lock (_gate)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                Rotate();

                File.AppendAllText(
                    _path,
                    $"{DateTimeOffset.UtcNow:O}\t{line}{Environment.NewLine}",
                    Encoding.UTF8);
            }
            catch (Exception)
            {
                // ইচ্ছাকৃতভাবে গিলে ফেলা। এখানে আর কিছু করার নেই — কনসোলে
                // লিখতে গেলে সার্ভিস মোডে সেটাও কোথাও যায় না।
            }
        }
    }

    /// <summary>একাধিক লাইন এক ব্যাচে — প্রতিবার ফাইল খোলা এড়াতে।</summary>
    public void WriteMany(IEnumerable<string> lines)
    {
        lock (_gate)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                Rotate();

                var stamp = DateTimeOffset.UtcNow.ToString("O");
                var sb = new StringBuilder();
                foreach (var line in lines)
                    sb.Append(stamp).Append('\t').Append(line).Append(Environment.NewLine);

                if (sb.Length > 0) File.AppendAllText(_path, sb.ToString(), Encoding.UTF8);
            }
            catch (Exception)
            {
            }
        }
    }

    /// <summary>
    /// পুরোনোটা একটাই কপি রাখা হয় (.1)। ⚠️ লক ধরা অবস্থায় ডাকতে হবে।
    /// </summary>
    private void Rotate()
    {
        try
        {
            var info = new FileInfo(_path);
            if (!info.Exists || info.Length <= MaxBytes) return;

            File.Move(_path, _rotated, overwrite: true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
