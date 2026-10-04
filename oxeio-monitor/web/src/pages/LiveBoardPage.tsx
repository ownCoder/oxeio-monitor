import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getTopUsage } from '../api/activity';
import { listAlerts } from '../api/alerts';
import { getLiveBoard, getTeamPulse, getTeamTrend, type TrendDay } from '../api/dashboard';
import { usePolling, type ApiResult } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../components/Card';
import { Button, Page } from '../components/Page';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dhakaHourNow, formatDate, formatDateShort, formatDuration, formatTime, weekdayOf, workTimeZone, workTimeZoneLabel } from '../lib/format';
import { DayPulse } from './live/DayPulse';
import { TopApps } from './live/TopApps';
import { StatusStrip } from './live/TeamBars';
import { TeamTable } from './live/TeamTable';
import { FewestHours, MonthCard, TopPerformers, WeekBars } from './live/WeekAndMonth';
import { isWorking } from './live/onTheClock';
import { dayDuty } from './live/roster';

// লাইভ অবস্থা ১৫ সেকেন্ডে; ভারী চার্ট/রিপোর্ট দুই মিনিটে। ছবি এখানে আনা হয় না।
const BOARD_REFRESH_MS = 15_000;
const CHART_REFRESH_MS = 120_000;
const LEADER_WINDOWS = [{ id: '30d', label: '30 days' }, { id: 'all', label: 'All time' }] as const;

