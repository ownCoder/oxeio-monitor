using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Sync;

/// <summary>
/// তারে যা যায় ঠিক তার আকৃতি — Core-এর রেকর্ডগুলো সরাসরি সিরিয়ালাইজ করা হয় না।
///
/// ⭐⚠️ <b>কেন এই বাড়তি স্তর:</b> System.Text.Json <b>সব</b> public getter লেখে,
/// computed প্রপার্টিসহ। <see cref="ActivitySegment"/>-এ আছে
/// <see cref="ActivitySegment.WorkDate"/> আর <see cref="ActivitySegment.CountsAsWork"/> —
/// সরাসরি পাঠালে JSON-এ <c>workDate</c> ও <c>countsAsWork</c>ও চলে যেত। NestJS-এ
/// <c>forbidNonWhitelisted</c> চালু থাকলে অচেনা ফিল্ড মানেই ৪০০, আর ৪০০ মানে
/// <see cref="SyncOutcome.Permanent"/> — অর্থাৎ ৫০০টা সেগমেন্ট চিরতরে মুছে যেত।
/// কেউ Core-এ একটা নিরীহ computed প্রপার্টি যোগ করলেই সেটা ঘটত, আর কোথাও
/// কোনো কম্পাইলার সতর্কবার্তা থাকত না।
///
/// তাই নিয়ম: <b>সার্ভারে যা পাঠানো হয় তার প্রতিটা ফিল্ড এখানে হাতে লেখা।</b>
/// (উল্টো দিকে, অর্থাৎ পড়ার সময়, Core-এর রেকর্ডে সরাসরি deserialize করা নিরাপদ —
/// অচেনা ফিল্ড STJ এমনিতেই বাদ দেয়।)
/// </summary>
internal static class SyncWire
{
    private static readonly char[] PathStarters = ['/', '?', '#'];

    // ── segments ────────────────────────────────────────────────────────────

    internal sealed record SegmentsEnvelope
    {
        public required IReadOnlyList<SegmentDto> Segments { get; init; }
    }

    internal sealed record SegmentDto
    {
        public required Guid ClientUuid { get; init; }
        public required string State { get; init; }
        public required DateTimeOffset StartedAt { get; init; }
        public required DateTimeOffset EndedAt { get; init; }
        public required int DurationSec { get; init; }
        public int? InputScore { get; init; }
    }

    internal static SegmentsEnvelope Segments(IReadOnlyList<ActivitySegment> segments)
    {
        var list = new List<SegmentDto>(segments.Count);
        foreach (var s in segments)
        {
            list.Add(new SegmentDto
            {
                ClientUuid = s.ClientUuid,
                State = StateToWire(s.State),
                StartedAt = s.StartedAt,
                EndedAt = s.EndedAt,
                DurationSec = s.DurationSec,
                InputScore = s.InputScore,
            });
        }

        return new SegmentsEnvelope { Segments = list };
    }

    /// <summary>
    /// ⚠️ <b>সার্ভারের enum ছোট হাতের অক্ষরে</b> — <c>active / idle / locked</c>।
    /// দেখুন <c>server/prisma/schema.prisma</c>-র <c>enum SegmentState</c>;
    /// Postgres enum আর <c>@IsEnum()</c> দুটোই case-sensitive।
    ///
    /// C#-এর <c>SegmentState.Active</c> সরাসরি পাঠালে <c>"Active"</c> যেত, আর
    /// বড় হাতে <c>"ACTIVE"</c> পাঠালেও একই ফল: <b>৪০০</b>। আর ৪০০ মানে
    /// <see cref="SyncOutcome.Permanent"/> — অর্থাৎ ব্যাচটা রিট্রাই না হয়ে
    /// <b>মুছে</b> যেত। একটা অক্ষরের ভুলে মাসের পে-রোল ডেটা হারাত।
    ///
    /// রূপান্তরটা এই একটাই জায়গায় — segments আর heartbeat দুটোই এখান থেকে নেয়।
    /// </summary>
    internal static string StateToWire(SegmentState state) => state switch
    {
        SegmentState.Active => "active",
        SegmentState.Idle => "idle",
        SegmentState.Locked => "locked",

        // ⚠️ অজানা স্টেটে ডিফল্ট বসানো হয় না। আগে এখানে "ACTIVE" ফিরত —
        //    অর্থাৎ নতুন কোনো স্টেট যোগ হলে সেটা নীরবে **কাজের সময়** হিসেবে
        //    গোনা হতো। সার্ভারে ভুল ডেটা পাঠানোর চেয়ে এখানেই থেমে যাওয়া ভালো।
        _ => throw new ArgumentOutOfRangeException(
            nameof(state), state, "No server representation is defined for this state"),
    };

