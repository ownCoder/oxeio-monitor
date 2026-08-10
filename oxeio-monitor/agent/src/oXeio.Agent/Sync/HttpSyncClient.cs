using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using oXeio.Agent.Storage;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Sync;

/// <summary>
/// <see cref="ISyncClient"/>-এর একমাত্র বাস্তবায়ন — <c>HttpClient</c>-এর উপর,
/// কোনো তৃতীয় পক্ষের লাইব্রেরি ছাড়া।
///
/// <b>এই ক্লাসের তিনটে অঙ্গীকার:</b>
/// <list type="number">
/// <item><b>কখনো ছোড়ে না।</b> সব পথ <see cref="SyncResult{T}"/> ফেরায়। নেটওয়ার্ক
///       না থাকা এই অফিসে ব্যতিক্রম নয়, স্বাভাবিক অবস্থা।</item>
/// <item><b>সন্দেহ হলে Transient।</b> ভুল করে রিট্রাই করলে কিউ কিছুক্ষণ বড় থাকে;
///       ভুল করে Permanent বললে কারো বেতনের ঘণ্টা মুছে যায়।</item>
/// <item><b>রেট লিমিটে আগেই থামে।</b> <see cref="SlidingWindowGate"/> দেখুন।</item>
/// </list>
///
/// <b>⭐ একটাই HttpClient, সারা জীবনের জন্য — কেন:</b>
/// প্রতি কলে <c>new HttpClient()</c> করলে প্রতিটা কানেকশন dispose-এর পরেও
/// <c>TIME_WAIT</c>-এ ২৪০ সেকেন্ড বসে থাকে; দিনে হাজারখানেক কল ধরলে কয়েক দিনেই
/// ephemeral port শেষ, আর তখন <c>SocketException</c> — অথচ মেশিনটা একটা
/// অফিস-PC, কেউ তাকিয়ে নেই।
///
/// <b>⚠️ কিন্তু শুধু static <c>HttpClient</c>-ও যথেষ্ট নয়:</b> সে কানেকশন পুল
/// ধরে রাখে এবং <b>DNS আর কখনো দেখে না</b>। এই প্রসেস সপ্তাহের পর সপ্তাহ চলে;
/// এর মধ্যে সার্ভারের IP বদলালে (নতুন রিভার্স প্রক্সি, DHCP লিজ) এজেন্ট চিরতরে
/// মৃত ঠিকানায় ধাক্কা দিত আর ঠিক করার একমাত্র উপায় হতো প্রতিটা PC-তে গিয়ে
/// রিস্টার্ট। সমাধান <c>SocketsHttpHandler.PooledConnectionLifetime</c> —
/// নির্দিষ্ট সময় পর কানেকশন ফেলে দেওয়া হয়, ফলে DNS আবার দেখা হয়।
/// </summary>
internal sealed class HttpSyncClient : ISyncClient, IDisposable
{
    private const int MaxBodyBytes = 256 * 1024;
    private const int MaxDetailChars = 300;

    /// <summary>Retry-After-এর সর্বোচ্চ মান — নিচের মন্তব্য দেখুন।</summary>
    private static readonly TimeSpan MaxRetryAfter = TimeSpan.FromMinutes(15);

    private static readonly IngestAck EmptyAck = new() { Accepted = 0, Duplicates = 0, Split = 0 };

    private readonly SyncClientOptions _options;
    private readonly IDeviceTokenSource? _tokenSource;
    private readonly ISyncLog _log;
    private readonly HttpClient _http;
    private readonly SlidingWindowGate _ingestGate;
    private readonly SlidingWindowGate _screenshotGate;

    private string? _token;
    private bool _disposed;

