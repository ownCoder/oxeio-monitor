using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[StructLayout(LayoutKind.Sequential)]
internal struct DXGI_SAMPLE_DESC
{
    internal uint Count;
    internal uint Quality;
}

/// <summary>
/// <c>d3d11.h</c>-এর <c>D3D11_TEXTURE2D_DESC</c> — ফিল্ডের ক্রম হেডারের সাথে
/// হুবহু এক রাখতে হবে। একটা ফিল্ড এদিক-ওদিক হলে ড্রাইভার আবর্জনা মাপ পড়বে।
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal struct D3D11_TEXTURE2D_DESC
{
    internal uint Width;
    internal uint Height;
    internal uint MipLevels;
    internal uint ArraySize;
    internal uint Format;
    internal DXGI_SAMPLE_DESC SampleDesc;
    internal uint Usage;
    internal uint BindFlags;
    internal uint CPUAccessFlags;
    internal uint MiscFlags;
}

[StructLayout(LayoutKind.Sequential)]
internal unsafe struct D3D11_MAPPED_SUBRESOURCE
{
    internal void* pData;

    /// <summary>
    /// ⚠️ প্রতি সারিতে কত বাইট — <b>প্রায় কখনোই <c>Width × 4</c> নয়</b>।
    /// ড্রাইভার নিজের সুবিধামতো padding দেয়। <see cref="oXeio.Core.Capture.PixelCopy"/> দেখুন।
    /// </summary>
    internal uint RowPitch;

    internal uint DepthPitch;
}

/// <summary>
/// D3D11-এর যেটুকু ডেস্কটপ ডুপ্লিকেশনের জন্য লাগে — ডিভাইস বানানো, staging
/// টেক্সচার, আর GPU থেকে CPU-তে পড়া।
///
/// সব ধ্রুবক, IID ও vtable স্লট
/// <c>C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0</c>-এর হেডার
/// থেকে গুনে মেলানো। কোন লাইন থেকে এসেছে সেটাও পাশে লেখা, যাতে পরে কেউ
/// যুক্তি দিয়ে নয়, হেডার খুলে যাচাই করতে পারে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class D3D11
{
    // ── ধ্রুবক (d3d11.h, dxgiformat.h, d3dcommon.h) ────────────────────────

    /// <summary>d3d11.h:15014 — <c>#define D3D11_SDK_VERSION (7)</c></summary>
    internal const uint SdkVersion = 7;

    /// <summary>
    /// d3dcommon.h:85।
    /// ⚠️ <b>অ্যাডাপ্টার হাতে দিয়ে ডিভাইস বানালে driver type অবশ্যই UNKNOWN হতে হবে</b> —
    /// HARDWARE দিলে <c>D3D11CreateDevice</c> E_INVALIDARG দেয়। ডকুমেন্টেশনে
    /// লেখা আছে, কিন্তু ভুলটা এতই সাধারণ যে এখানে লিখে রাখা।
    /// </summary>
    internal const uint DriverTypeUnknown = 0;

    /// <summary>
    /// d3d11.h:15007। ডুপ্লিকেশনের সারফেস BGRA-তেই আসে, আর Microsoft-এর নিজের
    /// নমুনাও এই ফ্ল্যাগ দিয়েই ডিভাইস বানায়। খরচ নেই, তাই রাখা।
    /// </summary>
    internal const uint CreateDeviceBgraSupport = 0x20;

    /// <summary>
    /// ⚠️ ইচ্ছাকৃতভাবে <c>SINGLETHREADED</c> দেওয়া হয় না। ভবিষ্যতে একাধিক
    /// মনিটরের ক্যাপচার সমান্তরাল করলে ওই ফ্ল্যাগ নীরবে অনির্ধারিত আচরণ ডেকে আনত।
    /// </summary>
    internal const uint CreateDeviceFlags = CreateDeviceBgraSupport;

    /// <summary>dxgiformat.h:100 — ডেস্কটপ ডুপ্লিকেশন স্বাভাবিক ডিসপ্লেতে এটাই দেয়।</summary>
    internal const uint FormatB8G8R8A8Unorm = 87;

    /// <summary>d3d11.h:1222 — GPU থেকে CPU-তে পড়ার একমাত্র usage।</summary>
    internal const uint UsageStaging = 3;

    /// <summary>d3d11.h:1244। ⚠️ 0x1 নয় — ওটা অন্য ফ্ল্যাগ।</summary>
    internal const uint CpuAccessRead = 0x20000;

    /// <summary>d3d11.h:1275</summary>
    internal const uint MapRead = 1;

    // ── IID (হেডারের DEFINE_GUID থেকে) ──────────────────────────────────────

    /// <summary>d3d11.h:15171</summary>
    internal static readonly Guid IID_ID3D11Texture2D =
        new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    // ── vtable স্লট ─────────────────────────────────────────────────────────
    //
    // ⚠️ এই সংখ্যাগুলোই এই ফাইলের সবচেয়ে ভঙ্গুর অংশ। প্রতিটা হেডারের
    //    CINTERFACE vtable struct থেকে IUnknown-এর ৩টা সহ গুনে বের করা।
    //    বদলানোর আগে আবার গুনুন — ভুলটা নীরব।

    /// <summary>
    /// ID3D11Device — QI/AddRef/Release, CreateBuffer, CreateTexture1D, তারপর এটা।
    /// ⚠️ ID3D11Device সরাসরি IUnknown থেকে আসে, <c>ID3D11DeviceChild</c> থেকে নয়।
    /// DeviceChild ধরে নিলে ৪ ঘর সরে গিয়ে <c>CreateTexture1D</c> ডাকা হতো।
    /// </summary>
    internal const int Device_CreateTexture2D = 5;

    /// <summary>ID3D11DeviceContext — ⚠️ এটা ID3D11DeviceChild থেকে আসে (৭টা স্লট)।</summary>
    internal const int Context_Map = 14;

    /// <summary>ID3D11DeviceContext — ⚠️ <c>void</c> ফেরত।</summary>
    internal const int Context_Unmap = 15;

    /// <summary>ID3D11DeviceContext — ⚠️ <c>void</c> ফেরত। ব্যর্থ হলে জানার উপায় নেই।</summary>
    internal const int Context_CopyResource = 47;

    /// <summary>
    /// ID3D11Texture2D — উত্তরাধিকার IUnknown(৩) → DeviceChild(+৪) → Resource(+৩)।
    /// ⚠️ <c>void</c> ফেরত।
    /// </summary>
    internal const int Texture2D_GetDesc = 10;

    // ── এন্ট্রি পয়েন্ট ───────────────────────────────────────────────────────

    /// <summary>d3d11.h:15075। <c>pFeatureLevels</c> ও <c>ppImmediateContext</c> null দেওয়া যায়।</summary>
    [LibraryImport("d3d11.dll")]
    internal static unsafe partial int D3D11CreateDevice(
        nint pAdapter,
        uint driverType,
        nint software,
        uint flags,
        uint* pFeatureLevels,
        uint featureLevels,
        uint sdkVersion,
        nint* ppDevice,
        uint* pFeatureLevel,
        nint* ppImmediateContext);
}
