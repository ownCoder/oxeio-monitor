using System.Globalization;
using System.Text;

using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Ui;

/// <summary>
/// <see cref="AgentStatus"/> → tray টুলটিপের লেখা। বিশুদ্ধ ফাংশন, কোনো Win32 নেই।
///
/// ⚠️ <b>৬৩ অক্ষরের সীমা।</b> shell-এর <c>NOTIFYICONDATA.szTip</c> পুরোনো
/// স্ট্রাকচার সাইজে ৬৪ ঘর (শেষেরটা NUL), আর .NET Framework-এর <c>NotifyIcon.Text</c>
/// setter ৬৩-র বেশি হলে সরাসরি <c>ArgumentOutOfRangeException</c> ছোড়ে। নতুন
/// রানটাইমে সীমাটা বড়, কিন্তু সেটার উপর ভরসা করা যায় না — একটা ছুড়ে দেওয়া
/// এক্সসেপশন UI থ্রেডে গিয়ে পুরো এজেন্ট নামিয়ে দিত, আর কারণ হতো "স্টাফের নাম
/// একটু লম্বা"।
///
/// বাংলা লেখায় প্রতিটা কার-চিহ্নও আলাদা UTF-16 একক, তাই "৬৩ অক্ষর" চোখে যা মনে হয়
/// তার চেয়ে অনেক কম — সেজন্যই লাইনগুলো অগ্রাধিকার ক্রমে সাজানো, আর যেটুকু ধরে
/// শুধু সেটুকুই যায়।
/// </summary>
internal static class TrayTooltip
{
    public const int MaxLength = 63;

    /// <summary>
    /// J07-এ প্রতিশ্রুত হুবহু বাক্য। ⚠️ বদলাবেন না — স্টাফের কাছে লাল আইকনের
    /// একমাত্র ব্যাখ্যা এটাই, আর "ডেটা জমছে" কথাটা না থাকলে লাল রং দেখে সবাই ধরে
    /// নেবে তার ঘণ্টা মুছে যাচ্ছে।
    /// </summary>
    public const string SyncFailingLine = "সার্ভারে পৌঁছাচ্ছে না, ডেটা লোকালি জমছে";

    public const string RevokedLine = "এই ডিভাইসে ট্র্যাকিং বন্ধ করা হয়েছে";

    public static string StateName(SegmentState state) => state switch
    {
        SegmentState.Active => "সক্রিয়",
        SegmentState.Locked => "লক করা",
        _ => "নিষ্ক্রিয়",
    };

    public static string Build(AgentStatus status) => Build(status, MaxLength);

    public static string Build(AgentStatus status, int maxLength)
    {
        if (status is null) return "oXeio";

        var lines = Lines(status);
        var text = Fit(lines, maxLength);

        // একেবারে কিছু না বসলেও টুলটিপ খালি রাখা যাবে না — খালি szTip মানে
        // hover করলে কিছুই দেখা যায় না, আর আইকনটা তখন ব্যাখ্যাহীন
        return string.IsNullOrEmpty(text) ? "oXeio" : text;
    }

    /// <summary>অগ্রাধিকার ক্রমে — উপরের লাইন সবচেয়ে জরুরি।</summary>
    private static List<string> Lines(AgentStatus status)
    {
        var lines = new List<string>(3);

        switch (status.Health)
        {
            case SyncHealth.Revoked:
                lines.Add(RevokedLine);
                lines.Add("প্রশাসকের সাথে কথা বলুন");
                break;

            case SyncHealth.Failing:
                // ⚠️ এখানে আজকের ঘণ্টা ইচ্ছাকৃতভাবে বাদ। ৬৩ ঘরে দুটোই আঁটে না,
                //    আর এই মুহূর্তে জরুরি খবর হলো "ডেটা হারায়নি" — ঘণ্টার হিসাব
                //    "আজকের সময়" জানালায় পুরোটাই আছে।
                lines.Add(SyncFailingLine);
                lines.Add($"সারিতে {BanglaText.Number(Math.Max(0, status.QueueDepth))}টি");
                break;

            default:
                lines.Add(HeadLine(status));
                lines.Add(MonthLine(status));
                lines.Add(SyncLine(status));
                break;
        }

        return lines;
    }

    private static string HeadLine(AgentStatus status)
    {
        // Paused সার্ভারের কমান্ড (H06), স্টাফের বাটন নয় — কিন্তু চললে সেটা
        // লুকানো চলবে না, নইলে ঘণ্টা না বাড়ার কারণটা অদৃশ্য থেকে যায়
        var head = status.Paused ? "ট্র্যাকিং সাময়িক বন্ধ" : StateName(status.State);
        return $"{head} · আজ {BanglaText.Duration(status.ActiveToday)}";
    }

    private static string MonthLine(AgentStatus status)
    {
        var target = status.MonthlyTargetHours;
        var targetText = Math.Abs(target - Math.Round(target)) < 0.05
            ? BanglaText.Number((int)Math.Round(target))
            : BanglaText.Digits(target.ToString("0.#", CultureInfo.InvariantCulture));

        return $"মাস {BanglaText.Duration(status.ActiveThisMonth)}/{targetText} " +
               $"({BanglaText.Percent(status.MonthlyProgress)})";
    }

    private static string SyncLine(AgentStatus status)
    {
        if (status.Health == SyncHealth.Degraded)
        {
            // Degraded-এ আইকন লাল হয় না (AgentStatus-এর ডকুমেন্টেশন), শুধু
            // টুলটিপে ইঙ্গিত — বারবার লাল-সবুজ হলে স্টাফ রংটাকেই আর দেখে না
            return $"সিঙ্ক দেরিতে · সারিতে {BanglaText.Number(Math.Max(0, status.QueueDepth))}টি";
        }

        return status.LastSyncAt is { } at
            ? $"সিঙ্ক {BanglaText.Clock(at)}"
            : "এখনো সিঙ্ক হয়নি";
    }

    private static string Fit(List<string> lines, int maxLength)
    {
        var sb = new StringBuilder();

        foreach (var line in lines)
        {
            if (string.IsNullOrEmpty(line)) continue;

            var needed = sb.Length == 0 ? line.Length : line.Length + 1; // +1 = '\n'
            if (sb.Length + needed > maxLength)
            {
                // প্রথম লাইনটাই না আঁটলে কেটে বসাও — টুলটিপ খালি যাওয়ার চেয়ে ভালো
                if (sb.Length == 0) sb.Append(BanglaText.Truncate(line, maxLength));

                // ⚠️ continue নয়, break। তালিকাটা অগ্রাধিকার ক্রমে সাজানো; দ্বিতীয়
                //    লাইন বাদ দিয়ে তৃতীয়টা ঢোকালে স্টাফ কম জরুরি তথ্য দেখত আর
                //    ভাবত বেশি জরুরিটা ঘটেইনি।
                break;
            }

            if (sb.Length > 0) sb.Append('\n');
            sb.Append(line);
        }

        return sb.ToString();
    }
}
