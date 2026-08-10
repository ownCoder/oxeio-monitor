using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[StructLayout(LayoutKind.Sequential)]
internal struct POINT
{
    internal int X;
    internal int Y;
}

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_RATIONAL
{
    internal uint Numerator;
    internal uint Denominator;
}

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_MODE_DESC
{
    internal uint Width;
    internal uint Height;
    internal DXGI_RATIONAL RefreshRate;
    internal uint Format;
    internal uint ScanlineOrdering;
    internal uint Scaling;
}

/// <summary>
/// ⚠️ <c>DeviceName</c> <c>fixed char</c>, <c>ByValTStr</c> নয় — নইলে স্ট্রাকচারটা
/// non-blittable হয়ে যেত (<see cref="MONITORINFOEXW"/>-এর মতোই)।
///
/// <c>Monitor</c> ফিল্ডটাই আসল কাজের জিনিস: এটাই সেই HMONITOR যেটা
/// <see cref="Platform.Capture.MonitorEnumerator"/> থেকে আসা মনিটরের সাথে
/// মেলাতে হবে।
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal unsafe struct DXGI_OUTPUT_DESC
{
    internal fixed char DeviceName[32];
    internal RECT DesktopCoordinates;
    internal int AttachedToDesktop;
    internal uint Rotation;
    internal nint Monitor;
}

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_OUTDUPL_DESC
{
    internal DXGI_MODE_DESC ModeDesc;

    /// <summary>DXGI_MODE_ROTATION — ঘোরানো ডিসপ্লেতে ১ ছাড়া অন্য কিছু আসে।</summary>
    internal uint Rotation;

    internal int DesktopImageInSystemMemory;
}

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_OUTDUPL_POINTER_POSITION
{
    internal POINT Position;
    internal int Visible;
}

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_OUTDUPL_FRAME_INFO
{
    internal long LastPresentTime;
    internal long LastMouseUpdateTime;

    /// <summary>
    /// শূন্য মানে কেবল কার্সার নড়েছে, ডেস্কটপের ছবি বদলায়নি —
    /// তবু <c>AcquireNextFrame</c> সফল হয় ([ADR-012c](../../../../docs/05-Options-Decisions.md))।
    /// </summary>
    internal uint AccumulatedFrames;

    internal int RectsCoalesced;

    /// <summary>
    /// ⭐ DRM-সুরক্ষিত কনটেন্ট বাদ দেওয়া হয়েছে কি না — <b>OS নিজে জানিয়ে দিচ্ছে</b>।
    /// GDI-তে এই তথ্যটা পাওয়ারই উপায় ছিল না; আন্দাজে কালো পিক্সেল গুনতে হতো।
    /// </summary>
    internal int ProtectedContentMaskedOut;

    internal DXGI_OUTDUPL_POINTER_POSITION PointerPosition;
    internal uint TotalMetadataBufferSize;
    internal uint PointerShapeBufferSize;
}

