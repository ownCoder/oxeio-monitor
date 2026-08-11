using System.Diagnostics;
using System.Runtime.Versioning;

using oXeio.Agent.Native;
using oXeio.Core.Watchdog;

namespace oXeio.Agent.Platform;

/// <summary>
/// ⭐ এজেন্ট বেঁচে আছে — watchdog-কে এটাই জানানোর একমাত্র উপায়।
///
/// দুটো জিনিস, দুটো আলাদা কাজ:
/// <list type="bullet">
/// <item><b><c>agent.lock</c></b> — এক্সক্লুসিভ ফাইল লক, প্রসেসের পুরো জীবন ধরে
///   ধরা থাকে। এক মেশিনে দুটো এজেন্ট চলা <b>ঠেকায়</b>।</item>
/// <item><b><c>agent.alive</c></b> — প্রতি ১৫ সেকেন্ডে লেখা হয়। প্রসেস বেঁচে
///   আছে কিন্তু <b>আটকে গেছে</b> — সেটা ধরার একমাত্র উপায়।</item>
/// </list>
///
/// <b>এটা না থাকলে যা হয়েছিল:</b> ইনস্টল করে চালানোর পর watchdog দেখল
/// <c>agent.lock</c> কেউ ধরে নেই, ভাবল এজেন্ট মরে গেছে, আর <b>আরেকটা এজেন্ট
/// চালু করল</b>। ৩০ সেকেন্ড পর আবার। দুটো এজেন্ট একই ঘণ্টা দুবার গুনত —
/// আর সার্ভারের দিক থেকে সেটা "কেউ খুব বেশি কাজ করছে" ছাড়া আলাদা কিছু
/// দেখাত না ([G57](../../../../docs/08-Gap-Analysis.md))।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class LivenessBeacon : IDisposable
{
    private readonly string _heartbeatPath;
    private readonly FileStream _lock;
    private readonly uint _sessionId;
    private readonly CancellationTokenSource _stopping = new();

    private LivenessBeacon(FileStream held, string heartbeatPath, uint sessionId)
    {
        _lock = held;
        _heartbeatPath = heartbeatPath;
        _sessionId = sessionId;
    }

    /// <summary>
    /// লক নেওয়ার চেষ্টা। <b>না পেলে <c>null</c></b> — মানে এই মেশিনে আরেকটা
    /// এজেন্ট ইতিমধ্যেই চলছে, আর তখন এই প্রসেসের থেমে যাওয়াই ঠিক।
    /// </summary>
    public static LivenessBeacon? TryAcquire(string dataDirectory)
    {
        var lockPath = Path.Combine(dataDirectory, AgentLiveness.AgentLockFileName);

        try
        {
            // ⚠️ FileShare.None — এটাই পুরো ব্যবস্থাটার ভিত্তি। watchdog একই
            //    ফাইল খুলতে গিয়ে ব্যর্থ হয়, আর সেই ব্যর্থতাই তার কাছে
            //    "এজেন্ট চলছে" খবরটা।
            var held = new FileStream(
                lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);

            Kernel32.ProcessIdToSessionId((uint)Environment.ProcessId, out var session);

            return new LivenessBeacon(
                held,
                Path.Combine(dataDirectory, AgentLiveness.HeartbeatFileName),
                session);
        }
        catch (IOException)
        {
            // অন্য কেউ ধরে আছে — স্বাভাবিক, ব্যতিক্রম নয়
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// ব্যাকগ্রাউন্ডে প্রতি ১৫ সেকেন্ডে হার্টবিট লেখা শুরু।
    /// প্রথমটা সাথে সাথেই — watchdog-এর প্রথম ৩০ সেকেন্ডের চেকেই যেন পায়।
    /// </summary>
    public void Start()
    {
        _ = Task.Run(async () =>
        {
            while (!_stopping.IsCancellationRequested)
            {
                Write();

                try { await Task.Delay(AgentLiveness.HeartbeatInterval, _stopping.Token); }
                catch (OperationCanceledException) { return; }
            }
        });
    }

    private void Write()
    {
        try
        {
            Kernel32.QueryUnbiasedInterruptTime(out var unbiased);

            var beat = new AgentHeartbeat
            {
                Version = AgentLiveness.CurrentVersion,
                ProcessId = Environment.ProcessId,
                SessionId = _sessionId,

                // ⚠️ unbiased ঘড়ি — ঘুমের সময় গোনে না। PC ঘুমিয়ে ওঠার পর
                //    biased ঘড়ি দিয়ে দেখলে হার্টবিট "১০ ঘণ্টা পুরোনো" মনে হতো
                //    আর watchdog সুস্থ এজেন্টকেই মেরে ফেলত।
                UnbiasedMs = (long)(unbiased / 10_000),

                WrittenAtUtc = DateTimeOffset.UtcNow,
            };

            // ⚠️ আগে temp-এ লিখে move — অর্ধেক লেখা লাইন watchdog পড়লে
            //    parse ব্যর্থ হতো, আর সেটা "হার্টবিট নেই"-এর সমান।
            var temp = _heartbeatPath + ".tmp";
            File.WriteAllText(temp, AgentLiveness.Format(beat));
            File.Move(temp, _heartbeatPath, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // একটা হার্টবিট মিস হওয়া মারাত্মক নয় — stale হতে ১২০ সেকেন্ড লাগে,
            // অর্থাৎ পরপর ৮টা মিস করলে তবেই।
            Debug.WriteLine($"could not write the heartbeat: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _stopping.Cancel();
        _lock.Dispose();
        _stopping.Dispose();

        // ⚠️ হার্টবিট ফাইলটা মুছে দেওয়া হয় — নইলে এজেন্ট বন্ধ হওয়ার পরেও
        //    ১২০ সেকেন্ড ধরে watchdog ভাবত সে বেঁচে আছে, আর ততক্ষণ কিছুই
        //    ট্র্যাক হতো না।
        try { File.Delete(_heartbeatPath); }
        catch (Exception) { /* বন্ধ হচ্ছে — আর কিছু করার নেই */ }
    }
}
