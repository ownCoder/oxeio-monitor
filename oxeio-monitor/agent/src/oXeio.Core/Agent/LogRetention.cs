namespace oXeio.Core.Agent;

/// <summary>
/// H08 — এজেন্টের লগ ফাইলগুলোর মধ্যে কোনগুলো মুছতে হবে।
///
/// স্পেকের সীমা দুটো (<a href="../../../docs/04-Features.md">04 § H08</a>):
/// <b>৭ দিন</b>, আর <b>সব মিলিয়ে ৫০ MB</b>। দুটোই দরকার, কারণ দুটো আলাদা
/// বিপদ ঠেকায়: দিনের সীমা না থাকলে শান্ত মেশিনে বছরের পর বছর লগ জমত, আর
/// আকারের সীমা না থাকলে একটা ক্র্যাশ-লুপ এক দুপুরেই ডিস্ক ভরিয়ে দিত।
///
/// ⭐ <b>সিদ্ধান্তটা Core-এ কেন:</b> "কোন ফাইলটা মুছব" — এটাই একমাত্র অংশ
/// যেটা ভুল হলে <b>ডেটা মুছে যায়</b>, আর ফাইল-ঘোরানোর কোডে বসে থাকলে সেটা
/// যাচাই করতে হলে সাত দিনের পুরোনো টাইমস্ট্যাম্পওয়ালা লগ বানাতে হতো।
/// এখানে থাকায় প্রতিটা শাখা ইউনিট টেস্টে ধরা যায়।
/// </summary>
public static class LogRetention
{
    /// <summary>04 § H08 — "৭ দিন"।</summary>
    public const int DefaultKeepDays = 7;

    /// <summary>04 § H08 — "ম্যাক্স ৫০ MB"।</summary>
    public const long DefaultMaxBytes = 50L * 1024 * 1024;

    /// <param name="Path">পুরো পাথ — কলার এটাই <c>File.Delete</c>-এ দেয়।</param>
    /// <param name="Day">ফাইলটা কোন দিনের (নামে লেখা তারিখ, mtime নয়)।</param>
    public readonly record struct LogFile(string Path, DateOnly Day, long Bytes);

    /// <summary>
    /// কোন কোন <b>পুরোনো</b> ফাইল যাবে।
    ///
    /// ⚠️ <paramref name="archives"/>-এ <b>আজকের চলতি ফাইলটা থাকবে না</b>।
    /// যে ফাইলে এই মুহূর্তে লেখা হচ্ছে সেটা কখনোই মোছার তালিকায় আসে না —
    /// এমনকি সে একাই বাজেট ছাড়িয়ে গেলেও। মুছলে চলতি লেখাগুলোই হারাত,
    /// আর ঠিক তখনই লগটা সবচেয়ে বেশি দরকার (ডিস্ক ভরে যাচ্ছে)।
    /// তার আকারটা <paramref name="activeBytes"/> হিসেবে বাজেটে ধরা হয়।
    /// </summary>
    public static IReadOnlyList<LogFile> Plan(
        IEnumerable<LogFile> archives,
        long activeBytes,
        DateOnly today,
        int keepDays = DefaultKeepDays,
        long maxBytes = DefaultMaxBytes)
    {
        // পুরোনো আগে — দুই ধাপেই একই ক্রম দরকার
        var sorted = archives.OrderBy(f => f.Day).ToList();
        var doomed = new List<LogFile>();

        // ── ধাপ ১ · বয়স ───────────────────────────────────────────────────
        //
        // ⚠️ `keepDays` দিনের **পুরোনো** মানে আজকেরটা ধরে গুনে। keepDays = 7
        //    হলে আজ + আগের ৬ দিন থাকে, সপ্তম দিনেরটা যায়। `<` লিখলে ৮ দিন
        //    থাকত — স্পেকের চেয়ে একদিন বেশি, আর কেউ টের পেত না।
        var cutoff = today.AddDays(-(keepDays - 1));
        var kept = new List<LogFile>();

        foreach (var file in sorted)
        {
            // ⚠️ ভবিষ্যতের তারিখওয়ালা ফাইলও রাখা হয় (ঘড়ি পিছিয়ে গেলে হতে
            //    পারে) — মুছে দিলে ঘড়ির একটা ভুলে আজকের লগই হারাত।
            if (file.Day < cutoff) doomed.Add(file);
            else kept.Add(file);
        }

        // ── ধাপ ২ · আকার ──────────────────────────────────────────────────
        var total = activeBytes + kept.Sum(f => f.Bytes);

        foreach (var file in kept)
        {
            if (total <= maxBytes) break;

            doomed.Add(file);
            total -= file.Bytes;
        }

        // ⚠️ লুপ শেষেও `total > maxBytes` হতে পারে — চলতি ফাইলটা একাই বড়।
        //    তখন আর কিছু করার নেই, আর সেটাই ঠিক: বাজেট রাখতে গিয়ে আজকের
        //    লগ মোছা মানে ঠিক সেই তথ্যটাই হারানো যেটার জন্য লগ রাখা।
        return doomed;
    }
}
