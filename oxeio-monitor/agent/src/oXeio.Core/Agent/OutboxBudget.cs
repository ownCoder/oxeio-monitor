namespace oXeio.Core.Agent;

/// <summary>
/// <see cref="OutboxBudget.Plan"/>-এর ফল। দুটো তালিকা আলাদা রাখা হয়েছে যাতে
/// লগে "পুরোনো হয়ে বাদ" আর "জায়গা নেই বলে বাদ" আলাদা করে লেখা যায় — দ্বিতীয়টা
/// দেখা গেলেই বোঝা যায় ডিস্কের বাজেট বা রিটেনশন বদলানো দরকার।
/// </summary>
public sealed record EvictionPlan
{
    /// <summary>বয়সের নিয়মে বাদ।</summary>
    public required IReadOnlyList<long> ExpiredRowIds { get; init; }

    /// <summary>ডিস্কের ক্যাপ ছাড়ানোয় বাদ।</summary>
    public required IReadOnlyList<long> OverBudgetRowIds { get; init; }

    /// <summary>দুটো মিলিয়ে — <see cref="IOutboxStore.EvictAsync"/>-এ এটাই যায়।</summary>
    public required IReadOnlyList<long> RowIds { get; init; }

    public required long BytesBefore { get; init; }
    public required long BytesFreed { get; init; }

    public long BytesAfter => BytesBefore - BytesFreed;

    public bool IsEmpty => RowIds.Count == 0;

    public static EvictionPlan Nothing(long bytesBefore) => new()
    {
        ExpiredRowIds = [],
        OverBudgetRowIds = [],
        RowIds = [],
        BytesBefore = bytesBefore,
        BytesFreed = 0,
    };
}

/// <summary>
/// ⭐ ডিস্ক ভরে গেলে কী ফেলে দেওয়া হবে — বিশুদ্ধ নীতি, কোনো I/O নেই।
///
/// <b>ক্রমটাই আসল কথা:</b> স্ক্রিনশট → app-usage → event → segment।
///
/// <code>
/// স্ক্রিনশট : ~২০০ KB × ২৮৮ স্লট × ৩ মনিটর ≈ দিনে ১৭০ MB   ← আয়তনের ৯৯%
/// segment   : ~২০০ বাইট × দিনে কয়েকশো        ≈ দিনে ১০০ KB   ← পে-রোল
/// </code>
///
/// অর্থাৎ একটা স্ক্রিনশট ফেলে দিলে হাজারখানেক সেগমেন্টের সমান জায়গা খালি হয়।
/// একটা সেগমেন্ট ফেলে দিলে জায়গা প্রায় কিছুই খালি হয় না, কিন্তু কারো বেতনের
/// ঘণ্টা চিরতরে হারায়। তাই segment <b>সবার শেষে</b>, আর বাস্তবে তার পালা কখনো
/// আসে না — সেটাই ইচ্ছাকৃত নকশা, দুর্ঘটনা নয়।
///
/// ⚠️ ধার নেওয়া (leased) সারি কখনো বাদ যায় না — ওগুলো এই মুহূর্তে আপলোড হচ্ছে,
/// আর নিচ থেকে ফাইল সরিয়ে নিলে আপলোডটা মাঝপথে ভেঙে পড়ত।
/// </summary>
public sealed record OutboxBudget
{
    public OutboxBudget(long capBytes, long targetBytes, TimeSpan maxAge, TimeSpan segmentMaxAge)
    {
        if (capBytes <= 0) throw new ArgumentOutOfRangeException(nameof(capBytes));
        if (targetBytes <= 0 || targetBytes > capBytes)
            throw new ArgumentOutOfRangeException(nameof(targetBytes));
        if (maxAge <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(maxAge));
        if (segmentMaxAge < maxAge) throw new ArgumentOutOfRangeException(nameof(segmentMaxAge));

        CapBytes = capBytes;
        TargetBytes = targetBytes;
        MaxAge = maxAge;
        SegmentMaxAge = segmentMaxAge;
    }

    /// <summary>এর ওপরে গেলে ছাঁটাই শুরু।</summary>
    public long CapBytes { get; }

    /// <summary>
    /// ছাঁটাই করে এখানে নামানো হয়। ক্যাপের চেয়ে কম রাখা হয়েছে হিস্টেরেসিসের জন্য —
    /// ঠিক ক্যাপে থামলে পরের প্রতিটা স্ক্রিনশটেই আবার একটা করে ছাঁটাই চলত।
    /// </summary>
    public long TargetBytes { get; }

