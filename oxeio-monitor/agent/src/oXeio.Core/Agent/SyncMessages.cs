using oXeio.Core.Models;

namespace oXeio.Core.Agent;

// ── enroll ──────────────────────────────────────────────────────────────────

/// <summary><c>POST /agent/enroll</c> — একমাত্র কল যাতে টোকেন লাগে না।</summary>
public sealed record EnrollRequest
{
    /// <summary>অ্যাডমিনের দেওয়া একবার-ব্যবহার্য কোড, ২৪ ঘণ্টায় মেয়াদ শেষ (H05)।</summary>
    public required string EnrollmentCode { get; init; }

    public required string Hostname { get; init; }
    public required string WindowsUsername { get; init; }

    /// <summary>হার্ডওয়্যার-ভিত্তিক স্থায়ী আইডি। সার্ভারে unique — একই মেশিন আবার enroll করলে চেনা যায়।</summary>
    public required string MachineGuid { get; init; }

    public string? OsVersion { get; init; }
    public string? AgentVersion { get; init; }

    /// <summary>১–৮। এর বাইরে হলে সার্ভার ৪০০ দেয়।</summary>
    public int? Monitors { get; init; }
}

public sealed record EnrollResponse
{
    public required int DeviceId { get; init; }

    /// <summary>
    /// ⚠️ এই একবারই আসে — সার্ভারে শুধু sha256 জমা থাকে। হারালে আবার enroll
    /// করা ছাড়া উপায় নেই, আর নতুন enrollment code লাগবে। পাওয়ামাত্রই
    /// DPAPI দিয়ে ডিস্কে লিখুন, তারপর বাকি কাজ।
    /// </summary>
    public required string DeviceToken { get; init; }

    public required EnrolledEmployee Employee { get; init; }
    public required string ConfigVersion { get; init; }
    public required AgentConfig Config { get; init; }
}

public sealed record EnrolledEmployee(int Id, string EmpCode, string FullName);

// ── config ──────────────────────────────────────────────────────────────────

/// <summary><c>GET /agent/config</c>। <see cref="Version"/> কনফিগের sha256-এর প্রথম ১৬ অক্ষর।</summary>
public sealed record ConfigResponse
{
    public required string Version { get; init; }
    public required AgentConfig Config { get; init; }
}

// ── heartbeat ───────────────────────────────────────────────────────────────

/// <summary><c>POST /agent/heartbeat</c> — প্রতি <see cref="AgentConfig.HeartbeatSec"/> সেকেন্ডে।</summary>
public sealed record HeartbeatRequest
{
    public required SegmentState State { get; init; }

    /// <summary>
    /// ঢাকার আজকের দিনে এ পর্যন্ত ACTIVE সেকেন্ড। ০–৮৬৪০০ ছাড়ালে সার্ভার ৪০০ দেয়।
    /// ⚠️ মধ্যরাতে (ঢাকার, UTC-র নয়) শূন্য হয় — <see cref="oXeio.Core.Time.DhakaTime"/>।
    /// </summary>
    public required int ActiveSecToday { get; init; }

    /// <summary><see cref="OutboxDepth.ForHeartbeat"/>। কিউ বাড়তে থাকলে ড্যাশবোর্ড এখান থেকেই টের পায়।</summary>
    public int? QueueDepth { get; init; }

    /// <summary>নিজের কনফিগের ভার্সন। না মিললে সার্ভার <see cref="AgentCommand.ReloadConfig"/> পাঠায়।</summary>
    public string? ConfigVersion { get; init; }
}

public sealed record HeartbeatResponse
{
    /// <summary>অচেনা কমান্ড <see cref="AgentCommands.Parse"/>-এ বাদ পড়ে যায়, তাই এই তালিকায় থাকে না।</summary>
    public required IReadOnlyList<AgentCommand> Commands { get; init; }

    public required string ConfigVersion { get; init; }

