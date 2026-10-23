// Independent source/coverage check. No credentials, network or report generation.
const fs=require('node:fs'),path=require('node:path');
function validate(contractPath,reportPath){
 const cfg=JSON.parse(fs.readFileSync(contractPath,'utf8').replace(/^\uFEFF/,'')),base=path.dirname(contractPath),issues=[],checks=[],cache=new Map();
 const check=(name,ok,detail)=>{checks.push({name,pass:!!ok,detail});if(!ok)issues.push({name,detail});};
 const load=file=>{if(!cache.has(file)){const p=path.resolve(base,file),raw=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));const r=raw.response?.result;const body=r?.structuredContent?.datasets?r.structuredContent:JSON.parse(r?.content?.find(x=>x.type==='text')?.text||'null');if(!body?.datasets)throw Error('完整MCP响应缺失datasets: '+file);cache.set(file,{raw,body});}return cache.get(file);};
 const dataset=ref=>{const {raw,body}=load(ref.file),d=body.datasets.find(x=>x.name===ref.dataset);if(!d)throw Error('数据集名不匹配: '+ref.dataset);const request=raw.params?.arguments?.queries?.find(x=>x.name===ref.dataset)?.query;if(!request)throw Error('缺少同名原始请求: '+ref.dataset);check(ref.dataset+' 模型身份',d.modelContext?.some(x=>x.name===ref.model),ref.model);check(ref.dataset+' 期间',request.timeDimensions?.some(x=>JSON.stringify(x.dateRange)===JSON.stringify(cfg.dateRange)),request.timeDimensions);check(ref.dataset+' 返回行数',d.rows.length===d.rowCount,d.rowCount);check(ref.dataset+' offset',Number(request.offset||0)===Number(d.offset||0),d.offset);return {d,request};};
 const sources={};
 for(const [role,ref] of Object.entries(cfg.sources)){
  const {d,request}=dataset(ref);sources[role]=d;
  check(role+' 完整返回',!d.hasMorePages && d.rows.length===d.totalRowCount,{rows:d.rows.length,total:d.totalRowCount});
  for(const field of Object.values(ref.fields||{}))check(role+' 字段身份 '+field,d.fields?.some(x=>x.name===field),field);
 }
 for(const group of cfg.pagedGroups||[]){
  let all=[],expectedOffset=0,expectedTotal=null,fields=[];
  for(let i=0;i<group.pages.length;i++){
   const {d,request}=dataset(group.pages[i]);
   check(group.id+' 连续分页 '+i,d.offset===expectedOffset,d.offset);expectedOffset+=d.rows.length;
   check(group.id+' 稳定排序 '+i,group.keyMembers.every(k=>request.order?.[k]==='asc'||request.order?.[k]==='desc'),group.keyMembers);
   check(group.id+' 分页总量稳定 '+i,expectedTotal===null||expectedTotal===d.totalRowCount,d.totalRowCount);expectedTotal=d.totalRowCount;
   check(group.id+' 终页标记 '+i,i===group.pages.length-1?!d.hasMorePages:d.hasMorePages,d.hasMorePages);all.push(...d.rows);fields=d.fields;
  }
  check(group.id+' 总行数',all.length===expectedTotal,{actual:all.length,expected:expectedTotal});
  const keys=all.map(r=>JSON.stringify(group.keyMembers.map(k=>r[k])));check(group.id+' 键无重复',new Set(keys).size===keys.length,{rows:keys.length,unique:new Set(keys).size});
  const totals=sources[group.totalRole];if(!totals)throw Error('未定义汇总角色 '+group.totalRole);
  for(const m of group.sumMembers){const values=all.map(r=>r[m]),totalValues=totals.rows.map(r=>r[m]);check(group.id+' 基础量非空 '+m,values.every(Number.isFinite)&&totalValues.every(Number.isFinite),m);const actual=values.reduce((a,b)=>a+b,0),expected=totalValues.reduce((a,b)=>a+b,0);check(group.id+' 明细合计 '+m,Math.abs(actual-expected)<.01,{actual,expected});}
  if(group.baseMember)for(const totalRow of totals.rows)for(const m of group.sumMembers){const baseValue=totalRow[group.baseMember],actual=all.filter(r=>r[group.baseMember]===baseValue).reduce((s,r)=>s+r[m],0);check(group.id+' 基地勾稽 '+baseValue+' '+m,Math.abs(actual-totalRow[m])<.01,{actual,expected:totalRow[m]});}
 }
 const primary=cfg.sources.primary,d=sources.primary,r=d.rows[0]||{},f=primary.fields,primaryAvailable=d.dataStatus!=='no_data'&&r[f.count]>0&&[f.need,f.shipped,f.shortage,f.rate].every(k=>r[k]!=null);
 const decision=cfg.metricDecision||{},formalAllowed=primaryAvailable&&decision.definitionStatus==='resolved'&&decision.coverageVerified===true&&decision.unitsVerified===true&&Array.isArray(decision.evidence)&&decision.evidence.length>0;
 if(reportPath){const report=JSON.parse(fs.readFileSync(reportPath,'utf8').replace(/^\uFEFF/,''));if(cfg.sources.candidate?.fields){const ref=cfg.sources.candidate,src=sources.candidate.rows[0]||{},sm=report.sourceMetric;check('候选源结果必须可见',!!sm,sm?.source);if(sm){check('候选源标签完整',sm.source===ref.model&&!!sm.status&&!!sm.note&&!!sm.unit,sm.source);for(const [key,member] of Object.entries(ref.fields)){if(key==='count')continue;check('候选源展示一致 '+key,src[member]===sm[key],{source:src[member],display:sm[key]});}}check('已取到数据必须有下钻视图',Array.isArray(report.sourceViews)&&report.sourceViews.length>0,report.sourceViews?.length);}if(!formalAllowed){for(const k of ['rate','need','rawShipped','monthlyShortage'])check('正式指标不得偷换来源 '+k,report.metric?.[k]===null,report.metric?.[k]);}
  else{for(const [k,m] of Object.entries({rate:f.rate,need:f.need,rawShipped:f.shipped,monthlyShortage:f.shortage}))check('正式指标来源一致 '+k,Number.isFinite(report.metric?.[k])&&Math.abs(report.metric[k]-r[m])<1e-6,{report:report.metric?.[k],source:r[m]});}
  for(const [role,ref] of Object.entries(cfg.sources)){if(role==='production'){const declared=report.scope?.productionUnitStatus,units=sources[role].fields.filter(x=>[ref.fields.plan,ref.fields.actual].includes(x.name)).map(x=>x.unit||x.meta?.unit);if(units.some(x=>!x||x==='源数量单位'))check('生产未知单位不得声明件',declared==='unverified'&&report.scope.productionUnit==='源数量单位（待核验）',report.scope);}}
 }
 return {status:issues.length?'FAIL':'PASS',formalMetricAllowed:formalAllowed,formalMetricStatus:formalAllowed?'eligible_for_definition_review':'unresolved',checks,issues,note:'机械验收不等于指标定义已裁决、原因已验证或浏览器已验收'};
}
module.exports=validate;
if(require.main===module){try{const r=validate(process.argv[2],process.argv[4]);fs.writeFileSync(process.argv[3],JSON.stringify(r,null,2));console.log(JSON.stringify({status:r.status,checks:r.checks.length,formalMetricAllowed:r.formalMetricAllowed,issues:r.issues}));if(r.status==='FAIL')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
