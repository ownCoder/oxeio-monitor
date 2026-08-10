using System.Diagnostics;
using System.Runtime.Versioning;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// এজেন্ট প্রসেসকে দেখা, মারা আর চালু করা। ⚠️ কোনো মেথড ছোড়ে না —
/// watchdog-এর লুপ থেকে একটা এক্সসেপশন বেরোলে পাহারাদারই মরে যেত, আর তখন
/// মেশিনে কেউ কাউকে দেখার থাকত না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class AgentProcess
{
    /// <summary>
    /// ওই pid-এ সত্যিই আমাদের এজেন্ট চলছে কি না।
    ///
    /// ⚠️ নাম মিলিয়ে দেখা বাধ্যতামূলক। Windows pid পুনর্ব্যবহার করে, আর হার্টবিট
    /// ফাইলের pid কয়েক মিনিট পুরোনো হতে পারে। শুধু "এই pid-এ কিছু একটা চলছে"
    /// দেখলে watchdog একদিন <c>explorer.exe</c>-কে মেরে বসত।
    /// </summary>
    public static bool IsAlive(int pid)
    {
        if (pid <= 0) return false;

        try
        {
            using var process = Process.GetProcessById(pid);
            return string.Equals(
                process.ProcessName, AgentPaths.AgentProcessName, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            // ArgumentException = ওই pid-এ কিছু নেই। InvalidOperationException =
            // মাঝপথে মরে গেছে। Win32Exception = অন্য ইউজারের প্রসেস, খোলা গেল না।
            // তিনটেরই মানে "আমরা একে দেখতে পাচ্ছি না", অর্থাৎ মারা যাবে না।
            return false;
        }
    }

    /// <summary>
    /// জমে যাওয়া এজেন্টকে মারে আর সে সত্যিই মরল কি না দেখে।
    ///
    /// ভদ্র সংকেত পাঠানোর চেষ্টা করা হয় না, ইচ্ছাকৃতভাবে: এই পথে আসাই হয়েছে
    /// কারণ প্রসেসটা ২ মিনিট ধরে কোনো সাড়া দিচ্ছে না। যে লুপ হার্টবিট লিখতে
    /// পারছে না, সে কোনো ইভেন্টও পড়তে পারবে না।
    ///
    /// ⚠️ শক্ত kill নিরাপদ, কারণ outbox নকশাগতভাবেই ক্র্যাশ-সহনশীল: সারি ডিস্কেই
    /// থাকে, lease-এর মেয়াদ শেষ হলে <c>ReclaimExpiredLeasesAsync</c> সেগুলো
    /// ফিরিয়ে আনে, আর প্রতিটা রেকর্ডে ClientUuid থাকায় দুবার পাঠানোও ক্ষতিকর নয়।
    /// সবচেয়ে খারাপ ক্ষতি — মাঝপথে থাকা একটা ব্যাচ আবার পাঠাতে হবে।
    /// </summary>
    public static bool TryKill(int pid, TimeSpan waitFor, out string detail)
    {
        try
        {
            using var process = Process.GetProcessById(pid);

            if (!string.Equals(
                    process.ProcessName, AgentPaths.AgentProcessName, StringComparison.OrdinalIgnoreCase))
            {
                detail = $"pid {pid} আমাদের এজেন্ট নয় ({process.ProcessName}) — হাত দেওয়া হয়নি";
                return false;
            }

            process.Kill(entireProcessTree: false);

            // ⚠️ অপেক্ষা না করলে পরের ধাপেই নতুন এজেন্ট চালু হতো, আর মরতে থাকা
            //    পুরোনোটা তখনো agent.lock ধরে আছে — নতুনটা সাথে সাথে বেরিয়ে যেত,
            //    আর মই সেটাকে একটা ব্যর্থতা হিসেবে গুনত। কয়েকবারে হাল ছাড়ার
            //    দশায় পৌঁছে যেত, অথচ আসলে কিছুই ভাঙেনি।
            if (!process.WaitForExit((int)waitFor.TotalMilliseconds))
            {
                detail = $"pid {pid} kill করার পরেও {waitFor.TotalSeconds:F0} সেকেন্ডে মরেনি";
                return false;
            }

            detail = $"pid {pid} বন্ধ করা হয়েছে";
            return true;
        }
        catch (Exception ex)
        {
            detail = $"pid {pid} মারা গেল না: {ex.GetType().Name} — {ex.Message}";
            return false;
        }
    }

    public static bool TryStart(string exePath, out int pid, out string detail)
    {
        pid = 0;

        try
        {
            var info = new ProcessStartInfo(exePath)
            {
                // ⚠️ ShellExecute দিলে প্রসেসটা explorer.exe-র সন্তান হতো, আমাদের নয় —
                //    তখন pid ফেরত পাওয়াও অনিশ্চিত হতো।
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(exePath) ?? AppContext.BaseDirectory,
            };

            using var started = Process.Start(info);
            if (started is null)
            {
                detail = "Process.Start কিছুই ফেরায়নি";
                return false;
            }

            pid = started.Id;
            detail = $"pid {pid} চালু হয়েছে";
            return true;
        }
        catch (Exception ex)
        {
            detail = $"চালু করা গেল না: {ex.GetType().Name} — {ex.Message}";
            return false;
        }
    }
}
