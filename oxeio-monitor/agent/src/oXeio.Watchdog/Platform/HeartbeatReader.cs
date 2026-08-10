using System.Runtime.Versioning;

using oXeio.Core.Watchdog;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// হার্টবিট ফাইল পড়ে। শেষ যেটা সফলভাবে পড়া গেছে সেটা মনে রাখে।
///
/// ⚠️ <b>কেন মনে রাখা জরুরি:</b> এজেন্ট temp ফাইলে লিখে rename করে, তাই পড়ার
/// ঠিক মুহূর্তে ফাইলটা এক পলকের জন্য না-ও থাকতে পারে। ওই এক পলকের ব্যর্থতাকে
/// "হার্টবিট নেই" ধরলে watchdog সুস্থ এজেন্টকে মেরে ফেলত — আর সেটা ঘটত
/// এলোমেলোভাবে, কয়েক দিনে একবার, অর্থাৎ কেউ কারণটা ধরতেই পারত না।
/// আগের ভালো মানটা ধরে রাখলে সত্যিকারের জমে যাওয়া তবু ২ মিনিটে ধরা পড়ে,
/// কারণ ওই পুরোনো মানটাই ততক্ষণে বাসি হয়ে যায়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class HeartbeatReader
{
    private AgentHeartbeat? _lastGood;

    public AgentHeartbeat? Read(string path)
    {
        var line = TryReadFirstLine(path);
        if (line is null) return _lastGood;

        var parsed = AgentLiveness.TryParse(line);
        if (parsed is null) return _lastGood;

        _lastGood = parsed;
        return parsed;
    }

    private static string? TryReadFirstLine(string path)
    {
        try
        {
            // ⚠️ FileShare-এ Write আর Delete দুটোই দিতে হবে। শুধু Read দিলে
            //    এজেন্টের rename (MoveFile) sharing violation-এ ব্যর্থ হতো —
            //    অর্থাৎ পাহারাদারের পড়াটাই এজেন্টের হার্টবিট থামিয়ে দিত, আর
            //    তারপর পাহারাদার সেটাকে "জমে গেছে" বলে মেরে ফেলত।
            using var stream = new FileStream(
                path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.SequentialScan);

            using var reader = new StreamReader(stream);
            return reader.ReadLine();
        }
        catch (Exception ex) when (
            ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return null;
        }
    }
}