    /// <summary>
    /// ⭐ tray-তে "x ঘ / ২০৮ঘ" দেখানোর সংখ্যা — <b>সার্ভার থেকেই আসে</b>।
    ///
    /// এজেন্ট নিজে এটা জানে না: সে শুধু নিজের চালু থাকার সময়টুকু গোনে, তাই
    /// রিবুট বা আপডেটের পর তার হিসাব শূন্য। স্টাফ তখন দেখত মাসের কাজ মুছে
    /// গেছে — অথচ ফিচারটার উদ্দেশ্যই আস্থা তৈরি করা।
    ///
    /// ডিভাইসের সাথে কোনো কর্মী যুক্ত না থাকলে <c>null</c>।
    /// </summary>
    public EmployeeProgress? Progress { get; init; }
}

/// <summary>সার্ভারের হিসাব — একাধিক PC ব্যবহার করলে সবগুলো যোগ হয়ে আসে (§ ২.১-গ)।</summary>
public sealed record EmployeeProgress
{
    public required int TodayActiveSec { get; init; }
    public required int MonthActiveSec { get; init; }
    public required double MonthlyTargetHours { get; init; }
}

// ── ingest ──────────────────────────────────────────────────────────────────

/// <summary>
/// segments / app-usage / events — তিনটারই উত্তর।
///
/// ⚠️ <see cref="Duplicates"/> ব্যর্থতা <b>নয়</b>। ডুপ্লিকেট মানে আগের চেষ্টাটা
/// আসলে পৌঁছেছিল, শুধু উত্তরটা আমরা পাইনি — অর্থাৎ ডেটা সার্ভারে আছে।
/// দুটোকেই সফল ধরে ack করতে হবে (§ ২.১-ঘ)। না করলে ওই ব্যাচ চিরকাল
/// রিট্রাই হতে থাকত আর কিউ কখনো খালি হতো না।
/// </summary>
public sealed record IngestAck
{
    public required int Accepted { get; init; }
    public required int Duplicates { get; init; }

    /// <summary>সার্ভার মধ্যরাতে ভাগ করেছে এমন রেকর্ডের সংখ্যা (G43)। এজেন্টের কিছু করার নেই।</summary>
    public required int Split { get; init; }
}

public sealed record ScreenshotAck
{
    public required bool Accepted { get; init; }

    /// <summary>একই <c>(device, slotStart, monitorIndex)</c> আগেই ছিল। এটাও সফল।</summary>
    public required bool Duplicate { get; init; }

    /// <summary>সার্ভারে ফাইলটা যেখানে বসেছে। শুধু লগের জন্য।</summary>
    public string? Path { get; init; }
}

// ── update ──────────────────────────────────────────────────────────────────

/// <summary>
/// <c>GET /agent/update?current=X</c>। ২০৪ এলে অফার নেই —
/// তখন <see cref="SyncResult{T}.Value"/> null কিন্তু
/// <see cref="SyncResult{T}.Outcome"/> <see cref="SyncOutcome.Success"/>।
/// </summary>
public sealed record UpdateOffer
{
    public required string Version { get; init; }

    /// <summary>⚠️ MSI চালানোর আগে হ্যাশ মিলিয়ে দেখা বাধ্যতামূলক।</summary>
    public required string Sha256 { get; init; }

    /// <summary>সার্ভার-সাপেক্ষ পাথ, যেমন <c>/api/v1/agent/update/download?version=1.2.0</c>।</summary>
    public required string Url { get; init; }

    public required bool Mandatory { get; init; }
}

/// <summary><c>GET /agent/update/download</c> শেষ হওয়ার পর — MSI ডিস্কে নামানো হয়ে গেছে।</summary>
public sealed record UpdateDownload
{
    public required string SavedPath { get; init; }
    public required long Bytes { get; init; }

    /// <summary>নামানো ফাইলের আসল হ্যাশ। <see cref="UpdateOffer.Sha256"/>-এর সাথে না মিললে ফাইল মুছে ফেলুন।</summary>
    public required string Sha256 { get; init; }
}
