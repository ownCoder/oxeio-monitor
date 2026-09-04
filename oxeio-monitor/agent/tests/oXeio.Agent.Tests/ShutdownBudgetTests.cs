namespace oXeio.Agent.Tests;

/// <summary>
/// ⭐⭐ <b>R29-B · G136 — বন্ধ হওয়ার বাজেটগুলো পরস্পরের ভেতরে থাকতেই হবে।</b>
///
/// ⚠️⚠️ এই ফাইলটার কারণ একটাই: শর্তগুলো এতদিন <b>কেবল মন্তব্যে</b> লেখা ছিল
/// (<i>"Program.ShutdownBudget-এর ভেতরে থাকতে হবে"</i>), আর মন্তব্য কাউকে
/// থামায় না। একটা বাজেট বাড়িয়ে দিলে ফল হতো নীরব: drain নিজে থামত না,
/// Windows প্রসেসটাকে <b>মাঝপথে</b> মেরে ফেলত, আর ঠিক যে <c>agent_stop</c>-এর
/// জন্য পুরো অপেক্ষা সেটাই হারাত। কম্পাইলার ধরত না, মাঠে ধরা পড়ত মাস পরে —
/// সকালের বাসি agent_down দেয়াল হয়ে।
///
/// ⭐ সংখ্যা নয়, <b>সম্পর্ক</b> পরীক্ষা করা হয়: কেউ ২.৫ সে.-কে ৩ করলে টেস্ট
/// চুপ থাকবে যতক্ষণ ছাদগুলো মানা হচ্ছে।
/// </summary>
public class ShutdownBudgetTests
{
    /// <summary>
    /// Windows অসাড় অ্যাপকে কতক্ষণ সময় দেয় — <c>WaitToKillAppTimeout</c>-এর
    /// ডিফল্ট (৫০০০ ms)। ⚠️ রেজিস্ট্রিতে কমানো যায়, তাই এটা <b>ছাদ</b>,
    /// প্রতিশ্রুতি নয়; আমরা তার অনেক নিচে থাকি।
    /// </summary>
    private static readonly TimeSpan WindowsKillTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// ⭐ <c>WM_ENDSESSION</c>-এ UI থ্রেড আটকে থাকে, তাই এই ছাদটাই সবচেয়ে
    /// সংবেদনশীল — এর বেশি হলে ব্যবহারকারী "অ্যাপ সাড়া দিচ্ছে না" দেখতেন।
    /// </summary>
    [Fact]
    public void শাটডাউনে_UI_থ্রেড_Windows_এর_সীমার_অর্ধেকের_কমই_আটকায়() =>
        Assert.True(
            AgentHost.EndSessionTotalBudget < WindowsKillTimeout / 2,
            $"EndSessionTotalBudget ({AgentHost.EndSessionTotalBudget}) " +
            $"Windows-এর {WindowsKillTimeout}-এর অর্ধেকের কম হতে হবে");

    /// <summary>
    /// ⚠️⚠️ বাইরের ছাদ ভেতরের দুই ধাপের যোগফলের সমান হতে হবে — কম হলে ছাদটা
    /// <b>অন্য জিনিস মাপত</b> যা সে মাপছে বলে দাবি করে, আর লেখা দেরি হলে
    /// পাঠানোর সময়ই থাকত না।
    /// </summary>
    [Fact]
    public void বাইরের_ছাদ_ভেতরের_দুই_ধাপের_যোগফল() =>
        Assert.Equal(
            AgentHost.EndSessionEnqueueWait + AgentHost.EndSessionSendBudget,
            AgentHost.EndSessionTotalBudget);

    /// <summary>⚠️ লেখার অপেক্ষা পাঠানোর ছাদের ভেতরেই — নইলে পাঠানোর সময়ই থাকত না।</summary>
    [Fact]
    public void কিউয়ে_লেখার_অপেক্ষা_পাঠানোর_ছাদের_ভেতরে() =>
        Assert.True(
            AgentHost.EndSessionEnqueueWait < AgentHost.EndSessionSendBudget,
            "EndSessionEnqueueWait must leave room for the send itself");

    /// <summary>
    /// ⭐⭐ <c>DisposeAsync</c>-এর দুটো drain মিলে <c>Program.ShutdownBudget</c>
    /// ছাড়াতে পারে না — এটাই সেই মন্তব্যে লেখা শর্ত, এখন পাহারায়।
    /// </summary>
    [Fact]
    public void Dispose_এর_দুটো_drain_মিলে_শাটডাউন_বাজেটের_ভেতরে() =>
        Assert.True(
            AgentHost.GoodbyeBudget + AgentHost.FinalDrainBudget
                <= Program.ShutdownBudget,
            $"goodbye ({AgentHost.GoodbyeBudget}) + final ({AgentHost.FinalDrainBudget}) " +
            $"must fit inside ShutdownBudget ({Program.ShutdownBudget})");

    /// <summary>⚠️ আর গোটা DisposeAsync-ও Windows-এর সীমার নিচে।</summary>
    [Fact]
    public void শাটডাউন_বাজেট_Windows_এর_সীমার_নিচে() =>
        Assert.True(Program.ShutdownBudget < WindowsKillTimeout);

    /// <summary>
    /// ⚠️ <c>agent_stop</c> ডিস্কে লেখার অপেক্ষাও ওই ছাদের ভেতরে — নইলে
    /// লেখা শেষ হওয়ার আগেই সময় ফুরাত আর drain খালি কিউ পেত।
    /// </summary>
    [Fact]
    public void লেখার_বাজেট_শাটডাউন_বাজেটের_ভেতরে() =>
        Assert.True(AgentHost.StopEnqueueBudget < Program.ShutdownBudget);
}
