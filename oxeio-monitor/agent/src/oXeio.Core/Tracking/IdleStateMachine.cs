using oXeio.Core.Models;
using oXeio.Core.Time;

namespace oXeio.Core.Tracking;

/// <summary>
/// ⭐ সিস্টেমের হৃদয় — পুরো নিয়মটা এখানেই।
///
/// <code>
/// কি-বোর্ড/মাউস ব্যবহার হচ্ছে?  →  হ্যাঁ: ⏱ গোনা হচ্ছে  ·  না (৬০ সে.): ⏸ hold
/// </code>
///
/// ইচ্ছাকৃতভাবে <b>প্ল্যাটফর্ম-মুক্ত</b>: এখানে কোনো Win32 কল নেই। বাইরে থেকে
/// শুধু "এখন কটা বাজে", "শেষ ইনপুট কতক্ষণ আগে", "লক করা আছে কি না" — এই তিনটে
/// তথ্য দিলেই চলে। ফলে পুরো নিয়মটা ইউনিট টেস্টে যাচাই করা যায়, আর CI-তে
/// Linux-এও চলে (আসল <c>GetLastInputInfo</c> থাকে oXeio.Agent-এ)।
/// </summary>
public sealed class IdleStateMachine
{
    /// <summary>এর চেয়ে কম সময় আগে ইনপুট এলে ওই সেকেন্ডটা "সক্রিয়" ধরা হয় (input score)।</summary>
    private static readonly TimeSpan RecentInput = TimeSpan.FromSeconds(2);

    /// <summary>
    /// ⭐ একটা সেগমেন্ট সর্বোচ্চ এতক্ষণ খোলা থাকতে পারে।
    ///
    /// <b>কেন দরকার:</b> সেগমেন্ট বন্ধ হয় কেবল স্টেট বদলালে। কেউ টানা কাজ
    /// করলে (বা ভিডিও দেখতে দেখতে মাউস নাড়তে থাকলে) একটাই ACTIVE সেগমেন্ট
    /// ঘণ্টার পর ঘণ্টা খোলা থাকত, আর <b>কিউয়ে কিছুই যেত না</b>।
    ///
    /// তারপর বিদ্যুৎ গেলে বা PC ক্র্যাশ করলে ওই পুরো সময়টা হারাত — কারণ
    /// <see cref="CloseAll"/> কেবল স্বাভাবিকভাবে বন্ধ হওয়ার সময় চলে।
    /// আসল মেশিনে চালিয়ে দেখা গেছে: ৩ মিনিট টানা কাজে সার্ভারে শূন্য সেগমেন্ট।
    ///
    /// ৫ মিনিট বেছে নেওয়ার কারণ স্ক্রিনশটের স্লটও ৫ মিনিট — দুটো একই ছন্দে
    /// চলে, আর ক্র্যাশে হারানোর সর্বোচ্চ পরিমাণ ৫ মিনিটে বাঁধা পড়ে।
    /// </summary>
    public static readonly TimeSpan MaxSegmentLength = TimeSpan.FromMinutes(5);

    private readonly TimeSpan _idleThreshold;
    private readonly TimeSpan _maxSegment;
    private readonly Func<Guid> _newUuid;

    private SegmentState _state;
    private DateTimeOffset _openedAt;
    private int _samples;
    private int _activeSamples;

    public IdleStateMachine(
        TimeSpan idleThreshold,
        DateTimeOffset startedAt,
        SegmentState initial = SegmentState.Active,
        Func<Guid>? newUuid = null,
        TimeSpan? maxSegment = null)
    {
        if (idleThreshold <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(idleThreshold));

        _idleThreshold = idleThreshold;
        _maxSegment = maxSegment ?? MaxSegmentLength;

        if (_maxSegment <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(maxSegment));

        _openedAt = startedAt;
        _state = initial;
        _newUuid = newUuid ?? Guid.NewGuid;
    }

    public SegmentState State => _state;
    public DateTimeOffset OpenedAt => _openedAt;