    /// <param name="tokenSource">
    /// secrets মডিউলের টোকেন। null দিলে শুধু <see cref="SetDeviceToken"/>-এ
    /// দেওয়া টোকেন কাজ করবে।
    /// </param>
    /// <param name="transport">
    /// টেস্টের জন্য নকল হ্যান্ডলার। null = আসল <see cref="SocketsHttpHandler"/>।
    /// ⚠️ দিলে সেটার মালিকানাও এই ক্লাসের — <see cref="Dispose"/>-এ ছেড়ে দেওয়া হয়।
    /// </param>
    internal HttpSyncClient(
        SyncClientOptions options,
        IDeviceTokenSource? tokenSource = null,
        ISyncLog? log = null,
        HttpMessageHandler? transport = null)
    {
        ArgumentNullException.ThrowIfNull(options);

        _options = options;
        _tokenSource = tokenSource;
        _log = log ?? NullSyncLog.Instance;

        var inner = transport ?? new SocketsHttpHandler
        {
            PooledConnectionLifetime = options.PooledConnectionLifetime,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            ConnectTimeout = options.ConnectTimeout,

            // ৪টের বেশি কানেকশন এই লোডে দরকার নেই (৫ মিনিটে কয়েকটা রিকোয়েস্ট),
            // আর কম রাখলে সার্ভারের দিক থেকেও পরিষ্কার থাকে।
            MaxConnectionsPerServer = 4,

            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,

            // ⚠️ ইচ্ছাকৃতভাবে বন্ধ। .NET ৩০১/৩০২-এ POST-কে GET বানিয়ে ফেলে এবং
            //    বডি ফেলে দেয় — অর্থাৎ একটা ভুল প্রক্সি রিডাইরেক্ট আমাদের ৫০০
            //    সেগমেন্টকে নীরবে শূন্য করে দিয়ে ২০০ ফেরত দিতে পারত, আর আমরা
            //    খুশি মনে ack করে কিউ থেকে মুছে ফেলতাম। রিডাইরেক্ট এখানে
            //    ৩xx হয়ে ফেরে আর SyncOutcomeClassifier সেটাকে Transient বলে —
            //    ডেটা থাকে, tray লাল হয়, অ্যাডমিন base URL ঠিক করে।
            AllowAutoRedirect = false,
        };

        _http = new HttpClient(new SyncHeadersHandler(ResolveToken, inner), disposeHandler: true)
        {
            BaseAddress = EnsureTrailingSlash(options.BaseAddress),

            // ⚠️ এখানে Infinite — টাইমআউট প্রতি কলে আলাদা
            //    (SyncClientOptions-এর মন্তব্য দেখুন)। HttpClient.Timeout ব্যবহার
            //    করলে সেটা OperationCanceledException দিত আর কলার বাতিল করেছে
            //    নাকি সময় শেষ — দুটো আলাদা করা যেত না।
            Timeout = Timeout.InfiniteTimeSpan,
        };

        // ⚠️ TryAddWithoutValidation — ভার্সন স্ট্রিংয়ে একটা ফাঁকা জায়গা থাকলেই
        //    ParseAdd FormatException ছুড়ত, অর্থাৎ কনস্ট্রাক্টরই ভেঙে পড়ত।
        _http.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent", $"oXeio-Agent/{options.AgentVersion}");
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");

        // Expect: 100-continue থাকলে প্রতিটা আপলোডে একটা বাড়তি round-trip —
        // ৩০০ ms ল্যাটেন্সির মোবাইল লিংকে সেটা প্রতি ছবিতে খেয়াল করার মতো দেরি।
        _http.DefaultRequestHeaders.ExpectContinue = false;

        _ingestGate = SlidingWindowGate.PerMinute(options.IngestPermitsPerMinute);
        _screenshotGate = SlidingWindowGate.PerMinute(options.ScreenshotPermitsPerMinute);
    }

    // ── টোকেন ───────────────────────────────────────────────────────────────

    /// <summary>
    /// এখানে দেওয়া টোকেন <see cref="IDeviceTokenSource"/>-এর চেয়ে অগ্রাধিকার পায়
    /// (enroll-এর ঠিক পরের মুহূর্তে ডিস্কে লেখার আগেই কাজ চালাতে হয়)।
    /// null দিলে আবার উৎসের টোকেনেই ফিরে যায়।
    /// </summary>
    public void SetDeviceToken(string? deviceToken)
    {
        string? normalized = string.IsNullOrWhiteSpace(deviceToken) ? null : deviceToken.Trim();

        // ⚠️ Volatile — টোকেন বসে tray/enroll থ্রেডে, পড়া হয় সিঙ্ক থ্রেডে।
        //    সাধারণ অ্যাসাইনমেন্টে JIT-এর caching-এ পুরোনো মানটা অনির্দিষ্ট সময়
        //    ধরে থেকে যেতে পারত — অর্থাৎ enroll-এর পরেও ৪০১ চলতেই থাকত।
        Volatile.Write(ref _token, normalized);
    }

    private string? ResolveToken() => Volatile.Read(ref _token) ?? _tokenSource?.CurrentToken;

    // ── enroll / config / heartbeat ─────────────────────────────────────────

    /// <summary>
    /// শুধু HTTP কলটুকু। ⚠️ টোকেন ডিস্কে লেখা, machineGuid বের করা, enrollment
    /// code চাওয়া — কিছুই এখানে নয়, ওগুলো secrets মডিউলের কাজ। এই ক্লাস
    /// টোকেনকে শুধু একটা স্ট্রিং হিসেবে চেনে।
    /// </summary>
    public Task<SyncResult<EnrollResponse>> EnrollAsync(
        EnrollRequest request, CancellationToken ct = default)
    {
        // ⚠️ null-এ ArgumentNullException ছোড়া হয় না। এই ইন্টারফেসের চুক্তি
        //    "কখনো ছোড়ে না" — কলার কোথাও try/catch বসায়নি, আর একটা ফসকে যাওয়া
        //    এক্সসেপশন সিঙ্ক ওয়ার্কারকে চুপচাপ মেরে দিত।
        if (request is null) return Task.FromResult(SyncResult<EnrollResponse>.Permanent(null, "enroll: request নেই"));

        var message = NewJsonRequest(HttpMethod.Post, "agent/enroll", SyncWire.Enroll(request), anonymous: true);

        return ExecuteAsync<EnrollResponse>(
            message, _options.ControlTimeout, gate: null, what: "enroll",
            onSuccess: (_, body) =>
            {
                var value = SyncJson.TryDeserialize<EnrollResponse>(body);
                if (value is not null) return SyncResult<EnrollResponse>.Ok(value);

                // ⚠️ এটা সবচেয়ে খারাপ ফলাফল: সার্ভার ডিভাইস বানিয়ে ফেলেছে এবং
                //    টোকেন একবারই পাঠায় — সেটা আমরা পড়তে পারিনি মানে টোকেন গেল।
                //    ঠিক করার একমাত্র পথ নতুন enrollment code। তাই চিৎকার করে লগ।
                _log.Error("enroll: সার্ভার ২xx দিয়েছে কিন্তু উত্তর পড়া যায়নি — " +
                           "deviceToken হারিয়ে গেছে, নতুন enrollment code লাগবে");
                return SyncResult<EnrollResponse>.Permanent(200, "enroll: উত্তরের JSON পড়া যায়নি");
            },
            ct);
    }

