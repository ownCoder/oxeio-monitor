using System.Globalization;
using System.Runtime.Versioning;
using System.Text;

using oXeio.Agent.Sync;
using oXeio.Core.Agent;

namespace oXeio.Agent.Storage;

/// <summary>
/// H08 — এজেন্টের নিজের লগ ফাইল, ৭ দিন / ৫০ MB সীমা সহ।
///
/// ⚠️⚠️ <b>এতদিন এই ফাইলটার কোনো অস্তিত্বই ছিল না।</b> <see cref="ISyncLog"/>-এর
/// একমাত্র বাস্তবায়ন ছিল <c>ConsoleSyncLog</c>, আর প্রজেক্ট <c>WinExe</c> —
/// অর্থাৎ কনসোলই নেই। ফলে এজেন্টের প্রতিটা লাইন <b>শূন্যে</b> যেত:
/// এনরোলমেন্ট ব্যর্থ, টোকেন বাতিল, ৪২২ প্রত্যাখ্যান, আপডেট নামানো — কিছুরই
/// কোনো চিহ্ন থাকত না। অথচ <c>deploy/README.md</c> সমস্যা হলে
/// <c>agent.log</c> পড়তে বলত, আর ফাইলটা কোনোদিন লেখাই হয়নি।
///
/// ⭐ <b>নাম দুরকম, ইচ্ছাকৃতভাবে:</b>
/// <list type="bullet">
/// <item>চলতি ফাইল সবসময় <c>agent.log</c> — রানবুকে একটাই পাথ বলা যায়,
/// আর IT-কে "আজকের তারিখ বসিয়ে নিন" বলতে হয় না।</item>
/// <item>দিন বদলালে সেটা <c>agent-YYYY-MM-DD.log</c> নামে সরে যায় —
/// তাতেই ৭ দিনের হিসাবটা তারিখ থেকেই পড়া যায়, ফাইলের mtime-এর উপর
/// ভরসা করতে হয় না (mtime কপি/ব্যাকআপে বদলে যায়)।</item>
/// </list>
///
/// ⚠️ এই ক্লাসের কোনো মেথড <b>কখনো ছোড়ে না</b>। লগ লিখতে না পারা (ডিস্ক
/// ভরা, ফাইল লক) মানে এজেন্ট থামা নয় — নইলে লগের সমস্যা ডেটা হারানোর
/// সমস্যা হয়ে যেত।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class FileLog : ISyncLog
{
    /// <summary>চলতি ফাইলের নাম — রানবুক ঠিক এটাই বলে।</summary>
    public const string CurrentFileName = "agent.log";

    private const string ArchivePrefix = "agent-";
    private const string ArchiveSuffix = ".log";

    private readonly object _gate = new();
    private readonly string _directory;
    private readonly string _path;
    private readonly UTF8Encoding _utf8 = new(encoderShouldEmitUTF8Identifier: false);

    /// <summary>কোন দিনের লেখা চলছে — বদলালেই ঘোরাতে হবে।</summary>
    private DateOnly _openDay;

    public FileLog(string logsDirectory)
    {
        _directory = logsDirectory;
        _path = Path.Combine(logsDirectory, CurrentFileName);

        // ⚠️ শুরুতেই চলতি ফাইলের **আসল** দিনটা জেনে নেওয়া হয়, আজকের তারিখ
        //    ধরে নেওয়া হয় না। PC তিন দিন বন্ধ থাকলে ফাইলটা তিন দিনের
        //    পুরোনো — ধরে নিলে আজকের লেখা ওই পুরোনো ফাইলেই যোগ হতো আর
        //    দিনের ভাগটা এলোমেলো হয়ে যেত।
        _openDay = ExistingDay() ?? DateOnly.FromDateTime(DateTime.Now);
    }

    public string FilePath => _path;

    public void Info(string message) => Write("INFO ", message);
    public void Warn(string message) => Write("WARN ", message);

    public void Error(string message, Exception? error = null) =>
        Write("ERROR", error is null
            ? message
            : $"{message} — {error.GetType().Name}: {error.Message}");

    /// <summary>
    /// এজেন্ট চালু হওয়ার সময়ের এক লাইন — কোন ভার্সন, কোন সার্ভার, ডেটা
    /// কোথায়। ⭐ সমস্যা খুঁজতে গিয়ে প্রথম প্রশ্নগুলো এগুলোই, আর এই লাইনটা
    /// না থাকলে লগের বাকি অংশ পড়ে বোঝার উপায় থাকত না সেটা কোন রানের।
    /// </summary>
    public void Startup(string version, string serverUrl, string dataRoot)
    {
        Write("INFO ", new string('─', 60));
        Write("INFO ", $"oXeio agent {version} starting · server {serverUrl}");
        Write("INFO ", $"data {dataRoot} · log {_path}");
    }

    private void Write(string level, string message)
    {
        lock (_gate)
        {
            try
            {
                Directory.CreateDirectory(_directory);
                RollIfNewDay();

                var line = string.Create(
                    CultureInfo.InvariantCulture,
                    $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}  {level}  {message}{Environment.NewLine}");

                // ⚠️ FileShare.ReadWrite — IT লগটা খুলে রাখলেও (Notepad,
                //    Get-Content -Wait) যেন লেখা আটকে না যায়। এই ফাইল
                //    আমাদের কাছে শুধু লেখার জায়গা, সত্যের উৎস নয়।
                using var stream = new FileStream(
                    _path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 4096, FileOptions.None);

                var bytes = _utf8.GetBytes(line);
                stream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception)
            {
                // ইচ্ছাকৃত নীরবতা — উপরের ডক দেখুন
            }
        }
    }

    /// <summary>
    /// দিন বদলে থাকলে চলতি ফাইলটা তারিখওয়ালা নামে সরিয়ে দেয়, তারপর
    /// পুরোনোগুলো ছাঁটে।
    ///
    /// ⚠️ ছাঁটাই শুধু <b>ঘোরানোর সময়</b> হয়, প্রতি লাইনে নয় — দিনে একবার।
    /// প্রতি লাইনে করলে প্রতিটা লগ-লেখায় একটা ডিরেক্টরি স্ক্যান হতো, আর
    /// ব্যস্ত দিনে সেটা হাজারবার।
    /// </summary>
    private void RollIfNewDay()
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        if (today == _openDay) return;

        try
        {
            if (File.Exists(_path))
            {
                var archive = Path.Combine(
                    _directory,
                    $"{ArchivePrefix}{_openDay:yyyy-MM-dd}{ArchiveSuffix}");

                // ⚠️ overwrite: true — ঘড়ি পিছিয়ে গিয়ে একই তারিখ দুবার এলে
                //    Move ছুড়ত, আর তখন লগ লেখা **স্থায়ীভাবে** বন্ধ হয়ে যেত
                //    (প্রতি লাইনে আবার একই ব্যর্থ Move)।
                File.Move(_path, archive, overwrite: true);
            }
        }
        catch (Exception)
        {
            // ঘোরাতে না পারলে ফাইলটা বড় হতে থাকবে — লেখা বন্ধ হওয়ার চেয়ে ভালো
        }

        // ⚠️ _openDay বদলানো হয় **সব ক্ষেত্রেই**, Move ব্যর্থ হলেও। নইলে
        //    প্রতিটা লাইনে আবার একই ব্যর্থ Move চেষ্টা হতো।
        _openDay = today;

        Prune(today);
    }

    /// <summary>
    /// ৭ দিন / ৫০ MB — সিদ্ধান্তটা <see cref="LogRetention"/>-এর, এখানে
    /// শুধু ডিস্কের কাজটুকু।
    /// </summary>
    private void Prune(DateOnly today)
    {
        try
        {
            var archives = new List<LogRetention.LogFile>();

            foreach (var path in Directory.EnumerateFiles(
                         _directory, $"{ArchivePrefix}*{ArchiveSuffix}"))
            {
                var day = DayFromName(Path.GetFileName(path));
                if (day is null) continue;

                var info = new FileInfo(path);
                archives.Add(new LogRetention.LogFile(path, day.Value, info.Length));
            }

            var active = File.Exists(_path) ? new FileInfo(_path).Length : 0;

            foreach (var doomed in LogRetention.Plan(archives, active, today))
            {
                try
                {
                    File.Delete(doomed.Path);
                }
                catch (Exception)
                {
                    // একটা ফাইল মুছতে না পারলে বাকিগুলো তো যাক
                }
            }
        }
        catch (Exception)
        {
            // ছাঁটাই না হলে ডিস্ক একটু বেশি নেবে — লগ থেমে যাওয়ার চেয়ে ভালো
        }
    }

    /// <summary>চলতি ফাইলটার শেষ লেখার দিন। না থাকলে <c>null</c>।</summary>
    private DateOnly? ExistingDay()
    {
        try
        {
            var info = new FileInfo(_path);
            return info.Exists ? DateOnly.FromDateTime(info.LastWriteTime) : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// <c>agent-2026-08-12.log</c> → ২০২৬-০৮-১২।
    ///
    /// ⚠️ নাম থেকে পড়া হয়, mtime থেকে নয়। ফাইল কপি করলে, ব্যাকআপ থেকে
    /// ফেরালে বা robocopy চালালে mtime বদলে যায় — তখন সাত দিনের পুরোনো লগ
    /// হঠাৎ "আজকের" হয়ে যেত আর কোনোদিন মুছত না।
    /// </summary>
    internal static DateOnly? DayFromName(string fileName)
    {
        if (!fileName.StartsWith(ArchivePrefix, StringComparison.OrdinalIgnoreCase)) return null;
        if (!fileName.EndsWith(ArchiveSuffix, StringComparison.OrdinalIgnoreCase)) return null;

        var middle = fileName[ArchivePrefix.Length..^ArchiveSuffix.Length];

        return DateOnly.TryParseExact(
            middle, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
            ? day
            : null;
    }
}
