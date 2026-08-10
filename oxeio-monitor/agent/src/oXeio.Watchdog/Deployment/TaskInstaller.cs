using System.Diagnostics;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text;

namespace oXeio.Watchdog.Deployment;

/// <summary>
/// H02 — Task Scheduler-এ লগঅন টাস্ক বসানো।
///
/// ⚠️ এটা <b>এক-শটের CLI মোড</b> (<c>--install-task</c>), ইনস্টলার একবার চালায়।
/// পাহারার লুপ থেকে কখনো <c>schtasks</c> ডাকা হয় না: ওটা প্রতি ৩০ সেকেন্ডে
/// একটা করে বাড়তি প্রসেস তৈরি করত, আর Task Scheduler-এর সার্ভিসে চাপ ফেলত —
/// অথচ টাস্কটা তো একবার বসানোর জিনিস।
///
/// XML-টা এমবেডেড রিসোর্স হিসেবে থাকে যাতে exe আর তার ডিপ্লয়মেন্ট নিয়ম
/// কখনো আলাদা হয়ে না যায়।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class TaskInstaller
{
    internal const string TaskName = @"\oXeio\oXeio Watchdog";

    private const string ResourceName = "oXeio.Watchdog.Task.xml";

    /// <summary>রিসোর্স থেকে XML, <c>{EXE}</c>/<c>{DIR}</c> বসানো ও মন্তব্য ছাঁটা।</summary>
    public static string RenderXml(string exePath)
    {
        var raw = ReadResource();
        var dir = Path.GetDirectoryName(exePath) ?? AppContext.BaseDirectory;

        return StripXmlComments(raw)
            .Replace("{EXE}", Escape(exePath), StringComparison.Ordinal)
            .Replace("{DIR}", Escape(dir.TrimEnd('\\')), StringComparison.Ordinal);
    }

    /// <returns>প্রসেসের এক্সিট কোড — ০ মানে সফল।</returns>
    public static int Install(string exePath, TextWriter output)
    {
        string temp;
        try
        {
            temp = Path.Combine(Path.GetTempPath(), $"oXeio-watchdog-{Guid.NewGuid():N}.xml");

            // ⚠️ UTF-16 (BOM সহ) — schtasks /XML UTF-8 ফাইলকে কিছু Windows
            //    বিল্ডে "The task XML is malformed" বলে ফিরিয়ে দেয়, আর ভুলটা
            //    XML-এ নয় বলে খুঁজে বের করতে ঘণ্টা যায়।
            File.WriteAllText(temp, RenderXml(exePath), new UnicodeEncoding(false, true));
        }
        catch (Exception ex)
        {
            output.WriteLine($"XML লেখা গেল না: {ex.Message}");
            return 4;
        }

        try
        {
            var code = RunSchtasks($"/Create /TN \"{TaskName}\" /XML \"{temp}\" /F", output);

            if (code == 0)
                output.WriteLine($"✅ টাস্ক বসানো হয়েছে: {TaskName}  →  {exePath}");
            else
                output.WriteLine($"❌ schtasks এক্সিট কোড {code} — অ্যাডমিন হিসেবে চালানো হয়েছে তো?");

            return code;
        }
        finally
        {
            try { File.Delete(temp); } catch (Exception) { /* temp ফাইল পড়ে থাকলে ক্ষতি নেই */ }
        }
    }

    public static int Uninstall(TextWriter output)
    {
        var code = RunSchtasks($"/Delete /TN \"{TaskName}\" /F", output);
        output.WriteLine(code == 0 ? "✅ টাস্ক মুছে ফেলা হয়েছে" : $"❌ schtasks এক্সিট কোড {code}");
        return code;
    }

    // ── ভেতরের কাজ ──────────────────────────────────────────────────────────

    private static int RunSchtasks(string arguments, TextWriter output)
    {
        try
        {
            // ⚠️ পুরো পাথ — শুধু "schtasks" লিখলে PATH-এ বসানো একটা নকল exe
            //    চলত। এই কমান্ড অ্যাডমিন হিসেবে চলে, তাই সেটা সরাসরি
            //    privilege escalation।
            var exe = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe");

            var info = new ProcessStartInfo(exe, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            using var process = Process.Start(info);
            if (process is null)
            {
                output.WriteLine("schtasks চালু করা গেল না");
                return 4;
            }

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (!string.IsNullOrWhiteSpace(stdout)) output.WriteLine(stdout.Trim());
            if (!string.IsNullOrWhiteSpace(stderr)) output.WriteLine(stderr.Trim());

            return process.ExitCode;
        }
        catch (Exception ex)
        {
            output.WriteLine($"schtasks চালানো গেল না: {ex.GetType().Name} — {ex.Message}");
            return 4;
        }
    }

    private static string ReadResource()
    {
        var assembly = Assembly.GetExecutingAssembly();

        // নাম বদলে গেলেও যেন খুঁজে পায় — এমবেডেড রিসোর্সের নাম MSBuild-এর
        // নিয়মে তৈরি হয়, আর ফাইল সরালে সেটা নীরবে বদলায়।
        var name = Array.Find(
            assembly.GetManifestResourceNames(),
            n => n.EndsWith(ResourceName, StringComparison.OrdinalIgnoreCase)
                 || n.EndsWith("WatchdogTask.xml", StringComparison.OrdinalIgnoreCase));

        if (name is null)
            throw new InvalidOperationException("টাস্কের XML রিসোর্স পাওয়া গেল না");

        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException("টাস্কের XML রিসোর্স খোলা গেল না");

        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    /// <summary>
    /// ⚠️ মন্তব্য ছেঁটে ফেলা হয়। XML-এ মন্তব্য বৈধ, কিন্তু Task Scheduler-এর
    /// পার্সার নিয়ে ঝুঁকি নেওয়ার মানে হয় না — আর ব্যর্থ হলে সে শুধু বলে
    /// "The task XML is malformed", কোন লাইনে সেটা বলে না। মন্তব্যগুলো
    /// রিপোজিটরির ফাইলেই থেকে যায়, যেখানে ওগুলোর দরকার।
    /// </summary>
    private static string StripXmlComments(string xml)
    {
        var builder = new StringBuilder(xml.Length);
        var index = 0;

        while (index < xml.Length)
        {
            var start = xml.IndexOf("<!--", index, StringComparison.Ordinal);
            if (start < 0)
            {
                builder.Append(xml, index, xml.Length - index);
                break;
            }

            builder.Append(xml, index, start - index);

            var end = xml.IndexOf("-->", start + 4, StringComparison.Ordinal);
            if (end < 0) break;   // অসমাপ্ত মন্তব্য — বাকিটা বাদ

            index = end + 3;
        }

        return builder.ToString();
    }

    /// <summary>পাথে <c>&amp;</c> বা <c>&lt;</c> থাকলে XML ভেঙে যেত।</summary>
    private static string Escape(string value) => value
        .Replace("&", "&amp;", StringComparison.Ordinal)
        .Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace(">", "&gt;", StringComparison.Ordinal);
}
