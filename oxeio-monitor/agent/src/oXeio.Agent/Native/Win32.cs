namespace oXeio.Agent.Native;

/// <summary>
/// সব ধ্রুবক এক জায়গায়। কল-সাইটে যেন কোনো জাদুকরী সংখ্যা না থাকে —
/// এই তালিকার কয়েকটা ভুল কপি হলে বাগটা নীরব হয় (কম্পাইল হয়, চলে, ভুল ফল দেয়)।
/// </summary>
internal static class Win32
{
    // ── উইন্ডো মেসেজ ────────────────────────────────────────────────────────
    internal const int WM_WTSSESSION_CHANGE = 0x02B1;
    internal const int WM_POWERBROADCAST = 0x0218;
    internal const int WM_QUERYENDSESSION = 0x0011;
    internal const int WM_ENDSESSION = 0x0016;
    internal const int WM_DISPLAYCHANGE = 0x007E;
    internal const int WM_TIMECHANGE = 0x001E;

    // ── সেশন নোটিফিকেশন ────────────────────────────────────────────────────
    internal const uint NOTIFY_FOR_THIS_SESSION = 0x0;

    internal const int WTS_CONSOLE_CONNECT = 0x1;
    internal const int WTS_CONSOLE_DISCONNECT = 0x2;
    internal const int WTS_REMOTE_CONNECT = 0x3;
    internal const int WTS_REMOTE_DISCONNECT = 0x4;
    internal const int WTS_SESSION_LOGON = 0x5;
    internal const int WTS_SESSION_LOGOFF = 0x6;
    internal const int WTS_SESSION_LOCK = 0x7;
    internal const int WTS_SESSION_UNLOCK = 0x8;
    internal const int WTS_SESSION_TERMINATE = 0xB;

    // ── সেশন শেষ (WM_ENDSESSION-এর lParam) ─────────────────────────────────
    // ⚠️ এই তিনটেই বিটমাস্ক, পরস্পর-বর্জক মান নয় — <c>==</c> দিয়ে মেলালে
    //    ENDSESSION_CRITICAL সহ আসা একটা logoff "shutdown" হয়ে যেত।

    /// <summary>থাকলে ইউজার লগঅফ করছে; <b>না থাকলে</b> PC বন্ধ/রিস্টার্ট হচ্ছে।</summary>
    internal const uint ENDSESSION_LOGOFF = 0x80000000;

    /// <summary>Restart Manager অ্যাপটাকে বন্ধ করাচ্ছে (ফাইল বদলাতে) — সেশন শেষ নয়।</summary>
    internal const uint ENDSESSION_CLOSEAPP = 0x00000001;

    /// <summary>জোর করে — "না" বলার সুযোগ নেই। বন্ধের ধরন এতে বদলায় না।</summary>
    internal const uint ENDSESSION_CRITICAL = 0x40000000;

    internal const int WTSSessionInfoEx = 25;
    internal const uint WTS_CURRENT_SESSION = 0xFFFFFFFF;

    // ⚠️ LOCK-এর মান UNLOCK-এর চেয়ে ছোট — উল্টো ধরলে পুরো হিসাব উল্টো হয়ে যাবে
    internal const int WTS_SESSIONSTATE_UNKNOWN = -1;
    internal const int WTS_SESSIONSTATE_LOCK = 0;
    internal const int WTS_SESSIONSTATE_UNLOCK = 1;

    // ── পাওয়ার ──────────────────────────────────────────────────────────────
    internal const int PBT_APMSUSPEND = 0x0004;
    internal const int PBT_APMRESUMESUSPEND = 0x0007;

    /// <summary>Windows যেটার নিশ্চয়তা দেয় — অথচ .NET-এর SystemEvents এটাকেই ধরে না।</summary>
    internal const int PBT_APMRESUMEAUTOMATIC = 0x0012;
    internal const int PBT_POWERSETTINGCHANGE = 0x8013;

    internal const uint DEVICE_NOTIFY_WINDOW_HANDLE = 0x0;

    /// <summary>ডিসপ্লে বন্ধ হওয়া = modern standby-তে ঢোকার সবচেয়ে আগের সংকেত।</summary>
    internal static readonly Guid GUID_SESSION_DISPLAY_STATUS =
        new("2B84C20E-AD23-4DDF-93DB-05FFBD7EFCA5");

    internal const int MONITOR_DISPLAY_OFF = 0;
    internal const int MONITOR_DISPLAY_ON = 1;
    internal const int MONITOR_DISPLAY_DIM = 2;

    // ── উইন্ডো স্টাইল ───────────────────────────────────────────────────────
    // ⚠️ HWND_MESSAGE (message-only) উইন্ডো ব্রডকাস্ট মেসেজ পায় না।
    //    তাই লুকানো হলেও top-level উইন্ডোই বানাতে হয়।
    internal const int WS_POPUP = unchecked((int)0x80000000);
    internal const int WS_EX_TOOLWINDOW = 0x00000080;
    internal const int WS_EX_NOACTIVATE = 0x08000000;

    // ── ত্রুটি কোড ──────────────────────────────────────────────────────────
    internal const int ERROR_INVALID_PARAMETER = 87;

    /// <summary>বুটের সময় Terminal Services তৈরি হওয়ার আগে রেজিস্টার করতে গেলে।</summary>
    internal const int RPC_S_INVALID_BINDING = 1702;
}
