const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
 const devices = await p.device.groupBy({by:['status','agentVersion'],_count:{_all:true}});
 const active = await p.device.count({where:{status:'active'}});
 const recent = await p.device.count({where:{status:'active',lastSeenAt:{gte:new Date(Date.now()-15*60000)}}});
 const versions = await p.agentVersion.findMany({orderBy:{releasedAt:'desc'},take:3,select:{version:true,rolloutStage:true,releasedAt:true}});
 const backup = await p.setting.findUnique({where:{key:'ops.backup.state'},select:{value:true}});
 const state = backup?.value ?? {};
 const backupSummary = Object.fromEntries(['lastSuccessAt','lastAttemptAt','lastOutcome','lastSizeBytes','consecutiveFailures','copyOutcome'].map(k=>[k,state[k]??null]));
 const closureCount = await p.monthClosure.count();
 const openAlerts = await p.alert.groupBy({by:['type','severity'],where:{acknowledgedAt:null,resolvedAt:null},_count:{_all:true}});
 console.log(JSON.stringify({devices,active,recentHeartbeats15min:recent,versions,backupSummary,closedMonths:closureCount,openAlerts},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
