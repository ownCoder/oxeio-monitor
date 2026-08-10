namespace oXeio.Core.Watchdog;

/// <summary>
/// রিস্টার্ট কত দ্রুত, কতবার, আর কখন থামতে হবে — বিশুদ্ধ সেটিং।
/// </summary>
public sealed record RestartPolicy
{
    public RestartPolicy(
        TimeSpan baseDelay,
        double multiplier,
        TimeSpan maxDelay,
        int giveUpAfter,
        TimeSpan coolOff,
        TimeSpan stabilityWindow)
    {
        if (baseDelay <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(baseDelay));
        if (multiplier < 1) throw new ArgumentOutOfRangeException(nameof(multiplier));
        if (maxDelay < baseDelay) throw new ArgumentOutOfRangeException(nameof(maxDelay));
        if (giveUpAfter < 1) throw new ArgumentOutOfRangeException(nameof(giveUpAfter));

        // ঠান্ডা হওয়ার সময় সবচেয়ে বড় ধাপের চেয়ে ছোট হলে "হাল ছাড়া" বলে কিছু
        // থাকত না — মই শেষ হয়ে গিয়ে বরং আগের চেয়ে ঘন ঘন চেষ্টা শুরু হতো।
        if (coolOff < maxDelay) throw new ArgumentOutOfRangeException(nameof(coolOff));
        if (stabilityWindow <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(stabilityWindow));

        BaseDelay = baseDelay;
        Multiplier = multiplier;
        MaxDelay = maxDelay;
        GiveUpAfter = giveUpAfter;
        CoolOff = coolOff;
        StabilityWindow = stabilityWindow;
    }

    /// <summary>প্রথম ব্যর্থ চালুর পর কত অপেক্ষা।</summary>
    public TimeSpan BaseDelay { get; }

    public double Multiplier { get; }

    /// <summary>সিলিং।</summary>
    public TimeSpan MaxDelay { get; }

    /// <summary>এতবার চালু করেও এজেন্ট টিকল না — তারপর আর হাতুড়ি পেটানো হয় না।</summary>
    public int GiveUpAfter { get; }

    /// <summary>হাল ছাড়ার পর কতক্ষণ পরপর শুধু একবার করে দেখা হয়।</summary>
    public TimeSpan CoolOff { get; }

    /// <summary>এতক্ষণ টানা সুস্থ থাকলে মই আবার শূন্য থেকে শুরু।</summary>
    public TimeSpan StabilityWindow { get; }

    /// <summary>
    /// ধাপগুলো: ৩০ সে. → ১.৫ মি. → ৪.৫ মি. → ১৩.৫ মি. → ১৫ মি. (সিলিং),
    /// পাঁচবারে হাল ছাড়া, তারপর ৬ ঘণ্টা পরপর একবার করে চেষ্টা, আর
    /// টানা ১০ মিনিট সুস্থ থাকলে সব ভুলে নতুন করে শুরু।
    ///
    /// <b>সংখ্যাগুলো কীভাবে এল:</b> watchdog নিজেই ৩০ সেকেন্ড পরপর তাকায়, তাই
    /// এর চেয়ে ছোট ধাপ লিখে কোনো লাভ নেই। পাঁচ ধাপে মোট ~৩৫ মিনিট — startup-এ
    /// ক্র্যাশ করা এজেন্টকে সৎভাবে পাঁচটা সুযোগ দেওয়া হয়, তারপরও না হলে সমস্যাটা
    /// আর রিস্টার্টে সারার নয়। ৬ ঘণ্টা মানে দিনে ৪ বার — CPU-তে এর অস্তিত্বই টের
    /// পাওয়া যায় না, অথচ AV-র কোয়ারেন্টিন বা লক হয়ে থাকা কনফিগ ফাইলের মতো
    /// সাময়িক সমস্যা নিজে থেকেই সেরে যায়, কাউকে ১৫টা PC ঘুরতে হয় না।
    /// </summary>
    public static RestartPolicy Default { get; } = new(
        baseDelay: TimeSpan.FromSeconds(30),
        multiplier: 3,
        maxDelay: TimeSpan.FromMinutes(15),
        giveUpAfter: 5,
        coolOff: TimeSpan.FromHours(6),
        stabilityWindow: TimeSpan.FromMinutes(10));
}

