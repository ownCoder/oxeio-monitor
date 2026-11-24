const {PrismaClient}=require('@prisma/client');
const {hash}=require('@node-rs/argon2');
(async()=>{
 const db=new PrismaClient();
 const owner=await db.user.create({data:{email:'owner@office-preview.local',fullName:'Preview Owner',role:'owner',mustChangePw:false,passwordHash:await hash('Preview-only-2026!')}});
 const employee=await db.employee.create({data:{empCode:'DEMO-01',fullName:'Preview Designer',staffType:'designer'}});
 await db.user.create({data:{email:'designer@office-preview.local',fullName:'Preview Designer',role:'employee',employeeId:employee.id,mustChangePw:false,passwordHash:await hash('Preview-only-2026!')}});
 const target=await db.designTarget.create({data:{asin:'B000000001',jobNumber:1000010,status:'assigned',assignedToId:employee.id,addedById:owner.id}});
 const entries=[
  {kind:'brief_template',title:'Typography design brief',content:{niche:'Pets',audience:'Cat lovers',style:'Simple typography',requiredText:'Owner-approved text',reference:'Use the provided reference for direction',output:'PNG and editable source'}},
  {kind:'brief',title:'Cat design: instructions',targetId:target.id,content:{niche:'Pets',audience:'Cat lovers',style:'Simple typography',requiredText:'Example only',reference:'Synthetic preview',output:'PNG and editable source'}},
  {kind:'checklist_template',title:'PNG submission checklist',content:{items:['File starts with the design number','Check spelling','Include source file'],format:'png',width:4500,height:5400}},
  {kind:'sop',title:'Design handover — বাংলা নির্দেশনা',content:{body:'১. Design brief পড়ে নাও।\n২. File name design number দিয়ে শুরু করো।\n৩. বানান ও output format মিলিয়ে নাও।\n৪. আটকে গেলে Help request দাও।\n৫. Submission checklist যাচাই করো।\n\nএগুলো synthetic preview examples; অফিসের নতুন policy নয়।'}},
  {kind:'asset',title:'Design workstation',employeeId:employee.id,content:{tag:'DEMO-PC-01',serial:'Example serial',deviceId:0,warranty:'2027-09-29',state:'in_use',note:'Issued to the preview designer'}},
  {kind:'lifecycle_template',title:'Designer joining checklist',content:{type:'joining',due:'',tasks:[{label:'Account and agent setup',done:false,responsible:'Manager'},{label:'Read design SOP',done:false,responsible:'Designer'},{label:'Equipment handover',done:false,responsible:'Manager'}]}},
  {kind:'coaching',title:'Typography practice',employeeId:employee.id,content:{skills:[{name:'Typography',level:3}],goal:'Practice spacing with two examples',followUp:'2026-10-05',note:'Synthetic coaching example'}}
 ];
 for(const entry of entries){const row=await db.officeEntry.create({data:{...entry,createdBy:owner.id}});await db.officeEvent.create({data:{entryId:row.id,actorId:owner.id,actorName:owner.email,action:'created',version:1,snapshot:{title:row.title,employeeId:row.employeeId,content:row.content}}});}
 await db.$disconnect();
 console.log('Synthetic office preview fixtures ready.');
})().catch(e=>{console.error(e.message);process.exit(1);});
