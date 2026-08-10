using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

/// <summary>
/// COM পয়েন্টার নিয়ে ন্যূনতম কাজ — vtable-এর স্লট ধরে সরাসরি ডাকা।
///
/// <b>কেন র‍্যাপার লাইব্রেরি নয়:</b> পুরো ক্যাপচারের জন্য মোট নয়টা মেথড লাগে।
/// Vortice.Windows এর জন্য একটা prerelease SharpGen.Runtime আর তার সাথে
/// System.Text.Json টেনে আনত — এমন একটা এজেন্টে, যেটার আজ কোনো নির্ভরতাই নেই।
///
/// <b>কেন <c>[GeneratedComInterface]</c> নয়:</b> ওতে ইন্টারফেসের <i>সব</i> মেথড
/// ক্রম মেনে ঘোষণা করতে হয়। <c>ID3D11DeviceContext</c>-এ ১০০-র বেশি মেথড, আর
/// <c>CopyResource</c> ৪৭ নম্বরে — অর্থাৎ ৪৭টা ডামি ঘোষণা লিখতে হতো শুধু একটা
/// মেথডে পৌঁছাতে। স্লট নম্বর সরাসরি লিখলে হেডারের সাথে চোখে মিলিয়ে নেওয়া যায়।
///
/// ⚠️ <b>স্লট নম্বর ভুল হলে কম্পাইলার কিছু বলবে না, রানটাইমেও ব্যতিক্রম হবে না।</b>
/// ভুল ফাংশনের ঠিকানায় ভুল আর্গুমেন্ট গিয়ে মেমরি নষ্ট হবে — উপসর্গ দেখা দেবে
/// সম্পূর্ণ অন্য কোথাও, অন্য কোনো দিন। তাই প্রতিটা স্লট
/// <c>Windows Kits\10\Include\10.0.26100.0</c>-এর হেডার থেকে গুনে মেলানো,
/// আর প্রতিটার পাশে হেডারের নামটা লেখা আছে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static unsafe class ComCall
{
    internal const int S_OK = 0;
    internal const int S_FALSE = 1;
    internal const int E_NOINTERFACE = unchecked((int)0x80004002);

    /// <summary>IUnknown-এর তিনটে স্লট সব ইন্টারফেসের শুরুতেই থাকে।</summary>
    internal const int SlotQueryInterface = 0;
    internal const int SlotAddRef = 1;
    internal const int SlotRelease = 2;

    /// <summary>প্রথম ইন্টারফেস-নির্দিষ্ট স্লট — IUnknown-এর ঠিক পরে।</summary>
    internal const int SlotFirst = 3;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void** Vtbl(nint self) => *(void***)self;

    /// <summary>স্লট <paramref name="slot"/>-এর ফাংশন পয়েন্টার।</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static void* Method(nint self, int slot) => Vtbl(self)[slot];

    internal static int QueryInterface(nint self, in Guid iid, out nint result)
    {
        nint outPtr;
        int hr;

        fixed (Guid* pIid = &iid)
        {
            hr = ((delegate* unmanaged[Stdcall]<nint, Guid*, nint*, int>)
                Method(self, SlotQueryInterface))(self, pIid, &outPtr);
        }

        // ⚠️ ব্যর্থ হলে outPtr-এ কী আছে তার নিশ্চয়তা নেই — নিজেরাই শূন্য করি,
        //    নইলে finally-তে আবর্জনা ঠিকানায় Release() ডাকা হতো।
        result = hr >= 0 ? outPtr : 0;
        return hr;
    }

    /// <summary>
    /// ছেড়ে দিয়ে হ্যান্ডেল শূন্য করা। দুবার ডাকলেও নিরাপদ — <c>finally</c>-তে
    /// এটাই দরকার, কারণ কোন লাইনে ব্যতিক্রম হয়েছে তা আগে থেকে জানা যায় না।
    /// </summary>
    internal static void Release(ref nint self)
    {
        if (self == 0) return;

        var p = self;
        self = 0; // আগে শূন্য, পরে Release — Release-এ ব্যতিক্রম হলেও দুবার হবে না
        ((delegate* unmanaged[Stdcall]<nint, uint>)Method(p, SlotRelease))(p);
    }

    /// <summary>HRESULT ব্যর্থ হলে চেনা যায় এমন ব্যতিক্রম।</summary>
    internal static void ThrowIfFailed(int hr, string what)
    {
        if (hr >= 0) return;

        throw new COMException($"{what} ব্যর্থ (HRESULT 0x{hr:X8})", hr);
    }
}
