namespace oXeio.Core.Agent;

/// <summary>
/// একটা ঘটনা — <c>POST /agent/events</c>-এর <c>events[]</c>-এর এলিমেন্ট।
///
/// ইভেন্ট হলো <b>ঘটনার লগ</b>, ঘণ্টার হিসাব নয়। ঘণ্টা আসে শুধু
/// <see cref="oXeio.Core.Models.ActivitySegment"/> থেকে। তাই ইভেন্ট হারালে
/// পে-রোল নড়ে না — শুধু ডিবাগিং কঠিন হয়।
/// </summary>
public sealed record AgentEventRecord
{
    public required Guid ClientUuid { get; init; }

    /// <summary><see cref="AgentEventTypes"/>-এর একটা। সর্বোচ্চ ৫০ অক্ষর।</summary>
    public required string Type { get; init; }

    public required DateTimeOffset OccurredAt { get; init; }

    /// <summary>
    /// JSON অবজেক্ট হিসেবে যায়। ছোট রাখুন — এখানে ডায়াগনস্টিক থাকে, ডেটা নয়।
    ///
    /// ⚠️ এখানে কখনো ফাইলের নাম, URL বা উইন্ডোর টেক্সট ঢোকাবেন না। মেটা ফিল্ডে
    /// কোনো ভ্যালিডেশন নেই, তাই "একটু ডিবাগ ইনফো" দিয়েই প্রাইভেসির নিয়ম ফাঁকি
    /// দেওয়া সবচেয়ে সহজ এখানেই।
    /// </summary>
    public IReadOnlyDictionary<string, object?>? Meta { get; init; }
}

/// <summary>
/// সার্ভারের <c>schema.prisma</c>-তে লেখা তালিকাটাই — স্ট্রিং হাতে লিখলে
/// একটা টাইপো সারা মাস চুপচাপ ভুল টাইপ পাঠাত, আর সার্ভার সেটা মেনেও নিত।
/// </summary>
public static class AgentEventTypes
{
    public const string AgentStart = "agent_start";
    public const string AgentStop = "agent_stop";
    public const string Logon = "logon";
    public const string Logoff = "logoff";

    /// <summary>
    /// ⭐ PC বন্ধ/রিস্টার্ট — <c>logoff</c> থেকে আলাদা।
    ///
    /// সার্ভারের G02 অ্যালার্ট (<c>alerts.rules.ts</c>) একটা <c>agent_stop</c>-কে
    /// "স্বাভাবিক" বলে <b>কেবল তখনই</b>, যখন তার আশেপাশে একটা <c>logoff</c> বা
    /// <c>shutdown</c> আছে। দুটোর কোনোটাই না পাঠালে প্রতিটা রাতের স্বাভাবিক
    /// শাটডাউনই "হস্তক্ষেপ" হয়ে অ্যালার্ট তুলত — অর্থাৎ ১৫টা PC থেকে রোজ
    /// ১৫টা মিথ্যা অ্যালার্ট, আর তার পরেই কেউ আর অ্যালার্ট পড়ত না।
    /// </summary>
    public const string Shutdown = "shutdown";

    /// <summary>
    /// ⭐⭐ <b>Restart Manager আমাদের বন্ধ করাচ্ছে — সাধারণত আপডেট বসাতে।</b>
    ///
    /// ⚠️⚠️ এটা <b>সেশন শেষ নয়</b>, তাই <see cref="Shutdown"/> বলা যেত না —
    /// বললে প্রতিটা আপডেট একটা ভুয়া "PC বন্ধ" রেকর্ড রেখে যেত।
    ///
    /// ⚠️⚠️ কিন্তু কিছুই না পাঠানোও ভুল ছিল, আর সেটাই এতদিন হতো। উপরের
    /// <see cref="Shutdown"/>-এর নোট যে ফাঁদটার কথা বলে, আপডেট ঠিক সেই
    /// ফাঁদেই পড়ত: <c>agent_stop</c> যেত, কিন্তু পাশে <c>logoff</c>/<c>shutdown</c>
    /// কিছুই থাকত না — তাই সার্ভারের G02 প্রতিটা আপডেটকে <b>হস্তক্ষেপ</b>
    /// ধরে <c>agent_killed</c> অ্যালার্ট তুলত। ⭐ হাতে গিয়ে একটা-দুটো PC
    /// আপডেট করলে সেটা চোখে পড়ত না; রোলআউট চালু হলে একসাথে ১২টা।
    ///
    /// ⭐ সার্ভার এটাকে <c>agent_stop</c>-এর <b>বৈধ সঙ্গী</b> ধরে
    /// (<c>alerts.rules.ts</c> → <c>CLEAN_STOP_CONTEXT</c>), ঠিক যেভাবে
    /// <c>logoff</c>/<c>shutdown</c>-কে ধরে।
    ///
    /// ⚠️ কেউ এজেন্ট মেরে দিলে এই ইভেন্টটা যায় না — তাই আসল হস্তক্ষেপ
    /// এখনো ধরা পড়ে। ছাড়টা শুধু ওই পথের, যেটা দিয়ে Windows নিজে আমাদের
    /// বন্ধ করায়।
    /// </summary>
    public const string AgentUpdate = "agent_update";

    public const string Lock = "lock";
    public const string Unlock = "unlock";
    public const string Sleep = "sleep";
    public const string Resume = "resume";
}
