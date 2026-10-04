using oXeio.Core.Agent;
using oXeio.Core.Models;
using oXeio.Core.Time;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// The work-day offset is process-wide state (<see cref="DhakaTime.TrySet"/>),
/// so every test that changes it lives in this collection: xUnit runs a
/// collection with parallelisation disabled on its own, after the others.
/// Without that, the Dhaka tests in other classes could see São Paulo's offset
/// halfway through.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class WorkTimeZoneCollection
{
    public const string Name = "work time zone (process-wide offset)";
}

/// <summary>
/// The server may run on another zone without DST (<c>WORK_TIMEZONE</c>) and
/// sends <c>utcOffsetMinutes</c> in the config. These tests check that:
///  1. by default nothing changes — Asia/Dhaka, UTC+06:00;
///  2. with America/Sao_Paulo (−180) days, the capture window and midnight
///     splits follow São Paulo's clock, across month and year boundaries.
/// </summary>
[Collection(WorkTimeZoneCollection.Name)]
public sealed class WorkTimeZoneTests : IDisposable
{
    private const string SaoPaulo = "America/Sao_Paulo";

    public WorkTimeZoneTests() => DhakaTime.Reset();

    public void Dispose() => DhakaTime.Reset();

    private static DateTimeOffset Utc(int y, int mo, int d, int h, int mi = 0) =>
        new(y, mo, d, h, mi, 0, TimeSpan.Zero);

    [Fact]
    public void Default_is_Dhaka_plus_six()
    {
        Assert.Equal(TimeSpan.FromHours(6), DhakaTime.Offset);
        Assert.Equal("Asia/Dhaka", DhakaTime.TimeZoneName);
        Assert.Equal("Dhaka", DhakaTime.Label);
        Assert.Equal(360, AgentConfig.Default.UtcOffsetMinutes);
        Assert.Equal(new DateOnly(2026, 8, 9), DhakaTime.WorkDateOf(Utc(2026, 8, 8, 18)));
    }

    [Fact]
    public void Sao_Paulo_day_turns_at_local_midnight()
    {
        Assert.True(DhakaTime.TrySet(SaoPaulo, -180));
        Assert.Equal("Sao Paulo", DhakaTime.Label);

        Assert.Equal(new DateOnly(2026, 8, 10), DhakaTime.WorkDateOf(Utc(2026, 8, 11, 2, 59)));
        Assert.Equal(new DateOnly(2026, 8, 11), DhakaTime.WorkDateOf(Utc(2026, 8, 11, 3)));
        // 15:00 local — where the Dhaka offset used to turn the day
        Assert.Equal(new DateOnly(2026, 8, 11), DhakaTime.WorkDateOf(Utc(2026, 8, 11, 18)));
        Assert.Equal(new TimeOnly(7, 5), DhakaTime.LocalTimeOf(Utc(2026, 8, 11, 10, 5)));
        Assert.Equal(Utc(2026, 8, 12, 3), DhakaTime.NextLocalMidnight(Utc(2026, 8, 11, 15)));
    }

    [Fact]
    public void Sao_Paulo_month_and_year_roll_over_at_local_midnight()
    {
        DhakaTime.TrySet(SaoPaulo, -180);

        Assert.Equal(new DateOnly(2026, 8, 31), DhakaTime.WorkDateOf(Utc(2026, 9, 1, 2, 30)));
        Assert.Equal(new DateOnly(2026, 12, 31), DhakaTime.WorkDateOf(Utc(2027, 1, 1, 2, 59)));
        Assert.Equal(new DateOnly(2027, 1, 1), DhakaTime.WorkDateOf(Utc(2027, 1, 1, 3)));
        Assert.Equal(Utc(2027, 1, 1, 3), DhakaTime.NextLocalMidnight(Utc(2026, 12, 31, 23)));
    }

    [Fact]
    public void Capture_window_07_23_is_local_time()
    {
        DhakaTime.TrySet(SaoPaulo, -180);
        var window = CaptureWindow.Default;

        Assert.False(window.Allows(Utc(2026, 8, 11, 9, 59)));  // 06:59 local
        Assert.True(window.Allows(Utc(2026, 8, 11, 10)));      // 07:00 local
        Assert.True(window.Allows(Utc(2026, 8, 12, 1, 59)));   // 22:59 local
        Assert.False(window.Allows(Utc(2026, 8, 12, 2)));      // 23:00 local
    }

    [Fact]
    public void Segments_split_at_Sao_Paulo_midnight()
    {
        DhakaTime.TrySet(SaoPaulo, -180);
        var lateNight = Utc(2026, 8, 12, 2, 50); // 23:50 local, 11 Aug
        var sm = new IdleStateMachine(TimeSpan.FromSeconds(60), lateNight);

        var closed = new List<ActivitySegment>();
        for (var i = 1; i <= 20 * 60; i++)
            closed.AddRange(sm.Tick(lateNight.AddSeconds(i), TimeSpan.Zero, false, screenFrozen: false));
        closed.AddRange(sm.CloseAll(lateNight.AddMinutes(20)));

        var midnight = Utc(2026, 8, 12, 3);
        var before = closed.Where(c => c.EndedAt <= midnight).ToList();
        var after = closed.Where(c => c.StartedAt >= midnight).ToList();

        Assert.All(before, c => Assert.Equal(new DateOnly(2026, 8, 11), c.WorkDate));
        Assert.Equal(600, before.Sum(c => c.DurationSec));
        Assert.All(after, c => Assert.Equal(new DateOnly(2026, 8, 12), c.WorkDate));
        Assert.Equal(600, after.Sum(c => c.DurationSec));
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public void An_impossible_offset_is_refused_and_nothing_changes(int minutes)
    {
        Assert.False(DhakaTime.TrySet(SaoPaulo, minutes));
        Assert.Equal(TimeSpan.FromHours(6), DhakaTime.Offset);
        Assert.Equal("Asia/Dhaka", DhakaTime.TimeZoneName);
    }

    [Fact]
    public void The_remembered_line_round_trips()
    {
        DhakaTime.TrySet(SaoPaulo, -180);
        var line = DhakaTime.ToMemoryLine();
        Assert.Equal("America/Sao_Paulo|-180", line);

        DhakaTime.Reset();
        Assert.True(DhakaTime.TryRestore(line));
        Assert.Equal(TimeSpan.FromHours(-3), DhakaTime.Offset);
        Assert.Equal(SaoPaulo, DhakaTime.TimeZoneName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("America/Sao_Paulo")]
    [InlineData("America/Sao_Paulo|")]
    [InlineData("America/Sao_Paulo|abc")]
    [InlineData("|-180")]
    [InlineData("Somewhere|9999")]
    public void A_broken_remembered_line_keeps_the_current_zone(string? line)
    {
        Assert.False(DhakaTime.TryRestore(line));
        Assert.Equal(TimeSpan.FromHours(6), DhakaTime.Offset);
    }

    [Fact]
    public void An_empty_zone_name_is_refused()
    {
        Assert.False(DhakaTime.TrySet(" ", -180));
        Assert.Equal(TimeSpan.FromHours(6), DhakaTime.Offset);
    }
}
