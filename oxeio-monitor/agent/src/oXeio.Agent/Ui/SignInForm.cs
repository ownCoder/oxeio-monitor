using System.Drawing;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Security;

namespace oXeio.Agent.Ui;

/// <summary>
/// ⭐⭐ <b>স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে নিজের PC যোগ করে।</b>
///
/// ⚠️ আগের ব্যবস্থায় অ্যাডমিনকে প্রতিটা PC-র জন্য একবার-ব্যবহার্য কোড
/// বানাতে হতো, ২৪ ঘণ্টার মধ্যে ব্যবহার করাতে হতো, আর <b>কোন কোড কোন
/// মেশিনে</b> সেটা হাতে মেলাতে হতো। ভুল মিললে কোনো এরর আসত না — শুধু
/// একজনের ঘণ্টা আরেকজনের নামে জমা হতো, আর ধরা পড়ত মাস শেষে।
///
/// ⚠️ <b>পাসওয়ার্ড কোথাও জমা হয় না।</b> এখান থেকে সোজা
/// <see cref="EnrollmentClient.SignInAsync"/>-এ যায়, সেখানে ডিভাইস
/// টোকেনে বদলায়, আর ডিস্কে যায় শুধু টোকেনটা (DPAPI দিয়ে)।
/// <see cref="TextBox.UseSystemPasswordChar"/> বসানো, আর
/// <see cref="TextBox.MaxLength"/>-ও — নইলে কেউ ভুল করে গোটা একটা ফাইল
/// পেস্ট করে দিলে সেটা তারে চলে যেত।
///
/// ⚠️ জানালাটা <b>মডাল</b> আর <see cref="Form.TopMost"/>। ইনস্টলের পর
/// এটাই প্রথম ও একমাত্র জিনিস যা স্টাফকে করতে হয়; পেছনে চলে গেলে
/// এজেন্ট চিরকাল enroll ছাড়া বসে থাকত আর কেউ টেরও পেত না।
///
/// ⚠️ এখানে <b>Cancel বোতাম নেই</b>, ইচ্ছাকৃতভাবে — কিন্তু জানালাটা বন্ধ
/// করা যায় (X)। বন্ধ করলে এজেন্ট চলতেই থাকে, শুধু enroll হয় না; পরের
/// লগঅনে আবার জিজ্ঞেস করা হয়। জোর করে আটকে রাখলে স্টাফ কাজই শুরু করতে
/// পারত না, আর প্রথম দিনেই সিস্টেমটার উপর বিরক্তি তৈরি হতো।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SignInForm : Form
{
    private readonly TrayTheme _theme = TrayTheme.Current;
    private readonly TrayFonts _fonts;
    private readonly bool _ownsFonts;

    private readonly TextBox _email = new();
    private readonly TextBox _password = new();
    private readonly TextBox _totp = new();
    private readonly Label _totpLabel = new();
    private readonly Label _message = new();
    private readonly Button _signIn = new();

    /// <summary>যে ফাংশনটা সত্যিকারের কাজটা করে — টেস্টে বদলে দেওয়া যায়।</summary>
    private readonly Func<string, SecretText, string?, CancellationToken, Task<EnrollmentResult>> _signInAsync;

    private bool _busy;

    /// <summary>শেষ ঘরটার নিচের প্রান্ত — <see cref="Relayout"/>-এর শুরুর বিন্দু।</summary>
    private int _fieldsBottom;

    public SignInForm(
        string serverUrl,
        Func<string, SecretText, string?, CancellationToken, Task<EnrollmentResult>> signInAsync,
        TrayFonts? fonts = null)
    {
        _signInAsync = signInAsync;
        _fonts = fonts ?? new TrayFonts();
        _ownsFonts = fonts is null;

        var dpi = DeviceDpi;

        Text = "oXeio — sign in";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = true;

        // ⭐ ব্র্যান্ড আইকন। ⚠️ এই ক্লাসটা OwnerDrawnForm-এর উত্তরাধিকারী
        //    **নয়**, তাই বেস ক্লাসে বসিয়ে এটা পাওয়া যায় না — অথচ
        //    ইনস্টলের পর স্টাফ এই জানালাটাই সবার আগে দেখেন।
        Icon = BrandIcon.Value;
        BackColor = _theme.Surface;
        ForeColor = _theme.Ink;
        Font = _fonts.Get(TrayFontRole.Body, dpi);

        var y = Scale(18, dpi);

        var title = new Label
        {
            Text = "Sign in to start tracking",
            Font = _fonts.Get(TrayFontRole.Strong, dpi),
            ForeColor = _theme.Ink,
            // ⚠️ BackColor স্পষ্ট করে বসাতে হয়। WinForms-এ Label-এর ডিফল্ট
            //    BackColor ambient, কিন্তু `AutoSize` লেবেল প্রথম পেইন্টে
            //    মাঝে মাঝে সিস্টেমের `Control` রংটাই আঁকে — গাঢ় জানালায়
            //    সেটা প্রতিটা লেবেলের পেছনে একটা ফ্যাকাশে বাক্স হয়ে বসে।
            BackColor = _theme.Surface,
            AutoSize = true,
            Location = new Point(Scale(20, dpi), y),
        };
        Controls.Add(title);
        y += Scale(26, dpi);

        /**
         * ⭐ সার্ভারের ঠিকানাটা দেখানো হয় ইচ্ছাকৃতভাবে। স্টাফ যেন জানে
         * পাসওয়ার্ডটা **কোথায়** যাচ্ছে — এটাই একমাত্র জায়গা যেখানে সে
         * অফিসের সিস্টেমে নিজের পাসওয়ার্ড টাইপ করছে, আর হুবহু এই রকম
         * একটা জানালা যে কেউ বানাতে পারে।
         */
        var where = new Label
        {
            Text = serverUrl,
            Font = _fonts.Get(TrayFontRole.Small, dpi),
            ForeColor = _theme.Ink3,
            BackColor = _theme.Surface,
            AutoSize = true,
            Location = new Point(Scale(20, dpi), y),
        };
        Controls.Add(where);
        y += Scale(24, dpi);

        y = AddField("Work email", _email, y, dpi);
        _email.MaxLength = 200;

        y = AddField("Password", _password, y, dpi);
        _password.UseSystemPasswordChar = true;
        _password.MaxLength = 200;

        // ⚠️ 2FA-র ঘরটা শুরুতে **লুকানো** — বেশিরভাগ স্টাফের 2FA নেই, আর
        //    একটা ফাঁকা ঘর দেখলে মানুষ ভাবে কিছু একটা ভরতে হবে।
        _totpLabel.Text = "6-digit code";
        // ⚠️ `y` **বাড়ানো হয় না** — ঘরটা লুকানো, তাই জায়গাও ছাড়া হয় না।
        //    `Relayout()` দেখানোর সময় জানালাটা বাড়িয়ে দেয়।
        AddField(_totpLabel, _totp, y, dpi);
        _totp.MaxLength = 10;
        _totpLabel.Visible = false;
        _totp.Visible = false;

        _message.Size = new Size(Scale(340, dpi), Scale(32, dpi));
        _message.ForeColor = _theme.Brand;
        _message.BackColor = _theme.Surface;
        _message.Font = _fonts.Get(TrayFontRole.Small, dpi);
        Controls.Add(_message);

        _signIn.Text = "Sign in";
        _signIn.Size = new Size(Scale(100, dpi), Scale(30, dpi));
        _signIn.FlatStyle = FlatStyle.Flat;
        _signIn.FlatAppearance.BorderColor = _theme.Ink3;
        _signIn.BackColor = _theme.Line;
        _signIn.ForeColor = _theme.Ink;
        _signIn.Click += async (_, _) => await SubmitAsync().ConfigureAwait(true);
        Controls.Add(_signIn);

        // Enter চাপলেই সাইন ইন — ফর্মে এটাই একমাত্র কাজ
        AcceptButton = _signIn;

        _fieldsBottom = y;
        Relayout();

        ActiveControl = _email;
    }

    /**
     * ⚠️⚠️ <b>জানালার উচ্চতা হাতে লেখা ধ্রুবক নয়, হিসাব করা।</b>
     *
     * 2FA-র ঘরটা সাধারণত লুকানো, আর তখন ওই জায়গাটুকু ফাঁকা পড়ে থাকত —
     * প্রথম ছবিতে ঠিক সেটাই দেখা গেছে: মাঝখানে একটা বড় শূন্যতা, আর নিচে
     * বোতামটা কিনারায় গিয়ে ঠেকা। উল্টোদিকে উচ্চতাটা ছোট করে বসালে
     * 2FA-ওয়ালা অ্যাকাউন্টে ঘরটা জানালার **বাইরে** পড়ত, আর স্টাফ কোড
     * টাইপ করার জায়গাই পেত না।
     *
     * তাই দুটো অবস্থার জন্য দুটো উচ্চতা, আর ঘরটা দেখানোর সময় জানালাটা
     * নিজে থেকেই বেড়ে যায়।
     */
    private void Relayout()
    {
        var dpi = DeviceDpi;
        var y = _fieldsBottom;

        if (_totp.Visible)
        {
            y += Scale(48, dpi);
        }

        _message.Location = new Point(Scale(20, dpi), y);
        y += _message.Height + Scale(6, dpi);

        _signIn.Location = new Point(Scale(380, dpi) - Scale(20, dpi) - _signIn.Width, y);

        ClientSize = new Size(Scale(380, dpi), y + _signIn.Height + Scale(18, dpi));
    }

    /// <summary>সফল হলে ভরা থাকে — কলার এটা দেখেই বোঝে কী হলো।</summary>
    public EnrollmentResult? Result { get; private set; }

    private int AddField(string label, TextBox box, int y, int dpi) =>
        AddField(new Label { Text = label }, box, y, dpi);

    private int AddField(Label label, TextBox box, int y, int dpi)
    {
        label.Font = _fonts.Get(TrayFontRole.Small, dpi);
        label.ForeColor = _theme.Ink2;
        label.BackColor = _theme.Surface;
        label.AutoSize = true;
        label.Location = new Point(Scale(20, dpi), y);
        Controls.Add(label);

        box.Location = new Point(Scale(20, dpi), y + Scale(16, dpi));
        box.Size = new Size(Scale(340, dpi), Scale(24, dpi));
        box.BorderStyle = BorderStyle.FixedSingle;
        box.BackColor = _theme.Line;
        box.ForeColor = _theme.Ink;
        box.Font = _fonts.Get(TrayFontRole.Body, dpi);
        Controls.Add(box);

        return y + Scale(48, dpi);
    }

    private async Task SubmitAsync()
    {
        // ⚠️ দুবার চাপা আটকানো — প্রতিটা ব্যর্থ চেষ্টা সার্ভারের
        //    brute-force কাউন্টারে গোনা হয়, তাই ডাবল-ক্লিকে অকারণে
        //    দুটো ব্যর্থতা জমত আর তালা তাড়াতাড়ি পড়ত।
        if (_busy) return;

        _busy = true;
        _signIn.Enabled = false;
        _message.ForeColor = _theme.Ink2;
        _message.Text = "Signing in…";

        EnrollmentResult result;
        try
        {
            var password = new SecretText(_password.Text);
            var totp = _totp.Visible ? _totp.Text : null;

            result = await _signInAsync(_email.Text, password, totp, CancellationToken.None)
                .ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            // ⚠️ এখানে ছুড়ে দেওয়া মানে WinForms-এর unhandled handler, অর্থাৎ
            //    ক্র্যাশ ডায়ালগ — সাইন-ইনের ভুলে গোটা এজেন্ট মরা চলবে না।
            result = new EnrollmentResult(
                EnrollmentStatus.ServerUnreachable, "Something went wrong: " + ex.Message);
        }

        _busy = false;
        _signIn.Enabled = true;

        if (result.Ok)
        {
            Result = result;
            DialogResult = DialogResult.OK;
            Close();
            return;
        }

        if (result.Status == EnrollmentStatus.NeedsTotp)
        {
            // ⭐ দ্বিতীয় ধাপ — ঘরটা এখন দেখা যাবে, আর কার্সরও ওখানে
            _totpLabel.Visible = true;
            _totp.Visible = true;
            Relayout();
            _totp.Focus();
            _message.ForeColor = _theme.Ink2;
            _message.Text = result.Message;
            return;
        }

        _message.ForeColor = _theme.Brand;
        _message.Text = result.Message;

        // ⚠️ পাসওয়ার্ডের ঘরটা খালি করা হয় **না**। ভুল ছ-অঙ্কের কোডের জন্য
        //    ব্যর্থ হলে পাসওয়ার্ড আবার টাইপ করানো নিছক শাস্তি।
        _password.SelectAll();
        _password.Focus();
    }

    private static int Scale(int value, int dpi) => value * dpi / 96;

    protected override void Dispose(bool disposing)
    {
        if (disposing && _ownsFonts) _fonts.Dispose();
        base.Dispose(disposing);
    }
}