/// <summary>
/// DXGI Desktop Duplication — প্রাথমিক ক্যাপচার ইঞ্জিন
/// ([ADR-012c](../../../../docs/05-Options-Decisions.md))।
///
/// সব IID ও স্লট <c>Windows Kits\10\Include\10.0.26100.0\shared\{dxgi,dxgi1_2}.h</c>
/// থেকে গুনে মেলানো।
///
/// ⚠️ <b>DXGI-র উত্তরাধিকার D3D11-এর উল্টো ক্রমে।</b> সব DXGI ইন্টারফেস
/// <c>IDXGIObject</c> থেকে আসে, যার চারটে মেথডের ক্রম —
/// SetPrivateData, SetPrivateDataInterface, <b>Get</b>PrivateData, GetParent।
/// D3D11-এ আবার Get আগে, Set পরে। দুটো গুলিয়ে ফেললে স্লট এক ঘর সরে যাবে
/// আর ভুলটা নীরব থাকবে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class Dxgi
{
    // ── IID ─────────────────────────────────────────────────────────────────

    /// <summary>dxgi.h:3119</summary>
    internal static readonly Guid IID_IDXGIFactory1 =
        new("770aae78-f26f-4dba-a829-253c83d1b387");

    /// <summary>dxgi1_2.h:2621</summary>
    internal static readonly Guid IID_IDXGIOutput1 =
        new("00cddea8-939b-4b83-a340-a685226666cc");

    /// <summary>dxgi1_2.h:2614</summary>
    internal static readonly Guid IID_IDXGIOutputDuplication =
        new("191cfac3-a341-470d-b26e-a864f428319c");

    // ── vtable স্লট ─────────────────────────────────────────────────────────
    //
    // IDXGIObject: 3 SetPrivateData · 4 SetPrivateDataInterface
    //              5 GetPrivateData · 6 GetParent
    // অর্থাৎ প্রতিটি DXGI ইন্টারফেসের নিজস্ব মেথড শুরু হয় ৭ থেকে।

    /// <summary>IDXGIFactory1 — dxgi.h। IDXGIFactory-র ৫টা মেথড (৭–১১) পেরিয়ে।</summary>
    internal const int Factory1_EnumAdapters1 = 12;

    /// <summary>IDXGIDevice — dxgi.h</summary>
    internal const int Device_GetAdapter = 7;

    /// <summary>IDXGIAdapter — dxgi.h</summary>
    internal const int Adapter_EnumOutputs = 7;

    /// <summary>IDXGIOutput — dxgi.h</summary>
    internal const int Output_GetDesc = 7;

    /// <summary>
    /// IDXGIOutput1 — dxgi1_2.h। IDXGIOutput-এর ১২টা মেথড (৭–১৮) পেরিয়ে
    /// GetDisplayModeList1(19), FindClosestMatchingMode1(20),
    /// GetDisplaySurfaceData1(21), তারপর এটা।
    /// </summary>
    internal const int Output1_DuplicateOutput = 22;

    /// <summary>IDXGIOutputDuplication — ⚠️ <c>void</c> ফেরত।</summary>
    internal const int Duplication_GetDesc = 7;

    /// <summary>IDXGIOutputDuplication</summary>
    internal const int Duplication_AcquireNextFrame = 8;

    /// <summary>IDXGIOutputDuplication</summary>
    internal const int Duplication_ReleaseFrame = 14;

    // ── ত্রুটি কোড (winerror.h) ─────────────────────────────────────────────

    /// <summary>ডেস্কটপ একটুও বদলায়নি — <b>ব্যর্থতা নয়</b>, স্বাভাবিক ফল।</summary>
    internal const int DXGI_ERROR_WAIT_TIMEOUT = unchecked((int)0x887A0027);

    /// <summary>মোড বদল / ডেস্কটপ সুইচ / DWM রিস্টার্ট — নতুন করে শুরু করতে হবে।</summary>
    internal const int DXGI_ERROR_ACCESS_LOST = unchecked((int)0x887A0026);

    /// <summary>
    /// একসাথে সর্বোচ্চ ৪টি duplication চলতে পারে। Teams বা Zoom স্ক্রিন শেয়ার
    /// করলে এই সীমা ছোঁয়া বাস্তবেই ঘটে।
    /// </summary>
    internal const int DXGI_ERROR_NOT_CURRENTLY_AVAILABLE = unchecked((int)0x887A0022);

    /// <summary>RDP সেশন — ডেস্কটপ ডুপ্লিকেশন ওখানে চলে না।</summary>
    internal const int DXGI_ERROR_SESSION_DISCONNECTED = unchecked((int)0x887A0028);

    /// <summary>ড্রাইভার/অ্যাডাপ্টার এটা পারে না — এই মেশিনে আর চেষ্টা করার মানে নেই।</summary>
    internal const int DXGI_ERROR_UNSUPPORTED = unchecked((int)0x887A0004);

    internal const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);
    internal const int DXGI_ERROR_INVALID_CALL = unchecked((int)0x887A0001);

    /// <summary>UAC-র secure desktop বা লক স্ক্রিন সামনে থাকলে।</summary>
    internal const int E_ACCESSDENIED = unchecked((int)0x80070005);

    /// <summary>
    /// এই ত্রুটিগুলো এই মেশিনে <b>স্থায়ী</b> — প্রতি ৫ মিনিটে আবার চেষ্টা করা
    /// অর্থহীন। এগুলো পেলে একেবারে GDI-তে নেমে যাওয়া হয়।
    /// </summary>
    internal static bool IsPermanent(int hr) =>
        hr == DXGI_ERROR_UNSUPPORTED || hr == DXGI_ERROR_NOT_FOUND;

    // ── এন্ট্রি পয়েন্ট ───────────────────────────────────────────────────────

    /// <summary>
    /// dxgi.h — অ্যাডাপ্টার গোনার জন্য।
    ///
    /// ⚠️ ডিফল্ট অ্যাডাপ্টারে ডিভাইস বানিয়ে কাজ চালানো যায় না। হাইব্রিড গ্রাফিক্সের
    /// ল্যাপটপে (Intel + NVIDIA) মনিটরটা যে অ্যাডাপ্টারে লাগানো, ডিভাইস ঠিক
    /// <b>সেটাতেই</b> বানাতে হয় — নইলে <c>DuplicateOutput</c> সরাসরি
    /// E_INVALIDARG দেয়। অফিসে একটাও ল্যাপটপ থাকলেই এটা ধরা পড়বে।
    /// </summary>
    [LibraryImport("dxgi.dll")]
    internal static unsafe partial int CreateDXGIFactory1(Guid* riid, nint* factory);
}
