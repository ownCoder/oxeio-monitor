using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Ui;

namespace oXeio.Agent.Tests;

/// <summary>
/// <b>হিরো সংখ্যার সেকেন্ড অংশ — অর্ধেক মাপে</b> <i>(১৮ আগস্ট ২০২৬)</i>।
///
/// মালিকের চাওয়া: <c>3:59:22</c>-এর <c>:22</c> অর্ধেক আকারে। ⚠️⚠️ কিন্তু
/// "ছোট করে দিলাম" আর "দেখতে ঠিক লাগছে" এক কথা নয় — ছোট লেখাটা যদি
/// baseline ছেড়ে উপরে বা নিচে সরে যায়, সেটা দেখতে ভাঙা লাগে, আর ওই ভুলটা
/// কোনো কম্পাইলার ধরে না।
///
/// ⭐⭐ তাই এখানে **সত্যিই এঁকে, পিক্সেল গুনে** যাচাই করা হয়: একটা
/// bitmap-এ আঁকা হয়, তারপর কালি কোথায় পড়ল সেটা মেপে দেখা হয় লেখাটা
/// কত উঁচু আর তার তলা কোথায়। ⚠️ GUI খোলা লাগে না, তাই CI-তেও চলে।
/// </summary>
[SupportedOSPlatform("windows")]
public class HeroSecondsTests
{
    // ── খাঁটি নিয়ম ──────────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️⚠️ <b>শেষ</b> কোলন, প্রথমটা নয় — প্রথমটা ধরলে মিনিটও ছোট হয়ে যেত।
    /// </summary>
    [Theory]
    [InlineData("3:59:22", "3:59", ":22")]
    [InlineData("0:00:07", "0:00", ":07")]
    [InlineData("123:45:06", "123:45", ":06")]
    public void SplitsAtTheSecondsColon(string figure, string head, string tail)
    {
        Assert.Equal((head, tail), UiText.SplitSeconds(figure));
    }

    /// <summary>
    /// ⚠️ সেকেন্ড না থাকলে লেজ খালি — তখন পুরোটাই হিরো মাপে আঁকা হয়,
    /// অর্ধেক নয়। (<c>Duration()</c> কোনোদিন হিরোতে বসলে যেন চুপচাপ
    /// মিনিটটা ছোট না হয়ে যায়।)
    /// </summary>
    [Theory]
    [InlineData("3:59")]
    [InlineData("")]
    [InlineData("59")]
    public void LeavesTheTailEmptyWhenThereAreNoSeconds(string figure)
    {
        Assert.Equal(string.Empty, UiText.SplitSeconds(figure).Tail);
    }

    // ── আঁকা ────────────────────────────────────────────────────────────────

    /// <summary>
    /// ⭐ ঠিক অর্ধেক — হাতে বসানো কোনো সংখ্যা নয়, তাই হিরোর মাপ বদলালে
    /// সেকেন্ডও সঙ্গে যায়।
    /// </summary>
    [Fact]
    public void SecondsFontIsExactlyHalfTheHero()
    {
        using var fonts = new TrayFonts();

        var hero = fonts.Get(TrayFontRole.Hero, 96);
        var seconds = fonts.Get(TrayFontRole.HeroSeconds, 96);

        Assert.Equal(hero.Size / 2f, seconds.Size, 3);
        // ⚠️ একই ফ্যামিলি ও style — নইলে দুটো অঙ্ক দুই পরিবারের দেখাত,
        //    আর baseline মেলানোর হিসাবটাও ভেঙে পড়ত
        Assert.Equal(hero.FontFamily.Name, seconds.FontFamily.Name);
        Assert.Equal(hero.Style, seconds.Style);
    }

    /// <summary>
    /// ⚠️ ১৫০% DPI-তেও অনুপাত একই — ফন্ট পিক্সেলে বানানো হয় বলে দুটোই
    /// একসাথে বড় হয়।
    /// </summary>
    [Fact]
    public void TheHalfHoldsAtHighDpi()
    {
        using var fonts = new TrayFonts();

        var hero = fonts.Get(TrayFontRole.Hero, 144);
        var seconds = fonts.Get(TrayFontRole.HeroSeconds, 144);

        Assert.Equal(hero.Size / 2f, seconds.Size, 3);
    }

