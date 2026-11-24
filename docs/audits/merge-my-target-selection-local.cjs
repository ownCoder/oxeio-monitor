const fs=require('node:fs');
const path='oxeio-monitor/web/src/pages/MyTargets.tsx';
const normalize=s=>s.replace(/\r\n/g,'\n');
const pending=normalize(fs.readFileSync(path,'utf8'));
const clean=normalize(fs.readFileSync('.release-system/'+path,'utf8'));
const linkImport="import { Link } from 'react-router-dom';\n";
const extra=' <Link to={`/production/board?target=${target.id}`} className="text-xs text-brand-ink hover:underline">History & review</Link>';
if(pending.replace(linkImport,'').replaceAll(extra,'')!==clean) throw new Error('Other pending changes exist; refusing to overwrite MyTargets');
let next=normalize(fs.readFileSync('.release-my-targets/'+path,'utf8'));
next=linkImport+next.replaceAll("{target.jobNumber ?? '—'}", "{target.jobNumber ?? '—'}"+extra);
fs.writeFileSync(path,next);
for(const p of ['oxeio-monitor/web/src/pages/targets/my-target-view.ts','oxeio-monitor/web/test/my-target-view.spec.ts']) {
 if(fs.existsSync(p)) throw new Error('Refusing to overwrite existing file '+p);
 fs.copyFileSync('.release-my-targets/'+p,p);
}
console.log('Scoped selection changes merged; existing unreleased History & review links preserved.');