/// <summary>
/// ⭐ <b>এই মডিউলের সবচেয়ে গুরুত্বপূর্ণ আচরণ — রিস্টার্ট-ঝড় ঠেকানো।</b>
///
/// সরল watchdog লেখে: "প্রসেস নেই? চালু করো।" এজেন্ট যদি startup-এই ক্র্যাশ করে
/// (ভুল কনফিগ, AV কোয়ারেন্টিন, নষ্ট queue.db) তাহলে ওই লুপ সেকেন্ডে দুবার প্রসেস
/// তৈরি করতে থাকে — ১৫টা PC-তে একসাথে, সারা রাত, আর সকালে সবার আগে যেটা চোখে পড়ে
/// সেটা হলো ঘরের পাখার শব্দ। তাই এখানে তিনটে আলাদা রক্ষাকবচ:
///
/// <list type="number">
/// <item><b>প্রতিটা লঞ্চ আগে থেকেই ব্যর্থ ধরা হয়</b> (<see cref="RecordLaunch"/> সাথে সাথেই
/// গোনা বাড়ায়)। "চালু করে দেখি টিকল কি না" ধরনের আশাবাদ রাখলে যে প্রসেসটা
/// তৈরি হওয়ার ১০ ms পরেই মরে যায়, তাকে কখনোই ব্যর্থ গোনা হতো না।</item>
///
/// <item><b>শুধু টানা সুস্থ থাকাই মই রিসেট করে</b> (<see cref="Observe"/>), শুধু
/// "একবার চালু হয়েছে" নয়। ক্র্যাশ-লুপে প্রসেসটা বারবার চালু <i>হয়</i>ই।</item>
///
/// <item><b>হাল ছাড়া মানে চিরতরে থামা নয়, ঠান্ডা হওয়া।</b> ⚠️ এখানে চিরতরে
/// থামলে সাময়িক একটা সমস্যায় (যেমন AV আপডেটের সময় exe লক হয়ে থাকা) ১৫টা PC-র
/// প্রত্যেকটায় একজন মানুষকে গিয়ে হাত লাগাতে হতো — আর ততক্ষণ কারো সময় গোনাই হতো না।
/// তাই সেকেন্ডে দুবারের লুপ দিনে চারবারে নামিয়ে আনা হয়, বন্ধ করা হয় না।</item>
/// </list>
///
/// এই ক্লাসে কোনো ঘড়ি নেই — কলার <c>now</c> দেয়। ⚠️ কলার অবশ্যই
/// <see cref="oXeio.Core.Time.MonotonicClock"/> দেবে, <c>DateTimeOffset.Now</c> নয়:
/// দেয়াল-ঘড়ি পিছিয়ে দিলে ঠান্ডা হওয়ার সময় কোনোদিন শেষ হতো না।
/// </summary>
public sealed class RestartLadder
{
    private readonly RestartPolicy _policy;

    private int _failures;
    private DateTimeOffset? _lastLaunchAt;
    private DateTimeOffset? _healthySince;
    private bool _alarmRaised;

    public RestartLadder(RestartPolicy? policy = null) => _policy = policy ?? RestartPolicy.Default;

    public RestartPolicy Policy => _policy;

    /// <summary>এ পর্যন্ত কতবার চালু করেও টেকানো যায়নি।</summary>
    public int Failures => _failures;

    /// <summary>মই শেষ — এখন শুধু ঠান্ডা হওয়ার ব্যবধানে একবার করে চেষ্টা।</summary>
    public bool IsExhausted => _failures >= _policy.GiveUpAfter;

    /// <summary>দৃশ্যমান সংকেত (অ্যালার্ম ফাইল/লগ) একবারই দেওয়া হয়েছে কি না।</summary>
    public bool AlarmRaised => _alarmRaised;

    public DateTimeOffset? LastLaunchAt => _lastLaunchAt;

