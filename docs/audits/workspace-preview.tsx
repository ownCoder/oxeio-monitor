import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {AuthProvider} from './src/auth/AuthContext';
import {Layout} from './src/components/Layout';
import {WorkspacePage} from './src/pages/WorkspacePage';
import './src/index.css';
const notices=[{key:'assignment:sample',title:'Assigned: 1000010',href:'/production/board?target=900001',at:'2026-09-29T09:00:00Z',category:'Assignment'},{key:'deadline:sample',title:'Due within 24 hours: 1000010',href:'/production/board?target=900001',at:'2026-09-29T17:59:59Z',category:'Deadline'}];
window.fetch=async(input,options)=>{
 const path=String(input);let data:unknown={};
 if(path.endsWith('/auth/me'))data={userId:900001,email:'preview@example.test',fullName:'Preview owner',role:'owner',employeeId:null,mustChangePassword:false,lastLoginAt:null,canAddTargets:true,canProofread:true};
 else if(path.includes('/workspace/read')){const key=JSON.parse(String(options?.body)).key;localStorage.setItem(key,'read');data={ok:true};}
 else if(path.endsWith('/workspace/inbox')){const rows=notices.map(n=>({...n,read:localStorage.getItem(n.key)==='read'}));data={rows,unread:rows.filter(r=>!r.read).length,limited:false};}
 else if(path.includes('/workspace/search'))data={rows:[{key:'design:sample',title:'1000010 · B000000001',detail:'Design · assigned',href:'/production/board?target=900001'}]};
 else if(path.endsWith('/workspace/deadlines'))data={rows:[{id:900001,jobNumber:1000010,asin:'B000000001',dueAt:'2026-09-29T17:59:59Z',state:'due-soon',href:'/production/board?target=900001',assignedTo:{empCode:'SAMPLE',fullName:'Preview designer'}}],limited:false};
 else if(path.includes('/alerts'))data={total:0,rows:[]};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<AuthProvider><MemoryRouter initialEntries={['/workspace/inbox']}><p className="bg-amber-100 p-2 text-center text-sm text-black">Synthetic preview — sample data, no production changes</p><Routes><Route element={<Layout/>}><Route path="workspace/:section" element={<WorkspacePage/>}/><Route path="*" element={<p>Sample design destination</p>}/></Route></Routes></MemoryRouter></AuthProvider>);
