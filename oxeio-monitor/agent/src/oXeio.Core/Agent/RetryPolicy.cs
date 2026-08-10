namespace oXeio.Core.Agent;

/// <summary>
/// ⭐ ব্যর্থ আপলোড কখন আবার চেষ্টা করা হবে — jitter সহ exponential backoff।
///
/// <b>যে দুটো সিদ্ধান্ত এখানে সবচেয়ে গুরুত্বপূর্ণ:</b>
///
/// <b>১· ডিফল্টে <see cref="MaxAttempts"/> null, অর্থাৎ চেষ্টার সংখ্যায় কিছু বাদ যায় না।</b>
/// সাইটের লাইন দশ দিন বন্ধ থাকলে ৫ মিনিটের সিলিং-এ প্রায় ২,৯০০ বার চেষ্টা হবে।
/// "২০ বারের পর ছেড়ে দাও" নিয়মটা তখন দশ দিনের পুরো পে-রোল ডেটা মুছে দিত —
/// আর সেটা ঘটত ঠিক সেই মেশিনে যেটার সমস্যা সবচেয়ে বেশি। সাময়িক ব্যর্থতা মানে
/// সার্ভার এখনো "না" বলেনি; না বলা পর্যন্ত ডেটা রাখা হয়।
/// ডেটা কমে শুধু দুই কারণে: সার্ভারের স্থায়ী প্রত্যাখ্যান
/// (<see cref="SyncOutcome.Permanent"/>) আর ডিস্কের বাজেট (<see cref="OutboxBudget"/>)।
///
/// <b>২· jitter সিলিং ছাড়িয়ে যেতে পারে, ইচ্ছাকৃতভাবে।</b> ১৫টা PC-র সবগুলো
/// একই সুইচের পেছনে; লাইন ফিরলে সবাই একই সেকেন্ডে ঠিক ৫ মিনিট পরপর ধাক্কা দিত।
/// jitter-কে সিলিং-এ ক্ল্যাম্প করলে ঠিক ওই জায়গাতেই সে আবার একসাথে হয়ে যেত।
/// </summary>
public sealed record RetryPolicy
{
    public RetryPolicy(
        TimeSpan baseDelay,
        double multiplier,
        TimeSpan maxDelay,
        double jitterRatio,
        int? maxAttempts,
        TimeSpan maxAge)
    {
        if (baseDelay <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(baseDelay));
        if (multiplier < 1) throw new ArgumentOutOfRangeException(nameof(multiplier));
        if (maxDelay < baseDelay) throw new ArgumentOutOfRangeException(nameof(maxDelay));
        if (jitterRatio is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(jitterRatio));
        if (maxAttempts is < 1) throw new ArgumentOutOfRangeException(nameof(maxAttempts));
        if (maxAge <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(maxAge));

        BaseDelay = baseDelay;
        Multiplier = multiplier;
        MaxDelay = maxDelay;
        JitterRatio = jitterRatio;
        MaxAttempts = maxAttempts;
        MaxAge = maxAge;
    }

    /// <summary>প্রথম ব্যর্থতার পর কত অপেক্ষা।</summary>
    public TimeSpan BaseDelay { get; }

    /// <summary>প্রতিবার কত গুণ। ১-এর কম হলে ব্যাকঅফ নয়, তাই নাকচ।</summary>
    public double Multiplier { get; }

    /// <summary>সিলিং — এর বেশি অপেক্ষা কখনো নয় (jitter বাদে)।</summary>
    public TimeSpan MaxDelay { get; }

    /// <summary>০.২৫ মানে ±২৫%।</summary>
    public double JitterRatio { get; }

    /// <summary>null = চেষ্টার সংখ্যায় কখনো হাল ছাড়া হয় না। ক্লাসের মন্তব্য দেখুন।</summary>
    public int? MaxAttempts { get; }

    /// <summary>এত পুরোনো হয়ে গেলে সারিটা আর কাজের নয় — শেষ রক্ষাকবচ।</summary>
    public TimeSpan MaxAge { get; }

    /// <summary>
    /// ৫ সেকেন্ড থেকে শুরু, দ্বিগুণ হয়ে ৫ মিনিটে থামে, ±২৫% jitter,
    /// চেষ্টার কোনো সীমা নেই, ৩০ দিনের বেশি পুরোনো হলে ছাড়া হয়।
    ///
    /// ৩০ দিন কেন: মাসিক হিসাবের চক্রই ৩০ দিন। এর চেয়ে পুরোনো ডেটা সার্ভারে
    /// পৌঁছালেও ততদিনে ওই মাসের রিপোর্ট বেরিয়ে গেছে।
    /// </summary>
    public static RetryPolicy Default { get; } = new(
        baseDelay: TimeSpan.FromSeconds(5),
        multiplier: 2,
        maxDelay: TimeSpan.FromMinutes(5),
        jitterRatio: 0.25,
        maxAttempts: null,
        maxAge: TimeSpan.FromDays(30));