    public Task<SyncResult<ConfigResponse>> GetConfigAsync(CancellationToken ct = default)
    {
        var message = NewJsonRequest(HttpMethod.Get, "agent/config");

        return ExecuteAsync<ConfigResponse>(
            message, _options.ControlTimeout, gate: null, what: "config",
            onSuccess: (_, body) =>
            {
                var value = SyncJson.TryDeserialize<ConfigResponse>(body);

                // কনফিগ না পেলে ট্র্যাকিং থামে না — কলার পুরোনো/ডিফল্ট কনফিগ
                // নিয়ে চলতে থাকবে (AgentConfig.Default-এর মন্তব্য দেখুন)।
                return value is not null
                    ? SyncResult<ConfigResponse>.Ok(value)
                    : SyncResult<ConfigResponse>.Transient(200, "config: উত্তরের JSON পড়া যায়নি");
            },
            ct);
    }

    public Task<SyncResult<HeartbeatResponse>> HeartbeatAsync(
        HeartbeatRequest request, CancellationToken ct = default)
    {
        if (request is null)
            return Task.FromResult(SyncResult<HeartbeatResponse>.Transient(null, "heartbeat: request নেই"));

        var message = NewJsonRequest(HttpMethod.Post, "agent/heartbeat", SyncWire.Heartbeat(request));

        return ExecuteAsync<HeartbeatResponse>(
            message, _options.ControlTimeout, gate: null, what: "heartbeat",
            onSuccess: (_, body) =>
            {
                var dto = SyncJson.TryDeserialize<SyncWire.HeartbeatResponseDto>(body);
                return dto is not null
                    ? SyncResult<HeartbeatResponse>.Ok(SyncWire.ToHeartbeatResponse(dto))
                    : SyncResult<HeartbeatResponse>.Transient(200, "heartbeat: উত্তরের JSON পড়া যায়নি");
            },
            ct);
    }

    // ── ingest ──────────────────────────────────────────────────────────────

    // ⚠️ null তালিকা = খালি তালিকা হিসেবে ধরা হয় (ছোড়া হয় না)। কিছু পাঠানোর
    //    ছিল না, তাই "সফল" — কলারের কিউতে তখন কিছুই ছিল না।
    public Task<SyncResult<IngestAck>> SendSegmentsAsync(
        IReadOnlyList<ActivitySegment> segments, CancellationToken ct = default) =>
        IngestAsync("agent/segments", "segments", segments?.Count ?? 0,
            () => SyncWire.Segments(segments!), ct);

    public Task<SyncResult<IngestAck>> SendAppUsageAsync(
        IReadOnlyList<AppUsageRecord> items, CancellationToken ct = default) =>
        IngestAsync("agent/app-usage", "app-usage", items?.Count ?? 0,
            () => SyncWire.AppUsage(items!), ct);

    public Task<SyncResult<IngestAck>> SendEventsAsync(
        IReadOnlyList<AgentEventRecord> events, CancellationToken ct = default) =>
        IngestAsync("agent/events", "events", events?.Count ?? 0,
            () => SyncWire.Events(events!), ct);

