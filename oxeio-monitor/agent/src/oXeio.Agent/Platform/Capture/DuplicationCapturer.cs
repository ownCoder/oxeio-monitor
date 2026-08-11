using System.Runtime.Versioning;

using oXeio.Agent.Native;
using oXeio.Core.Capture;

namespace oXeio.Agent.Platform.Capture;

/// <summary>
/// DXGI Desktop Duplication — প্রাথমিক ক্যাপচার ইঞ্জিন
/// ([ADR-012c](../../../../docs/05-Options-Decisions.md))।
///
/// <b>GDI-র উপর যা দেয়:</b> হার্ডওয়্যার-ত্বরিত ভিডিও আর exclusive-fullscreen
/// উইন্ডো আসল ছবি হিসেবে ওঠে, কালো নয়। উপরন্তু OS নিজেই বলে দেয় DRM কনটেন্ট
/// বাদ পড়েছে কি না (<c>ProtectedContentMaskedOut</c>) — GDI-তে সেটা আন্দাজ
/// করা ছাড়া উপায় ছিল না।
///
/// <b>যা দেয় না:</b> DRM-সুরক্ষিত উইন্ডো এখানেও কালোই আসবে। ওটা OS-এর
/// কনটেন্ট সুরক্ষা, ক্যাপচার API-র সীমা নয় — আর সেটা ডিঙানোর চেষ্টা আমরা করব না।
///
/// <b>প্রতিবার পুরো চেইন নতুন করে বানানো হয় এবং ভাঙা হয়।</b> ৫ মিনিটে একবার
/// ছবি তুলতে এটা কার্যত বিনামূল্যে, আর এতে রেজোলিউশন বদল, ডক/আনডক, মনিটর
/// খোলা-লাগানো, GPU রিসেট আর ইউজার সুইচ — সবগুলোই আপনাআপনি সামলে যায়।
/// চেইন ধরে রাখলে এর প্রতিটার জন্য আলাদা করে <c>ACCESS_LOST</c> সামলাতে হতো,
/// আর একটা ভুল হলে সেই PC-তে মাসের পর মাস ছবি ওঠা বন্ধ থাকত — যেটা কেউ
/// দেখতেও পেত না।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed unsafe class DuplicationCapturer : IScreenCapturer
{
    /// <summary>
    /// প্রতিবার ফ্রেমের জন্য কতক্ষণ অপেক্ষা।
    ///
    /// ভিডিও চললে ফ্রেম আসে ~১৬ মিলিসেকেন্ড অন্তর, তাই ২৫০ মি.সে. যথেষ্টেরও বেশি।
    /// আর পর্দা স্থির থাকলে যত অপেক্ষাই করি ফ্রেম আসবে না — তাই দেরি করার
    /// কোনো লাভ নেই, দ্রুত GDI-তে নেমে যাওয়াই ভালো।
    /// </summary>
    private const uint FrameTimeoutMs = 250;

    private const int Retries = 2;

    public string Name => "DXGI";

    /// <summary>
    /// ⭐ <b>"ছবি পাইনি" আর "এই মেশিনে DXGI চলে না" — দুটো এক জিনিস নয়।</b>
    ///
    /// পর্দা স্থির থাকলে DXGI ছবি দিতে পারে না, কিন্তু সেটা ইঞ্জিনের দোষ নয়।
    /// এই পার্থক্যটা না রাখলে শান্ত অফিসের PC-তে টানা কয়েক স্লট পর DXGI
    /// বিরতিতে চলে যেত ([EngineFallbackPolicy](../../../oXeio.Core/Capture/EngineFallbackPolicy.cs))
    /// — অর্থাৎ যে মেশিনে কেউ ভিডিও দেখা শুরু করত, ঠিক তখনই DXGI ঘুমিয়ে থাকত।
    /// </summary>
    public bool EngineFault { get; private set; }

    bool IScreenCapturer.LastFailureWasEngineFault => EngineFault;

    /// <summary>
    /// শেষ চেষ্টাটা কোথায় গিয়ে থেমেছে।
    ///
    /// ⚠️ চুক্তি অনুযায়ী ব্যর্থ হলে <c>null</c> ফেরে, ব্যতিক্রম নয় — তার মানে
    /// কারণটা কোথাও না রাখলে চিরতরে হারিয়ে যেত। "এই PC-তে সবসময় GDI-তে নেমে
    /// যাচ্ছে কেন" প্রশ্নের উত্তর একমাত্র এখানেই পাওয়া যাবে।
    /// </summary>
    public string LastStep { get; private set; } = "not attempted yet";

    public CapturedFrame? Capture(MonitorInfo monitor)
    {
        nint factory = 0, adapter = 0, output = 0, output1 = 0;
        nint device = 0, context = 0, duplication = 0;
        nint desktop = 0, texture = 0, staging = 0;
        var mapped = false;

        // ⚠️ ধরে নেওয়া হয় দোষ ইঞ্জিনেরই। যে ধাপগুলো আসলে দোষ নয় সেগুলো
        //    নিজেরাই এটা মিথ্যা করে দেয় — উল্টোটা করলে নতুন কোনো ব্যর্থতার পথ
        //    যোগ হলে সেটা নীরবে "দোষ নয়" হিসেবে গণ্য হতো, আর ফলব্যাক নীতি
        //    কখনোই কাজে লাগত না।
        EngineFault = true;

        try
        {
            LastStep = "looking for an output";
            if (!TryFindOutput(monitor.Handle, ref factory, ref adapter, ref output))
                return null;

            LastStep = "D3D11 device";
            if (!TryCreateDevice(adapter, ref device, ref context))
                return null;

            LastStep = "IDXGIOutput1";
            if (ComCall.QueryInterface(output, Dxgi.IID_IDXGIOutput1, out output1) < 0)
                return null;

            LastStep = "DuplicateOutput";
            var hr = ((delegate* unmanaged[Stdcall]<nint, nint, nint*, int>)
                ComCall.Method(output1, Dxgi.Output1_DuplicateOutput))(output1, device, &duplication);

            // ⚠️ E_ACCESSDENIED মানে secure desktop (UAC/লক স্ক্রিন) সামনে আছে,
            //    NOT_CURRENTLY_AVAILABLE মানে একসাথে ৪টি duplication-এর সীমা ছোঁয়া
            //    হয়েছে — Teams/Zoom শেয়ার করলে বাস্তবেই ঘটে। দুটোই সাময়িক,
            //    এই স্লটটা GDI-তে উঠবে।
            if (hr < 0) return null;

            LastStep = "checking rotation";
            var turns = PixelCopy.TurnsForRotation(RotationOf(duplication));

            LastStep = "waiting for a frame";
            if (!TryAcquire(duplication, out var info, ref desktop)) return null;

            LastStep = $"got a frame (accumulated={info.AccumulatedFrames}, " +
                       $"present={info.LastPresentTime}, drm={info.ProtectedContentMaskedOut})";

            if (ComCall.QueryInterface(desktop, D3D11.IID_ID3D11Texture2D, out texture) < 0)
                return null;

            D3D11_TEXTURE2D_DESC desc;
            ((delegate* unmanaged[Stdcall]<nint, D3D11_TEXTURE2D_DESC*, void>)
                ComCall.Method(texture, D3D11.Texture2D_GetDesc))(texture, &desc);

            // HDR মনিটরে ফরম্যাট R16G16B16A16_FLOAT হতে পারে। বাইটগুলোকে জোর
            // করে BGRA ধরে নিলে ছবি আসত রঙিন আবর্জনা হিসেবে — যেটা দেখতে
            // "ছবি উঠেছে"-র মতোই। তাই না বুঝলে হাত না দেওয়াই নিয়ম।
            if (desc.Format != D3D11.FormatB8G8R8A8Unorm) return null;

            if (!TryCreateStaging(device, desc, ref staging)) return null;

            ((delegate* unmanaged[Stdcall]<nint, nint, nint, void>)
                ComCall.Method(context, D3D11.Context_CopyResource))(context, staging, texture);

            // ⚠️ কপি করার **পরেই** ছাড়তে হবে, Map-এর আগে। ছেড়ে দিলে ডেস্কটপ
            //    সারফেস অকার্যকর হয়ে যায় — আগে ছাড়লে কপি করার মতো কিছু থাকত না।
            ((delegate* unmanaged[Stdcall]<nint, int>)
                ComCall.Method(duplication, Dxgi.Duplication_ReleaseFrame))(duplication);

            D3D11_MAPPED_SUBRESOURCE map;
            hr = ((delegate* unmanaged[Stdcall]<nint, nint, uint, uint, uint, D3D11_MAPPED_SUBRESOURCE*, int>)
                ComCall.Method(context, D3D11.Context_Map))(context, staging, 0, D3D11.MapRead, 0, &map);
            if (hr < 0) return null;

            mapped = true;

            // ⚠️ ঘোরানো ডিসপ্লেতে মনিটরের মাপ (১০৮০×১৯২০) আর সারফেসের মাপ
            //    (১৯২০×১০৮০) উল্টো। তাই ঘোরানোর **আগে** ক্ল্যাম্প করতে হলে
            //    মনিটরের মাপটাও উল্টে নিতে হয় — নইলে ছবির অর্ধেক কেটে যেত।
            var swapped = turns is 1 or 3;
            var wantW = swapped ? monitor.Height : monitor.Width;
            var wantH = swapped ? monitor.Width : monitor.Height;

            var (w, h) = PixelCopy.ContentBounds((int)desc.Width, (int)desc.Height, wantW, wantH);
            if (w <= 0 || h <= 0) return null;

            LastStep += $" · {desc.Width}×{desc.Height} pitch={map.RowPitch} → {w}×{h}" +
                        (turns == 0 ? "" : $" · rotation {turns * 90}°");

            var source = new ReadOnlySpan<byte>(map.pData, checked((int)(map.RowPitch * desc.Height)));
            var tight = PixelCopy.ToTightBuffer(source, (int)map.RowPitch, w, h);

            var (pixels, finalW, finalH) = PixelCopy.RotateClockwise(tight, w, h, turns);

            EngineFault = false;

            return new CapturedFrame(
                pixels, finalW, finalH, finalW * PixelCopy.BytesPerPixel, monitor, Name)
            {
                ProtectedContentMasked = info.ProtectedContentMaskedOut != 0,
            };
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // চুক্তি অনুযায়ী একটা মনিটর ব্যর্থ হলে null, ব্যতিক্রম নয় — বাকি
            // মনিটরগুলোর ছবি যেন তবু ওঠে।
            return null;
        }
        finally
        {
            // ⚠️ Unmap বাদ পড়লে staging টেক্সচার চিরকাল map হয়ে থাকে আর এই
            //    প্রসেসের বাকি জীবনে প্রতিটা Map ব্যর্থ হয়। ভুলটা দেখা দেয়
            //    কয়েক সপ্তাহ পরে, অন্য কোনো উপসর্গ হিসেবে।
            if (mapped && context != 0 && staging != 0)
            {
                ((delegate* unmanaged[Stdcall]<nint, nint, uint, void>)
                    ComCall.Method(context, D3D11.Context_Unmap))(context, staging, 0);
            }

            ComCall.Release(ref staging);
            ComCall.Release(ref texture);
            ComCall.Release(ref desktop);
            ComCall.Release(ref duplication);
            ComCall.Release(ref output1);
            ComCall.Release(ref context);
            ComCall.Release(ref device);
            ComCall.Release(ref output);
            ComCall.Release(ref adapter);
            ComCall.Release(ref factory);
        }
    }

    // ── ধাপগুলো ─────────────────────────────────────────────────────────────

    /// <summary>
    /// এই HMONITOR কোন অ্যাডাপ্টারের কোন আউটপুটে — সব অ্যাডাপ্টার ঘুরে খোঁজা।
    ///
    /// ⚠️ ডিফল্ট (০ নম্বর) অ্যাডাপ্টার ধরে নেওয়া যায় না। হাইব্রিড গ্রাফিক্সের
    /// ল্যাপটপে বিল্ট-ইন পর্দা এক অ্যাডাপ্টারে আর বাইরের মনিটর অন্যটাতে থাকে।
    /// </summary>
    private static bool TryFindOutput(nint hMonitor, ref nint factory, ref nint adapter, ref nint output)
    {
        nint f = 0;
        fixed (Guid* iid = &Dxgi.IID_IDXGIFactory1)
        {
            if (Dxgi.CreateDXGIFactory1(iid, &f) < 0) return false;
        }

        factory = f;

        for (uint ai = 0; ; ai++)
        {
            nint a = 0;
            if (((delegate* unmanaged[Stdcall]<nint, uint, nint*, int>)
                    ComCall.Method(factory, Dxgi.Factory1_EnumAdapters1))(factory, ai, &a) < 0)
            {
                return false; // DXGI_ERROR_NOT_FOUND — অ্যাডাপ্টার শেষ
            }

            for (uint oi = 0; ; oi++)
            {
                nint o = 0;
                if (((delegate* unmanaged[Stdcall]<nint, uint, nint*, int>)
                        ComCall.Method(a, Dxgi.Adapter_EnumOutputs))(a, oi, &o) < 0)
                {
                    break; // এই অ্যাডাপ্টারের আউটপুট শেষ
                }

                DXGI_OUTPUT_DESC desc;
                ((delegate* unmanaged[Stdcall]<nint, DXGI_OUTPUT_DESC*, int>)
                    ComCall.Method(o, Dxgi.Output_GetDesc))(o, &desc);

                if (desc.Monitor == hMonitor && desc.AttachedToDesktop != 0)
                {
                    adapter = a;
                    output = o;
                    return true;
                }

                ComCall.Release(ref o);
            }

            ComCall.Release(ref a);
        }
    }

    private static bool TryCreateDevice(nint adapter, ref nint device, ref nint context)
    {
        nint dev = 0, ctx = 0;
        uint level;

        var hr = D3D11.D3D11CreateDevice(
            adapter,
            D3D11.DriverTypeUnknown, // ⚠️ অ্যাডাপ্টার দিলে UNKNOWN বাধ্যতামূলক
            0,
            D3D11.CreateDeviceFlags,
            null, 0,
            D3D11.SdkVersion,
            &dev, &level, &ctx);

        if (hr < 0) return false;

        device = dev;
        context = ctx;
        return true;
    }

    /// <summary>ডিসপ্লে কতটা ঘোরানো — <c>DXGI_MODE_ROTATION</c>।</summary>
    private static uint RotationOf(nint duplication)
    {
        DXGI_OUTDUPL_DESC desc;
        ((delegate* unmanaged[Stdcall]<nint, DXGI_OUTDUPL_DESC*, void>)
            ComCall.Method(duplication, Dxgi.Duplication_GetDesc))(duplication, &desc);

        return desc.Rotation;
    }

    /// <summary>
    /// ⚠️ <b>সফল <c>AcquireNextFrame</c> মানেই ছবি পাওয়া নয়।</b>
    ///
    /// <c>DuplicateOutput</c>-এর পরপরই প্রথম কলটা প্রায় সবসময় সফল হয়, কিন্তু
    /// <c>AccumulatedFrames = 0</c> আর <c>LastPresentTime = 0</c> নিয়ে — অর্থাৎ
    /// "ডেস্কটপ বদলায়নি"। ওই ফ্রেমের সারফেসে কোনো ছবি বসানো হয় না, পুরোটা কালো।
    ///
    /// এই মেশিনেই মেপে দেখা গেছে: কল সফল, HRESULT ঠিক, মাপ ঠিক (১৯২০×১০৮০,
    /// pitch ৭৬৮০) — শুধু প্রতিটি পিক্সেল শূন্য। ফেরত মান দেখে সন্তুষ্ট হলে
    /// মাসের পর মাস নিখুঁতভাবে কালো ছবি জমত।
    ///
    /// তাই খালি ফ্রেম ছেড়ে দিয়ে আসল ছবির জন্য অপেক্ষা করা হয়।
    /// </summary>
    private bool TryAcquire(nint duplication, out DXGI_OUTDUPL_FRAME_INFO info, ref nint desktop)
    {
        info = default;

        for (var attempt = 0; attempt <= Retries; attempt++)
        {
            DXGI_OUTDUPL_FRAME_INFO fi;
            nint res = 0;

            var hr = ((delegate* unmanaged[Stdcall]<nint, uint, DXGI_OUTDUPL_FRAME_INFO*, nint*, int>)
                ComCall.Method(duplication, Dxgi.Duplication_AcquireNextFrame))(
                    duplication, FrameTimeoutMs, &fi, &res);

            if (hr < 0)
            {
                if (hr == Dxgi.DXGI_ERROR_WAIT_TIMEOUT) continue;

                LastStep = $"AcquireNextFrame failed (0x{hr:X8})";
                EngineFault = !IsTransient(hr);
                return false;
            }

            // ছবি সত্যিই আছে কি না — দুটোর যেকোনো একটা শূন্য না হলেই যথেষ্ট
            if (fi.AccumulatedFrames > 0 || fi.LastPresentTime != 0)
            {
                info = fi;
                desktop = res;
                return true;
            }

            // খালি ফ্রেম — ছেড়ে দিয়ে আবার। ⚠️ ছাড়া না দিলে পরের
            // AcquireNextFrame সরাসরি ব্যর্থ হয়।
            ComCall.Release(ref res);
            ((delegate* unmanaged[Stdcall]<nint, int>)
                ComCall.Method(duplication, Dxgi.Duplication_ReleaseFrame))(duplication);
        }

        // পর্দায় কিছুই নড়ছে না। এটা ইঞ্জিনের দোষ নয় — আর ঠিক এই অবস্থাতেই
        // GDI নিখুঁত ছবি দেয়, কারণ কালো আসার একমাত্র কারণ চলমান ভিডিও।
        LastStep = "no change on screen — falling back to GDI";
        EngineFault = false;
        return false;
    }

    /// <summary>এই ত্রুটিগুলো কেটে যায় — মেশিনটা DXGI পারে না, এমন নয়।</summary>
    private static bool IsTransient(int hr) =>
        hr == Dxgi.DXGI_ERROR_ACCESS_LOST ||
        hr == Dxgi.DXGI_ERROR_NOT_CURRENTLY_AVAILABLE ||
        hr == Dxgi.E_ACCESSDENIED;

    private static bool TryCreateStaging(nint device, D3D11_TEXTURE2D_DESC source, ref nint staging)
    {
        // ⚠️ STAGING-এর সাথে BindFlags শূন্য ছাড়া কিছু দিলে তৈরিই হয় না।
        //    MipLevels ১, ArraySize ১, কোনো মাল্টিস্যাম্পল নয় — নইলে
        //    CopyResource মাপ না মেলায় নীরবে কিছুই করে না।
        var desc = new D3D11_TEXTURE2D_DESC
        {
            Width = source.Width,
            Height = source.Height,
            MipLevels = 1,
            ArraySize = 1,
            Format = source.Format,
            SampleDesc = new DXGI_SAMPLE_DESC { Count = 1, Quality = 0 },
            Usage = D3D11.UsageStaging,
            BindFlags = 0,
            CPUAccessFlags = D3D11.CpuAccessRead,
            MiscFlags = 0,
        };

        nint tex = 0;
        var hr = ((delegate* unmanaged[Stdcall]<nint, D3D11_TEXTURE2D_DESC*, nint, nint*, int>)
            ComCall.Method(device, D3D11.Device_CreateTexture2D))(device, &desc, 0, &tex);

        if (hr < 0) return false;

        staging = tex;
        return true;
    }

    public void Dispose() { }
}
