import {useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {api} from '../api/client';
import {useApi,usePolling} from '../api/useApi';
import {useAuth} from '../auth/AuthContext';
import './office/office.css';
interface SearchRow {key:string;title:string;detail:string;href:string}
interface Notice {key:string;title:string;href:string;at:string;category:string;read:boolean}
interface Due {id:number;jobNumber:number|null;asin:string;dueAt:string;state:string;href:string;assignedTo:{empCode:string;fullName:string}|null}
export function WorkspacePage(){
  const {section='search'}=useParams();
  return <div className="office"><header><p className="office-eyebrow">OXEIO / WORKSPACE</p><h1>{section==='inbox'?'Notification inbox':section==='deadlines'?'Design deadlines':'Search workspace'}</h1><p>Find your work and see what needs attention.</p></header><nav aria-label="Workspace tools">{[['search','Search'],['inbox','Inbox'],['deadlines','Deadlines']].map(([path,label])=><Link key={path} to={`/workspace/${path}`} aria-current={section===path?'page':undefined}>{label}</Link>)}</nav>{section==='inbox'?<Inbox/>:section==='deadlines'?<Deadlines/>:<Search/>}</div>;
}
function Search(){
  const [params,setParams]=useSearchParams();
  const q=params.get('q')??'';
  const [draft,setDraft]=useState(q);
  const result=useApi(signal=>q.trim().length>=2?api<{rows:SearchRow[]}>(`/workspace/search?q=${encodeURIComponent(q)}`,{signal}):Promise.resolve({rows:[]}),[q]);
  return <><form onSubmit={e=>{e.preventDefault();setParams({q:draft.trim()});}} className="flex flex-wrap items-end gap-3"><label className="flex-1">Design number, ASIN, staff or record title<input className="mt-2 w-full rounded border border-line bg-surface p-3" value={draft} maxLength={100} onChange={e=>setDraft(e.target.value)} placeholder="Type at least 2 characters"/></label><button className="min-h-11 rounded border border-line px-4" type="submit">Search</button></form><p className="my-4 text-sm text-ink-2">Results follow your access permissions. Up to 20 designs, 20 Office records and 10 staff matches.</p>{result.loading&&<p role="status">Searching…</p>}{result.error&&<p role="alert">{result.error.message}</p>}{result.data&&q.length>=2&&result.data.rows.length===0&&<p>No matches found.</p>}<div className="grid gap-3">{result.data?.rows.map(r=><Link key={r.key} to={r.href} className="office-card"><strong>{r.title}</strong><p>{r.detail}</p></Link>)}</div></>;
}
function stamp(s:string){return new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'});}
function Inbox(){
  const [revision,setRevision]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[unreadOnly,setUnreadOnly]=useState(false);
  const result=usePolling(signal=>api<{rows:Notice[];unread:number;limited:boolean}>('/workspace/inbox',{signal}),60000,[revision]);
  async function read(key:string){setBusy(key);setError('');try{await api('/workspace/read',{method:'POST',body:{key}});setRevision(v=>v+1);window.dispatchEvent(new Event('oxeio-inbox-read'));}catch(e){setError((e as Error).message);}finally{setBusy(null);}}
  return <><div className="flex flex-wrap items-center gap-4"><p>{result.data?`${result.data.unread} unread`:'Loading inbox…'}</p><label><input type="checkbox" checked={unreadOnly} onChange={e=>setUnreadOnly(e.target.checked)}/> Unread only</label><button className="rounded border border-line px-3 py-2" onClick={()=>setRevision(v=>v+1)}>Refresh</button></div><p className="my-4 text-sm text-ink-2">Recent assignments, Office updates and unresolved review comments from the last 30 days, plus pending skip approvals and deadline reminders. Read status follows your account across PCs. Reminders appear here while you use the app.</p>{(error||result.error)&&<p role="alert">{error||result.error?.message}</p>}{result.data?.limited&&<p>Showing the latest 200 available notifications.</p>}<div className="grid gap-3">{result.data?.rows.filter(r=>!unreadOnly||!r.read).map(r=><article key={r.key} className="office-card"><div className="flex justify-between gap-3"><Link to={r.href} className={r.read?'text-ink-2':'font-semibold'}>{r.title}</Link><span>{r.read?'Read':'Unread'}</span></div><p>{r.category} · {stamp(r.at)} · Dhaka</p>{!r.read&&<button disabled={busy!==null} onClick={()=>void read(r.key)} className="mt-2 rounded border border-line px-3 py-1">{busy===r.key?'Saving…':'Mark read'}</button>}</article>)}</div>{result.data&&result.data.rows.filter(r=>!unreadOnly||!r.read).length===0&&<p className="mt-4">{unreadOnly?'You are caught up.':'No notifications to show.'}</p>}</>;
}
function Deadlines(){
  const {user}=useAuth();
  const [revision,setRevision]=useState(0),[filter,setFilter]=useState('all');
  const result=usePolling(signal=>api<{rows:Due[];limited:boolean}>('/workspace/deadlines',{signal}),60000,[revision]);
  const management=user?.role==='owner'||user?.role==='manager';
  return <><div className="flex flex-wrap items-end gap-3"><label>Show <select value={filter} onChange={e=>setFilter(e.target.value)} className="rounded border border-line bg-surface p-2"><option value="all">All deadlines</option><option value="overdue">Overdue</option><option value="due-soon">Due within 24 hours</option><option value="scheduled">Later</option></select></label><button className="min-h-11 rounded border border-line px-3" onClick={()=>setRevision(v=>v+1)}>Refresh</button></div><p className="my-4 text-sm text-ink-2">Active assigned designs only. Due dates end at 23:59 in Dhaka. {management?'Open a design → Planning to set or change its deadline.':'Your manager sets the deadline in Production planning.'} Completed or reassigned work updates automatically.</p>{result.error&&<p role="alert">{result.error.message}</p>}{result.data?.limited&&<p>Showing the earliest 200 deadlines.</p>}<div className="grid gap-3">{result.data?.rows.filter(r=>filter==='all'||r.state===filter).map(r=><Link key={r.id} to={r.href} className="office-card"><strong>{r.jobNumber??r.asin} · {r.state==='due-soon'?'Due within 24 hours':r.state==='overdue'?'Overdue':'Scheduled'}</strong><p>{stamp(r.dueAt)} · Dhaka</p>{management&&r.assignedTo&&<p>{r.assignedTo.empCode} · {r.assignedTo.fullName}</p>}</Link>)}</div>{result.data&&result.data.rows.filter(r=>filter==='all'||r.state===filter).length===0&&<p className="mt-4">No designs in this deadline group.</p>}</>;
}
