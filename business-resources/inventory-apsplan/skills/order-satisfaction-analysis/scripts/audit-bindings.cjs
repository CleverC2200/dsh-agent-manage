const fs=require('node:fs'),Supply=require('./supply-scope.js');
function audit(d){
 const errors=[],warnings=[],scopes=[];
 const add=(code,message)=>errors.push({code,message});
 const sum=(rs,k)=>rs.reduce((s,r)=>s+(r[k]??0),0);
 const cross=d.crossDimensionRows||[];
 for(const [k,m] of [['ordered','need'],['shipped','rawShipped'],['monthlyShortage','monthlyShortage'],['initialReportedDemand','initialReportedDemand'],['reported','reportedDemand']])if((cross.length||d.pipelineVersion)&&d.metric?.[m]!=null&&Math.abs(sum(cross,k)-d.metric[m])>.001)add('CROSS_TOTAL_MISMATCH',k+'分组合计与全国指标不一致');
 for(const r of cross){
  const detail=r.detailRows||[];
  if((r.orderRows||r.salesRows)&&!detail.length)add('DETAILS_EMPTY','已有数据的维度缺SKU明细：'+r.scopeKey);
  for(const [k,detailKey] of [['ordered','ordered'],['shipped','shipped'],['reported','reported'],['initialReportedDemand','initialReportedDemand'],['gap','demandGap'],['inPlanReference','inPlanGap']])if(r[k]!=null&&Math.abs(sum(detail,detailKey)-r[k])>.001)add('SKU_TOTAL_MISMATCH',r.scopeKey+' '+k);
  for(const sku of detail){if(sku.positiveRows!=null&&sku.positiveRows!==(sku.records||[]).length)add('SOURCE_ROWS_MISSING',sku.skuCode+' 正缺货源行数不符');for(const [k,sourceKey] of [['demandGap','demandGap'],['inPlanGap','inPlanGap']])if(sku[k]!=null&&Math.abs(sum(sku.records||[],sourceKey)-sku[k])>.001)add('SOURCE_TOTAL_MISMATCH',sku.skuCode+' '+k);}
 }
 const mes=new Set();for(const b of d.planRows||[])for(const c of b.children||[])for(const s of c.children||[])mes.add(String(s.object).split(' ')[0].trim());
 const walk=xs=>xs.flatMap(x=>[x,...walk(x.children||[])]);
 for(const [view,roots] of [['category',d.classificationPlanDimensionRows||[]],['base',d.classificationPlanRows||[]]])for(const r of roots){
  const details=view==='category'?cross.filter(x=>x.category===r.object).flatMap(x=>x.detailRows||[]):walk([r]).flatMap(x=>x.detailRows||[]);
  const codes=new Set(details.filter(x=>x.inPlanGap>0).map(x=>String(x.skuCode).trim()));
  const matched=[...codes].filter(c=>mes.has(c)),schedule=Supply.reference(d.scheduleSupplyRows,codes,r.object,r.gap,d.scheduleSupplyMetadata||{});
  const source=(d.dataProvenance||[]).find(p=>p.id==='schedule');
  const coverageKnown=source?.complete===true&&['acquired','empty_scope','source_null'].includes(source.status);
  const entry={view,object:r.object,orderSkuCount:codes.size,mesSkuCount:matched.length,scheduleSkuCount:schedule?.matchedSkuCount||0,scheduleStatus:schedule?.status==='unit_conflict'?'unit_conflict':!coverageKnown?'coverage_unverified':schedule?.rows?.length?'acquired':'empty_scope',selectedDefault:matched.length?'mes':schedule?.rows?.length?'schedule':'no_match'};
  if(!coverageKnown)warnings.push({code:'SCHEDULE_SCOPE_UNVERIFIED',message:view+'/'+r.object+' 排程查询范围或完整性未确认，不能把零匹配称为源系统无记录'});
  if(r.gap>0&&!codes.size)add('ORDER_SKUS_MISSING',view+'/'+r.object+' 有分类量却没有SKU绑定');
  if(codes.size&&!matched.length&&!schedule?.rows?.length)warnings.push({code:'SUPPLY_UNMATCHED',message:view+'/'+r.object+' 需检查排程、来源类型、编码、期间和单位，不能改用全国值'});
  scopes.push(entry);
 }
 for(const id of ['orders','sales','production','schedule']){const p=(d.dataProvenance||[]).find(x=>x.id===id);if(p?.rowCount>0){const target={orders:cross,sales:cross,production:d.planRows,schedule:d.scheduleSupplyRows}[id];if(!target?.length)add('ACQUIRED_BUT_UNBOUND',id+' 已取得记录却无展示输入');}}
 return {status:errors.length?'ERROR':warnings.length?'PASS_WITH_GAPS':'PASS',errors,warnings,scopes,browserVisual:'NOT_RUN'};
}
module.exports={audit};if(require.main===module){const result=audit(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;}
