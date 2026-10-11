import {useState} from 'react';
import {DROP_REASONS} from '../../api/targets';
import {MiniButton} from '../settings/ui';
export interface PoolView {filter:string;q:string;staffId:string;addedById:string;from:string;to:string;reviewType?:string;reviewReason?:string;reviewAge?:string;reviewSort?:string;reviewUndated?:string;poolProgress?:string;poolReason?:string;addedFrom?:string;addedTo?:string;poolSort?:string}
const keys=['filter','q','staffId','addedById','from','to','reviewType','reviewReason','reviewAge','reviewSort','reviewUndated','poolProgress','poolReason','addedFrom','addedTo','poolSort'] as const;
export function parsePoolView(search:string):PoolView {
 const q=new URLSearchParams(search),allowed=['all','pool','assigned','done','skipped','deleted','to_check','to_fix','no_file','to_review'];
 const result=Object.fromEntries(keys.map(k=>[k,(q.get(k)??'').slice(0,200)])) as unknown as PoolView;
 if(!allowed.includes(result.filter)) result.filter='all';
 for(const key of ['staffId','addedById'] as const) if(!/^[1-9]\d{0,8}$/.test(result[key]))result[key]='';
 for(const key of ['from','to'] as const) if(!/^\d{4}-\d{2}-\d{2}$/.test(result[key]))result[key]='';
 if(!['','all','pending','skipped','deleted'].includes(result.reviewType??''))result.reviewType='';
 if(!['',...DROP_REASONS].includes(result.reviewReason??''))result.reviewReason='';
 if(!['','today','over_24h','over_7d'].includes(result.reviewAge??''))result.reviewAge='';
 if(!['','pending_first','oldest_pending','newest','newest_deleted'].includes(result.reviewSort??''))result.reviewSort='';
 if(result.reviewUndated!=='true')result.reviewUndated='';
 if(!['','not_started','started'].includes(result.poolProgress??''))result.poolProgress='';
 if(!['',...DROP_REASONS].includes(result.poolReason??''))result.poolReason='';
 for(const key of ['addedFrom','addedTo'] as const) if(!/^\d{4}-\d{2}-\d{2}$/.test(result[key]??''))result[key]='';
 if(!['','activity_newest','activity_oldest','added_newest','added_oldest'].includes(result.poolSort??''))result.poolSort='';
 return result;
}
export function viewSearch(view:PoolView) {return new URLSearchParams(keys.filter(k=>view[k]!==''&&view[k]!==undefined&&!(k==='filter'&&view[k]==='all')).map(k=>[k,view[k]??''])).toString();}
interface Saved {name:string;view:PoolView}
export function SavedViews({scope,current,onApply}:{scope:string;current:PoolView;onApply:(v:PoolView)=>void}) {
 const storageKey='oxeio.pool.views.'+scope;
 const [name,setName]=useState(''),[message,setMessage]=useState('');
 const [saved,setSaved]=useState<Saved[]>(()=>{try {const value:unknown=JSON.parse(localStorage.getItem(storageKey)??'[]');return Array.isArray(value)?value.filter(x=>x&&typeof x.name==='string'&&x.view).slice(0,10).map(x=>({name:x.name.slice(0,60),view:parsePoolView(viewSearch(x.view))})):[];}catch{return[];}});
 const write=(next:Saved[])=>{try{localStorage.setItem(storageKey,JSON.stringify(next));setSaved(next);setMessage('Saved on this browser. Share the view link to use another PC.');}catch{setMessage('Browser storage is unavailable. Use the share link instead.');}};
 return <div className="border-b border-line px-4 py-3 space-y-2 text-xs"><div className="flex flex-wrap gap-2 items-center">
  <label>View name <input className="rounded border border-line bg-paper px-2 py-1" aria-label="Saved view name" value={name} maxLength={60} onChange={e=>setName(e.target.value)}/></label>
  <MiniButton disabled={!name.trim()||saved.length>=10&&!saved.some(x=>x.name===name.trim())} onClick={()=>{write([...saved.filter(x=>x.name!==name.trim()),{name:name.trim(),view:current}]);setName('');}}>Save current view</MiniButton>
  <a className="underline text-brand" href={'?'+viewSearch(current)}>Open shareable view link</a>
 </div><div className="flex flex-wrap gap-2">{saved.map(x=><span key={x.name}><MiniButton onClick={()=>onApply(x.view)}>{x.name}</MiniButton><button type="button" aria-label={'Remove saved view '+x.name} className="ml-1 px-1" onClick={()=>write(saved.filter(y=>y.name!==x.name))}>×</button></span>)}</div>{message&&<p role="status">{message}</p>}</div>;
}
