using System.Diagnostics;
using System.Runtime.Versioning;

using oXeio.Agent.Native;
using oXeio.Core.Apps;

namespace oXeio.Agent.Apps;

/// <summary>
/// এখন সামনে কোন উইন্ডো (D01, D02)।
///
/// ⭐ <b>এখানে কোনো কি-বোর্ড বা মাউস হুক নেই</b>, আর কখনো থাকবেও না।
/// শুধু "কোন উইন্ডো সামনে" আর "তার টাইটেল কী" — যা যেকোনো ব্যবহারকারী
/// Task Manager খুলেই দেখতে পান। কী টাইপ করা হচ্ছে সেটা এই সিস্টেম
/// জানে না ([04-Features § L](../../../../docs/04-Features.md))।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class ForegroundWindowProbe
{
    /// <summary>
    /// টাইটেল কত অক্ষর পর্যন্ত পড়া হবে। সার্ভারের সীমা ১০০০
    /// (<c>AppUsageDto.windowTitle</c>), তাই তার নিচে থামা — বড় পাঠালে
    /// পুরো ব্যাচ ৪০০ খেত, আর ৪০০ মানে ডেটা মুছে ফেলা।
    /// </summary>
    private const int MaxTitle = 512;

    /// <summary>
    /// এই প্রসেসগুলোকে ব্রাউজার ধরা হয় — address bar পড়ার চেষ্টা কেবল এদেরই।
    /// ⚠️ তালিকার বাইরে হলে URL পড়ার চেষ্টাই হয় না; অকারণে প্রতিটি অ্যাপে
    /// UI Automation চালানো ব্যয়বহুল (প্রতি কল ~১০–৩০ ms)।
    /// </summary>
    private static readonly HashSet<string> Browsers = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc",
    };

    /// <summary>
    /// প্রসেস আইডি → নাম। ⚠️ ক্যাশ ছাড়া প্রতি সেকেন্ডে
    /// <c>Process.GetProcessById</c> ডাকা হতো, যেটা তুলনায় ব্যয়বহুল।
    /// pid পুনর্ব্যবহার হয় বলে ক্যাশ ছোট রাখা হয়েছে।
    /// </summary>
    private readonly Dictionary<uint, (string Name, string? Title)> _names = [];

    /// <summary>ব্যর্থ হলে <c>null</c> — ব্যতিক্রম নয়। একটা নমুনা বাদ যাওয়া মারাত্মক নয়।</summary>
    public WindowSample? Read(Func<nint, string?>? urlReader = null)
    {
        try
        {
            var hwnd = User32.GetForegroundWindow();

            // ০ = কোনো উইন্ডো সামনে নেই (লক স্ক্রিন, ডেস্কটপ সুইচ)
            if (hwnd == 0) return null;

            if (User32.GetWindowThreadProcessId(hwnd, out var pid) == 0 || pid == 0) return null;

            var (process, appName) = ResolveProcess(pid);
            if (process is null) return null;

            var isBrowser = Browsers.Contains(Path.GetFileNameWithoutExtension(process));
            var title = PeekTitle(hwnd);

            return new WindowSample
            {
                ProcessName = process,
                AppName = appName,
                WindowTitle = title,

                // ⚠️ URL পড়া হয় **শুধু ব্রাউজারে**, আর কলার যদি পড়তে চায় তবেই।
                //    উইন্ডো না বদলালে কলার null দেয় — প্রতি সেকেন্ডে UI Automation
                //    চালানোর খরচ এড়াতে ([06-Research § ২.৬](../../../../docs/06-Research.md))।
                RawUrl = isBrowser ? urlReader?.Invoke(hwnd) : null,
                IsBrowser = isBrowser,
            };
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Debug.WriteLine($"foreground উইন্ডো পড়া গেল না: {ex.Message}");
            return null;
        }
    }

    private (string? Process, string? AppName) ResolveProcess(uint pid)
    {
        if (_names.TryGetValue(pid, out var cached)) return (cached.Name, cached.Title);

        try
        {
            using var p = Process.GetProcessById((int)pid);

            var exe = p.ProcessName + ".exe";

            // ⚠️ MainWindowTitle নয় — ওটা প্রসেসের **প্রধান** উইন্ডোর টাইটেল,
            //    আর সামনে থাকা উইন্ডো অন্যটাও হতে পারে। এখানে শুধু বন্ধুত্বপূর্ণ
            //    নামটুকু নেওয়া হয়; টাইটেল আসে GetWindowText থেকে।
            string? friendly = null;
            try { friendly = p.MainModule?.FileVersionInfo.FileDescription; }
            catch (Exception) { /* অন্য ইউজারের বা সুরক্ষিত প্রসেস — নাম ছাড়াই চলবে */ }

            if (_names.Count > 256) _names.Clear(); // pid পুনর্ব্যবহার হয়
            _names[pid] = (exe, friendly);

            return (exe, friendly);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            // প্রসেসটা ইতিমধ্যে বন্ধ হয়ে গেছে
            return (null, null);
        }
    }

    /// <summary>উইন্ডোর টাইটেল — URL আবার পড়া দরকার কি না বুঝতে কলারেরও লাগে।</summary>
    internal static string? PeekTitle(nint hwnd)
    {
        var length = User32.GetWindowTextLength(hwnd);
        if (length <= 0) return null;

        var size = Math.Min(length + 1, MaxTitle);
        Span<char> buffer = stackalloc char[size];

        int written;
        unsafe
        {
            fixed (char* p = buffer) written = User32.GetWindowText(hwnd, p, size);
        }

        return written <= 0 ? null : new string(buffer[..written]);
    }
}
