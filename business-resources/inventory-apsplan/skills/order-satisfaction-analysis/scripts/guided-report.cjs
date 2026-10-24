/* Guided evidence workflow. No network, no credentials, no automatic causal inference. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const audit=require('./audit-report-data.cjs');
const tasks=['definition','orders','classification','sales','category','production','schedule','transfer','oe','od','inventory','linkage'];
const states=['pending','acquired','partial','source_null','empty_scope','unsupported','query_failed','not_applicable','conflict'];
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2));};
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const present=v=>v!=null&&String(v).trim()!==''&&!/^(?:—|-|null|undefined)$/.test(String(v).trim())&&!/全部.*SKU|汇总|全部产品/.test(String(v));
function init(dir){
 const file=path.join(dir,'work-order.json');if(fs.existsSync(file))throw Error('任务单已存在，不覆盖');
 write(file,{period:null,cutoff:null,object:null,unit:'件',tasks:tasks.map(id=>({id,status:'pending',model:null,revision:null,grain:[],complete:false,querySummary:null,retrievedAt:null,evidenceFiles:[],bindings:[],checks:[],reason:null}))});
 return {file,next:'按query-recipes执行一项，保存证据并更新状态，然后status'};
}
function workCheck(dir){
 const file=path.join(dir,'work-order.json');if(!fs.existsSync(file))return {errors:['缺work-order.json'],gaps:[],tasks:[]};
 const w=read(file),errors=[],gaps=[];
 for(const k of ['period','cutoff','object','unit'])if(!present(w[k]))errors.push('任务范围缺'+k);
 const seen=new Set();for(const t of w.tasks||[]){
  if(seen.has(t.id))errors.push('任务重复'+t.id);seen.add(t.id);
  if(!states.includes(t.status))errors.push('非法状态'+t.id);
  if(t.status==='pending'){errors.push('尚未查询/判断适用性：'+t.id);continue;}
  if(!(t.checks||[]).length)errors.push(t.id+'没有检查记录');
  if(!(t.evidenceFiles||[]).length)errors.push(t.id+'缺证据文件');
  for(const f of t.evidenceFiles||[]){const abs=path.resolve(dir,f);if(!fs.existsSync(abs)||!fs.statSync(abs).isFile())errors.push(t.id+'证据不存在：'+f);}
  if(t.status==='acquired'&&(!t.complete||!present(t.model)||!present(t.retrievedAt)||!(t.grain||[]).length||!present(t.querySummary)))errors.push(t.id+'取得数据但来源/完整性未填');
  if(t.status!=='acquired'){if(!present(t.reason))errors.push(t.id+'缺停止理由');gaps.push({id:t.id,status:t.status,reason:t.reason});}
 }
 for(const id of tasks)if(!seen.has(id))errors.push('缺任务'+id);
 return {errors,gaps,tasks:w.tasks||[],scope:{period:w.period,cutoff:w.cutoff,object:w.object,unit:w.unit}};
}
function packet(d,input){
 const ids=new Set();for(const b of d.planRows||[])for(const i of b.findingIds||[])if(d.findings?.[i]?.scopeKey===b.scopeKey)ids.add(i);
 // Only one non-overlapping level. Keep aggregated day facts separate from reason facts.
 const facts=[...ids].map(i=>{
  const f=d.findings[i],rs=f.records||[],days=new Set(),shortDays=new Set();
  let planned=0,actual=0,positive=0,valid=0;
  rs.forEach(r=>{if(/^\d{4}-\d{2}-\d{2}/.test(r.date||''))days.add(r.date.slice(0,10));if(Number.isFinite(r.planned)&&Number.isFinite(r.actual)){valid++;planned+=r.planned;actual+=r.actual;positive+=Math.max(r.planned-r.actual,0);if(r.planned>r.actual&&r.date)shortDays.add(r.date.slice(0,10));}});
  return {kind:'production',findingId:i,object:f.object,scopeKey:f.scopeKey,reasonText:f.reasonText??null,status:f.status,
   evidence:f.evidence||[],recordRefs:rs.map((_,j)=>`findings[${i}].records[${j}]`),
   stats:{recordCount:rs.length,datedDays:days.size,shortDays:shortDays.size,planned:valid===rs.length&&valid?planned:null,actual:valid===rs.length&&valid?actual:null,netGap:valid===rs.length&&valid?planned-actual:null,positiveRowGap:valid===rs.length&&valid?positive:null,withSKU:rs.filter(r=>present(r.sku)).length,withLine:rs.filter(r=>present(r.line)).length,withProductionOrder:rs.filter(r=>present(r.order)).length},
   records:rs,boundary:f.boundary||f.counterEvidence||null};
 });
 const demandFacts=[];
 function demandWalk(rows,parents=[],prefix='demandRows'){
  rows.forEach((r,i)=>{const ref=prefix+'['+i+']',objects=[...parents,r.object];
   if(['ordered','monthlyShortage','initialReportedDemand','reported','accuracy'].some(k=>Number.isFinite(r[k])))demandFacts.push({kind:'demand',findingId:'demand:'+ref,object:(r.view||'需求')+' × '+objects.join(' × '),reasonText:null,status:'verified_fact',evidence:[r.sourceId||'report-data:'+ref],recordRefs:[ref],stats:{ordered:r.ordered??null,monthlyShortage:r.monthlyShortage??null,initialReportedDemand:r.initialReportedDemand??null,adjustedReportedDemand:r.reported??null,accuracyPercent:r.accuracy??null},boundary:r.scopeNote||'当前输入路径支持数量事实；需求原因需事件与版本证据，不能用缺货量替代准确率。'});
   demandWalk(r.children||[],objects,ref+'.children');
  });
 }demandWalk(d.demandRows||[]);facts.push(...demandFacts);
 // Schedule facts retain their own source meaning and unit, even if MES is empty.
 const scheduleGroups=new Map();for(const [i,r] of (d.scheduleSupplyRows||[]).entries()){
  const k=JSON.stringify([r.data_source??null,r.factory_name??null,r.measure_unit??null]);
  if(!scheduleGroups.has(k))scheduleGroups.set(k,[]);scheduleGroups.get(k).push({i,r});
 }
 for(const [k,items] of scheduleGroups){
  const rows=items.map(x=>x.r),ref=require('./supply-scope.js').reference(rows,null,rows[0].factory_name,null,d.scheduleSupplyMetadata||{});
  if(!ref?.rows?.length)continue;
  const planned=ref.totals.planned,actual=ref.totals.delivered,days=new Set(rows.map(r=>r.base_finish_day));
  facts.push({kind:'production_schedule',findingId:'schedule:'+k,object:'生产排程 × '+(rows[0].factory_name||'基地未提供')+' × '+(rows[0].data_source||'来源未提供'),status:'verified_fact',reasonText:null,
   evidence:['sourceId:schedule'],recordRefs:items.map(x=>'scheduleSupplyRows['+x.i+']'),unit:ref.unit,
   stats:{recordCount:rows.length,datedDays:days.size,shortDays:null,planned,actual,netGap:planned!=null&&actual!=null?planned-actual:null,positiveRowGap:ref.rows.every(r=>r.order_qty!=null&&r.deliv_qty!=null)?ref.rows.reduce((s,r)=>s+Math.max(r.order_qty-r.deliv_qty,0),0):null,withSKU:rows.filter(r=>present(r.material_code)).length,withLine:0,withProductionOrder:rows.filter(r=>present(r.order_no)).length},
   records:ref.rows,boundary:'排程计划与交付独立于MES实绩；单位 '+ref.unit+'；无原因原文，不补原因标签。'});
 }
 return {inputSha256:sha(input),unit:d.scope?.unit,scope:d.scope,metric:d.metric,warning:'各finding及父子/不同视角可能重叠，不跨finding或层级相加。数字为当前输入的事实统计，未核验上游真实性。',facts,
  demandObservations:(d.demandRows||[]).map(r=>({object:r.object,view:r.view,ordered:r.ordered,monthlyShortage:r.monthlyShortage,reported:r.reported,accuracy:r.accuracy})),audit:audit(d)};
}
function check(input,dir){
 const d=read(input),a=audit(d),w=workCheck(dir),bindingAudit=require('./audit-bindings.cjs').audit(d),errors=[...w.errors,...a.issues.filter(x=>x.severity==='error').map(x=>x.code+': '+x.message),...bindingAudit.errors.map(x=>x.code+': '+x.message)];
 for(const t of w.tasks){
  if(t.status==='acquired'&&['orders','sales','production','schedule'].includes(t.id)&&!(t.bindings||[]).length)errors.push(t.id+'缺查询到页面的绑定核对');
  for(const b of t.bindings||[]){
   const target=String(b.target||'').split('.').reduce((v,k)=>v?.[k],d);
   if(!Number.isInteger(b.sourceRows)||b.sourceRows<0)errors.push(t.id+'绑定sourceRows非法');
   if(b.sourceRows>0&&(!Array.isArray(target)||!target.length))errors.push(t.id+'原始返回有数据但目标为空：'+b.target);
   if(b.hasMorePages===true)errors.push(t.id+'分页未结束：'+b.target);
  }
 }
 const p=packet(d,input),file=path.join(dir,'analysis-cards.json'),doc=fs.existsSync(file)?read(file):{cards:[]};
 if(doc.inputSha256!==p.inputSha256)errors.push('证据卡输入指纹不匹配；重新packet并审阅');
 const reviewed=(doc.cards||[]).filter(c=>c.include===true),allowed=['verified_fact','supported_unverified','hypothesis','verified_cause'];
 if(reviewed.length)for(const kind of ['demand','production']){
  const relevant=p.facts.some(f=>f.kind===kind&&(kind==='demand'||present(f.reasonText)));
  if(relevant&&!reviewed.some(c=>p.facts.some(f=>f.findingId===c.findingId&&f.kind===kind)))errors.push('已有'+kind+'可分析事实但未审阅该分支证据卡');
 }
 for(const [i,c] of reviewed.entries()){
  const fact=p.facts.find(x=>x.findingId===c.findingId),f=typeof c.findingId==='number'?d.findings?.[c.findingId]:fact;
  if(!f||!fact){errors.push('证据卡'+i+'不指向生产或需求事实');continue;}
  if(c.object!==f.object)errors.push('证据卡'+i+'对象不匹配');
  for(const k of ['interpretation','boundary','action','owner','acceptance'])if(!present(c[k]))errors.push('证据卡'+i+'缺'+k);
  if(!allowed.includes(c.status))errors.push('证据卡'+i+'状态非法');
  if(!(c.evidenceRefs||[]).length||c.evidenceRefs.length!==fact.recordRefs.length||new Set(c.evidenceRefs).size!==fact.recordRefs.length||c.evidenceRefs.some(x=>!fact.recordRefs.includes(x)))errors.push('证据卡'+i+'引用须覆盖该finding全部记录；需子集分析时先建立真实子集finding');
  if(!f.evidence?.length)errors.push('证据卡'+i+'原finding没有来源');
  if(c.status==='verified_cause'&&(fact.kind==='demand'||f.status!=='verified_cause'||!present(f.orderSupplyLink)||!present(f.eventTime)||!Number.isFinite(f.impact)))errors.push('证据卡'+i+'不能升级为已验证订单根因');
 }
 if(!(d.dataProvenance||[]).length)errors.push('缺dataProvenance，需将真实查询来源写入输入');
 for(const s of d.dataProvenance||[])if(!present(s.id)||!present(s.model)||!present(s.period)||!present(s.retrievedAt)||!Array.isArray(s.grain)||!s.grain.length||!Array.isArray(s.files)||!s.files.length)errors.push('dataProvenance来源字段不全：'+(s.id||'?'));
 const businessIssues=require('./business-conclusion.cjs').review(d,p,reviewed);
 for(const i of businessIssues)if(['AGGREGATE_CAUSAL_EXCLUSION','FACT_CONTAINS_INFERENCE','CONCLUSION_BASE_COUNT_CONFLICT'].includes(i.code))errors.push(i.code+'：'+i.object+' '+i.message);
 const templateCoverage=require('./check-template-coverage.cjs')(d,w);
 const status=errors.length?'BLOCKED':templateCoverage.status==='INCOMPLETE'?'INCOMPLETE':!reviewed.length?'DRAFT_ONLY':w.gaps.length||a.issues.length||businessIssues.length?'READY_WITH_GAPS':'READY_FOR_REVIEW';
 const result={status,templateCoverage,inputSha256:p.inputSha256,errors,businessIssues,bindingAudit,productionOverview:require('./business-conclusion.cjs').productionOverview(d),gaps:w.gaps,dataContract:a,reviewedCards:reviewed.length,businessReview:'MANUAL_REVIEW_REQUIRED',visualBrowser:'NOT_RUN'};
 write(path.join(dir,'acceptance.json'),result);return {result,d,p,reviewed,w};
}
function build(input,dir,out){
 const x=check(input,dir);if(x.result.errors.length)throw Error('检查未通过，见acceptance.json');
 if(fs.existsSync(out))throw Error('输出目录已存在，请使用新目录');
 let d=JSON.parse(JSON.stringify(x.d));d.scope.draft=true;
 d.conclusion={...d.conclusion,sections:require('./business-conclusion.cjs').sections(d,x.p,x.reviewed,x.w.gaps,[...x.result.dataContract.issues,...x.result.businessIssues])};
 write(path.join(dir,'evidence-links.json'),{inputSha256:x.p.inputSha256,cards:x.reviewed.map(c=>({object:c.object,findingId:c.findingId,evidenceRefs:c.evidenceRefs}))});
 // 紧凑落盘并释放父进程大对象：避免与渲染子进程叠加内存（大输入下曾导致渲染进程原生崩溃）
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report-data.json'),JSON.stringify(d));
 d=null;if(x.d)x.d=null;if(x.p)x.p=null;
 const generator=path.join(__dirname,'generate-report.cjs');
 // 主路径：继承 stdio 的子进程（受限沙箱只禁止管道 stdio，inherit 可用；子进程独立堆，避免大输入 OOM）。
 // 回退：输入较小且沙箱连 inherit 也拒绝时，改为进程内渲染。
 const inputFile=path.join(out,'report-data.json'),inputBytes=fs.statSync(inputFile).size;
 try{cp.execFileSync(process.execPath,[generator,inputFile,out],{stdio:['ignore','ignore','inherit']});}
 catch(err){
  if(inputBytes>32*1024*1024)throw Error('渲染失败（退出码 '+((err&&err.status)??'?')+'）：'+((err&&err.message)||err)+'；等价命令：node '+generator+' '+inputFile+' '+out);
  try{require(generator).generate(JSON.parse(fs.readFileSync(inputFile,'utf8')),out);}
  catch(e3){throw Error('渲染失败：'+((e3&&e3.message)||e3)+'；等价命令：node '+generator+' '+inputFile+' '+out);}
 }
 for(const f of ['acceptance.json','work-order.json','analysis-cards.json','evidence-packet.json','evidence-links.json'])if(fs.existsSync(path.join(dir,f)))fs.copyFileSync(path.join(dir,f),path.join(out,f));
 const evidenceOut=path.join(out,'query-evidence');fs.mkdirSync(evidenceOut,{recursive:true});
 const evidence=[];for(const t of x.w.tasks)for(const f of t.evidenceFiles||[]){const src=path.resolve(dir,f),hash=sha(src),name=hash+path.extname(src);if(!fs.existsSync(path.join(evidenceOut,name)))fs.copyFileSync(src,path.join(evidenceOut,name));evidence.push({task:t.id,original:f,exported:'query-evidence/'+name,sha256:hash});}
 write(path.join(out,'query-evidence-manifest.json'),evidence);
 return {out,status:x.result.status,businessReview:'MANUAL_REVIEW_REQUIRED',visualBrowser:'NOT_RUN',draft:true};
}
module.exports={init,workCheck,packet,check,build,present};
if(require.main===module){try{const [cmd,a,b,c]=process.argv.slice(2);let result;
 if(cmd==='init')result=init(path.resolve(a));
 else if(cmd==='status')result=workCheck(path.resolve(a));
 else if(cmd==='packet'){const force=process.argv.includes('--force');const p=packet(read(a),a);write(path.join(b,'evidence-packet.json'),p);const target=path.join(b,'analysis-cards.json');const fresh={inputSha256:p.inputSha256,cards:p.facts.filter(f=>f.kind==='demand'||f.kind==='production_schedule'||present(f.reasonText)).map(f=>({include:false,findingId:f.findingId,object:f.object,evidenceRefs:f.recordRefs,interpretation:'',boundary:f.boundary||'',action:'',owner:'',acceptance:'',status:['demand','production_schedule'].includes(f.kind)?'verified_fact':'supported_unverified'}))};
  if(!fs.existsSync(target)||force){write(target,fresh);result={facts:p.facts.length,cards:target,audit:p.audit.status};}
  else{const old=read(target),same=old.inputSha256===p.inputSha256,alt=path.join(b,'analysis-cards.new.json');write(alt,fresh);result={facts:p.facts.length,cards:target,audit:p.audit.status,existingCardsFingerprint:same?'MATCH':'STALE',newCards:alt,action:same?'输入未变化，已保留现有审阅结果；需重置审阅请加 --force':'输入已变更：现有证据卡指纹不匹配。确认后删除 analysis-cards.json（或加 --force）再重新审阅'};if(!same)process.exitCode=1;}}
 else if(cmd==='check'){result=check(path.resolve(a),path.resolve(b)).result;if(result.errors.length)process.exitCode=1;}
 else if(cmd==='build')result=build(path.resolve(a),path.resolve(b),path.resolve(c));
 else throw Error('用法：init/status <目录>；packet/check <输入JSON> <任务目录>；build <输入JSON> <任务目录> <新输出目录>');
 console.log(JSON.stringify(result,null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
