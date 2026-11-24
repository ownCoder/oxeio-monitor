const fs = require('fs');
const root = '.release-skip/oxeio-monitor/';
let schema = fs.readFileSync(root+'server/prisma/schema.prisma','utf8');
const current = fs.readFileSync('oxeio-monitor/server/prisma/schema.prisma','utf8');
schema = schema.replace('model DesignTarget {','model DesignTarget {\n  skipReviewPending Boolean @default(false) @map("skip_review_pending")\n  skipRequestedAt DateTime? @map("skip_requested_at") @db.Timestamptz(3)\n  skipRequests DesignSkipRequest[]\n  history DesignTargetEvent[]');
schema += '\n'+current.slice(current.indexOf('/// A request survives'), current.indexOf('model DesignPreview {'));
fs.writeFileSync(root+'server/prisma/schema.prisma',schema);
for (const file of ['web/src/pages/AllTargetsPage.tsx','web/src/pages/MyTargets.tsx']) {
 let s=fs.readFileSync(root+file,'utf8').replace(/import \{ Link \} from 'react-router-dom';\r?\n/,'');
 s=s.replace(/<Link to=\{`\/production\/board\?target=\$\{[^}]+\}`\} className="[^"]+">History & review<\/Link>/g,'');
 fs.writeFileSync(root+file,s);
}