    /// <summary>
    /// <paramref name="failures"/>-তম ব্যর্থতার পর কত অপেক্ষা।
    /// ⚠️ <c>Math.Pow</c> কয়েক হাজার ধাপে ∞ দেয় আর <c>TimeSpan.FromSeconds(∞)</c>
    /// ছুড়ে দেয় — তাই TimeSpan বানানোর <b>আগেই</b> double-এ সিলিং মেলানো হয়।
    /// এখানে throw করা মানে watchdog-ই মরে যাওয়া, অর্থাৎ পাহারাদার ছাড়া মেশিন।
    /// </summary>
    public TimeSpan DelayAfter(int failures)
    {
        if (failures <= 0) return TimeSpan.Zero;

        var seconds = _policy.BaseDelay.TotalSeconds * Math.Pow(_policy.Multiplier, failures - 1);

        return double.IsNaN(seconds) || seconds >= _policy.MaxDelay.TotalSeconds
            ? _policy.MaxDelay
            : TimeSpan.FromSeconds(seconds);
    }

    /// <summary>পরের চেষ্টার আগে আর কত বাকি। শূন্য মানে এখনই চেষ্টা করা যায়।</summary>
    public TimeSpan TimeUntilNextLaunch(DateTimeOffset now)
    {
        // প্রথমবার — Task Manager থেকে kill করার ৩০ সেকেন্ডের মধ্যে ফিরে আসা
        // আমাদের গ্রহণযোগ্যতার শর্ত (H01), তাই এখানে কোনো বিলম্ব নেই।
        if (_failures == 0 || _lastLaunchAt is not { } last) return TimeSpan.Zero;

        var wait = IsExhausted ? _policy.CoolOff : DelayAfter(_failures);

        var elapsed = now - last;

        // ⚠️ কলার ভুল করে দেয়াল-ঘড়ি দিলে আর কেউ ঘড়ি পিছিয়ে দিলে elapsed ঋণাত্মক
        //    হতো, আর তখন watchdog নীরবে চিরতরে অপেক্ষায় বসে থাকত। শূন্যে আটকে
        //    দিলে সবচেয়ে খারাপ ফল একটা বাড়তি ব্যবধান — পাহারা বন্ধ হওয়া নয়।
        if (elapsed < TimeSpan.Zero) elapsed = TimeSpan.Zero;

        var left = wait - elapsed;
        return left > TimeSpan.Zero ? left : TimeSpan.Zero;
    }

    public bool MayLaunch(DateTimeOffset now) => TimeUntilNextLaunch(now) <= TimeSpan.Zero;

    /// <summary>
    /// এইমাত্র এজেন্ট চালু করার চেষ্টা করা হলো।
    ///
    /// ⚠️ কলার এটা <b>চালু করার আগে</b> ডাকবে। <c>Process.Start</c> ছুড়ে দিলে
    /// (exe নেই, AV ব্লক করেছে) পরে ডাকলে গোনা কখনো বাড়ত না আর লুপটা প্রতি
    /// ৩০ সেকেন্ডে চিরকাল চেষ্টা করে যেত — ঠিক যে ঝড়টা ঠেকানোর কথা।
    /// </summary>
    public void RecordLaunch(DateTimeOffset now)
    {
        if (_failures < int.MaxValue) _failures++;
        _lastLaunchAt = now;
        _healthySince = null;
    }

    /// <summary>
    /// প্রতি টিকে এজেন্ট সুস্থ কি না জানানো হয়। টানা
    /// <see cref="RestartPolicy.StabilityWindow"/> সুস্থ থাকলে মই রিসেট।
    /// </summary>
    public void Observe(bool healthy, DateTimeOffset now)
    {
        if (!healthy)
        {
            _healthySince = null;
            return;
        }

        if (_healthySince is not { } since || now < since)
        {
            // now < since মানে ঘড়ি পিছিয়েছে — নোঙরটা এগিয়ে না এনে ফেললে
            // এই এজেন্ট আর কোনোদিন "স্থির" গণ্য হতো না।
            _healthySince = now;
            since = now;
        }

        if (now - since >= _policy.StabilityWindow) Reset();
    }

    /// <summary>অ্যালার্ম দেওয়া হয়ে গেছে — প্রতি ৩০ সেকেন্ডে আবার লেখা হবে না।</summary>
    public void MarkAlarmRaised() => _alarmRaised = true;

    public void Reset()
    {
        _failures = 0;
        _lastLaunchAt = null;
        _healthySince = null;
        _alarmRaised = false;
    }
}
