using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Ui;

/// <summary>tray আইকন যে কয়টা চেহারা নিতে পারে — এর বাইরে কিছু নেই।</summary>
internal enum TrayVisual
{
    Active,
    Idle,
    Locked,
    Paused,
    Failing,
    Revoked,
}

internal static class TrayVisuals
{
    /// <summary>
    /// ⚠️ সিঙ্কের অবস্থা স্টেটের চেয়ে <b>উপরে</b>। "ডেটা সার্ভারে যাচ্ছে না" খবরটা
    /// "আমি এখন নিষ্ক্রিয়" খবরের চেয়ে জরুরি — নিষ্ক্রিয়তা এক মিনিটে নিজে থেকেই
    /// ঠিক হয়ে যায়, সংযোগ হয় না।
    ///
    /// <see cref="SyncHealth.Degraded"/> ইচ্ছাকৃতভাবে আইকন বদলায় না — দিনে দশবার
    /// লাল হলে স্টাফ লাল রংটাকেই উপেক্ষা করতে শিখে যেত, আর তখন আসল J07 অকেজো।
    /// </summary>
    public static TrayVisual For(AgentStatus status) => status.Health switch
    {
        SyncHealth.Revoked => TrayVisual.Revoked,
        SyncHealth.Failing => TrayVisual.Failing,
        _ when status.Paused => TrayVisual.Paused,
        _ => status.State switch
        {
            SegmentState.Active => TrayVisual.Active,
            SegmentState.Locked => TrayVisual.Locked,
            _ => TrayVisual.Idle,
        },
    };
}

