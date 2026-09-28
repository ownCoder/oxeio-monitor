import {useState} from 'react';
import {getSkipInsights,getTargetHistory} from '../../api/targetInsights';
import {useApi} from '../../api/useApi';
import {ErrorBox,Loading} from '../../components/States';
import {formatDateTime} from '../../lib/format';
import {MiniButton,Modal} from '../settings/ui';

export function SkipInsights() {
 const today=new Date(Date.now()+21600000).toISOString().slice(0,10);
 const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today);
 const report=useApi(signal=>getSkipInsights(from,to,signal),[from,to]);
 return <section className="border-b border-line p-4 space-y-3">
  <h3 className="font-semibold">Skip report</h3>
  <div className="flex flex-wrap gap-3"><label>From <input aria-label="Skip report from" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} /></label><label>To <input aria-label="Skip report to" type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} /></label><MiniButton onClick={report.reload} disabled={report.loading}>Refresh report</MiniButton></div>
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