    /// <summary>তিনটে ingest endpoint-এর একই শরীর — শুধু পাথ আর মোড়ক আলাদা।</summary>
    private Task<SyncResult<IngestAck>> IngestAsync<TPayload>(
        string path, string what, int count, Func<TPayload> payload, CancellationToken ct)
    {
        // খালি ব্যাচে নেটওয়ার্কে যাওয়ার মানে নেই — শুধু rate limit-এর একটা
        // permit নষ্ট হতো, আর ব্যাকলগ ড্রেন করার সময় ওটাই দামি জিনিস।
        if (count == 0) return Task.FromResult(SyncResult<IngestAck>.Ok(EmptyAck));

        if (count > SyncLimits.MaxBatchSize)
        {
            // ⚠️ এটা কলারের বাগ (ভাগ করার দায়িত্ব তার — ISyncClient দেখুন)।
            //    Permanent ফেরালে সঠিক শাস্তি হতো, কিন্তু তাতে একটা প্রোগ্রামিং
            //    ভুলের দাম দিত কারো বেতনের ঘণ্টা। তাই ডেটা ধরে রাখা হয়:
            //    Transient + জোরে লগ। কিউ আটকে থাকবে, tray লাল হবে, কেউ দেখবে।
            _log.Error($"{what}: ব্যাচে {count}টা রেকর্ড — সীমা {SyncLimits.MaxBatchSize}। " +
                       "কলার ভাগ করেনি; পাঠানো হলো না, ডেটা কিউতেই থাকল");
            return Task.FromResult(SyncResult<IngestAck>.Transient(
                null, $"{what}: ব্যাচ বড় ({count} > {SyncLimits.MaxBatchSize}) — কলারকে ভাগ করতে হবে"));
        }

        var message = NewJsonRequest(HttpMethod.Post, path, payload());

        return ExecuteAsync<IngestAck>(
            message, _options.IngestTimeout, _ingestGate, what,
            onSuccess: (_, body) =>
            {
                // ⭐ ২xx মানে সার্ভার ডেটা নিয়ে নিয়েছে। উত্তরের JSON পড়তে না পারা
                //    (প্রক্সির কাটা বডি, ভবিষ্যতের নতুন আকৃতি) সেটা বদলায় না।
                //    এখানে ব্যর্থতা ধরলে ওই ব্যাচ আবার যেত — সার্ভার ডুপ্লিকেট
                //    হিসেবে ফেলে দিত, কিন্তু কিউ কখনো খালি হতো না।
                var ack = SyncJson.TryDeserialize<IngestAck>(body)
                          ?? new IngestAck { Accepted = count, Duplicates = 0, Split = 0 };

                return SyncResult<IngestAck>.Ok(ack);
            },
            ct);
    }

    // ── screenshot ──────────────────────────────────────────────────────────