    /// <summary>
    /// ⭐⭐ <b>আসল যাচাই — কালি মেপে।</b> ছোট অঙ্কটা সত্যিই প্রায় অর্ধেক
    /// উঁচু, আর তার <b>তলা</b> বড় অঙ্কের তলার সাথে মেলে।
    ///
    /// ⚠️⚠️ দ্বিতীয় দাবিটাই এখানে জরুরি: মাপ ছোট করা সহজ, কিন্তু ছোট
    /// লেখাটা baseline ছেড়ে ভেসে গেলে জানালাটা দেখতে ভাঙা লাগে — আর
    /// এক সেকেন্ড পরপর নড়া একটা ভাসন্ত অঙ্ক চোখে লাগেই।
    /// </summary>
    [Fact]
    public void SecondsSitOnTheSameBaselineAtHalfTheHeight()
    {
        using var fonts = new TrayFonts();
        var hero = fonts.Get(TrayFontRole.Hero, 96);
        var seconds = fonts.Get(TrayFontRole.HeroSeconds, 96);

        // ⚠️ `OwnerDrawnForm.AscentPx`-এর হিসাবটাই এখানে আবার লেখা হয়নি —
        //    আঁকা হয় ওই কোডের নিয়মে, আর মাপা হয় **ছবি থেকে**। দুটো এক
        //    হলে টেস্টটা নিজের সাথে নিজেই মিলত, আর কিছুই প্রমাণ হতো না।
        var heroTop = 20;
        var tailTop = heroTop + Ascent(hero) - Ascent(seconds);

        using var canvas = new Bitmap(400, 120, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(canvas))
        {
            g.Clear(Color.Black);

            TextRenderer.DrawText(
                g, "3:59", hero, new Point(10, heroTop), Color.White, Flags);
            TextRenderer.DrawText(
                g, ":22", seconds, new Point(220, tailTop), Color.White, Flags);
        }

        var big = InkRows(canvas, 0, 200);
        var small = InkRows(canvas, 210, 390);

        Assert.True(big.HasValue && small.HasValue, "দুটোরই কালি পড়ার কথা");

        var bigHeight = big!.Value.Bottom - big.Value.Top;
        var smallHeight = small!.Value.Bottom - small.Value.Top;

        // ⚠️ ঠিক অর্ধেক নয় — অঙ্কের আকার ফন্টের মাপের ঠিক সমানুপাতিক নয়
        //    (hinting, rounding)। ±২০% যথেষ্ট ঢিলা, তবু "ছোট করা হয়নি"
        //    ধরার জন্য যথেষ্ট আঁটও।
        var ratio = (double)smallHeight / bigHeight;
        Assert.InRange(ratio, 0.40, 0.60);

        // ⭐ তলা মেলে — ২px ঢিল, কারণ ':' আর অঙ্কের নিচের প্রান্ত হুবহু
        //    এক পিক্সেলে শেষ হয় না
        Assert.InRange(Math.Abs(big.Value.Bottom - small.Value.Bottom), 0, 2);
    }

    // ── সহায়ক ───────────────────────────────────────────────────────────────

    private const TextFormatFlags Flags =
        TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding;

    private static int Ascent(Font font)
    {
        var family = font.FontFamily;

        return (int)Math.Round(
            font.Size * family.GetCellAscent(font.Style) / family.GetEmHeight(font.Style));
    }

    /// <summary>
    /// দেওয়া কলামগুলোর মধ্যে কালি কোন সারিতে শুরু আর কোথায় শেষ।
    /// ⚠️ কালো পটভূমিতে সাদা লেখা, তাই "কালি" মানে যেকোনো অ-কালো পিক্সেল।
    /// </summary>
    private static (int Top, int Bottom)? InkRows(Bitmap image, int fromX, int toX)
    {
        int top = -1, bottom = -1;

        for (var y = 0; y < image.Height; y++)
        {
            for (var x = fromX; x < Math.Min(toX, image.Width); x++)
            {
                if (image.GetPixel(x, y).R <= 40) continue;

                if (top < 0) top = y;
                bottom = y;
                break;
            }
        }

        return top < 0 ? null : (top, bottom);
    }
}