    /// <summary>স্ক্রিনশট / app-usage / event কতদিন পর অকেজো।</summary>
    public TimeSpan MaxAge { get; }

    /// <summary>
    /// সেগমেন্টের আলাদা, অনেক লম্বা মেয়াদ। ⚠️ এক করে ফেলবেন না —
    /// দুই সপ্তাহের লাইন-বিভ্রাটে পুরো পাক্ষিকের বেতন মুছে যেত।
    /// </summary>
    public TimeSpan SegmentMaxAge { get; }

    /// <summary>
    /// ২ GiB ক্যাপ, ১.৫ GiB লক্ষ্য, ৭ দিন, সেগমেন্টে ৩০ দিন।
    ///
    /// ২ GiB কেন: দিনে ~১৭০ MB × ৭ দিন ≈ ১.২ GB, অর্থাৎ ডকের বলা সাত দিনের
    /// অফলাইন সহনশীলতা পুরোটাই ধরে, তবু অফিস-PC-র ডিস্কে টের পাওয়ার মতো নয়।
    /// </summary>
    public static OutboxBudget Default { get; } = new(
        capBytes: 2L * 1024 * 1024 * 1024,
        targetBytes: 1536L * 1024 * 1024,
        maxAge: TimeSpan.FromDays(7),
        segmentMaxAge: TimeSpan.FromDays(30));

    /// <summary>
    /// স্ক্রিনশট আগে, সেগমেন্ট শেষে। ⚠️ <see cref="OutboundKind"/>-এর enum-ক্রমের
    /// ওপর নির্ভর করা হয়নি — সেখানে একটা সদস্য সরালেই নীরবে বেতনের ডেটা
    /// সবার আগে মুছতে শুরু করত।
    /// </summary>
    public static int EvictionRank(OutboundKind kind) => kind switch
    {
        OutboundKind.Screenshot => 0,
        OutboundKind.AppUsage => 1,
        OutboundKind.Event => 2,
        OutboundKind.Segment => 3,
        _ => 3,
    };

    /// <param name="entries">
    /// পুরো আউটবক্সের জরিপ (<see cref="IOutboxStore.SurveyAsync"/>)। অংশবিশেষ দিলে
    /// মোট বাইটের হিসাব কম হবে আর ছাঁটাই কম হবে।
    /// </param>
    public EvictionPlan Plan(IReadOnlyList<OutboxEntryInfo> entries, DateTimeOffset now)
    {
        var bytesBefore = 0L;
        foreach (var e in entries) bytesBefore += e.SizeBytes;

        if (entries.Count == 0) return EvictionPlan.Nothing(bytesBefore);

        var expired = new List<long>();
        var survivors = new List<OutboxEntryInfo>(entries.Count);
        var freed = 0L;

        foreach (var e in entries)
        {
            if (e.Leased)
            {
                survivors.Add(e);
                continue;
            }

            var limit = e.Kind == OutboundKind.Segment ? SegmentMaxAge : MaxAge;
            if (now - e.EnqueuedAt > limit)
            {
                expired.Add(e.RowId);
                freed += e.SizeBytes;
            }
            else
            {
                survivors.Add(e);
            }
        }

        var overBudget = new List<long>();
        var remaining = bytesBefore - freed;

        if (remaining > CapBytes)
        {
            // ধার নেওয়াগুলো বাদ, তারপর "সবচেয়ে কম দামি আগে, তার মধ্যে পুরোনো আগে"
            var candidates = survivors
                .Where(x => !x.Leased)
                .OrderBy(x => EvictionRank(x.Kind))
                .ThenBy(x => x.EnqueuedAt)
                .ThenBy(x => x.RowId);

            foreach (var e in candidates)
            {
                if (remaining <= TargetBytes) break;

                overBudget.Add(e.RowId);
                freed += e.SizeBytes;
                remaining -= e.SizeBytes;
            }
        }

        if (expired.Count == 0 && overBudget.Count == 0)
            return EvictionPlan.Nothing(bytesBefore);

        var all = new List<long>(expired.Count + overBudget.Count);
        all.AddRange(expired);
        all.AddRange(overBudget);

        return new EvictionPlan
        {
            ExpiredRowIds = expired,
            OverBudgetRowIds = overBudget,
            RowIds = all,
            BytesBefore = bytesBefore,
            BytesFreed = freed,
        };
    }
}
