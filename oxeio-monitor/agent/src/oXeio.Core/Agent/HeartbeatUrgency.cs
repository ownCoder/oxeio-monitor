namespace oXeio.Core.Agent;

/// <summary>
/// ⭐⭐ <b>অবস্থা বদলালে সার্ভারকে কখন জানানো হবে।</b> খাঁটি নিয়ম, কোনো I/O নেই।
///
/// ⚠️⚠️ <b>এটা একটা বাস্তব অভিযোগ থেকে এসেছে।</b> মালিক জানালেন: idle
/// থাকা অবস্থায় মাউস নাড়ালে, ক্লিক করলে বা কি-বোর্ড চাপলেও বোর্ডে
/// "Working" আসতে <b>১০–১৫ সেকেন্ড</b> লাগে।
///
/// কারণটা বাগ ছিল না, ছিল <b>ছন্দ</b>: এজেন্ট এক সেকেন্ডেই টের পায়, কিন্তু
/// সার্ভার জানে কেবল heartbeat-এ — আর সেটা যায় ১৫ সেকেন্ড পরপর। কর্মী
/// ফিরে এসে কাজ শুরু করেছেন, অথচ বোর্ড তখনো বলছে তিনি থেমে আছেন।
///
/// ⚠️ ছোট দেরি মনে হলেও ক্ষতিটা বিশ্বাসের: মালিক পর্দায় দেখেন একজন
/// "Idle", অথচ পাশে গিয়ে দেখেন তিনি টাইপ করছেন। দু-বার এমন হলে গোটা
/// বোর্ডের উপরই আর ভরসা থাকে না।
///
/// ⭐ তাই অবস্থা বদলালে <b>সাথে সাথেই</b> একটা heartbeat — কিন্তু
/// <see cref="MinGap"/>-এর চেয়ে ঘন ঘন নয়।
/// </summary>
public static class HeartbeatUrgency
{
    /// <summary>
    /// ⚠️⚠️ দুটো heartbeat-এর মধ্যে সর্বনিম্ন ব্যবধান।
    ///
    /// এটা না থাকলে অবস্থা দোদুল্যমান হলে (কেউ এক সেকেন্ড কাজ করে, এক
    /// সেকেন্ড থামে — পড়তে পড়তে টুকে নেওয়ার সময় খুবই স্বাভাবিক) এজেন্ট
    /// সেকেন্ডে সেকেন্ডে সার্ভারে ধাক্কা দিত। ১৫টা PC মিলে সেটা সার্ভারের
    /// উপর ঢেউ, আর লাভ শূন্য — মানুষের চোখে ৩ সেকেন্ড আর ০ সেকেন্ড এক।
    /// </summary>
    public static readonly TimeSpan MinGap = TimeSpan.FromSeconds(3);

    /// <summary>
    /// পরের heartbeat কতক্ষণ পরে।
    /// </summary>
    /// <param name="now">এখন (monotonic ঘড়ি)।</param>
    /// <param name="lastBeatAt">শেষ heartbeat কখন গিয়েছিল।</param>
    /// <param name="normal">স্বাভাবিক ব্যবধান (সার্ভারের কনফিগ থেকে)।</param>
    /// <param name="stateChanged">শেষ heartbeat-এর পর অবস্থা বদলেছে কি না।</param>
    public static TimeSpan Next(
        DateTimeOffset now,
        DateTimeOffset lastBeatAt,
        TimeSpan normal,
        bool stateChanged)
    {
        // অবস্থা বদলায়নি — স্বাভাবিক ছন্দেই চলুক
        if (!stateChanged) return Remaining(now, lastBeatAt, normal);

        /**
         * ⚠️ বদলেছে, কিন্তু এইমাত্র একটা beat গেছে — তবু <see cref="MinGap"/>
         * পর্যন্ত অপেক্ষা। ⭐ শূন্য ফেরত দিলে দোদুল্যমান অবস্থায় লুপটা
         * অনবরত ঘুরত।
         */
        var since = now - lastBeatAt;

        // ⚠️⚠️ ঋণাত্মক মানে ঘড়ি পিছিয়েছে — শেষ beat "ভবিষ্যতে"। তখন
        //    `MinGap - since` দাঁড়াত মিনিট বা ঘণ্টায়, অর্থাৎ জরুরি খবরটাই
        //    সবচেয়ে বেশি দেরিতে যেত।
        if (since < TimeSpan.Zero) return TimeSpan.Zero;

        return since < MinGap ? MinGap - since : TimeSpan.Zero;
    }

    /**
     * ⚠️⚠️ <b>দুই দিকেই ছাঁটা হয়, আর দ্বিতীয়টা একটা টেস্ট ধরিয়ে দিয়েছে।</b>
     *
     * প্রথম সংস্করণে কেবল ঋণাত্মক দিকটা সামলানো ছিল। কিন্তু আসল বিপদ
     * উল্টো দিকে: ঘড়ি পিছিয়ে গেলে (NTP সংশোধন) <c>lastBeatAt</c> হয়ে যায়
     * <b>ভবিষ্যতের</b> সময়, আর তখন অপেক্ষা দাঁড়াত ১০ মিনিটের ঘড়ি-লাফে
     * <b>৬১৫ সেকেন্ড</b> — heartbeat বন্ধ, আর G01 ("এজেন্ট ১০ মিনিট চুপ")
     * প্রতিটা মেশিনে জ্বলে উঠত।
     *
     * ⭐ তাই ছাদটা <c>normal</c> — একটা স্বাভাবিক ব্যবধানের বেশি অপেক্ষা
     * কোনো অবস্থাতেই যুক্তিসঙ্গত নয়।
     */
    private static TimeSpan Remaining(
        DateTimeOffset now,
        DateTimeOffset lastBeatAt,
        TimeSpan normal)
    {
        var due = lastBeatAt + normal - now;

        if (due <= TimeSpan.Zero) return TimeSpan.Zero;
        return due > normal ? normal : due;
    }
}
