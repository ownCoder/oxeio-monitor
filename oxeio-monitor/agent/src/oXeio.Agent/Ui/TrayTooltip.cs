using System.Text;

using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Ui;

/// <summary>
/// <see cref="AgentStatus"/> → tray টুলটিপের লেখা। বিশুদ্ধ ফাংশন, কোনো Win32 নেই।
///
/// ⚠️ <b>৬৩ অক্ষরের সীমা।</b> shell-এর <c>NOTIFYICONDATA.szTip</c> পুরোনো
/// স্ট্রাকচার সাইজে ৬৪ ঘর (শেষেরটা NUL), আর <c>NotifyIcon.Text</c> setter আজও
/// ৬৩-র বেশি পেলে সরাসরি <c>ArgumentOutOfRangeException</c> ছোড়ে — .NET 8-এও।
/// একটা ছুড়ে দেওয়া এক্সসেপশন UI থ্রেডে গিয়ে পুরো এজেন্ট নামিয়ে দিত, আর কারণ
/// হতো "লেখাটা একটু লম্বা"।
///
/// ইংরেজিতে এক অক্ষর = এক UTF-16 একক, তাই বাংলার তুলনায় ৬৩ ঘরে বেশি তথ্য ধরে।
/// তবু তিন লাইন সবসময় আঁটে না (দীর্ঘতম সংমিশ্রণ ~৮০), তাই লাইনগুলো অগ্রাধিকার
/// ক্রমে সাজানো — যেটুকু ধরে শুধু সেটুকুই যায়, উপর থেকে।
/// </summary>
internal static class TrayTooltip
{
    public const int MaxLength = 63;

    /// <summary>
    /// J07-এ প্রতিশ্রুত হুবহু বাক্য। ⚠️ "data is saved locally" অংশটা সরাবেন না —
    /// স্টাফের কাছে লাল আইকনের একমাত্র ব্যাখ্যা এটাই, আর ডেটা যে জমছে সেটা না
    /// লিখলে লাল রং দেখে সবাই ধরে নেবে তার ঘণ্টা মুছে যাচ্ছে।
    /// </summary>
    public const string SyncFailingLine = "Can't reach server, data saved locally";

    public const string RevokedLine = "Tracking is stopped on this device";

    public static string StateName(SegmentState state) => state switch
    {
        SegmentState.Active => "Working",
        SegmentState.Locked => "Locked",
        _ => "Idle",
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
                lines.Add("Contact your administrator");
                break;

            case SyncHealth.Failing:
                // ⚠️ এখানে আজকের ঘণ্টা ইচ্ছাকৃতভাবে বাদ। ৬৩ ঘরে দুটোই আঁটে না,
                //    আর এই মুহূর্তে জরুরি খবর হলো "ডেটা হারায়নি" — ঘণ্টার হিসাব
                //    "Today's hours" জানালায় পুরোটাই আছে।
                lines.Add(SyncFailingLine);
                lines.Add($"{UiText.Number(Math.Max(0, status.QueueDepth))} queued");
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
        var head = status.Paused ? "Tracking paused" : StateName(status.State);
        return $"{head} · Today {UiText.Duration(status.ActiveToday)}";
    }

    private static string MonthLine(AgentStatus status)
    {
        // ⚠️ সার্ভার এখনো মাসের যোগফল বলেনি — "0:00/208 (0%)" লিখলে সেটা
        //    "কিছুই করোনি" পড়া হতো, অথচ আসলে আমরা জানি না
        //    (AgentStatus.MonthlyKnown)।
        if (!status.MonthlyKnown) return "Monthly total loading…";

        // ⚠️ "Month", "This month" নয়। এই লাইনটার পরেই সিঙ্কের লাইন, আর ৬৩ ঘরে
        //    তিনটে লাইনই আঁটাতে হয় — বাড়তি পাঁচ অক্ষরে সিঙ্কের খবরটা বাদ পড়ত।
        return $"Month {UiText.Duration(status.ActiveThisMonth)}/{UiText.Hours(status.MonthlyTargetHours)} " +
               $"({UiText.Percent(status.MonthlyProgress)})";
    }

    private static string SyncLine(AgentStatus status)
    {
        if (status.Health == SyncHealth.Degraded)
        {
            // Degraded-এ আইকন লাল হয় না (AgentStatus-এর ডকুমেন্টেশন), শুধু
            // টুলটিপে ইঙ্গিত — বারবার লাল-সবুজ হলে স্টাফ রংটাকেই আর দেখে না।
            //
            // ⚠️ মাসের লাইনসহ তিনটে একসাথে ৬৩ ঘরে আঁটে না, তাই Degraded অবস্থায়
            //    এই লাইনটা প্রায়ই বাদ পড়ে — সেটা মেনে নেওয়া হয়েছে। Degraded
            //    জরুরি নয় (Failing-এর নিজস্ব শাখা আছে), আর সিঙ্কের পুরো অবস্থা
            //    "Today's hours" জানালায় সবসময়ই লেখা থাকে।
            return $"Sync late · {UiText.Number(Math.Max(0, status.QueueDepth))} queued";
        }

        return status.LastSyncAt is { } at
            ? $"Sync {UiText.Clock(at)}"
            : "Not synced yet";
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
                if (sb.Length == 0) sb.Append(UiText.Truncate(line, maxLength));

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
