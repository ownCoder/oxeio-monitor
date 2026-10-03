import {useState} from 'react';
import {getDailyDesignReport,getSkipInsights,getTargetHistory} from '../../api/targetInsights';
import {useApi} from '../../api/useApi';
import {ErrorBox,Loading} from '../../components/States';
import {formatDateTime} from '../../lib/format';
import {MiniButton,Modal} from '../settings/ui';

export function DailyDesignInsights() {
 const today=new Date(Date.now()+21600000).toISOString().slice(0,10);
 const sevenDaysAgo=new Date(Date.now()+21600000-6*86400000).toISOString().slice(0,10);
 const [from,setFrom]=useState(sevenDaysAgo),[to,setTo]=useState(today),[staff,setStaff]=useState('all');
 const daily=useApi(signal=>getDailyDesignReport(from,to,signal),[from,to]);
 const report=useApi(signal=>getSkipInsights(from,to,signal),[from,to]);
 const staffOptions=Array.from(new Map(daily.data?.rows.map(row=>[row.employeeId,`${row.empCode} · ${row.fullName}`])??[]).entries());
 const visible=daily.data?.rows.filter(row=>staff==='all'||String(row.employeeId)===staff)??[];
 const totals=visible.reduce((sum,row)=>({completed:sum.completed+row.completed,skipped:sum.skipped+(row.skipped??0),pending:sum.pending+(row.pending??0)}),{completed:0,skipped:0,pending:0});
 return <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
  <div className="flex flex-wrap items-end gap-3"><label>From <input aria-label="Daily report from" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} /></label><label>To <input aria-label="Daily report to" type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} /></label><MiniButton onClick={()=>{setFrom(today);setTo(today);}}>Today</MiniButton><MiniButton onClick={()=>{setFrom(sevenDaysAgo);setTo(today);}}>Last 7 days</MiniButton><MiniButton onClick={()=>{daily.reload();report.reload();}} disabled={daily.loading||report.loading}>Refresh report</MiniButton></div>
  {daily.loading?<Loading/>:daily.error?<ErrorBox error={daily.error} retry={daily.reload}/>:daily.data&&<>
   <div className="flex flex-wrap items-center gap-3"><label>Staff <select aria-label="Filter daily report by staff" value={staff} onChange={e=>setStaff(e.target.value)}><option value="all">All staff</option>{staffOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><p className="text-sm">Completed <b>{totals.completed}</b> · Recorded skips <b>{totals.skipped}</b> · Pending <b>{totals.pending}</b></p></div>
   <p className="text-xs text-ink-3">{daily.data.definition}</p>
   <div className="max-h-[30rem] overflow-auto"><table className="w-full text-sm"><thead><tr>{['Date (Dhaka)','Staff','Completed','Skipped','Pending'].map(x=><th key={x} scope="col" className="sticky top-0 bg-surface text-left p-2">{x}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={`${r.date}-${r.employeeId}`} className="border-t border-line"><td className="p-2 whitespace-nowrap">{r.date}</td><td className="p-2">{r.empCode} · {r.fullName}</td><td className="p-2 font-semibold">{r.completed}</td><td className="p-2 font-semibold">{r.skipped??'—'}</td><td className="p-2">{r.pending??'—'}</td></tr>)}</tbody></table></div>
   {visible.length===0&&<p>No staff records in this period.</p>}
   {visible.some(r=>r.skipped===null)&&<p className="text-xs text-ink-3">— means skip history is unavailable before {daily.data.skipHistoryCompleteFrom}; it does not mean zero.</p>}
  </>}
  <h4 className="font-semibold pt-2">Skip-rate details</h4>
  {report.loading?<Loading/>:report.error?<ErrorBox error={report.error} retry={report.reload}/>:report.data&&<>
   <p className="text-xs text-ink-3">{report.data.definition}</p>
   <p className="text-xs text-ink-3">Recorded assignment history starts {report.data.historySince?formatDateTime(report.data.historySince):'at an unknown time'}. Earlier assignments are not reconstructed. Pending/rejected requests count as requests, not approved skips.</p>
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Designer','Recorded assigned','Requests','Automatic','Pending','Approved','Rejected','Cohort skipped','Rate','Outside cohort requests'].map(x=><th key={x} className="text-left p-2">{x}</th>)}</tr></thead><tbody>{report.data.rows.map(r=><tr key={r.id} className="border-t border-line">{[`${r.empCode} · ${r.fullName}`,r.assigned,r.requests,r.automatic,r.pending,r.approved,r.rejected,r.cohortSkipped,r.skipRate===null?'—':`${r.skipRate}%`,r.outsideCohort].map((x,i)=><td key={i} className="p-2">{x}</td>)}</tr>)}</tbody></table></div>
   {report.data.rows.length===0&&<p>No recorded assignments or requests in this period.</p>}
  </>}
 </section>;
}

export function HistoryDrawer({id,onClose}:{id:number;onClose:()=>void}) {
 const [before,setBefore]=useState<number>();
 const data=useApi(signal=>getTargetHistory(id,before,signal),[id,before]);
 return <Modal title="Design history" onClose={onClose}>
  {data.loading?<Loading/>:data.error?<ErrorBox error={data.error} retry={data.reload}/>:data.data&&<div className="space-y-3">
   <p>{data.data.target.asin} · Job {data.data.target.jobNumber??'not assigned'}</p>
   <p className="text-xs text-ink-3">Recorded since {data.data.historySince?formatDateTime(data.data.historySince):'unknown'}. Missing older history is not evidence that no work happened.</p>
   {data.data.rows.map(r=><article key={r.id} className="border-t border-line py-2"><p><b>{r.action}</b> · {formatDateTime(r.recordedAt)}</p><p className="text-xs text-ink-3">{r.actorName??'Actor not recorded'} · {r.source}</p><p className="text-xs">Status: {String(r.beforeState?.status??'new')} → {String(r.afterState.status??'unknown')}{r.afterState.assigned_to_id!=null?` · Assignee #${String(r.afterState.assigned_to_id)}`:''}</p></article>)}
   {!data.data.rows.length&&<p>No recorded events for this design.</p>}
   <div className="flex gap-2">{before&&<MiniButton onClick={()=>setBefore(undefined)}>Newest events</MiniButton>}{data.data.nextBefore&&<MiniButton onClick={()=>setBefore(data.data!.nextBefore!)}>Older events</MiniButton>}</div>
  </div>}
 </Modal>;
}