    public async Task<SyncResult<ScreenshotAck>> SendScreenshotAsync(
        ScreenshotRecord meta, string webpPath, CancellationToken ct = default)
    {
        if (meta is null)
            return SyncResult<ScreenshotAck>.Permanent(null, "screenshot: meta নেই");

        // ── নেটওয়ার্কে যাওয়ার আগের যাচাই ────────────────────────────────
        // ⚠️ এখানে Permanent ফেরানোটা ইচ্ছাকৃত ব্যতিক্রম: ফাইলটা নেই বা বড়,
        //    অর্থাৎ হাজারবার চেষ্টা করলেও একই ফল। Transient বললে ওই সারি
        //    চিরকাল কিউয়ের মাথায় বসে থাকত আর তার পেছনের সব ছবি আটকে যেত।
        if (string.IsNullOrWhiteSpace(webpPath))
            return SyncResult<ScreenshotAck>.Permanent(null, "screenshot: ফাইলের পাথ খালি");

        long length;
        try
        {
            var info = new FileInfo(webpPath);
            if (!info.Exists)
            {
                _log.Error($"screenshot: ফাইল নেই — {webpPath} (সারিটা বাদ দেওয়া হবে)");
                return SyncResult<ScreenshotAck>.Permanent(null, $"screenshot: ফাইল নেই — {webpPath}");
            }

            length = info.Length;
        }
        catch (Exception e) when (
            e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            // পাথ পড়াই গেল না — এটাও রিট্রাইয়ে ঠিক হওয়ার নয়
            _log.Error($"screenshot: ফাইল দেখা গেল না — {webpPath}", e);
            return SyncResult<ScreenshotAck>.Permanent(null, $"screenshot: ফাইল দেখা গেল না — {e.Message}");
        }

        if (length == 0)
            return SyncResult<ScreenshotAck>.Permanent(null, "screenshot: ফাইল ০ বাইট");

        if (length > SyncLimits.MaxScreenshotBytes)
        {
            _log.Error($"screenshot: {length / 1024} KB > সীমা " +
                       $"{SyncLimits.MaxScreenshotBytes / 1024} KB — পাঠানোই হলো না");
            return SyncResult<ScreenshotAck>.Permanent(
                413, $"screenshot: {length} বাইট, সীমা {SyncLimits.MaxScreenshotBytes}");
        }

        HttpRequestMessage message;
        try
        {
            message = BuildScreenshotRequest(meta, webpPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // FileStream খোলা যায়নি (মুছে গেছে, অন্য প্রসেস লক করেছে)।
            // লক সাময়িক হতে পারে — তাই এখানে Transient, অস্তিত্বহীনতার মতো নয়।
            _log.Warn($"screenshot: ফাইল খোলা গেল না — {webpPath}: {e.Message}");
            return SyncResult<ScreenshotAck>.Transient(null, $"screenshot: ফাইল খোলা গেল না — {e.Message}");
        }

        return await ExecuteAsync<ScreenshotAck>(
            message, _options.ScreenshotTimeout, _screenshotGate, "screenshot",
            onSuccess: (_, body) =>
            {
                var ack = SyncJson.TryDeserialize<ScreenshotAck>(body)
                          ?? new ScreenshotAck { Accepted = true, Duplicate = false };

                return SyncResult<ScreenshotAck>.Ok(ack);
            },
            ct).ConfigureAwait(false);
    }

    /// <summary>
    /// multipart/form-data — দুটো অংশ, আর দুটোরই আকৃতি সার্ভার কড়াভাবে দেখে।
    /// </summary>
    private static HttpRequestMessage BuildScreenshotRequest(ScreenshotRecord meta, string webpPath)
    {
        // ⚠️ .NET ডিফল্টে boundary-টা উদ্ধৃতি চিহ্নে মুড়ে দেয়
        //    (boundary="…")। বেশিরভাগ পার্সার সেটা মানে, কিছু কড়া পার্সার মানে না
        //    আর তখন "কোনো ফাইল পাইনি" বলে ৪০০ আসে — অথচ অনুরোধটা দেখতে নিখুঁত।
        //    তাই boundary হাতে বসানো হচ্ছে, উদ্ধৃতি ছাড়া, শুধু নিরাপদ অক্ষরে।
        var boundary = $"oXeio{Guid.NewGuid():N}";
        var content = new MultipartFormDataContent(boundary);
        var mediaType = content.Headers.ContentType!;
        mediaType.Parameters.Clear();
        mediaType.Parameters.Add(new NameValueHeaderValue("boundary", boundary));

        // ── meta: JSON *স্ট্রিং*, JSON অবজেক্ট নয় ─────────────────────────
        // ⭐ সার্ভার এই ফিল্ডটাকে একটা সাধারণ ফর্ম-ফিল্ড হিসেবে পড়ে এবং তারপর
        //    নিজে JSON.parse করে। Content-Type: application/json দিয়ে পাঠালে
        //    multipart পার্সার ওটাকে আলাদা করে ধরে আর ফিল্ডটা "নেই" হয়ে যায় —
        //    ফল: নীরব ৪০০, প্রতিটা ছবিতে, চিরকাল।
        //    ব্রাউজারের FormData.append(name, string) ঠিক এভাবেই পাঠায়:
        //    কোনো Content-Type হেডার ছাড়া।
        var metaJson = SyncJson.Serialize(SyncWire.ScreenshotMeta(meta));
        var metaPart = new StringContent(metaJson, Encoding.UTF8);
        metaPart.Headers.ContentType = null;
        content.Add(metaPart, "meta");

        // ── file ─────────────────────────────────────────────────────────
        // ⚠️ useAsync: true — নইলে প্রতিটা read সিঙ্ক্রোনাসভাবে থ্রেড আটকাত।
        //    পুরো ফাইল মেমরিতে তোলা হয় না; StreamContent সরাসরি স্ট্রিম করে।
        var stream = new FileStream(
            webpPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 64 * 1024, useAsync: true);

        var filePart = new StreamContent(stream);
        filePart.Headers.ContentType = new MediaTypeHeaderValue(SyncLimits.ScreenshotMimeType);

        // ⚠️ filename ছাড়া multer এটাকে টেক্সট ফিল্ড ধরে, ফাইল নয়। নামটা
        //    ইচ্ছাকৃতভাবে ASCII (uuid) — ডিস্কের আসল নামে অ-ASCII থাকলে .NET
        //    RFC 5987-এর filename*= রূপ পাঠাত, যেটা সব পার্সার বোঝে না।
        content.Add(filePart, "file", $"{meta.ClientUuid:N}.webp");

        // ── thumb (A06) — ঐচ্ছিক ─────────────────────────────────────────
        // ⚠️ না থাকলে অনুরোধটা তবু বৈধ; সার্ভার `thumb_path` null রাখে আর
        //    গ্যালারি ফুল ছবিতে ফেরত যায়। থাম্বনেইলের অভাবে একটা ছবি
        //    আটকে থাকা বা বাদ যাওয়া চলবে না।
        var thumbPath = OutboxPaths.ThumbPathFor(webpPath);
        if (File.Exists(thumbPath))
        {
            var thumbStream = new FileStream(
                thumbPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: 16 * 1024, useAsync: true);

            var thumbPart = new StreamContent(thumbStream);
            thumbPart.Headers.ContentType = new MediaTypeHeaderValue(SyncLimits.ScreenshotMimeType);
            content.Add(thumbPart, "thumb", $"{meta.ClientUuid:N}-thumb.webp");
        }

        return new HttpRequestMessage(HttpMethod.Post, "agent/screenshots") { Content = content };
    }

    // ── update ──────────────────────────────────────────────────────────────

    public Task<SyncResult<UpdateOffer>> CheckUpdateAsync(
        string currentVersion, CancellationToken ct = default)
    {
        var path = $"agent/update?current={Uri.EscapeDataString(currentVersion ?? string.Empty)}";
        var message = NewJsonRequest(HttpMethod.Get, path);

        return ExecuteAsync<UpdateOffer>(
            message, _options.ControlTimeout, gate: null, what: "update-check",
            onSuccess: (response, body) =>
            {
                // ২০৪ = হালনাগাদই আছে। সফল, কিন্তু Value null (চুক্তি অনুযায়ী)।
                if (response.StatusCode == HttpStatusCode.NoContent || string.IsNullOrWhiteSpace(body))
                    return SyncResult<UpdateOffer>.Ok(null, (int)response.StatusCode);

                var offer = SyncJson.TryDeserialize<UpdateOffer>(body);
                return offer is not null
                    ? SyncResult<UpdateOffer>.Ok(offer, (int)response.StatusCode)
                    : SyncResult<UpdateOffer>.Transient(200, "update-check: উত্তরের JSON পড়া যায়নি");
            },
            ct);
    }

    public async Task<SyncResult<UpdateDownload>> DownloadUpdateAsync(
        string version, string destinationPath, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(destinationPath))
            return SyncResult<UpdateDownload>.Permanent(null, "update-download: গন্তব্য পাথ খালি");

        // ⚠️ সরাসরি গন্তব্যে লেখা হয় না। অর্ধেক নামা MSI যদি গন্তব্যের নামে বসে
        //    থাকে, পরের বার কেউ সেটাকে সম্পূর্ণ ভেবে চালাতে পারে। .part-এ লিখে
        //    হ্যাশ মিলিয়ে তারপর নাম বদলানো হয় — নাম বদলানোটা atomic।
        var partPath = destinationPath + ".part";

        using var message = new HttpRequestMessage(
            HttpMethod.Get, $"agent/update/download?version={Uri.EscapeDataString(version ?? string.Empty)}");

        try
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(destinationPath));
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(_options.DownloadTimeout);

