/* Contract diagnostics, not a business-cause or prose-quality scoring engine. */
const fs=require('node:fs');
function audit(d){
 const issues=[],add=(code,message,object='',severity='warning')=>issues.push({code,severity,object,message});
 const demand=d.demandRows||[],production=d.planRows||[],findings=d.findings||[];
 if(demand.length&&!demand.some(r=>/品类/.test(r.view||'')))add('DEMAND_CATEGORY_ABSENT','未提供品类视角；不把基地视角当作完整需求提报分析');
 if(d.metric?.initialReportedDemand==null||d.metric?.reportedDemand==null)add('SALES_VERSION_MISSING','初始或纠偏销售提报缺失，需区分未查、无匹配和正式NULL');
 if(d.analysisReview?.status==='REVIEW_REQUIRED')add('ANALYSIS_REVIEW_PENDING','适配输入后尚需审阅结论，不能把之前的正文自动当作新数据分析');
 const knownSKU=new Set(findings.flatMap(f=>(f.records||[]).map(r=>String(r.sku||''))));
 for(const base of production){
  const wrong=(base.children||[]).filter(child=>child.level==='sku'||(!child.children?.length&&knownSKU.has(String(child.object))));
  if(wrong.length)add('PRODUCTION_LEVEL_MISMATCH',wrong.length+'个节点直接连接SKU，应提供品类映射或按实际层级标识，不能称基地×品类',base.object,'error');
 }
 const records=production.flatMap(b=>(b.findingIds||[]).map(i=>findings[i]).filter(f=>f&&f.scopeKey===b.scopeKey).flatMap(f=>f.records||[]));
 const daily=records.filter(r=>/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(r.date||'')).length;
 const withLine=records.filter(r=>r.line!=null&&r.line!=='').length,withOrder=records.filter(r=>r.order!=null&&r.order!=='').length;
 if(records.length&&daily<records.length)add('PRODUCTION_DATE_GRAIN','部分或全部记录没有日级日期；不能推断发生天数或时间顺序');
 if(records.length&&!withLine)add('PRODUCTION_LINE_MISSING','缺产线关联；保留已有理由分析，但不能定位具体产线');
 if(records.length&&!withOrder)add('PRODUCTION_ORDER_MISSING','缺生产单关联；不能表述成逐单事件证据');
 const m=d.metric||{},parts=[m.demandChangeShortage,m.inPlanShortage];
 if(Number.isFinite(m.monthlyShortage)&&parts.every(Number.isFinite)&&Math.abs(parts[0]+parts[1]-m.monthlyShortage)>.01)add('CLASSIFICATION_NOT_RECONCILED','两类量与发布缺货不勾稽，应说明版本和范围，不形成正式原因贡献', '',m.classificationComplete?'error':'warning');
 for(const source of d.dataProvenance||[])if(source.complete!==true)add('SOURCE_COMPLETENESS_UNCONFIRMED','该来源分页完整性尚未核验',source.id||source.file||'');
 for(const cmp of d.comparisons||[])if(cmp.samePeriod===true&&cmp.leftPeriod!==cmp.rightPeriod)add('CROSS_PERIOD_COMPARISON','不同期间不能声明同月交叉核对',cmp.id||'','error');
 const present=v=>v!=null&&String(v).trim()!==''&&!/^(?:—|-|null|undefined)$/.test(String(v).trim())&&!/全部.*SKU|汇总|全部产品/.test(String(v));
 const meaningfulLine=records.filter(r=>present(r.line)).length,meaningfulOrder=records.filter(r=>present(r.order)).length,meaningfulSKU=records.filter(r=>present(r.sku)).length;
 if(records.length&&!meaningfulLine&&!issues.some(i=>i.code==='PRODUCTION_LINE_MISSING'))add('PRODUCTION_LINE_MISSING','产线只有占位符，不算真实实体关联');
 if(records.length&&!meaningfulOrder&&!issues.some(i=>i.code==='PRODUCTION_ORDER_MISSING'))add('PRODUCTION_ORDER_MISSING','生产单只有占位符，不算逐单证据');
 if(records.length&&!meaningfulSKU)add('PRODUCTION_SKU_MISSING','日级记录没有真实SKU，不能定位到SKU或关联订单');
 if(!(d.dataProvenance||[]).length)add('PROVENANCE_ABSENT','未提供机器可读查询来源及完整性；自然语言说明不能替代分页凭据');
 if((findings.some(f=>f.status==='definition_conflict')||m.classificationNote)&&!d.classificationAudit)add('CONFLICT_REGISTER_MISSING','已声明冲突但缺classificationAudit原值/来源登记');
 if(d.classificationAudit?.status==='conflict')add('CLASSIFICATION_SOURCE_CONFLICT',d.classificationAudit.reason||'分类源值冲突，即使展示值为null也仍待复核');
 const rows=[];const visit=xs=>{for(const r of xs){rows.push(r);visit(r.children||[]);}};visit(demand);
 if(parts.every(v=>v==null)&&rows.some(r=>r.gap!=null||r.inPlanReference!=null))add('CLASSIFICATION_SEMANTIC_SUBSTITUTION','全国分类停用而下级仍填分类字段；总缺货仅放monthlyShortage/overallRows，禁止借用gap','', 'error');
 for(const [i,f] of findings.entries())if(f.status==='verified_cause'&&(!present(f.orderSupplyLink)||!present(f.eventTime)||!Number.isFinite(f.impact)||!(f.evidence||[]).length))add('CAUSE_EVIDENCE_INCOMPLETE','已验证根因缺实体关联、时间、影响量或来源',String(i),'error');
 for(const k of ['transferRows','oeRows','odRows'])if(!(d[k]||[]).length)add('SUPPLY_BRANCH_EMPTY',k+'未提供；需任务单说明未查、无记录、无权限或不适用',k);
 return {status:issues.some(i=>i.severity==='error')?'ERROR':issues.length?'REVIEW_REQUIRED':'NO_STRUCTURAL_ISSUES',dataContract:{errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length},coverage:{demandViews:[...new Set(demand.map(r=>r.view))],productionBases:production.length,productionRecords:records.length,dailyRecords:daily,withSKU:meaningfulSKU,withLine:meaningfulLine,withProductionOrder:meaningfulOrder},businessConclusion:'MANUAL_REVIEW_REQUIRED',visualBrowser:'NOT_RUN',issues};
}
module.exports=audit;
if(require.main===module){const result=audit(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.status==='ERROR')process.exitCode=1;}