    /// <summary>প্রতি ১ সেকেন্ডে ডাকা হয়।</summary>
    /// <param name="now">monotonic ঘড়ির সময় (<see cref="MonotonicClock"/>)।</param>
    /// <param name="sinceLastInput">শেষ কি-বোর্ড/মাউস ইনপুটের পর কত সময় গেছে।</param>
    /// <param name="locked">স্ক্রিন লক করা আছে কি না (Win+L)।</param>
    /// <param name="screenFrozen">
    /// ⭐⭐ <b>G46</b> — পর্দা অনেকক্ষণ এক চুলও বদলায়নি
    /// (<see cref="ScreenActivity"/>)। ইনপুট টাইমার "সচল" বললেও এটা সত্যি
    /// হলে সময় গোনা হয় না।
    ///
    /// ⚠️⚠️ ঘরটা <b>ঐচ্ছিক নয়</b> — ইচ্ছাকৃত। ডিফল্ট থাকলে কেউ একদিন
    /// নতুন কলার লিখে ঘরটা দিতে ভুলে যেত, আর পাহারাটা <b>নীরবে</b> বন্ধ
    /// হয়ে থাকত। এই প্রকল্পে "চুক্তি লেখা আছে, কলার লেখা হয়নি" ভুলটা
    /// নয়বার ঘটেছে; কম্পাইলারকে পাহারায় বসানোই একমাত্র সত্যিকারের প্রতিকার।
    /// </param>
    /// <returns>এই টিকে যেসব সেগমেন্ট বন্ধ হলো।</returns>
    public IReadOnlyList<ActivitySegment> Tick(
        DateTimeOffset now,
        TimeSpan sinceLastInput,
        bool locked,
        bool screenFrozen)
    {
        var closed = new List<ActivitySegment>();

        // ১· মধ্যরাত পার হলে state না বদলেও রেকর্ড ভাগ হয় (§ ২.১-ক)
        SplitAtMidnights(closed, now);

        // ২· অনেকক্ষণ একই স্টেটে থাকলেও ভাগ — নইলে টানা কাজের সময়টুকু
        //    কিউয়ে না গিয়ে মেমরিতে খোলা থাকত, আর ক্র্যাশে হারাত।
        SplitLongSegments(closed, now);

        if (locked)
        {
            if (_state != SegmentState.Locked) Transition(closed, SegmentState.Locked, now);
            return closed;
        }

        /**
         * ⭐⭐ <b>G46 — নকল ইনপুট।</b> পর্দা জমে থাকলে ইনপুট টাইমারকে আর
         * বিশ্বাস করা হয় না।
         *
         * ⚠️ এটা <b>idle-এর শর্তের সাথেই</b> মেলানো হয়েছে, আলাদা কোনো
         * state বানানো হয়নি। কারণ ফলটা এক: সময়টা কাজের হিসাবে যাবে না।
         * নতুন state বানালে সার্ভার, পর্দা, রিপোর্ট — সবখানে একটা করে
         * নতুন ঘর যোগ করতে হতো, আর কোথাও না কোথাও বাদ পড়ত।
         *
         * ⚠️⚠️ কিন্তু retro-adjust <b>করা হয় না</b> এখানে। পর্দা জমেছে
         * বলে ধরা পড়ল এখন, অথচ জমে ছিল দশ মিনিট ধরে — ওই দশ মিনিট
         * পিছিয়ে কেটে দিলে সৎ কর্মীর পড়ার সময়টাও কেটে যেত। তাই কাটা
         * শুরু হয় <b>এখন থেকে</b>, আগেরটুকু ছেড়ে দেওয়া হয়। ⭐ ভুল করলে
         * কর্মীর পক্ষে ভুল করাই নিয়ম (ADR-023-এর একই যুক্তি)।
         */
        var untrusted = sinceLastInput >= _idleThreshold || screenFrozen;

        if (untrusted)
        {
            if (_state == SegmentState.Active)
            {
                // ⭐ retro-adjust (B04): idle আসলে শুরু হয়েছিল threshold-টা আগেই।
                // তাই ওই সময়টুকুও কাজের হিসাব থেকে বাদ — এক সেকেন্ড বেশিও নয়, কমও নয়।
                //
                // ⚠️ শুধু **আসল** idle-এ। পর্দা জমার কারণে হলে পিছিয়ে কাটা
                //    হয় না — উপরের মন্তব্য দেখুন।
                var startedIdleAt = sinceLastInput >= _idleThreshold
                    ? now - _idleThreshold
                    : now;
                if (startedIdleAt < _openedAt) startedIdleAt = _openedAt;
                Transition(closed, SegmentState.Idle, startedIdleAt);
            }
            else if (_state == SegmentState.Locked)
            {
                // আনলক হয়েছে, কিন্তু এখনো কেউ কিছু ছোঁয়নি — LOCKED থেকে সরাসরি IDLE।
                // এখানে retro-adjust নয়: লক থাকা সময়টা এমনিতেই গোনা হয়নি।
                Transition(closed, SegmentState.Idle, now);
            }
        }
        else if (_state != SegmentState.Active)
        {
            // ইনপুট পেলেই সাথে সাথে (B03) — কোনো অপেক্ষা নেই
            Transition(closed, SegmentState.Active, now);
        }

        if (_state == SegmentState.Active)
        {
            _samples++;
            if (sinceLastInput < RecentInput) _activeSamples++;
        }

        return closed;
    }

    /// <summary>
    /// PC ঘুমাতে যাচ্ছে (G3)। খোলা সেগমেন্ট এখানেই বন্ধ — নইলে জেগে ওঠার পর
    /// ঘুমিয়ে থাকা পুরো সময়টা কাজ হিসেবে যোগ হয়ে যেত।
    /// </summary>
    public IReadOnlyList<ActivitySegment> OnSuspend(DateTimeOffset at)
    {
        var closed = new List<ActivitySegment>();
        Transition(closed, SegmentState.Locked, at);
        return closed;
    }