            using var response = await _http
                .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cts.Token)
                .ConfigureAwait(false);

            var status = (int)response.StatusCode;
            if (status is < 200 or > 299)
            {
                var body = await ReadBodyAsync(response, cts.Token).ConfigureAwait(false);
                return Classify<UpdateDownload>(status, body, response, "update-download");
            }

            long total = 0;
            using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

            await using (var source = await response.Content.ReadAsStreamAsync(cts.Token).ConfigureAwait(false))
            await using (var target = new FileStream(
                partPath, FileMode.Create, FileAccess.Write, FileShare.None,
                bufferSize: 128 * 1024, useAsync: true))
            {
                var buffer = new byte[128 * 1024];
                int read;

                while ((read = await source.ReadAsync(buffer, cts.Token).ConfigureAwait(false)) > 0)
                {
                    total += read;

                    if (total > _options.MaxUpdateBytes)
                    {
                        _log.Error($"update-download: {total} বাইট ছাড়াল সীমা {_options.MaxUpdateBytes} — থামানো হলো");
                        return SyncResult<UpdateDownload>.Permanent(
                            status, $"update-download: ফাইল সীমার চেয়ে বড় ({_options.MaxUpdateBytes} বাইট)");
                    }

                    hasher.AppendData(buffer, 0, read);
                    await target.WriteAsync(buffer.AsMemory(0, read), cts.Token).ConfigureAwait(false);
                }

                await target.FlushAsync(cts.Token).ConfigureAwait(false);
            }

            if (total == 0)
                return SyncResult<UpdateDownload>.Transient(status, "update-download: ০ বাইট এল");

            var sha = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
            File.Move(partPath, destinationPath, overwrite: true);

            _log.Info($"update-download: {total / 1024} KB নামল → {destinationPath}");

            return SyncResult<UpdateDownload>.Ok(new UpdateDownload
            {
                SavedPath = destinationPath,
                Bytes = total,
                Sha256 = sha,
            });
        }
        catch (Exception e)
        {
            return MapException<UpdateDownload>(e, ct.IsCancellationRequested, "update-download");
        }
        finally
        {
            // সফল হলে .part আর নেই (Move হয়ে গেছে); ব্যর্থ হলে আবর্জনা রাখা হয় না।
            TryDelete(partPath);
        }
    }

    // ── সাধারণ পথ ───────────────────────────────────────────────────────────

    /// <summary>
    /// একটা রিকোয়েস্টের পুরো জীবন: রেট-লিমিট → টাইমআউট → পাঠানো → শ্রেণিবিভাগ।
    ///
    /// ⚠️ <paramref name="onSuccess"/> শুধু ২xx-এ ডাকা হয়, আর সে-ও কখনো ছুড়বে না
    /// (JSON পড়া <see cref="SyncJson.TryDeserialize{T}"/> দিয়ে)।
    /// </summary>
    private async Task<SyncResult<T>> ExecuteAsync<T>(
        HttpRequestMessage message,
        TimeSpan timeout,
        SlidingWindowGate? gate,
        string what,
        Func<HttpResponseMessage, string, SyncResult<T>> onSuccess,
        CancellationToken ct)
        where T : class
    {
        using (message)
        {
            try
            {
                // ⭐ গেটে অপেক্ষা টাইমআউটের বাইরে। ভেতরে রাখলে ব্যাকলগ ড্রেন
                //    করার সময় ৪০ সেকেন্ড অপেক্ষার পর রিকোয়েস্টটা "টাইমআউট" হয়ে
                //    বাতিল হতো — অর্থাৎ রেট লিমিট মানার শাস্তি হতো ব্যর্থতা।
                if (gate is not null) await gate.WaitAsync(ct).ConfigureAwait(false);

                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(timeout);

                using var response = await _http.SendAsync(message, cts.Token).ConfigureAwait(false);
                var body = await ReadBodyAsync(response, cts.Token).ConfigureAwait(false);
                var status = (int)response.StatusCode;

                return status is >= 200 and <= 299
                    ? onSuccess(response, body)
                    : Classify<T>(status, body, response, what);
            }
            catch (Exception e)
            {
                return MapException<T>(e, ct.IsCancellationRequested, what);
            }
        }
    }

    /// <summary>স্ট্যাটাস → ফলাফল। নিয়মগুলো <see cref="SyncOutcomeClassifier"/>-এ, এখানে শুধু মোড়ক ও লগ।</summary>
    private SyncResult<T> Classify<T>(
        int status, string body, HttpResponseMessage response, string what)
        where T : class
    {
        var revoked = status == 403 && LooksRevoked(body);
        var outcome = SyncOutcomeClassifier.FromHttpStatus(status, revoked);
        var detail = $"{what}: HTTP {status} {response.ReasonPhrase} {Shorten(body)}".TrimEnd();

        switch (outcome)
        {
            case SyncOutcome.Revoked:
                _log.Error($"⛔ এই ডিভাইস revoke হয়েছে — {detail}");
                return SyncResult<T>.Revoked(detail);

            case SyncOutcome.Permanent:
                // ⭐ "জোরে লগ করো" — এটাই সেই মুহূর্ত যেখানে ডেটা চিরতরে বাদ যাবে।
                //    বডিটা রাখা হচ্ছে কারণ সার্ভারের ভ্যালিডেশন বার্তাই একমাত্র
                //    সূত্র; ওটা না থাকলে কেউ কোনোদিন জানত না কোন ফিল্ডটা ভুল ছিল।
                _log.Error($"❌ স্থায়ী প্রত্যাখ্যান, এই রেকর্ডগুলো বাদ যাবে — {detail}");
                return SyncResult<T>.Permanent(status, detail);

            default:
                var retryAfter = ReadRetryAfter(response);
                _log.Warn(retryAfter is { } wait
                    ? $"{detail} (Retry-After {wait.TotalSeconds:F0}s)"
                    : detail);

                return SyncResult<T>.Transient(status, detail, retryAfter);
        }
    }

    /// <summary>
    /// এক্সসেপশন → <see cref="SyncOutcome.Transient"/>। ব্যতিক্রম নেই:
    /// <see cref="SyncOutcomeClassifier.FromTransportFailure"/> সবসময় Transient,
    /// কারণ উত্তরই আসেনি মানে সার্ভার এখনো "না" বলেনি।
    /// </summary>
    private SyncResult<T> MapException<T>(Exception e, bool callerCancelled, string what)
        where T : class
    {
        switch (e)
        {
            case OperationCanceledException when callerCancelled:
                // এজেন্ট বন্ধ হচ্ছে — ভুল নয়, তাই লগে হইচই নেই
                return SyncResult<T>.Transient(null, $"{what}: বাতিল (এজেন্ট থামছে)");

            case OperationCanceledException:
                _log.Warn($"{what}: টাইমআউট");
                return SyncResult<T>.Transient(null, $"{what}: টাইমআউট");

            case HttpRequestException http:
            {
                int? status = null;
                if (http.StatusCode is { } code) status = (int)code;

                _log.Warn($"{what}: {http.HttpRequestError} — {Shorten(http.Message)}");
                return SyncResult<T>.Transient(status, $"{what}: {http.HttpRequestError}");
            }

            case IOException io:
                _log.Warn($"{what}: I/O — {Shorten(io.Message)}");
                return SyncResult<T>.Transient(null, $"{what}: I/O — {Shorten(io.Message)}");

            default:
                // ⚠️ অপ্রত্যাশিত। তবু ছোড়া হয় না — একটা ফসকে যাওয়া এক্সসেপশন
                //    সিঙ্ক ওয়ার্কার থ্রেডকে মেরে দিত, আর তখন ডেটা আর কোনোদিন যেত না।
                _log.Error($"{what}: অপ্রত্যাশিত ত্রুটি", e);
                return SyncResult<T>.Transient(null, $"{what}: {e.GetType().Name} — {Shorten(e.Message)}");
        }
    }

    private static HttpRequestMessage NewJsonRequest(HttpMethod method, string path) =>
        new(method, path);

    private static HttpRequestMessage NewJsonRequest<TPayload>(
        HttpMethod method, string path, TPayload payload, bool anonymous = false)
    {
        var message = new HttpRequestMessage(method, path)
        {
            // ⚠️ জেনেরিক TPayload — object হিসেবে দিলে STJ ঘোষিত টাইপ দেখে
            //    সিরিয়ালাইজ করত এবং কিছুই না লিখে "{}" পাঠাত। এখানে সেটা মানে
            //    খালি বডি, আর খালি বডি মানে ৪০০, আর ৪০০ মানে ডেটা মুছে যাওয়া।
            Content = new StringContent(SyncJson.Serialize(payload), Encoding.UTF8, "application/json"),
        };

        if (anonymous) message.Options.Set(SyncHeadersHandler.Anonymous, true);
        return message;
    }

    /// <summary>
    /// বডি পড়া, তবে সীমিত পরিমাণে। ⚠️ ভুল রুট বা ক্যাপটিভ পোর্টাল ৫০ MB HTML
    /// ফেরত দিতে পারে — সেটা পুরোটা মেমরিতে তোলা মানে অকারণে GC চাপ, আর
    /// সবচেয়ে খারাপ সময়ে (নেট গোলমাল) সেটাই ঘটত।
    /// </summary>
    private static async Task<string> ReadBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);

            var buffer = new byte[16 * 1024];
            using var memory = new MemoryStream(capacity: 4 * 1024);

            while (memory.Length < MaxBodyBytes)
            {
                var room = (int)Math.Min(buffer.Length, MaxBodyBytes - memory.Length);
                var read = await stream.ReadAsync(buffer.AsMemory(0, room), ct).ConfigureAwait(false);
                if (read <= 0) break;

                memory.Write(buffer, 0, read);
            }

            return Encoding.UTF8.GetString(memory.GetBuffer(), 0, (int)memory.Length);
        }
        catch (Exception)
        {
            // বডি পড়তে না পারা কখনোই স্ট্যাটাস কোডের চেয়ে বেশি গুরুত্বপূর্ণ নয়
            return string.Empty;
        }
    }

    /// <summary>
    /// ৪০৩-এর বডিতে <c>{ command: "revoke" }</c> আছে কি না।
    ///
    /// ⚠️ ভুল করে true বললে ওই মেশিনের ট্র্যাকিং <b>স্থায়ীভাবে</b> বন্ধ হয়ে যায়।
    /// তাই খোঁজা হয় নির্দিষ্ট আকৃতি — কোথাও "revoke" শব্দটা থাকলেই নয়। সার্ভার
    /// বার্তাটা মোড়কে (<c>{ statusCode, message: { command } }</c>) পাঠাতে পারে,
    /// তাই কয়েক স্তর গভীরে দেখা হয়।
    /// </summary>
    private static bool LooksRevoked(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return false;

        try
        {
            using var document = JsonDocument.Parse(body);
            return HasRevokeCommand(document.RootElement, depth: 0);
        }
        catch (JsonException)
        {
            // JSON-ই নয় (প্রক্সির HTML পাতা?)। দুটো শব্দই থাকলে তবেই ধরা হয়।
            return body.Contains("command", StringComparison.OrdinalIgnoreCase)
                   && body.Contains(AgentCommands.Revoke, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static bool HasRevokeCommand(JsonElement element, int depth)
    {
        if (depth > 6) return false;

        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.NameEquals("command")
                        && property.Value.ValueKind == JsonValueKind.String
                        && string.Equals(property.Value.GetString(), AgentCommands.Revoke,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }

                    if (HasRevokeCommand(property.Value, depth + 1)) return true;
                }

                return false;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    if (HasRevokeCommand(item, depth + 1)) return true;
                }

                return false;

            default:
                return false;
        }
    }

    /// <summary>
    /// <c>Retry-After</c> — সেকেন্ডে বা তারিখে।
    ///
    /// ⚠️ তারিখের রূপটা আমাদের নিজের ঘড়ির সাথে বিয়োগ করতে হয় — অথচ এই এজেন্টের
    /// ঘড়ির ভুল মাপাই সার্ভারের একটা কাজ (x-client-time)। ঘড়ি একদিন পিছিয়ে
    /// থাকলে "একদিন পরে আসো" বেরিয়ে আসত আর মেশিনটা একদিন চুপ থাকত। তাই
    /// দুটো রূপকেই <see cref="MaxRetryAfter"/>-এ সীমাবদ্ধ করা হয়।
    /// </summary>
    private static TimeSpan? ReadRetryAfter(HttpResponseMessage response)
    {
        var header = response.Headers.RetryAfter;
        if (header is null) return null;

        TimeSpan wait;
        if (header.Delta is { } delta) wait = delta;
        else if (header.Date is { } date) wait = date - DateTimeOffset.UtcNow;
        else return null;

        if (wait < TimeSpan.Zero) return TimeSpan.Zero;

        return wait > MaxRetryAfter ? MaxRetryAfter : wait;
    }

    private static string Shorten(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;

        // লগ এক লাইনে থাকা দরকার — নইলে ফাইলে খুঁজে বের করা কঠিন
        var flat = text.Replace('\r', ' ').Replace('\n', ' ').Trim();

        return flat.Length <= MaxDetailChars ? flat : flat[..MaxDetailChars] + "…";
    }

    private static Uri EnsureTrailingSlash(Uri baseAddress)
    {
        var text = baseAddress.AbsoluteUri;
        return text.EndsWith('/') ? baseAddress : new Uri(text + "/", UriKind.Absolute);
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception)
        {
            // মুছতে না পারা কোনো কিছুই ভাঙে না — পরের ডাউনলোডে ওভাররাইট হবে
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _http.Dispose();          // ভেতরের হ্যান্ডলার চেইনও এখানেই ছাড়া হয়
        _ingestGate.Dispose();
        _screenshotGate.Dispose();
    }
}
