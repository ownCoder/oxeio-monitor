import {createRoot} from 'react-dom/client';
import {AuthProvider} from './src/auth/AuthContext';
import {GalleryPage} from './src/pages/GalleryPage';
import {shiftWorkDate,todayInDhaka} from './src/lib/format';
import './src/index.css';

const today=todayInDhaka();
const yesterday=shiftWorkDate(today,-1);
const old=shiftWorkDate(today,-5);
const staffMode=new URLSearchParams(location.search).get('role')==='staff';
const shots=[
 {id:'1',day:today,hour:9,employeeId:1,empCode:'OX-01',fullName:'Sample designer',monitorIndex:0,activeApp:'Chrome'},
 {id:'2',day:today,hour:15,employeeId:1,empCode:'OX-01',fullName:'Sample designer',monitorIndex:1,activeApp:'Photoshop'},
 {id:'3',day:today,hour:10,employeeId:2,empCode:'OX-02',fullName:'Second sample',monitorIndex:0,activeApp:'Chrome'},
 {id:'4',day:yesterday,hour:14,employeeId:1,empCode:'OX-01',fullName:'Sample designer',monitorIndex:1,activeApp:'Photoshop'},
 {id:'5',day:yesterday,hour:5,employeeId:2,empCode:'OX-02',fullName:'Second sample',monitorIndex:0,activeApp:'Chrome'},
 {id:'6',day:old,hour:15,employeeId:1,empCode:'OX-01',fullName:'Sample designer',monitorIndex:1,activeApp:'Photoshop'},
];
function image(id:string){return 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#31516a"/><rect x="55" y="55" width="690" height="390" rx="18" fill="#eef4f7"/><text x="96" y="145" font-family="Arial" font-size="38" fill="#142c3d">Synthetic screenshot ${id}</text><text x="96" y="215" font-family="Arial" font-size="24" fill="#31516a">No employee screen data</text></svg>`);}
window.fetch=async(input)=>{
 const url=new URL(String(input),location.origin);
 let data:unknown={};
 if(url.pathname.endsWith('/auth/me'))data={userId:900001,email:'preview@example.test',fullName:staffMode?'Sample designer':'Preview owner',role:staffMode?'employee':'owner',employeeId:staffMode?1:null,mustChangePassword:false,lastLoginAt:null,canAddTargets:false,canProofread:false};
 else if(url.pathname.endsWith('/employees'))data={rows:[{id:1,empCode:'OX-01',fullName:'Sample designer',status:'active'},{id:2,empCode:'OX-02',fullName:'Second sample',status:'active'}]};
 else if(url.pathname.endsWith('/screenshots')){
  const p=url.searchParams,from=p.get('fromDate')??p.get('date')??today,to=p.get('toDate')??p.get('date')??today,band=p.get('timeBand')??'all',app=p.get('app')?.toLowerCase()??'',monitor=p.get('monitorIndex'),staff=p.get('employeeId');
  const rows=shots.filter(s=>s.day>=from&&s.day<=to&&(!staffMode||s.employeeId===1)&&(!staff||s.employeeId===Number(staff))&&(band==='all'||(s.hour>=Number(band.slice(0,2))&&s.hour<Number(band.slice(3))))&&s.activeApp.toLowerCase().includes(app)&&(monitor===null||s.monitorIndex===Number(monitor))).map(s=>({id:s.id,employeeId:s.employeeId,empCode:s.empCode,fullName:s.fullName,capturedAt:new Date(`${s.day}T${String(s.hour).padStart(2,'0')}:15:00+06:00`).toISOString(),slotStart:new Date(`${s.day}T${String(s.hour).padStart(2,'0')}:00:00+06:00`).toISOString(),monitorIndex:s.monitorIndex,width:800,height:500,sizeBytes:25000,activeApp:s.activeApp,activeTitle:'Sample project',thumbUrl:image(s.id),fullUrl:image(s.id)}));
  data={date:to,page:Number(p.get('page')??1),pageSize:60,total:rows.length,totalPages:1,items:rows};
 }
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<AuthProvider><div className="min-h-screen bg-paper p-4"><p className="mb-5 rounded bg-amber-100 p-2 text-center text-sm text-black">Synthetic preview — sample images only; no employee data</p><GalleryPage/></div></AuthProvider>);
