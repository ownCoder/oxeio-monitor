using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Agent.Security;
using oXeio.Agent.Sync;

namespace oXeio.Agent;

/// <summary>
/// দুটো রূপ আছে:
///
/// <list type="bullet">
/// <item><b>কিছু না দিলে</b> — পূর্ণ এজেন্ট। tray আইকন দেখা যায়, কনসোল নয়।</item>
/// <item><c>--diagnose</c> — Win32 ও ক্যাপচার যাচাইয়ের টুল, কনসোলে ফল লেখে।</item>
/// </list>
///
/// ⚠️ প্রজেক্ট <c>WinExe</c>, তাই কনসোল আপনাআপনি থাকে না। এটা ইচ্ছাকৃত:
/// <c>Exe</c> হলে প্রতিবার লগঅনে প্রতিটা PC-তে একটা কালো কনসোল উইন্ডো
/// খুলে বসে থাকত, আর স্টাফ সেটা বন্ধ করে দিলে এজেন্টও মরত।
/// <c>--diagnose</c>-এ কনসোলটা হাতে জুড়ে নেওয়া হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class Program
{
    private const string Version = "0.1.0";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(a => a.Equals("--diagnose", StringComparison.OrdinalIgnoreCase)))
        {
            AttachOrAllocConsole();
            return Diagnostics.Run();
        }

        if (args.Any(a => a.Equals("--prepare-data-dir", StringComparison.OrdinalIgnoreCase)))
        {
            AttachOrAllocConsole();
            return PrepareDataDir();
        }

        return RunAgent();
    }

    /// <summary>
    /// MSI ইনস্টল করার সময় একবার, অ্যাডমিন অধিকারে।
    ///
    /// ⭐ <b>কেন ইনস্টলারকে এটা করতে হয়:</b> ProgramData-র ডিফল্ট ACL-এ সাধারণ
    /// ইউজার শুধু <b>নিজের বানানো</b> ফাইল বদলাতে পারে। ইনস্টলার (অ্যাডমিন)
    /// ফোল্ডারটা বানিয়ে ফেলে রেখে গেলে স্টাফের অ্যাকাউন্টে চলা এজেন্ট
    /// ওখানে SQLite কিউ লিখতেই পারত না — প্রতিটা INSERT-এ
    /// <c>SQLITE_READONLY</c>, আর এজেন্ট চুপচাপ কিছুই জমাত না।
    ///
    /// তাই ফোল্ডারটা <see cref="AgentDataDirectory.Ensure"/> দিয়েই বানানো হয়,
    /// যেটা Users-কে Modify দেয়। ACL-এর নিয়ম একটাই জায়গায় থাকে — WiX-এ
    /// আলাদা করে লিখলে দুটো সংজ্ঞা একদিন আলাদা হয়ে যেত।
    /// </summary>
    private static int PrepareDataDir()
    {
        var path = AgentDataDirectory.Default;

        if (!AgentDataDirectory.TryEnsure(path, out var error))
        {
            Console.Error.WriteLine($"❌ {path} বানানো গেল না: {error}");
            return 4;
        }

        Console.WriteLine($"✅ ডেটা ফোল্ডার প্রস্তুত: {path}");
        return 0;
    }

    private static int RunAgent()
    {
        var settings = AgentSettings.Load(out var source);
        if (settings is null)
        {
            // ⚠️ চুপ করে বন্ধ হওয়া যাবে না। ইনস্টলার কনফিগ না লিখলে বা ভুল
            //    লিখলে এজেন্ট নীরবে কিছুই করত না, আর কেউ সপ্তাহখানেক পরে
            //    আবিষ্কার করত যে ওই PC-র কোনো ডেটাই নেই।
            Complain(
                "oXeio এজেন্ট চালু হতে পারল না",
                $"সার্ভারের ঠিকানা পাওয়া যায়নি।\n\nদেখা হয়েছে: {source}\n\n" +
                $"ইনস্টলার এটা লিখে দেওয়ার কথা। অফিসের আইটিকে জানান।");
            return 2;
        }

        using var window = new MessageWindow(OnMessage);
        using var session = new SessionMonitor(window.Handle);
        using var power = new PowerMonitor(window.Handle);

        _power = power;
        _host = new AgentHost(settings, Version, ConsoleSyncLog.Instance);

        if (!_host.TryStart(window.Handle, out var error))
        {
            Complain("oXeio এজেন্ট চালু হতে পারল না", error ?? "কারণ জানা যায়নি");
            return 3;
        }

        session.TryRegister();
        power.TryRegister();

        Application.ApplicationExit += async (_, _) =>
        {
            if (_host is not null) await _host.DisposeAsync();
        };

        Application.Run();
        return 0;
    }

    private static AgentHost? _host;
    private static PowerMonitor? _power;

    /// <summary>
    /// ⚠️ এই হ্যান্ডলার UI থ্রেডে চলে। এখানে কোনো নেটওয়ার্ক বা ডিস্কের কাজ
    /// করা যাবে না — করলে লক/আনলকের সময় পুরো ডেস্কটপ আটকে যেত।
    /// </summary>
    private static void OnMessage(Message m)
    {
        switch (m.Msg)
        {
            case Win32.WM_WTSSESSION_CHANGE:
                _host?.OnSessionChange(SessionMonitor.Interpret((int)m.WParam));
                break;

            case Win32.WM_POWERBROADCAST:
                _host?.OnPower(_power?.Interpret(m.WParam, m.LParam, DateTimeOffset.UtcNow));
                break;
        }
    }

    // ── কনসোল ও বার্তা ──────────────────────────────────────────────────────

    private const uint AttachParentProcess = 0xFFFFFFFF;

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AttachConsole(uint processId);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AllocConsole();

    /// <summary>
    /// টার্মিনাল থেকে চালালে সেটার কনসোলেই লেখা, নইলে নতুন একটা।
    /// দুটোই ব্যর্থ হলে চুপচাপ এগিয়ে যাওয়া — আউটপুট না দেখা গেলেও
    /// ডায়াগনস্টিক চলতে বাধা নেই।
    /// </summary>
    private static void AttachOrAllocConsole()
    {
        if (!AttachConsole(AttachParentProcess)) AllocConsole();
    }

    private static void Complain(string title, string body)
    {
        // ⚠️ MessageBox ব্যবহার করা হয় শুধু **চালু হতেই না পারার** ক্ষেত্রে।
        //    স্বাভাবিক চলার সময় কোনো পপ-আপ নেই — tray আইকনই একমাত্র মুখ।
        try
        {
            MessageBox.Show(body, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception)
        {
            // কোনো ডেস্কটপ নেই (সার্ভিস/সেশন ০) — দেখানোর কিছু নেই
        }
    }
}
