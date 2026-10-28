const fs=require('node:fs');
function check(d,w={}){
 const issues=[],add=(code,message)=>issues.push({code,message});
 if(!(d.crossDimensionRows||[]).length)add('CROSS_DIMENSION_MISSING','缺品类×物料组×大区×省区列表');
 const cats=(d.demandRows||[]).filter(r=>r.view==='品类经理');
 if(!cats.length)add('CATEGORY_MISSING','缺品类视角，先核查同月基地口径映射');
 for(const k of ['demandChangeShortage','inPlanShortage'])if(d.metric?.[k]==null)add('CLASSIFICATION_MISSING',k+'未取得；核查正缺货逐源行复算及必要值');
 const scan=(rs)=>{let n=0;for(const r of rs||[]){n+=(r.detailRows||[]).reduce((s,x)=>s+(x.records?.length||0),0);n+=scan(r.children);}return n;};
 for(const c of cats)if(!scan([c]))add('CATEGORY_DRILL_MISSING',c.object+'没有订单源行下钻，需核对其实际数据范围');
 const tasks=w.tasks||[];if(!tasks.some(t=>t.id==='schedule'))add('SCHEDULE_TASK_MISSING','缺排程查询任务与结果证据');
 for(const t of tasks)if(['orders','category','production','schedule'].includes(t.id)&&['pending','partial','query_failed'].includes(t.status))add('SOURCE_INCOMPLETE',t.id+': '+t.status);
 if(!(d.planRows||[]).length&&!(d.scheduleSupplyRows||[]).length)add('SUPPLY_MISSING','MES及排程供给列表均未取得');
 for(const p of d.dataProvenance||[])if(p.complete===false)add('PROVENANCE_PARTIAL',p.id+'未取得完整性证明');
 return {status:issues.length?'INCOMPLETE':'STRUCTURE_READY',issues,categoryCount:cats.length,browserVisual:'NOT_RUN',note:'此检查定位模板缺数，不能替代单位口径、查询完整性审计或浏览器点击验收'};
}
module.exports=check;
if(require.main===module){const [a,b,c]=process.argv.slice(2),r=check(JSON.parse(fs.readFileSync(a)),JSON.parse(fs.readFileSync(b)));if(c)fs.writeFileSync(c,JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));if(r.issues.length)process.exitCode=1;}
