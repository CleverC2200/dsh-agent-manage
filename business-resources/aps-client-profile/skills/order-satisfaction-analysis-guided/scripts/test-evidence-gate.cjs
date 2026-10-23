const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),validate=require('./evidence-gate.cjs');
const contractFile=path.resolve(process.argv[2]),reportFile=path.resolve(process.argv[3]),dir=path.dirname(contractFile),temp=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-gate-'));
const original=JSON.parse(fs.readFileSync(contractFile,'utf8')),report=JSON.parse(fs.readFileSync(reportFile,'utf8'));const cases=[];
function run(name,editContract,editReport,want){const c=structuredClone(original),r=structuredClone(report);for(const ref of [...Object.values(c.sources),...c.pagedGroups.flatMap(g=>g.pages)])ref.file=path.resolve(dir,ref.file);editContract?.(c);editReport?.(r);const cf=path.join(temp,'contract.json'),rf=path.join(temp,'report.json');fs.writeFileSync(cf,JSON.stringify(c));fs.writeFileSync(rf,JSON.stringify(r));let ok;try{ok=validate(cf,rf).status==='PASS';}catch{ok=false;}assert.equal(ok,want,name);cases.push({name,pass:true});}
run('真实证据和待核验正式指标通过',null,null,true);
run('拒绝把候选46.02%写入正式率',null,r=>r.metric.rate=.4601671,false);
run('拒绝把候选需求冒充正式需求',null,r=>r.metric.need=1493316,false);
run('拒绝未知生产单位硬写件',null,r=>{r.scope.productionUnit='件';r.scope.productionUnitStatus='declared';},false);
run('拒绝数据集名字替换',c=>c.sources.primary.dataset=c.sources.candidate.dataset,null,false);
run('拒绝模型身份替换',c=>c.sources.primary.model=c.sources.candidate.model,null,false);
run('拒绝仅取生产首页',c=>c.pagedGroups[0].pages=c.pagedGroups[0].pages.slice(0,1),null,false);
run('拒绝重复分页',c=>c.pagedGroups[0].pages[1]=structuredClone(c.pagedGroups[0].pages[0]),null,false);
run('拒绝跨期来源',c=>c.dateRange=['2026-08-01','2026-08-31'],null,false);
run('不能仅声明已确认而绕过主模型空集',c=>c.metricDecision={definitionStatus:'resolved',coverageVerified:true,unitsVerified:true,evidence:['自称已核验']},r=>r.metric.rate=.4601671,false);
run('拒绝隐藏已取得源值',null,r=>delete r.sourceMetric,false);
run('拒绝隐藏全部下钻',null,r=>r.sourceViews=[],false);
run('拒绝错误源展示',null,r=>r.sourceMetric.need=123,false);
console.log(JSON.stringify({status:'PASS',cases,temp},null,2));
