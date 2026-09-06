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
    /// ⚠️⚠️ <c>DisposeAsync</c>-এর যেটুকু কাজে <b>কোনো বাজেট নেই</b> —
    /// <c>_stopping.CancelAsync()</c>, দুটো <c>CloseAll</c>, চারটে
    /// <c>Dispose()</c>, আর <c>_outbox.DisposeAsync()</c>-এর SQLite
    /// checkpoint। ⭐ সংখ্যাটা মাপা নয়, <b>জায়গা রাখা</b>: বাজেটওয়ালা
    /// ধাপগুলো যেন ছাদটা <b>ছুঁয়ে</b> না ফেলে।
    /// </summary>
    private static readonly TimeSpan DisposeOverhead = TimeSpan.FromMilliseconds(400);

    /// <summary>
    /// ⭐⭐⭐ <c>DisposeAsync</c>-এর <b>তিনটে</b> ধাপ মিলে
    /// <c>Program.ShutdownBudget</c> ছাড়াতে পারে না।
    ///
    /// ⚠️⚠️ <b>এই টেস্টটাই আগে ভুল ছিল</b> <i>(৬ সেপ্টেম্বর ২০২৬, G161)</i>।
    /// এটা যোগ করত কেবল <b>দুটো</b> drain (২ + ১.৫ = ৩.৫ ≤ ৪ — সবুজ), আর
    /// তার আগে যে <see cref="AgentHost.StopEnqueueBudget"/> ধাপটা পরপর
    /// চলে সেটা কোনো যোগফলেই ঢুকত না। আলাদা একটা টেস্ট তাকে একা মাপত
    /// (<c>২ &lt; ৪</c> — সবুজ)। ফলে আসল যোগফল <b>৫.৫ &gt; ৪</b> হয়েও
    /// সুইট সবুজ থাকত।
    ///
    /// ⚠️ এটাই এই ফাইলের নিজের ভূমিকায় বর্ণিত ব্যর্থতা — "শর্তটা মন্তব্যে
    /// লেখা ছিল, পাহারা ছিল না" — শুধু এবার <b>পাহারাটাই</b> অসম্পূর্ণ ছিল।
    /// ⭐ তাই এখন <b>একটাই</b> টেস্ট, আর তাতে তিনটে ধাপই আছে: ভবিষ্যতে
    /// চতুর্থ ধাপ যোগ হলে সেটাও এখানেই বসবে।
    /// </summary>
    [Fact]
    public void Dispose_এর_তিনটে_ধাপ_মিলে_শাটডাউন_বাজেটের_ভেতরে()
    {
        var sequential =
            AgentHost.StopEnqueueBudget + AgentHost.GoodbyeBudget + AgentHost.FinalDrainBudget;

        Assert.True(
            sequential + DisposeOverhead <= Program.ShutdownBudget,
            $"enqueue ({AgentHost.StopEnqueueBudget}) + goodbye ({AgentHost.GoodbyeBudget}) " +
            $"+ final ({AgentHost.FinalDrainBudget}) = {sequential}; " +
            $"বাজেটহীন কাজের জন্য {DisposeOverhead} রেখে " +
            $"ShutdownBudget ({Program.ShutdownBudget})-এর ভেতরে থাকতে হবে");
    }

    /// <summary>⚠️ আর গোটা DisposeAsync-ও Windows-এর সীমার নিচে।</summary>
    [Fact]
    public void শাটডাউন_বাজেট_Windows_এর_সীমার_নিচে() =>
        Assert.True(Program.ShutdownBudget < WindowsKillTimeout);

    /// <summary>
    /// ⭐ দুই শাটডাউন-পথ একই কাজে একই বাজেট নেয় <i>(G161)</i>।
    ///
    /// ⚠️ <c>WM_ENDSESSION</c>-এর পথ আর <c>DisposeAsync</c>-এর পথ — দুটোই
    /// একটা SQLite INSERT-এর জন্য অপেক্ষা করে, তারপর একটা ছোট POST পাঠায়।
    /// সংখ্যা দুরকম হলে একদিন একটা পথ ঠিক করা হতো আর অন্যটা বাসি থেকে
    /// যেত — এই প্রকল্পে ঠিক সেটাই বারবার হয়েছে।
    /// </summary>
    [Fact]
    public void দুই_শাটডাউন_পথ_একই_কাজে_একই_বাজেট_নেয়()
    {
        Assert.Equal(AgentHost.EndSessionEnqueueWait, AgentHost.StopEnqueueBudget);
        Assert.Equal(AgentHost.EndSessionSendBudget, AgentHost.GoodbyeBudget);
    }
}