/// <summary>
/// আইকনগুলো কোডেই আঁকা হয় — রিপোতে কোনো <c>.ico</c> বাইনারি নেই।
///
/// কেন: বাইনারি ফাইলের ডিফ পড়া যায় না, কে কবে বদলাল বোঝা যায় না, আর DPI অনুযায়ী
/// মাপ বদলাতে হলে প্রতিবারই নতুন ফাইল লাগত। এখানে মাপটা চালানোর সময় ঠিক হয়।
///
/// ⚠️ রং-ই একমাত্র পার্থক্য নয়, প্রতিটা অবস্থার আলাদা <b>আকৃতি</b> আছে। লাল-সবুজ
/// পার্থক্য পুরুষদের প্রায় ৮%-এর চোখে ধরা পড়ে না; ১৫ জনের অফিসে সেটা প্রায়
/// নিশ্চিতভাবেই কেউ একজন।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class TrayIconPainter : IDisposable
{
    /// <summary>আইকন আর তার HICON একসাথে — দুটোই আমাদের ছাড়তে হবে।</summary>
    private readonly record struct Entry(Icon Icon, nint Handle);

    private readonly Dictionary<TrayVisual, Entry> _cache = new();
    private readonly int _size;
    private bool _disposed;

    public TrayIconPainter()
    {
        _size = ResolveSize();
    }

    public int Size => _size;

    /// <summary>একবার আঁকা হয়, তারপর ক্যাশ থেকেই আসে।</summary>
    public Icon Get(TrayVisual visual)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_cache.TryGetValue(visual, out var cached)) return cached.Icon;

        var entry = Render(visual, _size);
        _cache[visual] = entry;
        return entry.Icon;
    }

    // ── মাপ ────────────────────────────────────────────────────────────────

    private static int ResolveSize()
    {
        // ⚠️ ম্যানিফেস্টে PerMonitorV2 বসানো আছে, তাই এই মাপটা প্রক্রিয়া শুরুর সময়ের
        //    প্রাইমারি মনিটরের DPI অনুযায়ী আসে। পরে DPI বদলালে shell নিজেই স্কেল
        //    করে নেয় — একটু নরম দেখায়, কিন্তু নতুন আইকন বানানোর ঝুঁকির চেয়ে ভালো।
        var side = Math.Max(SystemInformation.SmallIconSize.Width,
                            SystemInformation.SmallIconSize.Height);

        if (side < 16) side = 16;
        if (side > 64) side = 64;
        return side;
    }

    // ── আঁকা ───────────────────────────────────────────────────────────────

    private static Entry Render(TrayVisual visual, int size)
    {
        using var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);

        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            var palette = PaletteFor(visual);

            // বাইরে একটু ফাঁকা — নইলে অ্যান্টি-এলিয়াস করা কিনারা টাস্কবারে কাটা দেখায়
            var pad = Math.Max(1f, size * 0.07f);
            var body = new RectangleF(pad, pad, size - (2 * pad), size - (2 * pad));

            using (var fill = new SolidBrush(palette.Fill))
            {
                g.FillEllipse(fill, body);
            }

            // ⚠️ গাঢ় কিনারা বাধ্যতামূলক: Windows-এর হালকা টাস্কবারে হালকা আইকন আর
            //    গাঢ় টাস্কবারে গাঢ় আইকন মিলিয়ে যায়। ভেতরের গ্লিফ সবসময় সাদা,
            //    বাইরের রিং সবসময় গাঢ় — দুই থিমেই আলাদা করে দেখা যায়।
            using (var edge = new Pen(palette.Edge, Math.Max(1f, size * 0.08f)))
            {
                g.DrawEllipse(edge, body);
            }

            DrawGlyph(g, visual, body, palette.Glyph);
        }

        return FromBitmap(bitmap);
    }

    private readonly record struct Palette(Color Fill, Color Edge, Color Glyph);

    private static Palette PaletteFor(TrayVisual visual) => visual switch
    {
        TrayVisual.Active => new Palette(
            Color.FromArgb(0x2E, 0x9E, 0x4F), Color.FromArgb(0x14, 0x53, 0x2D), Color.White),

        TrayVisual.Idle => new Palette(
            Color.FromArgb(0xC8, 0x8A, 0x12), Color.FromArgb(0x5A, 0x3D, 0x06), Color.White),

        TrayVisual.Locked => new Palette(
            Color.FromArgb(0x5A, 0x64, 0x70), Color.FromArgb(0x26, 0x2C, 0x33), Color.White),

        TrayVisual.Paused => new Palette(
            Color.FromArgb(0x4A, 0x6F, 0xA5), Color.FromArgb(0x1E, 0x2F, 0x49), Color.White),

        TrayVisual.Failing => new Palette(
            Color.FromArgb(0xC6, 0x28, 0x28), Color.FromArgb(0x5A, 0x10, 0x10), Color.White),

        _ => new Palette(
            Color.FromArgb(0x4A, 0x0E, 0x0E), Color.FromArgb(0x1A, 0x04, 0x04), Color.White),
    };

    private static void DrawGlyph(Graphics g, TrayVisual visual, RectangleF body, Color glyph)
    {
        var cx = body.X + (body.Width / 2f);
        var cy = body.Y + (body.Height / 2f);
        var u = body.Width; // ১ একক = আইকনের ব্যাস, সব মাপ এর অনুপাতে

        using var pen = new Pen(glyph, Math.Max(1.4f, u * 0.13f))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
        };
        using var brush = new SolidBrush(glyph);

        switch (visual)
        {
            case TrayVisual.Active:
            {
                // ✓
                g.DrawLines(pen, new[]
                {
                    new PointF(cx - (u * 0.22f), cy + (u * 0.02f)),
                    new PointF(cx - (u * 0.06f), cy + (u * 0.17f)),
                    new PointF(cx + (u * 0.23f), cy - (u * 0.19f)),
                });
                break;
            }

            case TrayVisual.Idle:
            {
                // ফাঁপা বৃত্ত — "চলছে, কিন্তু কিছু ঘটছে না"
                var r = u * 0.22f;
                g.DrawEllipse(pen, cx - r, cy - r, r * 2, r * 2);
                break;
            }

            case TrayVisual.Paused:
            {
                var w = u * 0.11f;
                var h = u * 0.42f;
                g.FillRectangle(brush, cx - (u * 0.19f), cy - (h / 2), w, h);
                g.FillRectangle(brush, cx + (u * 0.08f), cy - (h / 2), w, h);
                break;
            }

            case TrayVisual.Locked:
            {
                var w = u * 0.40f;
                var h = u * 0.30f;
                g.FillRectangle(brush, cx - (w / 2), cy - (h * 0.05f), w, h);

                using var shackle = new Pen(glyph, Math.Max(1.2f, u * 0.10f));
                g.DrawArc(shackle, cx - (w * 0.30f), cy - (h * 0.95f), w * 0.60f, h * 0.95f, 180f, 180f);
                break;
            }

            case TrayVisual.Failing:
            {
                // ! — রং না দেখেও বোঝা যায় "কিছু একটা ঠিক নেই"
                g.FillRectangle(brush, cx - (u * 0.06f), cy - (u * 0.26f), u * 0.12f, u * 0.31f);
                g.FillEllipse(brush, cx - (u * 0.07f), cy + (u * 0.13f), u * 0.14f, u * 0.14f);
                break;
            }

            default:
            {
                // ✕ — বাতিল
                g.DrawLine(pen, cx - (u * 0.19f), cy - (u * 0.19f), cx + (u * 0.19f), cy + (u * 0.19f));
                g.DrawLine(pen, cx + (u * 0.19f), cy - (u * 0.19f), cx - (u * 0.19f), cy + (u * 0.19f));
                break;
            }
        }
    }

    // ── Bitmap → Icon ──────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ এখানে <c>Icon.Clone()</c> ব্যবহার করা <b>হয়নি</b>, যদিও সেটাই স্বাভাবিক
    /// পথ মনে হয়। <c>Icon.FromHandle</c>-এ তৈরি আইকনের কোনো iconData থাকে না, আর
    /// সেই অবস্থায় <c>Clone()</c> হ্যান্ডেলটা <b>শেয়ার</b> করে, কপি করে না। তখন
    /// HICON ধ্বংস করলে ক্লোনটাও অকেজো হয়ে যেত — এবং লক্ষণ হতো "কয়েক ঘণ্টা পর
    /// আইকন হঠাৎ ফাঁকা", যেটা ডিবাগ করা প্রায় অসম্ভব।
    ///
    /// তাই র‍্যাপার আর হ্যান্ডেল দুটোই ধরে রাখা হয়: র‍্যাপার <see cref="Dispose"/>-এ
    /// ছাড়ে, হ্যান্ডেল <see cref="TrayNative.DestroyIcon"/>-এ।
    /// </summary>
    private static Entry FromBitmap(Bitmap bitmap)
    {
        var handle = bitmap.GetHicon();
        return new Entry(Icon.FromHandle(handle), handle);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var entry in _cache.Values)
        {
            // ⚠️ ক্রম: আগে র‍্যাপার, তারপর হ্যান্ডেল। আর এই মেথড ডাকার আগে
            //    NotifyIcon.Icon = null করা থাকতে হবে — নইলে shell এমন একটা
            //    HICON আঁকতে যাবে যেটা আর নেই।
            entry.Icon.Dispose();
            TrayNative.DestroyIcon(entry.Handle);
        }

        _cache.Clear();
    }
}