    // ── app usage ───────────────────────────────────────────────────────────

    internal sealed record AppUsageEnvelope
    {
        public required IReadOnlyList<AppUsageDto> Items { get; init; }
    }

    internal sealed record AppUsageDto
    {
        public required Guid ClientUuid { get; init; }
        public required DateTimeOffset StartedAt { get; init; }
        public required DateTimeOffset EndedAt { get; init; }
        public required int DurationSec { get; init; }
        public required string ProcessName { get; init; }
        public string? AppName { get; init; }
        public string? WindowTitle { get; init; }
        public string? Domain { get; init; }
        public bool? IsBrowser { get; init; }

        /**
         * ⭐ <b>R22a</b> — খণ্ডটা কোন অবস্থায় দেখা হয়েছে (`active` / `idle`)।
         *
         * ⚠️ ছোট হাতের স্ট্রিং, কারণ সার্ভারের enum-ও তাই (`SegmentState`)।
         *    `.ToString()` দিলে `Active` যেত আর `@IsEnum` ৪০০ দিত — আর ৪০০
         *    মানে Permanent, অর্থাৎ পুরো ব্যাচটা মুছে ফেলা হতো (G49)।
         */
        public required string State { get; init; }
    }

    internal static AppUsageEnvelope AppUsage(IReadOnlyList<AppUsageRecord> items)
    {
        var list = new List<AppUsageDto>(items.Count);
        foreach (var i in items)
        {
            list.Add(new AppUsageDto
            {
                ClientUuid = i.ClientUuid,
                StartedAt = i.StartedAt,
                EndedAt = i.EndedAt,
                DurationSec = i.DurationSec,
                // ⚠️ সার্ভারের @MaxLength ছাড়ালে পুরো ব্যাচ ৪০০ খায়, আর ৪০০ মানে
                //    Permanent — ডেটা মুছে ফেলা হয় (G49)। তাই দৈর্ঘ্য এখানেই বাঁধা।
                ProcessName = Clamp(i.ProcessName, 260)!,
                AppName = Clamp(i.AppName, 260),
                WindowTitle = Clamp(i.WindowTitle, 1000),
                Domain = Clamp(DomainOnly(i.Domain), 260),
                IsBrowser = i.IsBrowser,
                State = i.State.ToString().ToLowerInvariant(),
            });
        }

        return new AppUsageEnvelope { Items = list };
    }

    /// <summary>
    /// সার্ভারের সীমার মধ্যে ছাঁটা।
    ///
    /// ⚠️ এই স্ট্রিংগুলোর কোনোটাই আমাদের লেখা নয় — <c>appName</c> আসে
    /// এক্সিকিউটেবলের version resource থেকে, <c>domain</c> আসে address bar থেকে।
    /// যেকোনো লম্বা মান ঢুকতে পারে, আর একটা লম্বা মান পুরো ব্যাচকে ৪০০ করিয়ে
    /// দিত। ছাঁটা তথ্য অসম্পূর্ণ, কিন্তু হারানো তথ্যের চেয়ে ভালো।
    /// </summary>
    private static string? Clamp(string? value, int max) =>
        value is null || value.Length <= max ? value : value[..max];

    /// <summary>
    /// ⭐ শেষ প্রহরী: পুরো URL কখনোই নেটওয়ার্কে ওঠে না — শুধু ডোমেইন।
    ///
    /// ব্রাউজার টাইটেল/URL থেকে ডোমেইন বের করার কাজ app-tracking মডিউলের, কিন্তু
    /// এই নিষেধটা (পুরো URL জমা রাখা যাবে না) সিস্টেমের একটা <b>কঠিন</b> নিয়ম।
    /// একটা মডিউলের বাগে <c>https://bank.com/account/12345?token=…</c> চলে এলে সেটা
    /// সার্ভারের ডেটাবেসে বসে যেত আর ফেরানোর উপায় থাকত না। তাই দরজার মুখেই ছাঁটা হয়,
    /// এমনকি "এমনটা হওয়ার কথা নয়" জেনেও।
    /// </summary>
    internal static string? DomainOnly(string? domain)
    {
        if (string.IsNullOrWhiteSpace(domain)) return null;

        var value = domain.Trim();

        var scheme = value.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) value = value[(scheme + 3)..];

