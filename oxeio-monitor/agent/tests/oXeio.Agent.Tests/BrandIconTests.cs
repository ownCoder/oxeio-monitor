using System.Drawing;
using System.Reflection;

namespace oXeio.Agent.Tests;

/// <summary>
/// <b>ব্র্যান্ড আইকন — টাস্কবারে যা দেখা যায়।</b>
///
/// ⚠️⚠️ <b>এই ফাইলটা একটা নীরব ব্যর্থতা ঠেকায়।</b> জানালার আইকন আসে একটা
/// এমবেডেড রিসোর্স থেকে, আর সেটা খুঁজে পাওয়া হয় <b>নাম দেখে</b>
/// (<c>"oXeio.Agent.brand.ico"</c>)। csproj-এর <c>LogicalName</c> কেউ
/// বদলালে, বা ফাইলটা সরে গেলে, কোডটা <c>null</c> পেয়ে চুপচাপ পুরোনো
/// ডিফল্ট আইকনে ফিরে যেত — <b>কোনো এরর নেই, কোনো লগ নেই</b>, শুধু
/// টাস্কবারে আবার সেই ফাঁকা জানালা।
///
/// ⭐ ঠিক এই ধরনের "চুক্তি আছে, সরবরাহ নেই" ভুল এই প্রকল্পে বারবার
/// ফিরেছে, তাই নামটা টেস্টে বাঁধা।
/// </summary>
public class BrandIconTests
{
    /// <summary>⚠️ কোডে লেখা নামটার সাথে হুবহু মিলতে হবে (OwnerDrawnForm)</summary>
    private const string ResourceName = "oXeio.Agent.brand.ico";

    private static Assembly AgentAssembly =>
        typeof(oXeio.Agent.Program).Assembly;

    [Fact]
    public void The_icon_is_embedded_under_the_expected_name()
    {
        Assert.Contains(ResourceName, AgentAssembly.GetManifestResourceNames());
    }

    /// <summary>
    /// ⭐⭐ রিসোর্সটা থাকা যথেষ্ট নয় — সেটা যে সত্যিই একটা <b>পড়ার মতো
    /// আইকন</b>, তা-ও দেখা দরকার। একটা ভাঙা বা খালি ফাইলও "আছে" বলেই
    /// গোনা হতো।
    /// </summary>
    [Fact]
    public void The_embedded_resource_is_a_real_icon()
    {
        using var stream = AgentAssembly.GetManifestResourceStream(ResourceName);
        Assert.NotNull(stream);

        using var icon = new Icon(stream!);

        Assert.True(icon.Width > 0);
        Assert.True(icon.Height > 0);
    }

    /**
     * ⭐⭐⭐ <b>এই ফাইলের সবচেয়ে দরকারি টেস্ট।</b>
     *
     * ⚠️⚠️ একটা `.ico`-তে অনেকগুলো মাপ থাকে, আর Windows প্রতিটা জায়গার
     * জন্য <b>সবচেয়ে কাছের</b> মাপটা বেছে নেয়। ১৬px না থাকলে ৩২px-টা
     * অর্ধেক করে বসাত, আর টাস্কবারে X-এর ডাঁটি ঝাপসা দেখাত — ঠিক যেটা
     * এড়াতে প্রতিটা মাপ আলাদা করে আঁকা হয় (`installer/make-icon.py`)।
     */
    [Theory]
    [InlineData(16)]
    [InlineData(32)]
    [InlineData(48)]
    public void Every_size_WinForms_asks_for_is_present(int side)
    {
        using var stream = AgentAssembly.GetManifestResourceStream(ResourceName);
        using var icon = new Icon(stream!, new Size(side, side));

        // ⚠️ Icon(stream, size) চাওয়া মাপ না পেলে **সবচেয়ে কাছেরটা** দেয়,
        //    ব্যতিক্রম ছোড়ে না। তাই ফেরত আসা মাপটাই যাচাই করতে হয় —
        //    নইলে টেস্টটা সবুজ থাকত অথচ কিছুই প্রমাণ করত না।
        Assert.Equal(side, icon.Width);
        Assert.Equal(side, icon.Height);
    }

    /**
     * ⭐⭐ <b>২৫৬px আছে কি না — ফাইলের ডিরেক্টরি নিজে পড়ে।</b>
     *
     * ⚠️⚠️ <c>System.Drawing.Icon</c> দিয়ে এটা মাপা <b>যায় না</b>, আর
     * সেটা আমাদের ফাইলের দোষ নয়: ICO ফরম্যাটে ২৫৬ লেখা হয় <c>0</c> বাইট
     * দিয়ে (এক বাইটে ২৫৬ আঁটে না), আর ওই API শূন্যকে শূন্যই ধরে — তাই
     * ২৫৬ চাইলে সে ১২৮ ফেরত দেয়। প্রথমে এই টেস্টটা <c>Icon</c> দিয়েই
     * লেখা হয়েছিল, আর সে "মাপটা নেই" বলে মিথ্যা অভিযোগ করেছিল।
     *
     * ⭐ Explorer-এর নিজের লোডার ওই নিয়মটা জানে, তাই "Extra large icons"
     * ভিউতে ২৫৬-টাই ব্যবহার হয়। মাপার জায়গা তাই ফাইলটা, API নয়।
     */
    [Fact]
    public void The_file_carries_a_256_entry_for_Explorer()
    {
        using var stream = AgentAssembly.GetManifestResourceStream(ResourceName);
        using var memory = new MemoryStream();
        stream!.CopyTo(memory);
        var bytes = memory.ToArray();

        // ICO হেডার: 2 বাইট reserved · 2 বাইট type · 2 বাইট count
        var count = BitConverter.ToUInt16(bytes, 4);
        Assert.True(count >= 6, $"only {count} sizes in the icon");

        var sides = new List<int>();
        for (var i = 0; i < count; i++)
        {
            // প্রতিটা এন্ট্রি ১৬ বাইট, শুরু ৬ বাইট পরে; প্রথম বাইটটাই প্রস্থ
            var w = bytes[6 + (i * 16)];
            sides.Add(w == 0 ? 256 : w);
        }

        Assert.Contains(256, sides);
        Assert.Contains(16, sides);
    }

    /// <summary>
    /// ⭐ আইকনটা <b>ব্র্যান্ডের লাল</b>, আর সেটা কোণায় দেখা যায় — টাইলটা
    /// কোণা পর্যন্ত ভরাট (favicon.svg-এর নিয়ম)। ফাইলটা ভুল করে অন্য কোনো
    /// আইকন দিয়ে বদলে গেলে এটাই ধরবে।
    /// </summary>
    [Fact]
    public void It_is_the_red_brand_tile()
    {
        using var stream = AgentAssembly.GetManifestResourceStream(ResourceName);
        using var icon = new Icon(stream!, new Size(32, 32));
        using var bitmap = icon.ToBitmap();

        // মাঝখান থেকে সামান্য সরে — ওখানে X-এর সাদা ডাঁটি
        var tile = bitmap.GetPixel(4, 16);

        Assert.InRange(tile.R, 200, 255);
        Assert.InRange(tile.G, 0, 80);
        Assert.InRange(tile.B, 0, 80);
    }
}