    /// <summary>
    /// jitter ছাড়া বিশুদ্ধ ব্যাকঅফ। <paramref name="attempt"/> = এ পর্যন্ত কতবার
    /// ব্যর্থ হয়েছে (১ = প্রথম ব্যর্থতা)।
    ///
    /// ⚠️ <paramref name="attempt"/> ১-এর কম হলে এক্সসেপশন নয়, ১ ধরা হয়।
    /// এটা রিকভারির পথ — সবকিছু ভেঙে পড়ার পর <b>এই</b> কোডটাই চলতে হবে।
    /// এখানে throw করা মানে সিঙ্ক ওয়ার্কার মরে যাওয়া, আর তখন ডেটা আর কখনো যাবে না।
    /// </summary>
    public TimeSpan DelayFor(int attempt)
    {
        if (attempt < 1) attempt = 1;

        // ⚠️ Math.Pow(2, 2880) = ∞, আর TimeSpan.FromSeconds(∞) ছুড়ে দেয়
        //    OverflowException। দশ দিন অফলাইন থাকলেই attempt ওই ঘরে পৌঁছায়,
        //    তাই TimeSpan বানানোর আগেই double-এই সিলিং মেলাতে হবে।
        var seconds = BaseDelay.TotalSeconds * Math.Pow(Multiplier, attempt - 1);

        return double.IsNaN(seconds) || seconds >= MaxDelay.TotalSeconds
            ? MaxDelay
            : TimeSpan.FromSeconds(seconds);
    }

    /// <summary>
    /// jitter সহ। <paramref name="jitterSample"/> ∈ [০,১] — কলার
    /// <c>Random.Shared.NextDouble()</c> দেয়, টেস্ট নির্দিষ্ট মান দেয়।
    /// ০.৫ দিলে ঠিক <see cref="DelayFor(int)"/>-ই ফেরে।
    ///
    /// Core-এ <c>Random</c> রাখা হয়নি ইচ্ছাকৃতভাবে — এলোমেলোতা ভেতরে থাকলে
    /// এই ক্লাসটা আর টেস্ট করা যেত না।
    /// </summary>
    public TimeSpan DelayFor(int attempt, double jitterSample)
    {
        var delay = DelayFor(attempt);
        if (JitterRatio <= 0) return delay;

        var sample = double.IsNaN(jitterSample) ? 0.5 : Math.Clamp(jitterSample, 0, 1);
        var factor = 1 - JitterRatio + (2 * JitterRatio * sample);
        var seconds = delay.TotalSeconds * factor;

        // ⚠️ jitter যেন শূন্য বা ঋণাত্মক বিলম্ব না বানায় — তাহলে সিঙ্ক লুপ
        //    busy loop হয়ে একটা কোর খেয়ে ফেলত।
        return TimeSpan.FromSeconds(Math.Max(0.001, seconds));
    }

    /// <summary>
    /// সার্ভার <c>Retry-After</c> পাঠালে সেটাই মানা হয় — নিজের হিসাব যদি ছোট হয়।
    ///
    /// সার্ভার ৪২৯-এ যখন বলে "৬০ সেকেন্ড পরে আসো", তখন ৫ সেকেন্ড পরে গিয়ে
    /// আবার ৪২৯ খাওয়া মানে rate limit-এর কাউন্টার আরো ভরানো — নিজের পায়ে কুড়াল।
    /// </summary>
    public TimeSpan DelayFor(int attempt, double jitterSample, TimeSpan? serverRetryAfter)
    {
        var mine = DelayFor(attempt, jitterSample);
        return serverRetryAfter is { } theirs && theirs > mine ? theirs : mine;
    }

    /// <summary>পরের চেষ্টার মুহূর্ত — <see cref="IOutboxStore.RetryAsync"/>-এ সরাসরি যায়।</summary>
    public DateTimeOffset NextAttemptAt(
        int attempt, DateTimeOffset now, double jitterSample, TimeSpan? serverRetryAfter = null) =>
        now + DelayFor(attempt, jitterSample, serverRetryAfter);

    /// <summary>
    /// সারিটা কি আর ধরে রাখার মানে হয়?
    ///
    /// ⚠️ এটা শুধু <see cref="SyncOutcome.Transient"/>-এর ক্ষেত্রে ডাকবেন।
    /// <see cref="SyncOutcome.Permanent"/> হলে এটা না দেখেই abandon,
    /// আর <see cref="SyncOutcome.Success"/> হলে প্রশ্নই ওঠে না।
    /// </summary>
    /// <param name="attempt">এ পর্যন্ত কতবার ব্যর্থ (<see cref="OutboxEntry.Attempts"/>)।</param>
    /// <param name="enqueuedAt">রেকর্ড তৈরির সময় — শেষ চেষ্টার সময় নয়।</param>
    public bool ShouldAbandon(int attempt, DateTimeOffset enqueuedAt, DateTimeOffset now)
    {
        if (MaxAttempts is { } cap && attempt >= cap) return true;

        return now - enqueuedAt >= MaxAge;
    }
}
