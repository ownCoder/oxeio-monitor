import {createRoot} from 'react-dom/client';
import {AuthProvider,useAuth} from '../src/auth/AuthContext';
import {MyTargets} from '../src/pages/MyTargets';
import '../src/index.css';
const rows=[30,10,20].map((n,i)=>({id:i+1,asin:`B00000000${i+1}`,url:`/opened-design.html?job=${1000000+n}`,jobNumber:1000000+n,assignedAt:new Date().toISOString(),startedAt:null,completedAt:null,skipReviewPending:false,skipRequestedAt:null}));
window.fetch=async(input)=>{
 const path=String(input);
 const data=path.endsWith('/auth/me')?{userId:900001,email:'fixture@example.test',fullName:'Preview designer',role:'employee',employeeId:900001,mustChangePassword:false,lastLoginAt:null,canAddTargets:false,canProofread:false}:path.endsWith('/skip-allowance')?{limit:3,requested:0,remaining:3}:path.endsWith('/me/targets')?rows:{};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
function Preview(){const {user}=useAuth();return <main className="mx-auto max-w-5xl p-8"><h1 className="mb-4 text-xl font-semibold">My Data preview — synthetic designs</h1>{user?<MyTargets/>:'Loading preview…'}</main>;}
createRoot(document.getElementById('root')!).render(<AuthProvider><Preview/></AuthProvider>);