export function LiveBoardPage() {
  const { user } = useAuth();
  const canViewBoard = user?.role === 'owner' || user?.role === 'manager';
  const isOwner = user?.role === 'owner';
  // ভূমিকার শর্ত একই থাকে; অনুমতি না থাকলে কোনো protected endpoint-এ কল নয়।
  const board = usePolling((signal) => canViewBoard ? getLiveBoard(signal) : Promise.resolve(null), BOARD_REFRESH_MS, [canViewBoard]);
  const pulse = usePolling((signal) => canViewBoard ? getTeamPulse(signal) : Promise.resolve(null), CHART_REFRESH_MS, [canViewBoard]);
  const trend = usePolling((signal) => canViewBoard ? getTeamTrend(signal) : Promise.resolve(null), CHART_REFRESH_MS, [canViewBoard]);
  const workDate = board.data?.workDate;
  const apps = usePolling((signal) => canViewBoard && workDate ? getTopUsage({ from: workDate, to: workDate, limit: 6 }, signal) : Promise.resolve(null), CHART_REFRESH_MS, [canViewBoard, workDate]);
  const alerts = usePolling((signal) => isOwner ? listAlerts({ limit: 3 }, signal) : Promise.resolve(null), CHART_REFRESH_MS, [isOwner]);
  const [leaderWindow, setLeaderWindow] = useState<'30d' | 'all'>('30d');
  const cards = board.data?.cards ?? [];
  const active = cards.filter((card) => isWorking(card.status)).length;
  const idle = cards.filter((card) => card.status === 'idle').length;
  const offline = cards.filter((card) => card.status === 'offline').length;
  const todaySec = cards.reduce((sum, card) => sum + card.todayWorkedSec, 0);
  const worked = cards.filter((card) => card.todayWorkedSec > 0).length;
  const finished = cards.reduce((sum, card) => sum + card.designsFinished, 0);
  const hasDesigners = cards.some((card) => card.staffType === 'designer');
  const month = trend.data?.month;
  const observed = month?.trackedFrom != null;
  const withTarget = cards.filter((card) => dayDuty(card) === 'target').length;
  const targets = cards.filter((card) => card.dailyTargetSec > 0);
  const dailyTarget = targets.length && targets.every((card) => card.dailyTargetSec === targets[0].dailyTargetSec) ? targets[0].dailyTargetSec : null;
  const yesterday = trend.data?.days.at(-2);
  const delta = yesterday?.tracked ? yesterday.expectedStaff === 0 ? 'Yesterday was a day off' : Math.abs(todaySec - yesterday.workedSec) < 300 ? 'About the same as yesterday' : `${todaySec > yesterday.workedSec ? '▲' : '▼'} ${formatDuration(Math.abs(todaySec - yesterday.workedSec))} vs yesterday` : null;
  const refresh = () => { board.reload(); pulse.reload(); trend.reload(); apps.reload(); if (isOwner) alerts.reload(); };

  let content: ReactNode;
  if (!canViewBoard) content = <Empty title="You don't have access" hint="This board is available to owners and managers." />;
  else if (!board.data && board.loading) content = <Loading label="Loading the board…" />;
  else if (!board.data) content = <ErrorBox error={board.error} retry={board.reload} />;
  else if (!cards.length) content = <Empty title="Nobody on the board yet" hint="Add staff and install the agent. Their first heartbeat brings them onto the board." />;
  else content = <>
    {board.error && <p role="status" className="rounded-lg border border-brand/30 bg-brand-bg px-4 py-3 text-sm text-brand-ink">Couldn't refresh — showing the last successful snapshot from {formatTime(board.updatedAt?.toISOString() ?? null)}.</p>}
    <div className="studio-stats">
      <StudioStat label="Working now" value={active} unit={`/ ${cards.length}`} note={<>{idle} idle · {offline} offline<br />{cards.length - withTarget} off / no target today</>} />
      <StudioStat label="Hours today" value={formatDuration(todaySec)} note={<>{worked} staff with recorded time{delta && <><br />{delta}{trend.error && ' · last update'}</>}</>} />
      <StudioStat label="Average today" value={worked ? formatDuration(todaySec / worked) : '—'} note={<>Across {worked} staff with time<br />{dailyTarget ? `${formatDuration(dailyTarget)} daily target` : 'Individual targets shown below'}</>} />
      {hasDesigners && <StudioStat label="Designs finished" value={finished} note="Marked complete today" />}
      <StudioStat label={!observed ? 'Monthly pace' : month!.paceSec < 0 ? 'Behind monthly pace' : 'Ahead of monthly pace'} value={observed ? formatDuration(Math.abs(month!.paceSec)) : '—'} tone={observed ? month!.paceSec < 0 ? 'warning' : 'ok' : undefined} note={trend.error ? 'Refresh failed · last update shown' : observed ? <>Counted from {formatDate(month!.trackedFrom!)}{month!.notObservedStaff > 0 && ` · ${month!.notObservedStaff} not counted yet`}</> : 'No finished day counted yet'} />
      {isOwner && <StudioStat label="Open alerts" value={alerts.data?.openCount ?? '—'} tone={alerts.data?.openCount ? 'warning' : undefined} note={<Link to="/alerts" className="underline underline-offset-4">{alerts.error ? 'Refresh failed · view alerts ↗' : alerts.data?.rows[0]?.title ?? 'View alerts ↗'}</Link>} />}
    </div>
    <div className="studio-overview">
      <Card title="Shape of the Day" hint={`Team hours by hour · ${workTimeZoneLabel()} time`} padded={false}><DataPanel result={pulse}>{pulse.data && <DayPulse hours={pulse.data.hours} currentHour={dhakaHourNow()} />}</DataPanel></Card>
      <Card title="Team Right Now" hint="Agent status at the last refresh" padded={false}>
        <StatusStrip cards={cards} />
        <p className="studio-connection-note">Offline describes the agent connection, not whether someone worked.</p>
      </Card>
      <Card title="Hours · Last 7 Days" hint="Solid line = usual target · dashed bars = not tracked" padded={false}><DataPanel result={trend}>{trend.data && <WeekBars days={trend.data.days} />}</DataPanel></Card>
    </div>
    <div className="studio-detail-grid">
      <Card title="Team Snapshot" hint={withTarget ? 'Today’s hours, targets and design progress · furthest along first' : 'Day off · recorded hours still count'} actions={<Link className="tap text-xs underline underline-offset-4" to="/worklog">View Worklog ↗</Link>} padded={false}>
        <TeamTable cards={cards} />
      </Card>
      <div className="studio-detail-side">
        {hasDesigners && <Card title="Designs Finished · Last 7 Days" hint="Whole team · today is still in progress" padded={false}><DataPanel result={trend}>{trend.data && <StudioWeek days={trend.data.days} metric="designs" />}</DataPanel></Card>}
        <Card title="Where Today Went" hint="Whole team · counted app time only" padded={false}><DataPanel result={apps}>{apps.data && <TopApps usage={apps.data.apps} />}</DataPanel></Card>
        <Card title="Fewest Hours" hint={trend.data ? `Least counted in the last ${trend.data.laggardDays} days` : 'Least counted recently'} padded={false}><DataPanel result={trend}>{trend.data && <FewestHours people={trend.data.laggards} days={trend.data.laggardDays} />}</DataPanel></Card>
      </div>
    </div>
    <div className="studio-pair">
      <Card title="Top Performers" hint={leaderWindow === '30d' ? 'Most hours counted in the last 30 days' : 'Most hours counted, all time'} padded={false} actions={<Tabs items={LEADER_WINDOWS} active={leaderWindow} onChange={setLeaderWindow} label="Top performers window" />}><DataPanel result={trend}>{trend.data && <TopPerformers leaders={leaderWindow === '30d' ? trend.data.leaders30 : trend.data.leaders} />}</DataPanel></Card>
      <Card title="This Month" hint="Counted against the team target" padded={false}><DataPanel result={trend}>{month && <MonthCard month={month} />}</DataPanel></Card>
    </div>

  </>;

  return <Page><div className="studio-board">
    <div className="studio-board-head">
      <div><h1>Your team, at a glance.</h1><p>{workDate ? `${formatDate(workDate)} · ${workTimeZone()}` : `Live Board · ${workTimeZone()}`}</p></div>
      {canViewBoard && <div className="studio-actions"><span className="studio-updated"><strong className={board.error ? 'text-idle-ink' : 'text-ok'}>{board.error ? 'STALE' : board.paused ? 'PAUSED' : board.data ? 'LIVE' : 'CONNECTING'}</strong>{board.updatedAt && ` · Updated ${formatTime(board.updatedAt.toISOString())}`}</span><Link className="tap text-xs underline underline-offset-4" to="/reports">Reports ↗</Link><Button onClick={refresh} disabled={board.loading}>{board.loading ? 'Refreshing…' : 'Refresh'}</Button><Link className="tap rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink" to="/worklog">Open Worklog ↗</Link></div>}
    </div>
    {content}
    <footer className="studio-footer"><span>{board.error ? 'Refresh failed' : board.paused ? 'Updates paused' : board.loading ? 'Refreshing snapshot…' : 'Refreshes every 15 seconds'}{board.updatedAt && ` · Last updated ${formatTime(board.updatedAt.toISOString())}`}</span>{canViewBoard && <Link to="/reports" className="underline underline-offset-4">Open reports ↗</Link>}</footer>
  </div></Page>;
}

function StudioStat({ label, value, unit, note, tone }: { label: string; value: ReactNode; unit?: string; note: ReactNode; tone?: 'warning' | 'ok' }) {
  return <div className="studio-stat"><p className="studio-stat-label">{label}</p><div className={`studio-stat-value${tone === 'warning' ? ' text-idle-ink' : tone === 'ok' ? ' text-ok' : ''}`}>{value}{unit && <small>{unit}</small>}</div><p className="studio-stat-note">{note}</p></div>;
}

// প্রতিটা স্বাধীন ডেটা-উৎসের ব্যর্থতা দেখায়; পুরোনো সফল উত্তর মুছে দেয় না।
function DataPanel({ result, children }: { result: Pick<ApiResult<unknown>, 'data' | 'error' | 'reload'>; children: ReactNode }) {
  if (!result.data) return <div className="p-5">{result.error ? <ErrorBox error={result.error} retry={result.reload} /> : <Loading label="Loading summary…" />}</div>;
  return <>{result.error && <p role="status" className="px-5 pb-3 text-xs text-idle-ink">Couldn’t refresh this summary. Showing its last successful update. <button type="button" onClick={result.reload} className="tap underline">Retry</button></p>}{children}</>;
}

function StudioWeek({ days, metric }: { days: TrendDay[]; metric: 'designs' | 'hours' }) {
  const [selected, setSelected] = useState<string | null>(null);
  const valueOf = (day: TrendDay) => metric === 'designs' ? day.designsFinished : day.workedSec;
  const labelOf = (day: TrendDay) => metric === 'designs' ? `${day.designsFinished}` : formatDuration(day.workedSec);
  const peak = Math.max(...days.filter((day) => day.tracked).map(valueOf), 1);
  const shown = days.find((day) => day.date === selected);
  if (!days.length) return <p className="p-5 text-sm text-ink-2">No daily history yet.</p>;
  const tracked = days.filter((day) => day.tracked);
  return <div className="studio-chart">
    <div className="studio-chart-columns" aria-label={metric === 'designs' ? 'Completed designs by day' : 'Active hours by day'}>
      {days.map((day) => <button type="button" key={day.date} className="studio-chart-day" onMouseEnter={() => setSelected(day.date)} onFocus={() => setSelected(day.date)} onClick={() => setSelected(day.date)} aria-label={`${formatDate(day.date)}: ${day.tracked ? `${labelOf(day)} ${metric === 'designs' ? 'designs finished' : 'active time'}${day.expectedStaff === 0 ? ', day off' : ''}` : 'not tracked yet'}`}>
        <span className="studio-chart-value">{day.tracked ? labelOf(day) : '—'}</span>
        <span className={`studio-chart-bar${day.tracked ? '' : ' is-untracked'}`} style={{ height: day.tracked ? `${Math.max(2, valueOf(day) / peak * 135)}px` : '35px' }} />
      </button>)}
    </div>
    <div className="studio-chart-dates" aria-hidden>{days.map((day) => <span key={day.date}>{weekdayOf(day.date).slice(0, 3)}<br />{Number(day.date.slice(-2))}</span>)}</div>
    <p className="studio-chart-total"><strong>{tracked.length ? tracked.reduce((sum, day) => sum + day.designsFinished, 0) : '—'}</strong> designs finished · {tracked.length} of {days.length} days tracked</p>
    <p className="studio-chart-note" aria-live="polite">{shown ? `${formatDateShort(shown.date)} · ${shown.tracked ? `${labelOf(shown)} ${metric === 'designs' ? 'finished' : 'active'}${shown.expectedStaff === 0 ? ' · day off' : ''}` : 'not tracked yet'}` : 'Today is still in progress. Dashed bars mean not tracked yet.'}</p>
  </div>;
}