using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;
using oXeio.Core.Agent;

namespace oXeio.Agent.Platform;

/// <summary>
/// lock / unlock / logon / logoff / RDP সংযোগ-বিচ্ছেদ।
///
/// ⚠️ শুধু Win+L ধরলে হবে না। fast user switching আর RDP disconnect —
/// শেয়ার করা বা দূরের PC ছেড়ে যাওয়ার সবচেয়ে সাধারণ দুটো উপায় — কোনোটাতেই
/// SESSION_LOCK আসে না। ওগুলো আলাদা করে ধরতে হয়, নইলে ঘড়ি চলতেই থাকে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SessionMonitor : IDisposable
{
    private readonly nint _hwnd;
    private bool _registered;

    /// <summary>যেসব ইভেন্টে ট্র্যাকিং থামবে।</summary>
    private static readonly HashSet<int> Suspending =
    [
        Win32.WTS_SESSION_LOCK,
        Win32.WTS_SESSION_LOGOFF,
        Win32.WTS_SESSION_TERMINATE,
        Win32.WTS_CONSOLE_DISCONNECT,
        Win32.WTS_REMOTE_DISCONNECT,
    ];

    /// <summary>যেসব ইভেন্টে আবার চালু হবে।</summary>
    private static readonly HashSet<int> Resuming =
    [
        Win32.WTS_SESSION_UNLOCK,
        Win32.WTS_SESSION_LOGON,
        Win32.WTS_CONSOLE_CONNECT,
        Win32.WTS_REMOTE_CONNECT,
    ];

    public SessionMonitor(nint hwnd) => _hwnd = hwnd;

    /// <summary>রেজিস্ট্রেশন ব্যর্থ হলে কী ঘটল তা ফেরত দেয় — চুপ করে থাকে না।</summary>
    public (bool Ok, int Error) TryRegister()
    {
        if (Wtsapi32.WTSRegisterSessionNotification(_hwnd, Win32.NOTIFY_FOR_THIS_SESSION))
        {
            _registered = true;
            return (true, 0);
        }

        return (false, Marshal.GetLastPInvokeError());
    }

    public static SessionChange? Interpret(int wtsCode) =>
        Suspending.Contains(wtsCode) ? SessionChange.Suspend
        : Resuming.Contains(wtsCode) ? SessionChange.Resume
        : null;

    /// <summary>
    /// G02 — এই সেশন-বার্তাটা কি "স্টাফ চলে যাচ্ছে" বোঝায়? বোঝালে যে ইভেন্ট
    /// টাইপ পাঠাতে হবে, নইলে <c>null</c>।
    ///
    /// ⚠️ <b>lock এখানে নেই, ইচ্ছাকৃতভাবে।</b> লক করা মানে চলে যাওয়া নয় — টানা
    /// আট ঘণ্টায় একজন ডজনখানেক বার লক করে। ওগুলো ইভেন্ট হিসেবে পাঠালে
    /// <c>agent_events</c> দিনে হাজারখানেক সারিতে ভরে যেত, অথচ ঘণ্টার হিসাবে
    /// লক আগে থেকেই <see cref="oXeio.Core.Models.SegmentState.Locked"/> সেগমেন্ট
    /// হয়ে যায় — অর্থাৎ তথ্যটা দুবার জমা হতো।
    ///
    /// ⚠️ <c>WTS_SESSION_TERMINATE</c>-ও logoff। সেশনটা বাইরে থেকে (অ্যাডমিন,
    /// টাইমআউট) শেষ করে দেওয়া হয়েছে; স্টাফের দিক থেকে ফলটা একই, আর ইভেন্টটা
    /// না পাঠালে সার্ভার ওই <c>agent_stop</c>-কে হস্তক্ষেপ ধরত।
    /// </summary>
    public static string? ClosingEventType(int wtsCode) => wtsCode switch
    {
        Win32.WTS_SESSION_LOGOFF or Win32.WTS_SESSION_TERMINATE => AgentEventTypes.Logoff,
        _ => null,
    };

    /// <summary>
    /// <c>WM_ENDSESSION</c> → <c>logoff</c> / <c>shutdown</c> / কিছুই না।
    ///
    /// ⭐⚠️ <b>শাটডাউনের খবর PowerMonitor-এ আসে না — খুঁজে দেখা হয়েছে।</b>
    /// <c>WM_POWERBROADCAST</c>-এর সব রূপ (<c>PBT_APMSUSPEND</c>,
    /// <c>PBT_APMRESUME*</c>, ডিসপ্লে) ঘুম ও জাগরণের কথা বলে; Windows বন্ধ বা
    /// রিস্টার্ট হওয়ার সময় ওগুলোর একটাও আসে না। শাটডাউন আসে <b>শুধু</b>
    /// <c>WM_QUERYENDSESSION</c>/<c>WM_ENDSESSION</c> হয়ে, আর ওটা সেশনের বার্তা —
    /// সেজন্যই ব্যাখ্যাটা এখানে, পাওয়ারে নয়। PowerMonitor-এ বসালে কোডটা
    /// কম্পাইল হতো, চলত, এবং <c>shutdown</c> ইভেন্ট কোনোদিন যেত না।
    ///
    /// ⚠️ WTS-এর logoff আর এখানকার logoff — দুটোই আসে। একটাই পাঠানো হয়;
    /// ডিডুপটা <c>AgentHost</c>-এ (<c>RaiseClosingEvent</c>)।
    /// </summary>
    /// <param name="wParam">০ হলে সেশন আসলে শেষ হচ্ছে না (কেউ "না" বলেছে)।</param>
    /// <param name="lParam">ENDSESSION_* বিটমাস্ক।</param>
    public static string? InterpretEndSession(nint wParam, nint lParam)
    {
        // wParam == FALSE মানে WM_QUERYENDSESSION-এ কেউ বাধা দিয়েছে, সেশন
        // চলবে। এখানে ইভেন্ট পাঠালে "PC বন্ধ হয়েছে" মিথ্যা রেকর্ড হয়ে থাকত।
        if (wParam == 0) return null;

        // ⚠️ ৬৪-বিটে lParam sign-extend হতে পারে; নিচের ৩২ বিটই আসল মান।
        var flags = unchecked((uint)(long)lParam);

        if ((flags & Win32.ENDSESSION_LOGOFF) != 0) return AgentEventTypes.Logoff;

        /*
         * ⚠️ শুধু CLOSEAPP মানে Restart Manager আমাদেরই বন্ধ করাচ্ছে (সাধারণত
         *    আপডেট ইনস্টল করতে) — PC বন্ধ হচ্ছে না। এটাকে `shutdown` বলা
         *    যায় না: বললে প্রতিটা এজেন্ট-আপডেট একটা ভুয়া "PC বন্ধ" রেকর্ড
         *    রেখে যেত।
         *
         * ⚠️⚠️ **কিন্তু আগে এখানে `null` ফিরত, আর সেটাই ছিল একটা নীরব বাগ।**
         *    `null` মানে কোনো closing ইভেন্টই যায় না, অথচ `agent_stop` ঠিকই
         *    যায় — আর সার্ভারের G02 একটা সঙ্গীহীন `agent_stop`-কে
         *    **হস্তক্ষেপ** ধরে (`alerts.rules.ts` → `isTamperStop`)। ফলে
         *    প্রতিটা আপডেট একটা মিথ্যা `agent_killed` অ্যালার্ট তুলত।
         *    ⭐ হাতে একটা-দুটো PC আপডেট করলে চোখে পড়ত না; রোলআউট নিজে
         *    থেকে এগোতে শুরু করলে একসাথে ১২টা — আর তার পরেই কেউ আর
         *    অ্যালার্ট পড়ত না।
         *
         * ⭐ এখন নিজের একটা নাম আছে (`agent_update`) — সত্যি কথাটাই বলা
         *    হয়, আর সার্ভার সেটাকে `agent_stop`-এর বৈধ সঙ্গী ধরে।
         */
        if ((flags & Win32.ENDSESSION_CLOSEAPP) != 0)
            return AgentEventTypes.AgentUpdate;

        // বাকি সব (0, ENDSESSION_CRITICAL) = PC বন্ধ বা রিস্টার্ট হচ্ছে
        return AgentEventTypes.Shutdown;
    }

    public static string Describe(int wtsCode) => wtsCode switch
    {
        Win32.WTS_CONSOLE_CONNECT => "console connect",
        Win32.WTS_CONSOLE_DISCONNECT => "console disconnect",
        Win32.WTS_REMOTE_CONNECT => "remote connect",
        Win32.WTS_REMOTE_DISCONNECT => "remote disconnect",
        Win32.WTS_SESSION_LOGON => "logon",
        Win32.WTS_SESSION_LOGOFF => "logoff",
        Win32.WTS_SESSION_LOCK => "lock",
        Win32.WTS_SESSION_UNLOCK => "unlock",
        Win32.WTS_SESSION_TERMINATE => "terminate",
        _ => $"unknown ({wtsCode})",
    };

    public void Dispose()
    {
        if (!_registered) return;
        Wtsapi32.WTSUnRegisterSessionNotification(_hwnd);
        _registered = false;
    }
}

internal enum SessionChange
{
    Suspend,
    Resume,
}
