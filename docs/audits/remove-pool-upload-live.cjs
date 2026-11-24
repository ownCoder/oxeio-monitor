const fs = require('fs');
const paths = ['.release-pool/oxeio-monitor/web/src/pages/AllTargetsPage.tsx', 'oxeio-monitor/web/src/pages/AllTargetsPage.tsx'];
for (const path of paths) {
 let s = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
 s = s.replace(/^  mark(?:Uploaded|Live),\n/gm, '');
 s = s.replace('FILTERS.map((f)', "FILTERS.filter((f) => f.stage !== 'to_upload' && f.stage !== 'to_live').map((f)");
 for (const action of ['Uploaded','Live']) {
  s = s.replace(new RegExp('                    on'+action+'=\\{\\(\\) =>[\\s\\S]*?\\n                    \\}\\n'), '');
  s = s.replace(new RegExp('^  on'+action+',\\n','m'), '').replace(new RegExp('^  on'+action+': \\(\\) => void;\\n','m'),'');
 }
 s = s.replace(/    \) : row\.completedAt !== null && row\.uploadedAt === null && !broken \? \([\s\S]*?    \) : row\.status !== 'done' \? \(/, "    ) : row.status !== 'done' ? (");
 s = s.replace(/      \{\/\*\n        ⚠️⚠️ \*\*ভুল পাওয়া অথচ ঠিক-না-হওয়া ডিজাইনে "Uploaded"[\s\S]*?      \{row\.uploadedAt !== null && row\.liveAt === null && \([\s\S]*?      \)\}\n/, '');
 s = s.replace(/  \/\*\*\n   \* খোলা অবস্থা — সব কিছু, ক্রম মেনে\.[\s\S]*?   \*\/\n/, '  /** Design Pool-এ design ও proofreading actions; upload/live controls সরানো হয়েছে। */\n');
 s = s.replaceAll('Dates refer to completion time in Dhaka time, including designs uploaded or made live later.', 'Dates refer to completion time in Dhaka time.');
 fs.writeFileSync(path, s.replace(/\n/g,'\r\n'));
}
const apiPath = '.release-pool/oxeio-monitor/web/src/api/targets.ts';
let api = fs.readFileSync(apiPath,'utf8').replace(/\r\n/g,'\n');
api = api.replace(/\/\*\* ⭐ "আপলোড হয়েছে"[^\n]*\nexport function markUploaded[\s\S]*?\n\}\n\n/, '');
api = api.replace('/** ⭐ "Amazon-এ লাইভ" — নতুন পণ্যের ASIN ঐচ্ছিক */\n','');
api = api.replace(/export function markLive[\s\S]*?\n\}\n\n/,'');
fs.writeFileSync(apiPath,api.replace(/\n/g,'\r\n'));
