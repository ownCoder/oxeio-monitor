using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// সাইন আউট করা যাবে কি না, আর করলে কী হারাবে।
///
/// ⚠️⚠️ এই নিয়মটার আসল কাজ মেনু নিষ্ক্রিয় রাখা নয় — <b>ভুল লোকের নামে
/// ঘণ্টা বসা ঠেকানো</b>। সাইন আউটের পর আউটবক্সে সারি পড়ে থাকলে পরের জন
/// সাইন ইন করামাত্র সেগুলো তার টোকেনে চলে যেত, আর কেউ কোনোদিন টের পেত না।
/// তাই এখানকার সীমানাগুলোই সবচেয়ে গুরুত্বপূর্ণ।
/// </summary>
public class SignOutGateTests
{
    private const bool Enrolled = true;
    private const bool NotEnrolled = false;
    private const bool Revoked = true;
    private const bool NotRevoked = false;

    private const int Nothing = 0;
    private const int Something = 7;

    [Fact]
    public void সাইন_ইন_করা_থাকলে_সাইন_আউট_করা_যায়() =>
        Assert.True(SignOutGate.Allows(Enrolled, NotRevoked, Nothing));

    [Fact]
    public void সাইন_ইন_না_থাকলে_সাইন_আউটের_কিছু_নেই() =>
        Assert.Equal(
            SignOutGate.Verdict.NotSignedIn,
            SignOutGate.Check(NotEnrolled, NotRevoked, Nothing));

    /**
     * ⚠️⚠️ <b>ক্রমের টেস্ট — TrackingGate-এর সাথে হুবহু মেলে।</b>
     *
     * revoke হলে টোকেন মুছে যায়, তাই ওই মুহূর্তে "enrolled নয়"-ও সত্যি।
     * দুটো শর্তই মেলে বলেই ক্রমটা লিখে রাখা দরকার, নইলে বাতিল মেশিনে
     * স্টাফ দেখত "সাইন ইন করা নেই" — অথচ আসল কথা অফিস এটা বন্ধ করেছে।
     *
     * ⭐ দুই গেট একই ক্রম না মানলে tray-র দুই জায়গায় দুই রকম ব্যাখ্যা যেত।
     */
    [Fact]
    public void বাতিল_ডিভাইসে_revoke_ই_উত্তর_সাইন_ইন_নেই_নয()
    {
        Assert.Equal(
            SignOutGate.Verdict.Revoked,
            SignOutGate.Check(NotEnrolled, Revoked, Nothing));

        // দুই গেটের ক্রম একই — এটাই আসল দাবি
        Assert.Equal(
            TrackingGate.Verdict.Revoked,
            TrackingGate.Check(NotEnrolled, Revoked));
    }

    [Fact]
    public void বাতিল_ডিভাইসে_সাইন_আউট_নিষ্ক্রিয়() =>
        Assert.False(SignOutGate.Allows(NotEnrolled, Revoked, Something));

    /** ⭐⭐ এই ফাইলের মূল টেস্ট */
    [Fact]
    public void অপাঠানো_সারি_থাকলে_আলাদা_উত্তর()
    {
        Assert.Equal(
            SignOutGate.Verdict.PendingUpload,
            SignOutGate.Check(Enrolled, NotRevoked, Something));

        // ⚠️ আটকানো হয় না — শুধু জিজ্ঞাসা করা হয়। আটকে দিলে অফলাইন
        //    মেশিনে কেউ কোনোদিন সাইন আউট করতে পারত না, আর শেয়ার করা PC-তে
        //    ঘণ্টা ভুল লোকের নামেই যেত — যা ঠেকাতে চাইছি ঠিক সেটাই।
        Assert.True(SignOutGate.Allows(Enrolled, NotRevoked, Something));
    }

    /**
     * ⚠️ গণনায় বাগ থাকলে সেটা যেন বাড়তি সতর্কবার্তা না বানায় — ঋণাত্মক
     * সংখ্যা "কিছু নেই"-এর সমান। বাগের শাস্তি স্টাফের পাওয়ার কথা নয়।
     */
    [Fact]
    public void ঋণাত্মক_গণনা_কিছু_নেই_ধরা_হয() =>
        Assert.Equal(
            SignOutGate.Verdict.Ready,
            SignOutGate.Check(Enrolled, NotRevoked, -3));

    [Fact]
    public void একটা_সারিও_যথেষ্ট() =>
        Assert.Equal(
            SignOutGate.Verdict.PendingUpload,
            SignOutGate.Check(Enrolled, NotRevoked, 1));

    /**
     * ⚠️⚠️ বার্তাটা স্টাফকে <b>তথ্য ফেলে দিতে</b> রাজি করাচ্ছে। তাই তিনটে
     * জিনিস তাতে থাকতেই হবে: কতগুলো, কী হবে, আর বাঁচার পথ।
     */
    [Fact]
    public void অপাঠানো_থাকলে_বার্তায়_সংখ্যা_ক্ষতি_ও_পথ_তিনটেই_থাকে()
    {
        var text = SignOutGate.Confirm(SignOutGate.Verdict.PendingUpload, Something);

        Assert.Contains("7", text, StringComparison.Ordinal);
        Assert.Contains("discard", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Sync now", text, StringComparison.Ordinal);
    }

    /** ⚠️ "1 items" — অযত্নের ছাপ থাকলে গোটা সতর্কবার্তাই কম বিশ্বাসযোগ্য */
    [Fact]
    public void একবচন_ও_বহুবচন_আলাদা()
    {
        var one = SignOutGate.Confirm(SignOutGate.Verdict.PendingUpload, 1);
        var many = SignOutGate.Confirm(SignOutGate.Verdict.PendingUpload, 5);

        Assert.Contains("1 measurement has", one, StringComparison.Ordinal);
        Assert.Contains("5 measurements have", many, StringComparison.Ordinal);
    }

    /**
     * ⚠️⚠️ "আবার সাইন ইন করা যাবে" বোঝানো জরুরি। না বোঝালে স্টাফ ভাবত
     * সাইন আউট মানে চিরতরে বাদ পড়া, আর ভয়ে শেয়ার করা PC-তে কেউ সাইন
     * আউট করত না — তখন ঘণ্টা ভুল লোকের নামেই যেত।
     */
    [Fact]
    public void সব_পাঠানো_হয়ে_গেলে_বার্তা_ভয়_দেখায়_না()
    {
        var text = SignOutGate.Confirm(SignOutGate.Verdict.Ready, Nothing);

        Assert.Contains("signs in again", text, StringComparison.Ordinal);
        Assert.DoesNotContain("discard", text, StringComparison.OrdinalIgnoreCase);
    }

    /**
     * ⚠️ যে অবস্থায় সাইন আউট করাই যায় না, সেখানে বার্তা চাওয়া মানে কলারের
     * ভুল — নীরবে একটা লাইন ফেরত দিলে কোনোদিন স্টাফ এমন "নিশ্চিত করুন?"
     * পড়ত যার কোনো ফলই নেই।
     */
    [Theory]
    [InlineData(SignOutGate.Verdict.NotSignedIn)]
    [InlineData(SignOutGate.Verdict.Revoked)]
    public void নিষ্ক্রিয়_অবস্থায়_বার্তা_চাইলে_ছুঁড়ে_দেয(SignOutGate.Verdict verdict) =>
        Assert.Throws<ArgumentOutOfRangeException>(
            () => SignOutGate.Confirm(verdict, Nothing));
}
