using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;
using oXeio.Core.Tracking;

namespace oXeio.Agent.Platform;

/// <summary>
/// "শেষ ইনপুট কতক্ষণ আগে" — একটাই কাজ।
///
/// <b>স্টেটহীন:</b> প্রতিবার শূন্য থেকে হিসাব হয়, কিছু জমিয়ে রাখা হয় না।
/// একটা টিক মিস হলে শুধু ওই সেকেন্ডের নিখুঁততা যায়, হিসাব নষ্ট হয় না।
///
/// হিসাবের নিয়মটা <see cref="IdleMath"/>-এ, কারণ ওটা টেস্ট করা যায়; এখানে শুধু
/// Win32 থেকে কাঁচা সংখ্যা তোলা।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class IdleProbe
{
    internal readonly record struct Sample(
        bool Valid,
        TimeSpan SinceLastInput,
        ulong BiasedMs,
        ulong UnbiasedMs,
        uint RawDwTime,
        uint RawNow32,
        /// <summary>শেষ ইনপুটের সময় "এখনকার" চেয়ে পরে দেখাচ্ছিল কি না।</summary>
        bool ClampedFuture,
        int Win32Error);

    private LASTINPUTINFO _lii;

    public Sample Read()
    {
        // প্রতিবার বসাতে হয় — Windows এটা সত্যিই যাচাই করে
        _lii.cbSize = 8;

        var biased = Kernel32.GetTickCount64();
        var unbiased = ReadUnbiasedMs();

        if (!User32.GetLastInputInfo(ref _lii))
        {
            // ⚠️ কোনো ডিফল্ট মান বসানো যাবে না — dwTime তখন 0, আর সেটা ব্যবহার করলে
            //    নিষ্ক্রিয়তা "PC চালু হওয়ার পর থেকে" হিসেব হবে। নমুনাটাই বাদ।
            return new Sample(false, TimeSpan.Zero, biased, unbiased, 0, 0, false,
                Marshal.GetLastPInvokeError());
        }

        // dwTime ৩২-বিট GetTickCount ঘড়িতে চলে, আর GetTickCount64-এর নিচের ৩২ বিটই
        // সেই ঘড়ি — তাই সরু করে নিয়ে modular বিয়োগ
        var now32 = unchecked((uint)biased);
        var elapsed = IdleMath.Elapsed(now32, _lii.dwTime, out var clamped);

        return new Sample(true, elapsed, biased, unbiased, _lii.dwTime, now32, clamped, 0);
    }

    private static ulong ReadUnbiasedMs() =>
        Kernel32.QueryUnbiasedInterruptTime(out var t) ? t / 10_000UL : 0UL;
}
