using System.Drawing;
using System.Drawing.Drawing2D;
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
///  ২) লেখা মাপা ও আঁকা এক জায়গাতেই থাকে, ফলে DPI বদলালে সব একসাথে বদলায়।
///
/// ⚠️ লেখা আঁকা হয় <see cref="TextRenderer"/> দিয়ে, <c>Graphics.DrawString</c> দিয়ে
/// নয়। কারণ মাপা আর আঁকা একই ইঞ্জিনে হতে হবে: <c>MeasureText</c> GDI-র হিসাব দেয়,
/// আর <c>DrawString</c> আঁকে GDI+ দিয়ে — দুটোর কার্নিং আলাদা, ফলে মাপা বাক্সের
/// শেষ শব্দটা নীরবে কেটে যেত। বাকি WinForms কন্ট্রোলও GDI-তেই আঁকে, তাই
/// জানালার লেখা সিস্টেমের সাথে মেলে।
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

    private readonly TrayTheme _theme = TrayTheme.Current;

    protected OwnerDrawnForm(TrayFonts fonts, string title, int baseWidth, int baseHeight)
    {
        _fonts = fonts;
        _baseWidth = baseWidth;
        _baseHeight = baseHeight;

        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;

        // ⭐ মিনিমাইজ আছে — কাজ করতে করতে জানালাটা সরিয়ে রাখা যায়।
        //
        // ⚠️ ম্যাক্সিমাইজ নেই: ভেতরের সব মাপ ৪০০px চওড়ার ধরে আঁকা
        //    (owner-drawn, কোনো লেআউট ইঞ্জিন নেই), তাই বড় করলে লেখা বাঁ
        //    কোণে জড়ো হয়ে বাকিটা ফাঁকা পড়ে থাকত।
        //
        // ⚠️ তবু টাইটেল বারে বাটনটা **দেখা যাবে, ধূসর অবস্থায়** — এটা
        //    Windows-এর আচরণ, আমাদের নয়: minimize বা maximize-এর একটা
        //    থাকলে সে দুটোই আঁকে, অনুপস্থিতটা নিষ্ক্রিয় করে। স্টাইল-বিট
        //    (`WS_MAXIMIZEBOX`) হাতে মুছেও লাভ হয় না — চেষ্টা করে দেখা হয়েছে।
        //    সরাতে হলে গোটা টাইটেল বার নিজে আঁকতে হবে, যা এই জানালার জন্য
        //    অসমানুপাতিক।
        MinimizeBox = true;
        MaximizeBox = false;
        ShowInTaskbar = true;

        /**
         * ⭐⭐ **টাস্কবারের আইকন** — ব্র্যান্ডের লাল টাইল ও সাদা X।
         *
         * ⚠️⚠️ `ApplicationIcon` বসানোই যথেষ্ট নয়: ওটা exe-র শেল-আইকন,
         *    কিন্তু WinForms টাস্কবারে দেখায় <c>Form.Icon</c>, আর সেটা
         *    না দিলে **নিজের ডিফল্ট** আইকন বসায়। মালিক ঠিক ওটাই দেখেছেন।
         *
         * ⚠️ <c>ShowIcon = false</c> থাকছে — টাইটেল বারে আইকন নেই, কারণ
         *    জানালাটা owner-drawn আর ওখানে ১৬px আইকন বেমানান। ⭐ তাতে
         *    টাস্কবারের আইকন যায় না; দুটো আলাদা জায়গা।
         */
        Icon = BrandIcon.Value;
        ShowIcon = false;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;

        // ⚠️ WinForms-এর নিজস্ব স্কেলিং বন্ধ। আমরা নিজেরাই DeviceDpi দেখে সব মাপি;
        //    দুটো একসাথে চললে ১৫০% মনিটরে সব কিছু দুবার স্কেল হতো।
        AutoScaleMode = AutoScaleMode.None;

        BackColor = _theme.Surface;
        ForeColor = _theme.Ink;
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

    protected TrayTheme Theme => _theme;

    protected Color Muted => _theme.Ink3;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        TrayNative.TryUseDarkTitleBar(Handle);
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
    /// কেন দরকার: লেখা কত জায়গা নেবে সেটা আগে থেকে গোনা যায় না — ফন্ট বদলালে,
    /// DPI বদলালে, এমনকি Segoe UI না থাকলে ফলব্যাক ফন্টে মেট্রিক আলাদা হয়।
    /// স্থির উচ্চতা দিলে কারো কারো মেশিনে শেষ লাইনটা নীরবে কেটে যেত, আর কেটে
    /// যাওয়া লাইনটা প্রায়ই হয় "data saved locally" জাতীয় আশ্বাসের লাইন।
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
    /// পরেরটার জায়গা ঠিক করে, তাই লম্বা লেখা দুই লাইনে ভেঙে গেলেও ওভারল্যাপ হয় না।
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

            // ⚠️ নমুনাটায় ascender ও descender দুটোই থাকতে হবে ("Ag")। শুধু "A"
            //    দিলে GDI descender-এর জায়গা বাদ দিয়ে উচ্চতা মাপত, আর "g"/"y"
            //    থাকা মানগুলোর লেজ পরের লাইনের সাথে ঘষা খেত।
            var height = TextRenderer.MeasureText(
                _g, "Ag", font, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;

            // ⚠️ ঠিক অর্ধেক-অর্ধেক নয়। লেবেলগুলো ছোট ("Now", "Sync"), মানগুলো লম্বা
            //    ("127:30 / 208 hours")। সমান ভাগ করলে ডান পাশের সংখ্যাটাই কেটে যেত।
            var labelWidth = _bounds.Width * 2 / 5;

            TextRenderer.DrawText(
                _g, label, font,
                new Rectangle(_bounds.Left, _y, labelWidth, height),
                _form.Theme.Ink2, TextFlags);

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
            using var pen = new Pen(_form.Theme.Line, 1f);
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

            using (var brush = new SolidBrush(_form.Theme.Track))
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

        // ── নতুন প্রিমিটিভ ──────────────────────────────────────────────────

        /// <summary>
        /// হিরো সারি — বড় সংখ্যা, তার পাশে একক, আর ডানে অবস্থার চিপ।
        ///
        /// ⭐ অবস্থাটা এখানে, কারণ জানালার একমাত্র <b>এটাই</b> মিনিটে মিনিটে
        /// বদলায়। আগে এটা চার সারির তালিকার চতুর্থ সারি ছিল ("Now: Working"),
        /// অর্থাৎ "Queued: 0"-র সমান ওজনে।
        /// </summary>
        public void Hero(string figure, string unit, string? chip, Color chipDot)
        {
            var heroFont = _form.FontFor(TrayFontRole.Hero);
            var unitFont = _form.FontFor(TrayFontRole.Body);

            var heroSize = TextRenderer.MeasureText(
                _g, figure, heroFont, new Size(_bounds.Width, int.MaxValue), TextFlags);

            TextRenderer.DrawText(
                _g, figure, heroFont,
                new Rectangle(_bounds.Left, _y, _bounds.Width, heroSize.Height),
                _form.Theme.Ink, TextFlags);

            // ⚠️ একক বসে সংখ্যার baseline-এ, উপরে নয় — নইলে "hours today"
            //    সংখ্যাটার মাথার সাথে ভাসত।
            var unitSize = TextRenderer.MeasureText(
                _g, unit, unitFont, new Size(_bounds.Width, int.MaxValue), TextFlags);

            var unitY = _y + heroSize.Height - unitSize.Height - _form.Scale(6);

            TextRenderer.DrawText(
                _g, unit, unitFont,
                new Rectangle(
                    _bounds.Left + heroSize.Width + _form.Scale(8), unitY,
                    _bounds.Width - heroSize.Width, unitSize.Height),
                _form.Theme.Ink2, TextFlags);

            if (!string.IsNullOrEmpty(chip))
            {
                DrawChip(chip, chipDot, _y + ((heroSize.Height - _form.Scale(24)) / 2));
            }

            _y += heroSize.Height + _form.Scale(2);
        }

        /// <summary>ডান দিকে একটা পিল — ভেতরে রঙিন বিন্দু আর অবস্থার নাম।</summary>
        private void DrawChip(string text, Color dot, int top)
        {
            var font = _form.FontFor(TrayFontRole.Small);
            var height = _form.Scale(24);
            var padX = _form.Scale(9);
            var dotSize = _form.Scale(8);

            var textSize = TextRenderer.MeasureText(
                _g, text, font, new Size(_bounds.Width, int.MaxValue), TextFlags);

            var width = padX + dotSize + _form.Scale(6) + textSize.Width + padX;
            var box = new Rectangle(_bounds.Right - width, top, width, height);

            var mode = _g.SmoothingMode;
            _g.SmoothingMode = SmoothingMode.AntiAlias;

            using (var path = Pill(box))
            using (var pen = new Pen(_form.Theme.Line, 1f))
            {
                _g.DrawPath(pen, path);
            }

            using (var brush = new SolidBrush(dot))
            {
                _g.FillEllipse(brush, new Rectangle(
                    box.Left + padX, box.Top + ((height - dotSize) / 2), dotSize, dotSize));
            }

            _g.SmoothingMode = mode;

            TextRenderer.DrawText(
                _g, text, font,
                new Rectangle(
                    box.Left + padX + dotSize + _form.Scale(6),
                    box.Top + ((height - textSize.Height) / 2),
                    textSize.Width + _form.Scale(2), textSize.Height),
                _form.Theme.Ink2, TextFlags);
        }

        /// <summary>
        /// মাসের মিটার — ভরাটের সাথে "আজ পর্যন্ত যতটা হওয়ার কথা" দাগ।
        ///
        /// ⭐ দাগটাই এই জানালার সবচেয়ে বড় বদল। "৭৯:২০ hours behind" সংখ্যাটা
        /// একা একটা অভিযোগ — কতটা পিছিয়ে, আর পোষাতে কতটা মাস বাকি, কোনোটাই
        /// বলে না। দাগ থাকলে ফাঁকটা পড়ার <b>আগেই</b> দেখা যায়।
        ///
        /// ⚠️ ভরাটের সর্বনিম্ন ৩px। ০:৩৯ / ২০৮ ঘণ্টা মানে ০.৩% — ৩৬০px-এ
        /// ১.১px, যা GDI গোল করে <b>শূন্য</b> করে দিত। তখন "একটু কাজ হয়েছে"
        /// আর "কিছুই হয়নি" হুবহু এক দেখাত। সত্যিকারের শূন্য অবশ্য শূন্যই।
        /// </summary>
        public void Meter(double ratio, double? expected, Color fill, int baseHeight = 10)
        {
            var height = _form.Scale(baseHeight);
            var radius = height / 2;

            // দাগের লেবেলটা মিটারের উপরে বসে, তাই আগে জায়গা রাখা
            var labelFont = _form.FontFor(TrayFontRole.Micro);
            var labelHeight = expected is null
                ? 0
                : TextRenderer.MeasureText(
                    _g, "Ag", labelFont, new Size(_bounds.Width, int.MaxValue), TextFlags).Height
                  + _form.Scale(3);

            _y += labelHeight;

            var track = new Rectangle(_bounds.Left, _y, _bounds.Width, height);

            var mode = _g.SmoothingMode;
            _g.SmoothingMode = SmoothingMode.AntiAlias;

            using (var path = Pill(track))
            using (var brush = new SolidBrush(_form.Theme.Track))
            {
                _g.FillPath(brush, path);
            }

            var clamped = double.IsNaN(ratio) ? 0 : Math.Min(1.0, Math.Max(0.0, ratio));
            if (clamped > 0)
            {
                var filled = Math.Max(_form.Scale(3), (int)Math.Round(track.Width * clamped));
                filled = Math.Min(filled, track.Width);

                using var path = Pill(new Rectangle(track.X, track.Y, filled, height));
                using var brush = new SolidBrush(fill);
                _g.FillPath(brush, path);
            }

            _g.SmoothingMode = mode;

            if (expected is { } mark and >= 0 and <= 1)
            {
                var x = track.Left + (int)Math.Round(track.Width * mark);
                var tickTop = track.Top - _form.Scale(3);
                var tickBottom = track.Bottom + _form.Scale(3);

                using (var pen = new Pen(_form.Theme.Ink2, _form.Scale(2)))
                {
                    _g.DrawLine(pen, x, tickTop, x, tickBottom);
                }

                const string caption = "expected by today";
                var capSize = TextRenderer.MeasureText(
                    _g, caption, labelFont, new Size(_bounds.Width, int.MaxValue), TextFlags);

                // ⚠️ দুই প্রান্তে ক্ল্যাম্প — মাসের শুরুতে বা শেষে লেখাটা
                //    জানালার বাইরে চলে যেত।
                var capX = Math.Min(
                    Math.Max(_bounds.Left, x - (capSize.Width / 2)),
                    _bounds.Right - capSize.Width);

                TextRenderer.DrawText(
                    _g, caption, labelFont,
                    new Rectangle(capX, _y - labelHeight, capSize.Width, capSize.Height),
                    _form.Theme.Ink3, TextFlags);
            }

            _y += height + _form.Scale(6);
        }

        /// <summary>বাঁয়ে-ডানে দুটো ছোট লেখা — মিটারের নিচের লাইন।</summary>
        public void Legend(string left, string right, Color rightColor)
        {
            var font = _form.FontFor(TrayFontRole.Small);
            var height = TextRenderer.MeasureText(
                _g, "Ag", font, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;

            TextRenderer.DrawText(
                _g, left, font,
                new Rectangle(_bounds.Left, _y, _bounds.Width / 2, height),
                _form.Theme.Ink3, TextFlags);

            TextRenderer.DrawText(
                _g, right, font,
                new Rectangle(
                    _bounds.Left + (_bounds.Width / 2), _y, _bounds.Width / 2, height),
                rightColor,
                TextFlags | TextFormatFlags.Right);

            _y += height + _form.Scale(3);
        }

        /// <summary>
        /// যন্ত্রের তিনটে তথ্য এক সারিতে — বড়-হাতের ছোট লেবেল, নিচে mono মান।
        ///
        /// ⭐ আগে এগুলো ছিল তিনটে আলাদা সারি, প্রতিটাই বাকি সব লাইনের সমান
        /// ওজনে। এগুলো <b>পড়ার</b> জিনিস নয়, <b>দেখে নেওয়ার</b> জিনিস।
        /// </summary>
        public void Readout((string Key, string Value, Color? Color)[] cells)
        {
            if (cells.Length == 0) return;

            var keyFont = _form.FontFor(TrayFontRole.Micro);
            var valueFont = _form.FontFor(TrayFontRole.Mono);

            var keyHeight = TextRenderer.MeasureText(
                _g, "AG", keyFont, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;
            var valueHeight = TextRenderer.MeasureText(
                _g, "Ag", valueFont, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;

            var column = _bounds.Width / cells.Length;
            var gap = _form.Scale(8);

            for (var i = 0; i < cells.Length; i++)
            {
                var x = _bounds.Left + (i * column);
                var w = column - gap;

                TextRenderer.DrawText(
                    _g, cells[i].Key.ToUpperInvariant(), keyFont,
                    new Rectangle(x, _y, w, keyHeight),
                    _form.Theme.Ink3,
                    TextFlags | TextFormatFlags.EndEllipsis);

                TextRenderer.DrawText(
                    _g, cells[i].Value, valueFont,
                    new Rectangle(x, _y + keyHeight + _form.Scale(2), w, valueHeight),
                    cells[i].Color ?? _form.Theme.Ink,
                    TextFlags | TextFormatFlags.EndEllipsis);
            }

            _y += keyHeight + valueHeight + _form.Scale(6);
        }

        /// <summary>
        /// শুধু গোলমালের সময় — বাক্সে ঘেরা এক বাক্য।
        ///
        /// ⚠️ লাল এই জানালায় <b>একমাত্র এখানেই</b>। "পিছিয়ে আছে" লাল নয়:
        /// ওটা কর্মীর হিসাব, আর এটা সিস্টেমের ব্যর্থতা।
        /// </summary>
        public void Alert(string text)
        {
            if (string.IsNullOrEmpty(text)) return;

            var font = _form.FontFor(TrayFontRole.Small);
            var padX = _form.Scale(10);
            var padY = _form.Scale(8);
            var inner = _bounds.Width - (2 * padX);

            var size = TextRenderer.MeasureText(
                _g, text, font, new Size(inner, int.MaxValue), TextFlags);

            var box = new Rectangle(
                _bounds.Left, _y, _bounds.Width, size.Height + (2 * padY));

            var mode = _g.SmoothingMode;
            _g.SmoothingMode = SmoothingMode.AntiAlias;

            using (var path = Rounded(box, _form.Scale(6)))
            using (var pen = new Pen(_form.Theme.Brand, 1f))
            {
                _g.DrawPath(pen, path);
            }

            _g.SmoothingMode = mode;

            TextRenderer.DrawText(
                _g, text, font,
                new Rectangle(box.Left + padX, box.Top + padY, inner, size.Height),
                _form.Theme.Ink, TextFlags);

            _y += box.Height + _form.Scale(6);
        }

        /// <summary>
        /// একটা টার্গেটের সারি — বাঁয়ে নাম, ডানে "কত / কত", নিচে বার।
        ///
        /// ⭐ তিনটে টার্গেট (আজ · ৭ দিন · মাস) একই আকৃতিতে সাজানো, ইচ্ছাকৃতভাবে:
        /// তিন রকম দেখালে চোখকে প্রতিবার নতুন করে পড়তে হতো, অথচ প্রশ্ন একটাই —
        /// "কতটা হয়েছে"।
        ///
        /// <paramref name="ratio"/> <c>null</c> হলে বার আঁকাই হয় না — "জানি না"
        /// অবস্থায় খালি বার দেখানো মানে "কিছুই করোনি" বলা।
        /// </summary>
        public void TargetRow(
            string label, string value, double? ratio, Color fill,
            double? expected = null, string? note = null, Color? noteColor = null)
        {
            var labelFont = _form.FontFor(TrayFontRole.Body);
            var height = TextRenderer.MeasureText(
                _g, "Ag", labelFont, new Size(_bounds.Width, int.MaxValue), TextFlags).Height;

            TextRenderer.DrawText(
                _g, label, labelFont,
                new Rectangle(_bounds.Left, _y, _bounds.Width / 2, height),
                _form.Theme.Ink2, TextFlags);

            TextRenderer.DrawText(
                _g, value, labelFont,
                new Rectangle(_bounds.Left + (_bounds.Width / 2), _y, _bounds.Width / 2, height),
                _form.Theme.Ink,
                TextFlags | TextFormatFlags.Right);

            _y += height + _form.Scale(4);

            if (ratio is { } r)
            {
                Meter(r, expected, fill, 8);
            }
            else
            {
                Line("Waiting for the server…", TrayFontRole.Small, _form.Theme.Ink3);
            }

            if (!string.IsNullOrEmpty(note))
            {
                _y -= _form.Scale(3);
                Line(note, TrayFontRole.Small, noteColor ?? _form.Theme.Ink3);
            }
        }

        /// <summary>
        /// শেষ কয়েকটা ৫-মিনিটের ঘরে কত শতাংশ সময় হাত চলেছে (B13)।
        ///
        /// ⭐⚠️ এটা <b>কীস্ট্রোক গোনা নয়</b> — গুনলে সেটা কীলগিং হতো
        /// (04-Features § L · G46)। প্রতিটা স্তম্ভ বলে "ওই ৫ মিনিটের কত ভাগ
        /// সময়ে কি-বোর্ড বা মাউস নড়েছে", কী নড়েছে তা নয়।
        ///
        /// ⚠️ শূন্য স্কোরেও ১px-এর একটা রেখা আঁকা হয় — নইলে "০% ব্যস্ত" আর
        /// "এই ঘরের কোনো তথ্যই নেই" পর্দায় হুবহু এক দেখাত।
        /// </summary>
        public void BusyBlocks(IReadOnlyList<int> scores, int blocks, int baseHeight = 26)
        {
            var height = _form.Scale(baseHeight);
            var gap = _form.Scale(3);
            var width = (_bounds.Width - (gap * (blocks - 1))) / blocks;

            // ⚠️ ডান দিকে সবচেয়ে নতুন — ঘর কম থাকলে বাঁ দিক ফাঁকা যায়,
            //    নইলে সদ্য চালু হওয়া এজেন্টে স্তম্ভগুলো লাফিয়ে জায়গা বদলাত।
            var missing = Math.Max(0, blocks - scores.Count);

            for (var i = 0; i < blocks; i++)
            {
                var x = _bounds.Left + (i * (width + gap));
                var slot = new Rectangle(x, _y, width, height);

                using (var back = new SolidBrush(_form.Theme.Track))
                {
                    _g.FillRectangle(back, slot);
                }

                if (i < missing) continue;

                var score = Math.Clamp(scores[i - missing], 0, 100);
                var filled = Math.Max(_form.Scale(1), (int)Math.Round(height * score / 100.0));

                using var brush = new SolidBrush(
                    score == 0 ? _form.Theme.Ink3 : _form.Theme.Ink);

                _g.FillRectangle(
                    brush, new Rectangle(x, slot.Bottom - filled, width, filled));
            }

            _y += height + _form.Scale(5);
        }

        /// <summary>
        /// শেষ তোলা ছবিটা। ⚠️ থাম্বনেইল, পুরো ছবি নয় — জানালার কাজ "কী গেছে
        /// তা দেখানো", ছবি বিশ্লেষণ নয়।
        ///
        /// ফাইল না থাকলে বা পড়া না গেলে <c>false</c> ফেরে আর কিছুই আঁকে না;
        /// কলার তখন অন্য কিছু লিখতে পারে।
        /// </summary>
        public bool Thumbnail(string? path, int baseWidth)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;

            // ⚠️⚠️ `Image.FromStream` এখানে চলে **না** — ছবিটা WebP, আর GDI+-এ
            //    ওই কোডেক নেই। সে "Parameter is not valid" বলে, যেটা পড়ে মনে হয়
            //    ফাইল নষ্ট। ডিকোড করে SkiaSharp (WebpImage), যেটা এমনিতেই আছে।
            using var image = WebpImage.Load(path);
            if (image is null) return false;

            try
            {
                var width = _form.Scale(baseWidth);
                var height = (int)Math.Round(width * (double)image.Height / image.Width);

                var box = new Rectangle(_bounds.Left, _y, width, height);

                _g.DrawImage(image, box);

                using (var pen = new Pen(_form.Theme.Line, 1f))
                {
                    _g.DrawRectangle(pen, box);
                }

                _y += height + _form.Scale(6);
                return true;
            }
            catch (Exception e) when (e is IOException or ArgumentException or OutOfMemoryException)
            {
                // GDI+ ভাঙা ছবিতে OutOfMemoryException ছোড়ে — সত্যিই মেমরি
                // ফুরোয়নি, ওটা ওদের ঐতিহাসিক অদ্ভুততা
                return false;
            }
        }

        private static GraphicsPath Pill(Rectangle box) =>
            Rounded(box, box.Height / 2);

        /// <summary>
        /// ⚠️ <c>Graphics.FillRoundedRectangle</c> .NET 8-এ নেই, তাই হাতে পথ।
        /// ব্যাসার্ধ উচ্চতা/প্রস্থের অর্ধেকের বেশি হলে arc-গুলো একে অন্যের
        /// ভেতরে ঢুকে আকৃতিটা উল্টে যেত, তাই আগেই ছেঁটে নেওয়া।
        /// </summary>
        private static GraphicsPath Rounded(Rectangle box, int radius)
        {
            var path = new GraphicsPath();

            var r = Math.Max(1, Math.Min(radius, Math.Min(box.Width, box.Height) / 2));
            var d = r * 2;

            path.AddArc(box.Left, box.Top, d, d, 180, 90);
            path.AddArc(box.Right - d, box.Top, d, d, 270, 90);
            path.AddArc(box.Right - d, box.Bottom - d, d, d, 0, 90);
            path.AddArc(box.Left, box.Bottom - d, d, d, 90, 90);
            path.CloseFigure();

            return path;
        }
    }

    /**
     * এমবেড করা ব্র্যান্ড আইকন — একবার পড়া হয়, সব জানালা ভাগ করে নেয়।
     *
     * ⚠️⚠️ ব্যর্থ হলে <c>null</c>, ব্যতিক্রম নয়। আইকন না পাওয়ার সবচেয়ে
     * খারাপ ফল হলো টাস্কবারে পুরোনো চেহারা — কিন্তু ছুড়ে দিলে
     * <b>সাইন-ইন জানালাটাই খুলত না</b>, আর কর্মী কাজই শুরু করতে পারতেন না।
     */
    private static readonly Lazy<Icon?> BrandIcon = new(() =>
    {
        try
        {
            using var stream = typeof(OwnerDrawnForm).Assembly
                .GetManifestResourceStream("oXeio.Agent.brand.ico");

            return stream is null ? null : new Icon(stream);
        }
        catch (Exception)
        {
            return null;
        }
    });
}