    /// <summary>জেগে উঠল। ইনপুট না আসা পর্যন্ত IDLE, তাই ঘুমের সময় গোনা হয় না।</summary>
    public IReadOnlyList<ActivitySegment> OnResume(DateTimeOffset at)
    {
        var closed = new List<ActivitySegment>();
        // ঘুমের সময়টুকু LOCKED হিসেবে বন্ধ করে, নতুন দিন শুরু (মধ্যরাত পেরোলে ভাগ হবে)
        EmitAndReopen(closed, SegmentState.Idle, at);
        return closed;
    }

    /// <summary>logoff / shutdown / এজেন্ট বন্ধ — শেষ সেগমেন্টটা বন্ধ করে দাও।</summary>
    public IReadOnlyList<ActivitySegment> CloseAll(DateTimeOffset at)
    {
        var closed = new List<ActivitySegment>();
        EmitSegment(closed, _state, _openedAt, at);
        _openedAt = at;
        ResetScore();
        return closed;
    }

    // ── ভেতরের কাজ ──────────────────────────────────────────────────────────

    private void Transition(List<ActivitySegment> closed, SegmentState next, DateTimeOffset at)
    {
        if (next == _state) return;
        EmitAndReopen(closed, next, at);
    }

    private void EmitAndReopen(List<ActivitySegment> closed, SegmentState next, DateTimeOffset at)
    {
        if (at < _openedAt) at = _openedAt;

        EmitSegment(closed, _state, _openedAt, at);
        _state = next;
        _openedAt = at;
        ResetScore();
    }

    /// <summary>
    /// খোলা সেগমেন্ট <see cref="MaxSegmentLength"/> পেরোলে সেখানেই কেটে
    /// নতুন করে খোলা। স্টেট বদলায় না — শুধু রেকর্ডটা টেকসই হয়।
    ///
    /// ⚠️ <b>শেষ <c>idleThreshold</c> সময়টুকু কখনো বন্ধ করা হয় না।</b>
    ///
    /// কারণ retro-adjust (B04): ACTIVE থেকে IDLE-এ যাওয়ার সময় শেষ ৬০ সেকেন্ড
    /// কাজের হিসাব থেকে <b>বাদ</b> দিতে হয়। ওই ৬০ সেকেন্ড যদি ইতিমধ্যে
    /// আলাদা সেগমেন্ট হিসেবে বেরিয়ে গিয়ে থাকে, তখন আর পিছিয়ে গিয়ে কাটা
    /// যায় না — আর নিষ্ক্রিয় সময়টা নীরবে <b>কাজ হিসেবে গোনা</b> হয়ে যায়।
    ///
    /// তাই ভাগ করার সীমানা সবসময় <c>now − idleThreshold</c>-এর আগে রাখা হয়।
    /// এতে সেগমেন্ট ~৬০ সেকেন্ড দেরিতে বের হয়, যেটা কোনো সমস্যা নয়।
    /// </summary>
    private void SplitLongSegments(List<ActivitySegment> closed, DateTimeOffset now)
    {
        var horizon = now - _idleThreshold;

        while (_openedAt + _maxSegment <= horizon)
        {
            var boundary = _openedAt + _maxSegment;
            EmitSegment(closed, _state, _openedAt, boundary);
            _openedAt = boundary;
            ResetScore();
        }
    }

    /// <summary>খোলা সেগমেন্ট মধ্যরাত পেরিয়ে গেলে সেখানেই কেটে নতুন করে খোলা হয়।</summary>
    private void SplitAtMidnights(List<ActivitySegment> closed, DateTimeOffset now)
    {
        var boundary = DhakaTime.NextLocalMidnight(_openedAt);
        while (boundary <= now)
        {
            EmitSegment(closed, _state, _openedAt, boundary);
            _openedAt = boundary;
            ResetScore();
            boundary = DhakaTime.NextLocalMidnight(_openedAt);
        }
    }

    /// <summary>
    /// রক্ষাকবচ হিসেবে এখানেও মধ্যরাতে ভাগ করা হয় — কোনো সেগমেন্ট যেন
    /// কখনো দুই work_date জুড়ে না থাকে।
    /// </summary>
    private void EmitSegment(
        List<ActivitySegment> closed,
        SegmentState state,
        DateTimeOffset from,
        DateTimeOffset to)
    {
        if (to <= from) return;

        var score = ScoreFor(state);
        var cursor = from;

        while (cursor < to)
        {
            var boundary = DhakaTime.NextLocalMidnight(cursor);
            var end = boundary < to ? boundary : to;

            closed.Add(new ActivitySegment
            {
                ClientUuid = _newUuid(),
                State = state,
                StartedAt = cursor,
                EndedAt = end,
                DurationSec = (int)Math.Round((end - cursor).TotalSeconds),
                InputScore = score,
            });

            cursor = end;
        }
    }

    /// <summary>০–১০০। কতটা ব্যস্ত ছিল, কী লিখেছে তা নয় (B13)।</summary>
    private int? ScoreFor(SegmentState state)
    {
        if (state != SegmentState.Active || _samples == 0) return null;
        return (int)Math.Round(100.0 * _activeSamples / _samples);
    }

    private void ResetScore()
    {
        _samples = 0;
        _activeSamples = 0;
    }
}
