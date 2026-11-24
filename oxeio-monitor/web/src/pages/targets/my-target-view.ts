export function byJobNumber<T extends {id:number;jobNumber:number|null}>(targets:T[]):T[] {
  return [...targets].sort((a,b)=>{
    if(a.jobNumber===null && b.jobNumber!==null) return 1;
    if(b.jobNumber===null && a.jobNumber!==null) return -1;
    return (a.jobNumber??0)-(b.jobNumber??0)||a.id-b.id;
  });
}
const key=(userId:number)=>`oxeio.my-target.selected.${userId}`;
export function readSelectedTarget(userId:number):number|null {
  try {
    const value=localStorage.getItem(key(userId));
    const id=Number(value);
    return value!==null&&Number.isSafeInteger(id)&&id>0?id:null;
  } catch {return null;}
}
export function rememberSelectedTarget(userId:number,id:number) {
  try {localStorage.setItem(key(userId),String(id));} catch { /* Selection still works in memory. */ }
}
