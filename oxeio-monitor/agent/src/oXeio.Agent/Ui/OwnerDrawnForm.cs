using System.Drawing;
using System.Runtime.Versioning;
using System.Windows.Forms;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-র ছোট জানালাগুলোর ভিত্তি — সম্পূর্ণ owner-drawn, কোনো চাইল্ড কন্ট্রোল নেই।
///
/// কেন কোনো Label/Button নেই:
///  ১) কোনো কন্ট্রোল না থাকা মানে কোনো ইনপুট নেই — জানালাটা গঠনগতভাবেই read-only,
///     ভুল করেও কোথাও কিছু টাইপ করা বা চাপা যায় না (ADR-011d: স্টাফের চাপার মতো
///     কিছু থাকবে না)।
///  ২) বাংলা লেখা মাপা ও আঁকা এক জায়গাতেই থাকে, ফলে DPI বদলালে সব একসাথে বদলায়।
///
/// ⚠️ লেখা আঁকা হয় <see cref="TextRenderer"/> দিয়ে, <c>Graphics.DrawString</c> দিয়ে
/// নয়। TextRenderer GDI/Uniscribe ব্যবহার করে, যেটা যুক্তাক্ষর ও কার-চিহ্নের
/// অবস্থান ঠিকঠাক সাজায়। GDI+ পথে বাংলা প্রায়ই ভেঙে আঁকে — "ক্ষ" আলাদা হয়ে যায়,
/// ই-কার অক্ষরের পরে বসে। ভুলটা ক্র্যাশ করে না, শুধু অপাঠ্য হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal abstract class OwnerDrawnForm : Form
{
    private const TextFormatFlags TextFlags =
        TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding;

    private readonly TrayFonts _fonts;
    private readonly int _baseWidth;
    private readonly int _baseHeight;
    private bool _resizing;

    protected OwnerDrawnForm(TrayFonts fonts, string title, int baseWidth, int baseHeight)
    {
        _fonts = fonts;
        _baseWidth = baseWidth;
        _baseHeight = baseHeight;

        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        ShowIcon = false;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;

        // ⚠️ WinForms-এর নিজস্ব স্কেলিং বন্ধ। আমরা নিজেরাই DeviceDpi দেখে সব মাপি;
        //    দুটো একসাথে চললে ১৫০% মনিটরে সব কিছু দুবার স্কেল হতো।
        AutoScaleMode = AutoScaleMode.None;

        BackColor = SystemColors.Window;
        ForeColor = SystemColors.WindowText;
        DoubleBuffered = true;

        SetStyle(
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.UserPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true);
    }

    protected TrayFonts Fonts => _fonts;

    /// <summary>৯৬ DPI-র মাপ → এই মনিটরের মাপ।</summary>
    protected int Scale(int value) => (int)Math.Round(value * DeviceDpi / 96.0);

    protected Font FontFor(TrayFontRole role) => _fonts.Get(role, DeviceDpi);

    protected static Color Muted => SystemColors.GrayText;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyDpi();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        ApplyDpi();
    }

    private void ApplyDpi()
    {
        try
        {
            ClientSize = new Size(Scale(_baseWidth), Scale(_baseHeight));
            Invalidate();
        }
        catch (ObjectDisposedException)
        {
        }
    }

    /// <summary>
    /// যে মনিটরে মাউস আছে, তার কাজের এলাকার ডান-নিচে — অর্থাৎ tray-র পাশে।
    ///
    /// ⚠️ <c>WorkingArea</c> ব্যবহার করা হয়েছে, <c>Bounds</c> নয়: টাস্কবার উপরে বা
    /// পাশে সরানো থাকলেও জানালাটা তার নিচে ঢুকে পড়ে না।
    /// </summary>
    public void PositionNearTray()
    {
        try
        {
            var area = Screen.FromPoint(Cursor.Position).WorkingArea;
            var margin = Scale(12);

            var x = area.Right - Width - margin;
            var y = area.Bottom - Height - margin;

            // একেবারে ছোট রেজল্যুশনে ঋণাত্মক হয়ে পর্দার বাইরে চলে যেত
            Location = new Point(Math.Max(area.Left, x), Math.Max(area.Top, y));
        }
        catch (Exception)
        {
            StartPosition = FormStartPosition.CenterScreen;
        }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);

        // Esc = বন্ধ। কোনো বাটন নেই বলেই কি-বোর্ডের পথটা থাকা দরকার।
        if (e.KeyCode == Keys.Escape) Close();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        // ⚠️ OnPaint থেকে ছুটে যাওয়া এক্সসেপশন WinForms-এ পুরো প্রক্রিয়া নামিয়ে
        //    দেয়। একটা জানালার আঁকার বাগে যেন ঘণ্টা গোনা না থামে।
        try
        {
            e.Graphics.Clear(BackColor);

            var pad = Scale(16);
            var body = new Rectangle(
                pad, pad,
                Math.Max(1, ClientSize.Width - (2 * pad)),
                Math.Max(1, ClientSize.Height - (2 * pad)));

            var stack = new TextStack(this, e.Graphics, body);
            PaintBody(stack);
            GrowIfClipped(stack.Bottom + pad);
        }
        catch (Exception)
        {
        }
    }

    /// <summary>
    /// লেখা নিচে উপচে গেলে জানালাটা নিজেই একটু লম্বা হয়।
    ///
    /// কেন দরকার: বাংলা লেখা কত জায়গা নেবে সেটা আগে থেকে গোনা যায় না — ফন্ট
    /// বদলালে, DPI বদলালে, এমনকি Nirmala UI না থাকলে ফলব্যাক ফন্টে মেট্রিক
    /// আলাদা হয়। স্থির উচ্চতা দিলে কারো কারো মেশিনে শেষ লাইনটা নীরবে কেটে যেত,
    /// আর কেটে যাওয়া লাইনটা প্রায়ই হয় "ডেটা হারায়নি" জাতীয় আশ্বাসের লাইন।
    ///
    /// ⚠️ পেইন্টের ভেতরেই মাপ বদলাচ্ছি, তাই পুনঃপ্রবেশ ঠেকাতে পতাকা। বড় করা
    /// একবারই লাগে: পরের পেইন্টে আর উপচায় না, তাই লুপ হয় না।
    /// </summary>
    private void GrowIfClipped(int neededHeight)
    {
        if (_resizing || neededHeight <= ClientSize.Height) return;

        _resizing = true;
        try
        {
            ClientSize = new Size(ClientSize.Width, neededHeight);
            Invalidate();
        }
        catch (ObjectDisposedException)
        {
        }
        finally
        {
            _resizing = false;
        }
    }

    protected abstract void PaintBody(TextStack stack);

    /// <summary>
    /// উপর থেকে নিচে লাইন বসানোর ছোট সহায়ক — প্রতিটা লাইনের উচ্চতা মেপে
    /// পরেরটার জায়গা ঠিক করে, তাই বাংলা লেখা দুই লাইনে ভেঙে গেলেও ওভারল্যাপ হয় না।
    /// </summary>
    protected sealed class TextStack
    {
        private readonly OwnerDrawnForm _form;
        private readonly Graphics _g;
        private readonly Rectangle _bounds;
        private int _y;

        internal TextStack(OwnerDrawnForm form, Graphics g, Rectangle bounds)
        {
            _form = form;
            _g = g;
            _bounds = bounds;
            _y = bounds.Top;
        }

        /// <summary>এ পর্যন্ত আঁকা লেখার নিচের প্রান্ত — জানালার উচ্চতা ঠিক করতে লাগে।</summary>
        public int Bottom => _y;

        public void Gap(int basePixels) => _y += _form.Scale(basePixels);

        public void Line(string text, TrayFontRole role = TrayFontRole.Body, Color? color = null)
        {
            if (string.IsNullOrEmpty(text)) return;

            var font = _form.FontFor(role);
            var width = _bounds.Width;

            var size = TextRenderer.MeasureText(
                _g, text, font, new Size(width, int.MaxValue), TextFlags);

            TextRenderer.DrawText(
                _g, text, font,
                new Rectangle(_bounds.Left, _y, width, size.Height),
                color ?? _form.ForeColor,
                TextFlags);

            _y += size.Height + _form.Scale(3);
        }

        /// <summary>একই লাইনে বাঁয়ে লেবেল, ডানে মান।</summary>
        public void Pair(string label, string value, TrayFontRole role = TrayFontRole.Body)
        {
            var font = _form.FontFor(role);
            var height = TextRenderer.MeasureText(
                _g, "ঢ", font, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;

            // ⚠️ ঠিক অর্ধেক-অর্ধেক নয়। লেবেলগুলো ছোট ("বাকি", "এখন"), মানগুলো লম্বা
            //    ("১২৭:৩০ / ২০৮ ঘণ্টা")। সমান ভাগ করলে ডান পাশের সংখ্যাটাই কেটে যেত।
            var labelWidth = _bounds.Width * 2 / 5;

            TextRenderer.DrawText(
                _g, label, font,
                new Rectangle(_bounds.Left, _y, labelWidth, height),
                Muted, TextFlags);

            TextRenderer.DrawText(
                _g, value, font,
                new Rectangle(_bounds.Left + labelWidth, _y, _bounds.Width - labelWidth, height),
                _form.ForeColor,
                TextFlags | TextFormatFlags.Right);

            _y += height + _form.Scale(3);
        }

        public void Rule()
        {
            Gap(6);
            using var pen = new Pen(SystemColors.ControlLight, 1f);
            _g.DrawLine(pen, _bounds.Left, _y, _bounds.Right, _y);
            Gap(8);
        }

        /// <summary>
        /// অগ্রগতির বার। ⚠️ শুধু <b>আঁকাটা</b> ১-এ ক্ল্যাম্প করা হয় —
        /// <see cref="oXeio.Core.Agent.AgentStatus.MonthlyProgress"/>-এর নিয়ম অনুযায়ী
        /// লেখা শতাংশটা ক্ল্যাম্প করা হয় না, নইলে ২২০ ঘণ্টা কাজ করা মানুষের বাড়তি
        /// কাজটা অদৃশ্য হয়ে যেত।
        /// </summary>
        public void Bar(double ratio, Color fill, int baseHeight = 10)
        {
            var height = _form.Scale(baseHeight);
            var track = new Rectangle(_bounds.Left, _y, _bounds.Width, height);

            using (var brush = new SolidBrush(SystemColors.ControlLight))
            {
                _g.FillRectangle(brush, track);
            }

            var clamped = double.IsNaN(ratio) ? 0 : Math.Min(1.0, Math.Max(0.0, ratio));
            var filled = (int)Math.Round(track.Width * clamped);

            if (filled > 0)
            {
                using var brush = new SolidBrush(fill);
                _g.FillRectangle(brush, new Rectangle(track.X, track.Y, filled, height));
            }

            _y += height + _form.Scale(6);
        }
    }
}
