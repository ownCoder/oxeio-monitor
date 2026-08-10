using System.Globalization;
using System.Runtime.Versioning;

using oXeio.Core.Time;
using oXeio.Core.Watchdog;
using oXeio.Watchdog.Native;
using oXeio.Watchdog.Platform;

namespace oXeio.Watchdog;

/// <summary>
/// ⭐ ৩০ সেকেন্ডের লুপ — দেখা, সিদ্ধান্ত, কাজ।
///
/// সিদ্ধান্তের সব যুক্তি <see cref="WatchdogPolicy"/> আর <see cref="RestartLadder"/>-এ,
/// অর্থাৎ Windows ছাড়াই টেস্ট করা যায়। এখানে শুধু বাইরের দুনিয়া পড়া আর
/// সিদ্ধান্ত কার্যকর করা।
///
/// ⚠️ এই লুপ থেকে কোনো এক্সসেপশন বেরোতে পারবে না। পাহারাদার মরে গেলে কেউ আর
/// কাউকে তোলে না, আর সেটা টের পাওয়া যায় সার্ভারে দশ মিনিট চুপ থাকার পর —
/// যদি কেউ অ্যালার্ট পড়ে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class WatchdogLoop
{
    /// <summary>kill করার পর প্রসেসটাকে মরার জন্য কতটা সময় দেওয়া হয়।</summary>
    private static readonly TimeSpan KillGrace = TimeSpan.FromSeconds(10);

    /// <summary>কিছু না বদলালেও এতক্ষণ পরপর একটা করে লাইন — লগ যেন "মৃত" না লাগে।</summary>
    private static readonly TimeSpan HeartbeatLogEvery = TimeSpan.FromHours(1);

    private readonly AgentPaths _paths;
    private readonly RollingLog _log;
    private readonly string? _agentExeOverride;

    private readonly RestartLadder _ladder = new();
    private readonly HeartbeatReader _heartbeat = new();

    // ⚠️ MonotonicClock, DateTimeOffset.Now নয়। কেউ PC-র ঘড়ি পিছিয়ে দিলে
    //    ঠান্ডা হওয়ার সময় কোনোদিন শেষ হতো না, আর watchdog নীরবে অকেজো
    //    হয়ে বসে থাকত — লগে সব স্বাভাবিক দেখিয়ে।
    private readonly MonotonicClock _clock = MonotonicClock.StartNow();

    private (WatchdogAction Action, WatchdogReason Reason, AgentHealth Health) _lastLogged;
    private DateTimeOffset _lastLogAt = DateTimeOffset.MinValue;
    private bool _alarmOnDisk;

    public WatchdogLoop(AgentPaths paths, RollingLog log, string? agentExeOverride)
    {
        _paths = paths;
        _log = log;
        _agentExeOverride = agentExeOverride;
    }

    public void Run(WaitHandle stop, TimeSpan period)
    {
        _log.Write($"পাহারা শুরু — প্রতি {period.TotalSeconds:F0} সেকেন্ডে, ডেটা ফোল্ডার {_paths.DataDirectory}");
        _alarmOnDisk = File.Exists(_paths.Alarm);

        do
        {
            try
            {
                Tick();
            }
            catch (Exception ex)
            {
                // এখানে পৌঁছানোর কথা নয় — নিচের প্রতিটা ধাপ নিজেই ধরে। তবু
                // এই catch-টাই শেষ ভরসা: একটা অপ্রত্যাশিত বাগ যেন পাহারাদারকে
                // চিরতরে থামিয়ে না দেয়।
                _log.Write($"❌ টিকে অপ্রত্যাশিত ত্রুটি: {ex.GetType().Name} — {ex.Message}");
            }

            // থামার অনুরোধ এলে সাথে সাথেই বেরোনো যায় — Sleep হলে ৩০ সেকেন্ড
            // অপেক্ষা করতে হতো, আর শাটডাউনে Windows ততক্ষণ অপেক্ষা করে না।
        } while (!stop.WaitOne(period) && !StopRequested());

        _log.Write("পাহারা থামানো হলো");
    }

    // ── এক টিক ──────────────────────────────────────────────────────────────

    private void Tick()
    {
        var now = _clock.Now;
        var observation = Observe();

        if (observation is null)
        {
            // ঘড়িই পড়া গেল না — এই টিকে কোনো সিদ্ধান্ত নেওয়া নিরাপদ নয়।
            LogIfChanged(WatchdogAction.Hold, WatchdogReason.ProbeFailed, AgentHealth.Unknown,
                "unbiased ঘড়ি পড়া গেল না — এই টিক বাদ", now);
            return;
        }

        var decision = WatchdogPolicy.Decide(observation, _ladder, now);
        LogIfChanged(decision.Action, decision.Reason, decision.Health, Describe(decision), now);

        switch (decision.Action)
        {
            case WatchdogAction.None:
                if (_alarmOnDisk && !_ladder.AlarmRaised)
                {
                    AlarmFile.Clear(_paths.Alarm);
                    _alarmOnDisk = false;
                    _log.Write("✅ এজেন্ট আবার স্থিরভাবে চলছে — অ্যালার্ম তুলে নেওয়া হলো");
                }
                break;

            case WatchdogAction.GiveUp:
                AlarmFile.Raise(
                    _paths.Alarm,
                    $"{_ladder.Failures} বার চালু করেও এজেন্ট টেকেনি " +
                    $"({Bengali(decision.Reason)})। পরের চেষ্টা ~{_ladder.Policy.CoolOff.TotalHours:F0} ঘণ্টা পর।");
                _alarmOnDisk = true;
                _ladder.MarkAlarmRaised();
                _log.Write("🔴 হাল ছাড়া হলো — watchdog.alarm লেখা হয়েছে, ঠান্ডা হওয়ার অপেক্ষা");
                break;

            case WatchdogAction.Restart:
                Restart(decision.KillProcessId, now);
                break;

            case WatchdogAction.Start:
                Start(now);
                break;

            case WatchdogAction.Hold:
            default:
                break;
        }
    }

    /// <summary>বাইরের দুনিয়া থেকে এক টিকের সব তথ্য। ঘড়ি পড়া না গেলে null।</summary>
    private AgentObservation? Observe()
    {
        if (Kernel32.UnbiasedMs() is not { } nowUnbiased) return null;

        var session = SessionCheck.Check();
        var lockState = InstanceLock.Probe(_paths.AgentLock);
        var beat = _heartbeat.Read(_paths.Heartbeat);

        return new AgentObservation
        {
            ProbeSucceeded = lockState != LockProbe.Unknown,
            InstanceLockHeld = lockState == LockProbe.Held,
            ProcessId = beat?.ProcessId,
            ProcessAlive = beat is not null && AgentProcess.IsAlive(beat.ProcessId),
            HeartbeatUnbiasedMs = beat?.UnbiasedMs,
            NowUnbiasedMs = nowUnbiased,
            SessionUsable = session.CanSupervise,
            ShuttingDown = User32.IsShuttingDown(),
        };
    }

    // ── কাজ ─────────────────────────────────────────────────────────────────

    private void Restart(int? pid, DateTimeOffset now)
    {
        if (pid is not { } victim)
        {
            _log.Write("⚠️ জমে যাওয়া এজেন্ট, কিন্তু pid জানা নেই — কিছু করা হলো না");
            return;
        }

        _log.Write($"⛔ এজেন্ট জমে গেছে (হার্টবিট {AgentLiveness.StaleAfter.TotalSeconds:F0} সে.-এর বেশি পুরোনো) — বন্ধ করা হচ্ছে");

        if (!AgentProcess.TryKill(victim, KillGrace, out var killDetail))
        {
            // ⚠️ ব্যর্থ kill-ও মইয়ের একটা ধাপ খরচ করে। না করলে watchdog প্রতি
            //    ৩০ সেকেন্ডে চিরকাল একটা না-মরা প্রসেসকে মারতে চেষ্টা করে যেত,
            //    কোনো অ্যালার্ম না তুলেই — অর্থাৎ সমস্যাটা চিরকাল অদৃশ্য থাকত।
            _ladder.RecordLaunch(now);
            _log.Write($"⚠️ {killDetail} (চেষ্টা {_ladder.Failures}/{_ladder.Policy.GiveUpAfter})");
            return;
        }

        _log.Write($"   {killDetail}");

        // ⚠️ মরতে থাকা প্রসেস কয়েক মিলিসেকেন্ড agent.lock ধরে রাখতে পারে।
        //    সাথে সাথে চালু করলে নতুন এজেন্ট লক না পেয়ে বেরিয়ে যেত, আর মই
        //    সেটাকে ব্যর্থতা হিসেবে গুনত। লক খালি হয়েছে দেখেই কেবল এগোনো।
        if (InstanceLock.Probe(_paths.AgentLock) != LockProbe.Free)
        {
            _log.Write("   লক এখনো ছাড়েনি — পরের টিকে চালু করা হবে");
            return;
        }

        Start(now);
    }

    private void Start(DateTimeOffset now)
    {
        var exe = AgentPaths.ResolveAgentExecutable(_agentExeOverride);

        // ⚠️ মই <b>আগে</b> এগোনো হয়, চালু করার আগে। exe নেই বা AV ব্লক করেছে —
        //    এসব ক্ষেত্রে পরে গুনলে গোনা কখনো বাড়ত না আর লুপটা প্রতি ৩০ সেকেন্ডে
        //    চিরকাল চেষ্টা করে যেত। ঠিক যে ঝড়টা ঠেকানোর কথা।
        _ladder.RecordLaunch(now);

        if (exe is null)
        {
            _log.Write($"❌ {AgentPaths.AgentExeName} পাওয়া গেল না ({AppContext.BaseDirectory}) — " +
                       $"চেষ্টা {_ladder.Failures}/{_ladder.Policy.GiveUpAfter}");
            return;
        }

        var ok = AgentProcess.TryStart(exe, out _, out var detail);

        _log.Write($"{(ok ? "▶" : "❌")} এজেন্ট চালু: {detail} " +
                   $"(চেষ্টা {_ladder.Failures}/{_ladder.Policy.GiveUpAfter}, " +
                   $"পরেরটা {_ladder.TimeUntilNextLaunch(now).TotalSeconds:F0} সে. পর)");
    }

    // ── থামার অনুরোধ ────────────────────────────────────────────────────────

    /// <summary>
    /// ইনস্টলার/আনইনস্টলার <c>watchdog.stop</c> ফাইল বানিয়ে ভদ্রভাবে থামাতে পারে।
    ///
    /// নামযুক্ত event ব্যবহার করা যেত না: SYSTEM হিসেবে চলা ইনস্টলার আর ইউজার
    /// সেশনে চলা watchdog আলাদা namespace-এ থাকে, আর <c>Global\</c> নাম
    /// তৈরি করতে স্ট্যান্ডার্ড ইউজারের privilege নেই।
    /// </summary>
    private bool StopRequested()
    {
        try
        {
            if (!File.Exists(_paths.StopFile)) return false;

            _log.Write("🛑 watchdog.stop পাওয়া গেছে — থামছি");
            File.Delete(_paths.StopFile);
            return true;
        }
        catch (Exception)
        {
            // মুছতে না পারলেও থামা হচ্ছে — নইলে ফাইলটা রয়ে গিয়ে প্রতিবার
            // চালু হওয়ার সাথে সাথেই থামাত।
            return true;
        }
    }

    // ── লগ ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// শুধু <b>বদল</b> লেখা হয়। প্রতি টিকে লিখলে দিনে ২,৮৮০টা লাইন হতো,
    /// লগ দিনে দুবার ঘুরত, আর দুই সপ্তাহ আগের যে ক্র্যাশটা খুঁজতে অ্যাডমিন
    /// লগ খুলেছেন সেটাই মুছে যেত।
    /// </summary>
    private void LogIfChanged(
        WatchdogAction action, WatchdogReason reason, AgentHealth health, string message, DateTimeOffset now)
    {
        var key = (action, reason, health);
        var stale = now - _lastLogAt >= HeartbeatLogEvery;

        if (key == _lastLogged && !stale) return;

        _lastLogged = key;
        _lastLogAt = now;
        _log.Write(message);
    }

    private static string Describe(WatchdogDecision decision)
    {
        var retry = decision.RetryIn is { } left && left > TimeSpan.Zero
            ? $" (আর {left.TotalSeconds:F0} সে.)"
            : string.Empty;

        return string.Create(
            CultureInfo.InvariantCulture,
            $"{Symbol(decision.Health)} {Bengali(decision.Health)} — {Bengali(decision.Reason)}{retry}");
    }

    private static string Symbol(AgentHealth health) => health switch
    {
        AgentHealth.Healthy => "✅",
        AgentHealth.NotRunning => "⛔",
        AgentHealth.Wedged => "🧊",
        AgentHealth.Unreachable => "❓",
        _ => "❓",
    };

    private static string Bengali(AgentHealth health) => health switch
    {
        AgentHealth.Healthy => "এজেন্ট সুস্থ",
        AgentHealth.NotRunning => "এজেন্ট চলছে না",
        AgentHealth.Wedged => "এজেন্ট জমে গেছে",
        AgentHealth.Unreachable => "এজেন্ট আছে কিন্তু নাগালের বাইরে",
        _ => "অবস্থা জানা যায়নি",
    };

    private static string Bengali(WatchdogReason reason) => reason switch
    {
        WatchdogReason.Healthy => "হার্টবিট তাজা",
        WatchdogReason.AgentMissing => "কেউ agent.lock ধরে নেই",
        WatchdogReason.HeartbeatStale => "হার্টবিট থেমে গেছে",
        WatchdogReason.ForeignInstance => "লক ধরা আছে কিন্তু কোন প্রসেস জানা যায়নি",
        WatchdogReason.BackoffPending => "ব্যাকঅফ চলছে",
        WatchdogReason.CoolOffPending => "হাল ছাড়া হয়েছে, ঠান্ডা হচ্ছে",
        WatchdogReason.CoolOffProbe => "ঠান্ডা হওয়ার পর একবার চেষ্টা",
        WatchdogReason.LadderExhausted => "বারবার চেষ্টা করেও এজেন্ট টেকেনি",
        WatchdogReason.ShuttingDown => "Windows বন্ধ হচ্ছে",
        WatchdogReason.SessionNotUsable => "এই সেশন থেকে এজেন্ট চালানো যাবে না",
        WatchdogReason.ProbeFailed => "lock ফাইল পড়াই গেল না",
        _ => reason.ToString(),
    };
}
