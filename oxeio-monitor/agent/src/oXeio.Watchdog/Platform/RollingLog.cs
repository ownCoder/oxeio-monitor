using System.Globalization;
using System.Runtime.Versioning;
using System.Text;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// ছোট, নিজে থেকে ঘোরে এমন লগ। বাইরের কোনো লাইব্রেরি নয়।
///
/// <b>আয়তনের হিসাব:</b> সিলিং ৫১২ KiB, আর মাত্র একটা পুরোনো কপি (<c>.1</c>) —
/// অর্থাৎ ডিস্কে সর্বোচ্চ ১ MiB, চিরকালের জন্য। এই প্রসেস সপ্তাহের পর সপ্তাহ চলে
/// আর কেউ লগ পড়ে না; সীমা না থাকলে একদিন সেটাই ডিস্ক ভরাত।
///
/// ⚠️ <b>প্রতি টিকে লেখা হয় না।</b> ৩০ সেকেন্ড পরপর একটা করে লাইন মানে দিনে
/// ২,৮৮০টা — দিনে দুবার rotate, আর ঠিক যে লাইনটা দরকার (দুই সপ্তাহ আগের সেই
/// ক্র্যাশ) সেটাই হারিয়ে যেত। তাই <see cref="WatchdogLoop"/> শুধু <b>বদল</b>
/// লেখে, অবস্থা নয়।
///
/// ⚠️ কোনো মেথড ছোড়ে না। ডিস্ক ভরা থাকলে লগ লেখা ব্যর্থ হবে — কিন্তু পাহারা
/// চলতেই থাকবে। লগের দোষে ঘণ্টা গোনা থামা চলবে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class RollingLog
{
    private const long DefaultMaxBytes = 512 * 1024;

    private readonly string _path;
    private readonly long _maxBytes;
    private readonly object _gate = new();

    public RollingLog(string path, long maxBytes = DefaultMaxBytes)
    {
        _path = path;
        _maxBytes = maxBytes > 0 ? maxBytes : DefaultMaxBytes;
    }

    public void Write(string message)
    {
        lock (_gate)
        {
            try
            {
                RotateIfNeeded();

                var line = string.Create(
                    CultureInfo.InvariantCulture,
                    $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}  {message}{Environment.NewLine}");

                // FileShare.ReadWrite — অ্যাডমিন লগটা খুলে রাখলেও যেন লেখা আটকে
                // না যায়। এই ফাইল আমাদের কাছে শুধুই লেখার জায়গা, সত্যের উৎস নয়।
                using var stream = new FileStream(
                    _path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 4096, FileOptions.None);

                var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(line);
                stream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception)
            {
                // ইচ্ছাকৃতভাবে গিলে ফেলা — এখানে throw করা মানে পাহারাদারের মৃত্যু।
            }
        }
    }

    private void RotateIfNeeded()
    {
        try
        {
            var info = new FileInfo(_path);
            if (!info.Exists || info.Length < _maxBytes) return;

            var previous = _path + ".1";

            // ⚠️ Move(overwrite: true) — আগে Delete করে তারপর Move করলে দুটোর
            //    মাঝখানে প্রসেস মরলে দুটো ফাইলই থাকত না।
            File.Move(_path, previous, overwrite: true);
        }
        catch (Exception)
        {
            // ঘোরানো না গেলে ফাইল একটু বড় হবে — লেখা বন্ধ হওয়ার চেয়ে সেটা ভালো।
        }
    }
}
