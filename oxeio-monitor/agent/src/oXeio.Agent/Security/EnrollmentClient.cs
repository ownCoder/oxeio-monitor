using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Security;

/// <summary>enroll করার চেষ্টা ঠিক যে ক'রকম ভাবে শেষ হতে পারে।</summary>
internal enum EnrollmentStatus
{
    /// <summary>আগেই হয়ে আছে — সার্ভারে যাওয়াই হয়নি।</summary>
    AlreadyEnrolled,

    /// <summary>সফল, টোকেন ডিস্কে লেখা হয়ে গেছে।</summary>
    Enrolled,

    /// <summary>
    /// কোডটা সার্ভার নেয়নি — ব্যবহার হয়ে গেছে, মেয়াদ শেষ, বা ভুল।
    /// ⚠️ একই কোড দিয়ে আবার চেষ্টা করা অর্থহীন; নতুন কোড লাগবে।
    /// </summary>
    CodeRejected,

    /// <summary>
    /// সার্ভার পাওয়া যায়নি বা ৫xx/৪২৯ দিয়েছে। <b>মারাত্মক নয়</b> —
    /// পরে আবার চেষ্টা করলেই হবে, একই কোড দিয়ে।
    /// </summary>
    ServerUnreachable,

    /// <summary>ডিভাইস বাতিল (H06)। enroll করার চেষ্টাও আর করা যাবে না।</summary>
    Revoked,

    /// <summary>স্থায়ী machineGuid বানানো যায়নি — <see cref="MachineIdentity.UsableForEnrollment"/>।</summary>
    IdentityUnusable,

    /// <summary>
    /// সার্ভার টোকেন দিয়েছে কিন্তু ডিস্কে লেখা গেল না।
    /// ⚠️ এটাই সবচেয়ে খারাপ ফল — টোকেন একবারই আসে, তাই সেটা চিরতরে গেল
    /// এবং নতুন enrollment code ছাড়া আর কিছু করার নেই।
    /// </summary>
    StorageFailed,
}

/// <summary>
/// enroll-এর ফল। ⚠️ এখানে টোকেন <b>নেই</b>, ইচ্ছাকৃতভাবে।
/// কলার এটা নির্ভয়ে লগে ছাপতে পারে।
/// </summary>
internal sealed record EnrollmentResult(
    EnrollmentStatus Status,
    string Message,
    int? DeviceId = null,
    string? EmpCode = null,
    int? HttpStatus = null)
{
    public bool Ok => Status is EnrollmentStatus.Enrolled or EnrollmentStatus.AlreadyEnrolled;

    /// <summary>একই কোড নিয়ে পরে আবার চেষ্টা করার মানে আছে কি না।</summary>
    public bool Retryable => Status is EnrollmentStatus.ServerUnreachable;
}

