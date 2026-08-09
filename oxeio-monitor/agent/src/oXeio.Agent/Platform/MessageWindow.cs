using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

/// <summary>
/// এজেন্টের একমাত্র উইন্ডো — দেখা যায় না, কিন্তু সব খবর এখান দিয়েই আসে।
///
/// ⚠️ <b>message-only (HWND_MESSAGE) উইন্ডো নয়, ইচ্ছাকৃতভাবে।</b>
/// ব্রডকাস্ট মেসেজ শুধু top-level উইন্ডোতেই পৌঁছায়। message-only উইন্ডো বানালে
/// কোডটা পরিষ্কার দেখাত, রেজিস্ট্রেশনও সফল হতো, কিন্তু পাওয়ার নোটিফিকেশন
/// কখনো আসত না — আর "কিছুই ঘটছে না" দেখে সেটা বোঝাও যেত না।
/// তাই WS_POPUP + WS_EX_TOOLWINDOW: top-level, কিন্তু টাস্কবার বা Alt+Tab-এ নেই।
///
/// <c>Microsoft.Win32.SystemEvents</c> ব্যবহার করা হয়নি — ওটা NOTIFY_FOR_THIS_SESSION
/// হার্ডকোড করে, lParam ফেলে দেয়, আর PBT_APMRESUMEAUTOMATIC (0x12) — যেটা Windows-এর
/// একমাত্র নিশ্চিত resume সংকেত — সেটাকেই ধরে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class MessageWindow : NativeWindow, IDisposable
{
    private readonly Action<Message> _onMessage;

    public MessageWindow(Action<Message> onMessage)
    {
        _onMessage = onMessage;

        CreateHandle(new CreateParams
        {
            Caption = "oXeio.Agent.Sink",
            Style = Win32.WS_POPUP,
            ExStyle = Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE,
            X = 0,
            Y = 0,
            Width = 0,
            Height = 0,
            Parent = 0,
        });

        if (Handle == 0)
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "উইন্ডো তৈরি করা গেল না");
    }

    protected override void WndProc(ref Message m)
    {
        // হ্যান্ডলারে দেরি করা যাবে না — suspend-এর বাজেট মাত্র ~২ সেকেন্ড,
        // আর সেটা সব প্রসেস মিলিয়ে, প্রতি প্রসেসে নয়।
        try
        {
            _onMessage(m);
        }
        catch
        {
            // মেসেজ পাম্প কখনোই ভাঙতে দেওয়া যাবে না
        }

        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle != 0) DestroyHandle();
    }
}
