using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Core.Agent;

namespace oXeio.Agent.Tests;

/// <summary>
/// G02 — "স্টাফ চলে গেছে" বনাম "PC বন্ধ হচ্ছে"।
///
/// ⭐ এই পার্থক্যটাই সার্ভারের tamper অ্যালার্টের পুরো ভিত্তি
/// (<c>alerts.rules.ts</c>): একটা <c>agent_stop</c>-এর আশেপাশে
/// <c>logoff</c>/<c>shutdown</c> থাকলে সেটা স্বাভাবিক বন্ধ, না থাকলে হস্তক্ষেপ।
/// এখানকার একটা ভুল মানে হয় রোজ ১৫টা মিথ্যা অ্যালার্ট, নয় আসল হস্তক্ষেপ
/// চুপচাপ পার পেয়ে যাওয়া।
/// </summary>
public class SessionEndTests
{
    private static nint Flags(uint value) => unchecked((nint)(long)(int)value);

    // ── WM_ENDSESSION ───────────────────────────────────────────────────────

    [Fact]
    public void লগঅফের_বিটে_logoff_যায() =>
        Assert.Equal(
            AgentEventTypes.Logoff,
            SessionMonitor.InterpretEndSession(1, Flags(Win32.ENDSESSION_LOGOFF)));

    /// <summary>lParam ০ = Windows বন্ধ বা রিস্টার্ট হচ্ছে (MSDN)।</summary>
    [Fact]
    public void শূন্য_lParam_মানে_shutdown() =>
        Assert.Equal(AgentEventTypes.Shutdown, SessionMonitor.InterpretEndSession(1, 0));

    /// <summary>
    /// ⚠️ CRITICAL শুধু বলে "না বলার সুযোগ নেই" — বন্ধের ধরন বদলায় না।
    /// <c>==</c> দিয়ে মেলালে এই কেসটাই ভুল দিকে যেত।
    /// </summary>
    [Fact]
    public void CRITICAL_যোগ_হলেও_shutdown_ই_থাকে() =>
        Assert.Equal(
            AgentEventTypes.Shutdown,
            SessionMonitor.InterpretEndSession(1, Flags(Win32.ENDSESSION_CRITICAL)));

    [Fact]
    public void CRITICAL_সহ_লগঅফও_logoff_ই_থাকে() =>
        Assert.Equal(
            AgentEventTypes.Logoff,
            SessionMonitor.InterpretEndSession(
                1, Flags(Win32.ENDSESSION_CRITICAL | Win32.ENDSESSION_LOGOFF)));

    /// <summary>
    /// ⚠️ Restart Manager অ্যাপটাকে বন্ধ করাচ্ছে (সাধারণত এজেন্ট-আপডেটের সময়) —
    /// PC বন্ধ হচ্ছে না। এটাকে shutdown ধরলে প্রতিটা আপডেট একটা ভুয়া
    /// "PC বন্ধ" রেকর্ড রেখে যেত, আর H04-এর প্রতিটা রাতের আপডেট সার্ভারে
    /// পনেরোটা মিথ্যা শাটডাউন হয়ে বসত।
    /// </summary>
    [Fact]
    public void শুধু_CLOSEAPP_কোনো_ইভেন্ট_নয়() =>
        Assert.Null(SessionMonitor.InterpretEndSession(1, Flags(Win32.ENDSESSION_CLOSEAPP)));

    /// <summary>
    /// wParam == FALSE মানে WM_QUERYENDSESSION-এ কেউ বাধা দিয়েছে — সেশন চলবে।
    /// এখানে ইভেন্ট পাঠালে "PC বন্ধ হয়েছে" মিথ্যা লেখা থেকে যেত।
    /// </summary>
    [Fact]
    public void বাতিল_হওয়া_সেশন_শেষে_কিছুই_যায়_না() =>
        Assert.Null(SessionMonitor.InterpretEndSession(0, 0));

    // ── WM_WTSSESSION_CHANGE ────────────────────────────────────────────────

    [Theory]
    [InlineData(Win32.WTS_SESSION_LOGOFF)]
    [InlineData(Win32.WTS_SESSION_TERMINATE)]
    public void সেশন_শেষ_হলে_logoff(int code) =>
        Assert.Equal(AgentEventTypes.Logoff, SessionMonitor.ClosingEventType(code));

    /// <summary>
    /// ⚠️ লক/আনলক ইভেন্ট নয়। একজন দিনে ডজনখানেক বার লক করে; ওগুলো পাঠালে
    /// <c>agent_events</c> রোজ হাজার সারিতে ভরত, অথচ তথ্যটা আগে থেকেই
    /// <c>locked</c> সেগমেন্টে আছে।
    /// </summary>
    [Theory]
    [InlineData(Win32.WTS_SESSION_LOCK)]
    [InlineData(Win32.WTS_SESSION_UNLOCK)]
    [InlineData(Win32.WTS_SESSION_LOGON)]
    [InlineData(Win32.WTS_REMOTE_DISCONNECT)]
    public void বাকি_সেশন_বার্তায়_কোনো_ইভেন্ট_নয়(int code) =>
        Assert.Null(SessionMonitor.ClosingEventType(code));

    /// <summary>
    /// ⚠️ ট্র্যাকিং আর ইভেন্ট — দুটো আলাদা সিদ্ধান্ত, আর দুটোই থাকতে হবে।
    /// RDP disconnect-এ ঘড়ি থামে কিন্তু কেউ "চলে যায়নি"; logoff-এ দুটোই ঘটে।
    /// </summary>
    [Fact]
    public void ট্র্যাকিং_থামা_আর_চলে_যাওয়া_এক_নয()
    {
        Assert.Equal(SessionChange.Suspend, SessionMonitor.Interpret(Win32.WTS_REMOTE_DISCONNECT));
        Assert.Null(SessionMonitor.ClosingEventType(Win32.WTS_REMOTE_DISCONNECT));

        Assert.Equal(SessionChange.Suspend, SessionMonitor.Interpret(Win32.WTS_SESSION_LOGOFF));
        Assert.Equal(AgentEventTypes.Logoff, SessionMonitor.ClosingEventType(Win32.WTS_SESSION_LOGOFF));
    }

    /// <summary>সার্ভারের prisma enum-এর সাথে হুবহু মেলা স্ট্রিং।</summary>
    [Fact]
    public void ইভেন্টের_নাম_সার্ভারের_নামই()
    {
        Assert.Equal("logoff", AgentEventTypes.Logoff);
        Assert.Equal("shutdown", AgentEventTypes.Shutdown);
        Assert.Equal("agent_stop", AgentEventTypes.AgentStop);
    }
}