/// <summary>
/// ⭐ একবারের কাজ: <c>POST /agent/enroll</c>, তারপর টোকেন ডিস্কে।
///
/// <b>যে তিনটে ব্যর্থতা আলাদা করে সামলাতেই হবে (নইলে ইনস্টল দিন ভেস্তে যায়):</b>
///
/// ১· <b>কোড আগেই ব্যবহার হয়ে গেছে / মেয়াদ শেষ</b> → সার্ভার ৪xx দেয়,
///    <see cref="SyncOutcomeClassifier"/> সেটাকে Permanent বলে।
///    রিট্রাই করলে শুধু rate limit ভরত। অ্যাডমিনকে নতুন কোড চাইতে বলা হয়।
///
/// ২· <b>ইনস্টলের সময় সার্ভার পাওয়া যাচ্ছে না</b> (সাইটের লাইন বন্ধ, VPN ওঠেনি) →
///    এটা <b>মারাত্মক নয়</b>। ইনস্টলার ব্যর্থ হবে না, এজেন্ট চালু হবে, ট্র্যাকিং
///    ডিফল্ট কনফিগে চলতেই থাকবে আর ডেটা outbox-এ জমবে; লাইন ফিরলে
///    <see cref="EnrollWithRetryAsync"/> নিজে থেকেই enroll সেরে নেবে।
///    ⚠️ এখানে ইনস্টল আটকে দিলে ১৫টা PC-র সেটআপ একটা রাউটার রিবুটের
///    জন্য থেমে থাকত, আর ওই দিনের ঘণ্টাও কেউ পেত না।
///
/// ৩· <b>টোকেন এসেছে কিন্তু ডিস্কে লেখা গেল না</b> → <see cref="EnrollmentStatus.StorageFailed"/>।
///    টোকেন একবারই আসে, তাই চুপ করে থাকা যাবে না।
///
/// ⚠️ <b>লগ ফাঁসের ফাঁদ:</b> <see cref="EnrollResponse"/> একটা <c>record</c>,
/// অর্থাৎ তার জেনারেটেড <c>ToString</c> <c>DeviceToken</c>-সহ সব ছাপে।
/// তাই এই ক্লাসে রেসপন্স অবজেক্টটা <b>কখনো</b> লগে যায় না; টোকেন সাথে সাথে
/// <see cref="SecretText"/>-এ মুড়ে ফেলা হয় আর বাইরে যায়
/// <see cref="EnrollmentResult"/>, যাতে টোকেন নেই।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class EnrollmentClient
{
    /// <summary>
    /// enrollment code ২৪ ঘণ্টায় মেয়াদ শেষ (H05), তাই এর বেশি রিট্রাই করে লাভ নেই।
    /// </summary>
    public static readonly TimeSpan DefaultGiveUpAfter = TimeSpan.FromHours(24);

    /// <summary>
    /// enroll-এর জন্য আলাদা পলিসি — outbox-এর ৫ সেকেন্ড থেকে শুরু করলে
    /// লাইন বন্ধ থাকা অবস্থায় প্রথম মিনিটেই ডজনখানেক ব্যর্থ চেষ্টা লগ ভরিয়ে দিত।
    /// enroll তাড়ার কাজ নয়: ১০ সেকেন্ড থেকে শুরু, সিলিং ৫ মিনিট।
    /// </summary>
    private static readonly RetryPolicy Policy = new(
        baseDelay: TimeSpan.FromSeconds(10),
        multiplier: 2,
        maxDelay: TimeSpan.FromMinutes(5),
        jitterRatio: 0.25,
        maxAttempts: null,
        maxAge: TimeSpan.FromHours(24));

    private readonly ISyncClient _sync;
    private readonly DeviceTokenStore _store;
    private readonly DeviceCredentials _credentials;
    private readonly string? _agentVersion;
    private readonly Action<string>? _log;

    public EnrollmentClient(
        ISyncClient sync,
        DeviceTokenStore store,
        DeviceCredentials credentials,
        string? agentVersion = null,
        Action<string>? log = null)
    {
        _sync = sync;
        _store = store;
        _credentials = credentials;
        _agentVersion = agentVersion;
        _log = log;
    }

    /// <summary>
    /// একবার চেষ্টা। ⚠️ কখনো throw করে না —
    /// <see cref="ISyncClient"/>-ও করে না, আর ডিস্কের ব্যর্থতা এখানে ধরা হয়।
    /// </summary>
    /// <param name="monitors">১–৮। এর বাইরে হলে ক্ল্যাম্প করা হয়, নইলে সার্ভার ৪০০ দিত।</param>
    public async Task<EnrollmentResult> EnrollAsync(
        SecretText enrollmentCode, int? monitors = null, CancellationToken ct = default)
    {
        if (_credentials.IsRevoked)
            return new EnrollmentResult(EnrollmentStatus.Revoked, "This device has been revoked.");

        if (_credentials.IsEnrolled)
        {
            return new EnrollmentResult(
                EnrollmentStatus.AlreadyEnrolled,
                "Already enrolled — " + _credentials.Describe(),
                _credentials.DeviceId,
                _credentials.Employee?.EmpCode);
        }

        // ⭐ সার্ভারে যাওয়ার **আগেই** নিশ্চিত হওয়া যে টোকেনটা রাখা যাবে।
        //    কোড একবার-ব্যবহার্য: enroll সফল হয়ে টোকেন এলো অথচ ডিস্কে লেখা
        //    গেল না — তখন কোডও গেল, টোকেনও গেল, আর সার্ভারে অনাথ ডিভাইস
        //    পড়ে রইল। আসল মেশিনে ঠিক এটাই ঘটেছিল।
        if (!_store.CanPersist(out var storageError))
        {
            return new EnrollmentResult(
                EnrollmentStatus.StorageFailed,
                $"The token store is not writable, so the enrolment code was not spent — {storageError}");
        }

        var identity = _credentials.Identity;
        if (!identity.UsableForEnrollment)
        {
            return new EnrollmentResult(
                EnrollmentStatus.IdentityUnusable,
                identity.Warning ?? "A stable machineGuid could not be created.");
        }

        if (enrollmentCode.IsBlank)
        {
            // নেটওয়ার্কে যাওয়ার দরকারই নেই — সার্ভার এটাকে ৪০০ দিত আর
            // rate limit-এর কাউন্টার অকারণে বাড়ত।
            return new EnrollmentResult(EnrollmentStatus.CodeRejected, "The enrolment code is empty.");
        }

        var request = new EnrollRequest
        {
            EnrollmentCode = enrollmentCode.Reveal(),
            Hostname = identity.Hostname,
            WindowsUsername = identity.WindowsUsername,
            MachineGuid = identity.MachineGuid,
            OsVersion = identity.OsVersion,
            AgentVersion = _agentVersion,
            // ⚠️ ক্ল্যাম্প — সার্ভার ১–৮-এর বাইরে হলে পুরো enroll-ই ৪০০ দেয়,
            //    আর মনিটর গোনার ভুলের জন্য enroll আটকে যাওয়াটা অর্থহীন।
            Monitors = monitors is { } count ? (int?)Math.Clamp(count, 1, 8) : null,
        };

        // ⚠️ কোডটা লগে যায় না — SecretText.ToString() শুধু fingerprint ছাপে।
        _log?.Invoke($"Enrolment attempt: code={enrollmentCode} · {identity.Describe()}");

        var response = await _sync.EnrollAsync(request, ct).ConfigureAwait(false);

        switch (response.Outcome)
        {
            case SyncOutcome.Success when response.Value is { } body:
                return Persist(body, identity);

            case SyncOutcome.Success:
                // ২xx কিন্তু বডি নেই — সাধারণত মাঝখানে বসা proxy। রেকর্ডের দোষ নয়,
                // তাই রিট্রাইযোগ্য ধরা হচ্ছে।
                return new EnrollmentResult(
                    EnrollmentStatus.ServerUnreachable,
                    "The server said success but the enrol body was empty (proxy?). It will be retried later.",
                    HttpStatus: response.StatusCode);

            case SyncOutcome.Revoked:
                _credentials.Revoke(response.Detail ?? "The server said revoked during enrolment");
                return new EnrollmentResult(
                    EnrollmentStatus.Revoked,
                    "This device has been revoked — " + (response.Detail ?? "reason unknown"),
                    HttpStatus: response.StatusCode);

            case SyncOutcome.Permanent:
                return new EnrollmentResult(
                    EnrollmentStatus.CodeRejected,
                    "The server did not accept the code (already used, invalid or expired): " +
                    (response.Detail ?? "reason unknown") +
                    ". Get a new enrolment code from the admin.",
                    HttpStatus: response.StatusCode);

            default:
                return new EnrollmentResult(
                    EnrollmentStatus.ServerUnreachable,
                    "Could not reach the server: " + (response.Detail ?? "reason unknown") +
                    ". The agent keeps running and will enrol by itself once the line is back.",
                    HttpStatus: response.StatusCode);
        }
    }

    /// <summary>
    /// লাইন না থাকা অবস্থায় ইনস্টল হলে এটাই ব্যাকগ্রাউন্ডে চলতে থাকে।
    ///
    /// ⚠️ <paramref name="giveUpAfter"/> ২৪ ঘণ্টা, কারণ কোডের মেয়াদই ২৪ ঘণ্টা —
    /// এর পরে চেষ্টা চালিয়ে যাওয়া মানে শুধু সার্ভারে ৪xx-এর ঝড় তোলা।
    /// থেমে গেলে ট্রে-তে লাল হয়ে অ্যাডমিনকে জানানোর দায়িত্ব কলারের।
    /// </summary>
    public async Task<EnrollmentResult> EnrollWithRetryAsync(
        SecretText enrollmentCode,
        int? monitors = null,
        TimeSpan? giveUpAfter = null,
        CancellationToken ct = default)
    {
        var deadlineFrom = DateTimeOffset.UtcNow;
        var limit = giveUpAfter ?? DefaultGiveUpAfter;
        var attempt = 0;

        while (true)
        {
            var result = await EnrollAsync(enrollmentCode, monitors, ct).ConfigureAwait(false);
            if (!result.Retryable) return result;

            attempt++;

            var now = DateTimeOffset.UtcNow;
            if (now - deadlineFrom >= limit)
            {
                return result with
                {
                    Message = result.Message +
                              $" — {attempt} attempts over {limit.TotalHours:F0} hours and still no luck; " +
                              "the code has probably expired. Run again with a new code.",
                };
            }

            var delay = Policy.DelayFor(attempt, Random.Shared.NextDouble());
            _log?.Invoke($"Enrolment will be retried in {delay.TotalSeconds:F0}s (attempt {attempt})");

            try
            {
                await Task.Delay(delay, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // এজেন্ট বন্ধ হচ্ছে। শেষ ফলটাই ফেরত — এটা ব্যর্থতা নয়।
                return result;
            }
        }
    }

    /// <summary>
    /// ⭐ ক্রম: আগে ডিস্ক, তারপর মেমরি।
    /// উল্টো হলে ডিস্কে লেখা ব্যর্থ হলেও এজেন্ট চলত, আর রিবুটের পর টোকেন উধাও —
    /// অথচ সার্ভার ততক্ষণে টোকেনটা ভুলে গেছে (শুধু sha256 রাখে)।
    /// </summary>
    private EnrollmentResult Persist(EnrollResponse body, MachineIdentity identity)
    {
        var record = new DeviceCredentialRecord
        {
            DeviceId = body.DeviceId,
            Token = new SecretText(body.DeviceToken),
            MachineGuid = identity.MachineGuid,
            Hostname = identity.Hostname,
            EnrolledAt = DateTimeOffset.UtcNow,
            Employee = body.Employee,
            AgentVersion = _agentVersion,
        };

        var saved = _store.Save(record);
        if (!saved.Ok)
        {
            return new EnrollmentResult(
                EnrollmentStatus.StorageFailed,
                "❌ The server issued a token but it could not be written to disk: " + saved.Detail +
                ". The token is issued only once, so it cannot be recovered — " +
                $"fix the write permissions on {_store.FilePath} and run again with a new enrolment code.",
                body.DeviceId,
                body.Employee.EmpCode);
        }

        _credentials.Adopt(record);

        return new EnrollmentResult(
            EnrollmentStatus.Enrolled,
            $"Enrolment succeeded — device #{body.DeviceId}, {body.Employee.EmpCode} ({body.Employee.FullName})",
            body.DeviceId,
            body.Employee.EmpCode,
            201);
    }
}