        var path = value.IndexOfAny(PathStarters);
        if (path >= 0) value = value[..path];

        // user:pass@host — credential যেন কোনোভাবেই না যায়
        var at = value.LastIndexOf('@');
        if (at >= 0) value = value[(at + 1)..];

        // পোর্ট ছাঁটা, কিন্তু IPv6 ([::1]) হাতে না দিয়ে — একাধিক ':' থাকলে ছোঁয়া হয় না
        var colon = value.LastIndexOf(':');
        if (colon > 0 && value.IndexOf(':') == colon) value = value[..colon];

        value = value.Trim().TrimEnd('.');

        return value.Length == 0 ? null : value.ToLowerInvariant();
    }

    // ── events ──────────────────────────────────────────────────────────────

    internal sealed record EventsEnvelope
    {
        public required IReadOnlyList<EventDto> Events { get; init; }
    }

    internal sealed record EventDto
    {
        public required Guid ClientUuid { get; init; }
        public required string Type { get; init; }
        public required DateTimeOffset OccurredAt { get; init; }
        public IReadOnlyDictionary<string, object?>? Meta { get; init; }
    }

    internal static EventsEnvelope Events(IReadOnlyList<AgentEventRecord> events)
    {
        var list = new List<EventDto>(events.Count);
        foreach (var e in events)
        {
            list.Add(new EventDto
            {
                ClientUuid = e.ClientUuid,
                Type = e.Type,
                OccurredAt = e.OccurredAt,

                // খালি ডিকশনারি পাঠানোর মানে নেই; null হলে ফিল্ডটাই বাদ যাবে
                Meta = e.Meta is { Count: > 0 } ? e.Meta : null,
            });
        }

        return new EventsEnvelope { Events = list };
    }

    // ── heartbeat / enroll ──────────────────────────────────────────────────

    internal sealed record HeartbeatDto
    {
        public required string State { get; init; }
        public required int ActiveSecToday { get; init; }
        public int? QueueDepth { get; init; }
        public string? ConfigVersion { get; init; }
        public string? AgentVersion { get; init; }
    }

    internal static HeartbeatDto Heartbeat(HeartbeatRequest request) => new()
    {
        State = StateToWire(request.State),

        // ⚠️ ০–৮৬৪০০-র বাইরে হলে সার্ভার ৪০০ দেয়। heartbeat-এর ৪০০ কোনো ডেটা
        //    মোছে না, কিন্তু তখন কমান্ডও আসে না — অর্থাৎ revoke পৌঁছাত না।
        //    তাই সন্দেহজনক মানকে এখানেই সীমার ভেতরে বসানো হয়।
        ActiveSecToday = Math.Clamp(request.ActiveSecToday, 0, 86_400),

        QueueDepth = request.QueueDepth is { } d ? Math.Max(0, d) : null,
        ConfigVersion = request.ConfigVersion,
        AgentVersion = request.AgentVersion,
    };

    internal sealed record EnrollDto
    {
        public required string EnrollmentCode { get; init; }
        public required string Hostname { get; init; }
        public required string WindowsUsername { get; init; }
        public required string MachineGuid { get; init; }
        public string? OsVersion { get; init; }
        public string? AgentVersion { get; init; }
        public int? Monitors { get; init; }
    }

    internal static EnrollDto Enroll(EnrollRequest request) => new()
    {
        EnrollmentCode = request.EnrollmentCode,
        Hostname = request.Hostname,
        WindowsUsername = request.WindowsUsername,
        MachineGuid = request.MachineGuid,
        OsVersion = request.OsVersion,
        AgentVersion = request.AgentVersion,
        Monitors = request.Monitors,
    };

    /// <summary>
    /// ⚠️ সার্ভারের `EnrollLoginDto`-র ঘরগুলোই — নাম বা আকার বদলালে
    /// দু-পাশে একসাথে বদলাতে হবে।
    /// </summary>
    internal sealed record EnrollLoginDto
    {
        public required string Email { get; init; }
        public required string Password { get; init; }
        public string? Totp { get; init; }
        public required string Hostname { get; init; }
        public required string WindowsUsername { get; init; }
        public required string MachineGuid { get; init; }
        public string? OsVersion { get; init; }
        public string? AgentVersion { get; init; }
        public int? Monitors { get; init; }
    }

    internal static EnrollLoginDto EnrollLogin(EnrollLoginRequest request) => new()
    {
        // ⚠️ ইমেইলের সামনে-পিছনে ফাঁকা জায়গা কেটে দেওয়া হয়: মানুষ কপি-পেস্ট
        //    করলে প্রায়ই একটা স্পেস চলে আসে, আর সার্ভারে সেটা "অচেনা ইমেইল"
        //    হয়ে ৪০১ দিত — স্টাফ তখন পাসওয়ার্ড নিয়ে সন্দেহ করত।
        Email = request.Email.Trim(),
        // ⚠️ পাসওয়ার্ড **Trim করা হয় না** — শেষের স্পেসও পাসওয়ার্ডের অংশ
        Password = request.Password,
        Totp = string.IsNullOrWhiteSpace(request.Totp) ? null : request.Totp.Trim(),
        Hostname = request.Hostname,
        WindowsUsername = request.WindowsUsername,
        MachineGuid = request.MachineGuid,
        OsVersion = request.OsVersion,
        AgentVersion = request.AgentVersion,
        Monitors = request.Monitors,
    };

    // ── screenshot meta ─────────────────────────────────────────────────────

    /// <summary>
    /// multipart-এর <c>meta</c> অংশ। ⚠️ এটা JSON <b>স্ট্রিং</b> হয়ে যায়,
    /// JSON অবজেক্ট হয়ে নয় — <see cref="HttpSyncClient.SendScreenshotAsync"/> দেখুন।
    /// </summary>
    internal sealed record ScreenshotMetaDto
    {
        public required Guid ClientUuid { get; init; }
        public required DateTimeOffset SlotStart { get; init; }
        public required DateTimeOffset CapturedAt { get; init; }
        public required int MonitorIndex { get; init; }
        public int? Width { get; init; }
        public int? Height { get; init; }
        public string? ActiveApp { get; init; }
        public string? ActiveTitle { get; init; }
    }

    internal static ScreenshotMetaDto ScreenshotMeta(ScreenshotRecord meta) => new()
    {
        ClientUuid = meta.ClientUuid,
        SlotStart = meta.SlotStart,
        CapturedAt = meta.CapturedAt,
        MonitorIndex = meta.MonitorIndex,
        Width = meta.Width,
        Height = meta.Height,

        // ⚠️ app usage-এর মতোই দৈর্ঘ্য এখানেই বাঁধা (G60) — সার্ভারের সীমা
        //    `activeApp` ২৬০, `activeTitle` ১০০০। ছাড়ালে ৪০০, আর স্ক্রিনশটে
        //    ৪০০ মানে Permanent: ছবিটা কিউ থেকে **মুছে** যেত, অথচ দোষ ছিল
        //    কেবল একটা লম্বা উইন্ডো-টাইটেলের। নামটা আসে অন্য প্রোগ্রামের
        //    version resource থেকে — আমাদের হাতে নয়।
        ActiveApp = Clamp(meta.ActiveApp, 260),
        ActiveTitle = Clamp(meta.ActiveTitle, 1000),
    };

    // ── যা পড়া হয় ───────────────────────────────────────────────────────────

    /// <summary>
    /// heartbeat-এর উত্তর। কমান্ড তারে snake_case স্ট্রিং, C#-এ enum — তাই
    /// <see cref="HeartbeatResponse"/>-এ সরাসরি deserialize করা যায় না।
    /// অচেনা কমান্ড <see cref="AgentCommands.Parse"/>-এ null হয়ে বাদ পড়ে,
    /// ফলে ভবিষ্যতের সার্ভার নতুন কমান্ড পাঠালেও পুরোনো এজেন্ট ভাঙে না।
    /// </summary>
    internal sealed record HeartbeatResponseDto
    {
        public IReadOnlyList<string>? Commands { get; init; }
        public string? ConfigVersion { get; init; }

        /// <summary>
        /// ⚠️ <b>এই ফিল্ডটা ছিল না, আর সেটা নীরব বাগ ছিল।</b> সার্ভার
        /// (<c>agent.controller.ts</c>) প্রতিটা heartbeat-এর উত্তরে
        /// <c>progress</c> পাঠায়, কিন্তু DTO-তে ঘরটাই না থাকায় STJ সেটা
        /// চুপচাপ ফেলে দিত। ফলে <see cref="HeartbeatResponse.Progress"/>
        /// চিরকাল null, আর tray-তে "এ মাসে" চিরকাল <b>০ ঘণ্টা</b> —
        /// অথচ সার্ভারে সংখ্যাটা ঠিকই ছিল। J03/J04 দুটোই এর উপর দাঁড়িয়ে।
        /// </summary>
        public ProgressDto? Progress { get; init; }
    }

    /// <summary>
    /// ⚠️ <see cref="EmployeeProgress"/>-এ সরাসরি deserialize করা হয় না, যদিও
    /// এটা পড়ার দিক। ওই রেকর্ডের তিনটে সদস্য <c>required</c>, আর .NET ৭+ এ
    /// required সদস্য JSON-এ না থাকলে STJ <c>JsonException</c> ছোড়ে। সার্ভার
    /// একদিন একটা ফিল্ড ঐচ্ছিক করলেই তখন <b>পুরো heartbeat-এর উত্তর</b>
    /// (কমান্ড, revoke, configVersion সহ) পড়া যেত না — অগ্রগতির একটা ঘর হারানোর
    /// শাস্তি হতো ট্র্যাকিং কমান্ড হারানো। তাই তারের দিকে সব nullable।
    /// </summary>
    internal sealed record ProgressDto
    {
        public int? TodayActiveSec { get; init; }
        public int? MonthActiveSec { get; init; }
        public double? MonthlyTargetHours { get; init; }
        public int? PaceSec { get; init; }
        public int? DailyTargetSec { get; init; }
        public int? Week7ActiveSec { get; init; }
        public int? Week7TargetSec { get; init; }
    }

    internal static HeartbeatResponse ToHeartbeatResponse(HeartbeatResponseDto dto)
    {
        var commands = new List<AgentCommand>();
        if (dto.Commands is not null)
        {
            foreach (var wire in dto.Commands)
            {
                if (AgentCommands.Parse(wire) is { } command) commands.Add(command);
            }
        }

        return new HeartbeatResponse
        {
            Commands = commands,
            ConfigVersion = dto.ConfigVersion ?? string.Empty,
            Progress = ToProgress(dto.Progress),
        };
    }

    /// <summary>
    /// ডিভাইসের সাথে কর্মী যুক্ত না থাকলে সার্ভার <c>progress: null</c> পাঠায় —
    /// তখন null-ই ফেরে, শূন্য ভরা একটা অবজেক্ট নয়।
    ///
    /// ⚠️ <c>monthlyTargetHours ≤ 0</c> হলেও পুরোটা বাতিল। শূন্য টার্গেট নিয়ে
    /// <see cref="AgentStatus.MonthlyProgress"/> ০ ফেরত দেয়, অর্থাৎ যে মানুষ
    /// পুরো মাস কাজ করেছে তার প্রগ্রেস বার সারা মাস খালি দেখাত।
    /// </summary>
    private static EmployeeProgress? ToProgress(ProgressDto? dto)
    {
        if (dto is null) return null;
        if (dto.MonthlyTargetHours is not { } target || target <= 0) return null;

        return new EmployeeProgress
        {
            TodayActiveSec = Math.Max(0, dto.TodayActiveSec ?? 0),
            MonthActiveSec = Math.Max(0, dto.MonthActiveSec ?? 0),
            MonthlyTargetHours = target,
            PaceSec = dto.PaceSec,

            // ⚠️ এগুলো `Math.Max(0, …)` দিয়ে ঢাকা হয় **না** — null থাকা মানে
            //    "পুরোনো সার্ভার বলেনি", আর ০ মানে "আজ ছুটি"। শূন্যে নামিয়ে
            //    দিলে দুটো এক হয়ে যেত (দেখুন EmployeeProgress.DailyTargetSec)।
            DailyTargetSec = dto.DailyTargetSec is { } d && d >= 0 ? d : null,
            Week7ActiveSec = dto.Week7ActiveSec is { } a && a >= 0 ? a : null,
            Week7TargetSec = dto.Week7TargetSec is { } w && w >= 0 ? w : null,
        };
    }
}
