using System.Runtime.Versioning;
using System.Text;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-কে ডিস্কের কথা জানতে দেওয়া হয় না — সে শুধু এটুকু জিজ্ঞাসা করে।
/// টেস্টে এর জায়গায় একটা মেমরি-ভিত্তিক নকল বসে।
/// </summary>
internal interface IMilestoneMemory
{
    string? LastCelebrated();

    void Remember(string monthKey);
}

/// <summary>
/// J03-এর বেলুন কোন মাসে দেখানো হয়েছে — ডিস্কে একটা লাইন, এটুকুই।
///
/// ⚠️ <b>ডিস্কে রাখতেই হয়।</b> শুধু মেমরিতে রাখলে "মাসে একবার" কার্যত
/// "রিস্টার্টে একবার" হতো, আর অফিসের PC রোজ রাতে বন্ধ হয় — অর্থাৎ লক্ষ্য
/// পূরণের পর মাসের বাকি প্রতিটা দিন সকালে একটা করে বেলুন।
///
/// ⚠️ <b>কোনো পথেই ছোড়ে না।</b> ফাইল না লেখা গেলে (ডিস্ক ভরা, ACL) সবচেয়ে
/// খারাপ যা হয় তা হলো বেলুনটা আরেকবার দেখা যাওয়া। সেই ঝুঁকির জন্য tray-র
/// রেন্ডার পথে একটা এক্সসেপশন ছোড়া যায় না — ওটা UI থ্রেড, আর ওখানে ছুটে
/// যাওয়া এক্সসেপশন মানে পুরো এজেন্ট বন্ধ, অর্থাৎ ঘণ্টা গোনা বন্ধ।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class MilestoneMemory : IMilestoneMemory
{
    private const string FileName = "milestone.txt";

    /// <summary>চাবিটা <c>YYYY-MM</c>; নষ্ট/অদ্ভুত লাইন এলে যেন গিলে না ফেলি।</summary>
    private const int MaxKeyLength = 16;

    private readonly string _path;

    /// <summary>ডিস্ক পড়া/লেখা ব্যর্থ হলেও এক রানে একবারের বেশি নয়।</summary>
    private string? _cached;
    private bool _loaded;

    public MilestoneMemory(string directory)
    {
        _path = Path.Combine(directory, FileName);
    }

    /// <summary>সবশেষ যে মাসে দেখানো হয়েছিল, না জানলে <c>null</c>।</summary>
    public string? LastCelebrated()
    {
        if (_loaded) return _cached;

        _loaded = true;

        try
        {
            if (File.Exists(_path))
            {
                var text = File.ReadAllText(_path, Encoding.UTF8).Trim();
                if (text.Length is > 0 and <= MaxKeyLength) _cached = text;
            }
        }
        catch (Exception)
        {
            // পড়া গেল না — "কখনো দেখানো হয়নি" ধরে নেওয়া হচ্ছে। ফলে বড়জোর
            // একটা বাড়তি বেলুন; উল্টোটা ধরলে সত্যিকারের অর্জনটা চাপা পড়ত।
        }

        return _cached;
    }

    /// <summary>এই মাসে দেখানো হয়েছে বলে জমা রাখা। ব্যর্থ হলেও মেমরিতে থাকে।</summary>
    public void Remember(string monthKey)
    {
        if (string.IsNullOrWhiteSpace(monthKey)) return;

        _cached = monthKey;
        _loaded = true;

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path, monthKey, Encoding.UTF8);
        }
        catch (Exception)
        {
            // পরের রিস্টার্টে আরেকবার বেলুন — এর চেয়ে বড় কোনো ক্ষতি নেই
        }
    }
}
