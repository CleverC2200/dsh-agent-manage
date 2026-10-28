// Deterministic bridge from preserved query pages to the existing report contract.
// No credentials, network calls, embedded period data or inferred cause labels.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const at=(o,k)=>o!=null&&Object.hasOwn(o,k)?o[k]:String(k||'').split('.').filter(Boolean).reduce((v,p)=>v?.[p],o);
const num=v=>{if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n))throw Error('非数值数量 '+v);return n;};
const sum=(rs,k)=>rs.length&&rs.every(r=>r[k]!=null)?rs.reduce((s,r)=>s+r[k],0):null;
const partial=(rs,k)=>rs.reduce((s,r)=>s+(r[k]??0),0);
const text=v=>v==null||String(v).trim()===''?null:String(v).trim();
const key=xs=>JSON.stringify(xs);
const day=v=>String(v||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3').slice(0,10);
const defaults={orders:['fromorderno_month','material_code','need_qty_origin','qtyshipped','outqty','allnum','demand_change_outqty','plan_inner_outqty'],sales:['stat_month','source_flag','material_code','plan_qty_initial','plan_qty_adjusted','order_qty_origin','act_dl_qty'],mapping:['stat_month','source_flag','material_code','product_categ_name','material_group'],production:['zdate','factory_name','material_code','plan_qty','actual_qty'],schedule:['base_finish_day','factory_name','material_code','measure_unit','data_source','order_no','order_qty','deliv_qty']};
function load(id,ds,root,period){
 if(!ds)return {rows:[],provenance:{id,status:'pending',complete:false}};
 const statuses=['acquired','partial','source_null','empty_scope','unsupported','query_failed','not_applicable','pending'];
 if(!statuses.includes(ds.status))throw Error(id+' 缺合法status');
 if(!ds.files?.length){if(['acquired','partial','empty_scope','source_null'].includes(ds.status))throw Error(id+' 缺证据文件');return {rows:[],provenance:{id,...ds,complete:false}};}
 if(ds.period!==period)throw Error(id+' 期间与任务不一致');
 const rows=[],files=[],seenFiles=new Set(),seenGrain=new Set();
 for(const name of ds.files){
  const file=path.resolve(root,name),raw=fs.readFileSync(file),hash=crypto.createHash('sha256').update(raw).digest('hex');
  if(seenFiles.has(hash))throw Error(id+' 重复分页文件');seenFiles.add(hash);
  const doc=JSON.parse(raw),page=ds.rowsPath?at(doc,ds.rowsPath):doc;
  if(!Array.isArray(page))throw Error(id+' rowsPath不是数组');
  if(doc.period&&doc.period!==period)throw Error(id+' 文件内期间冲突');
  files.push({file:name,sha256:hash,rows:page.length});
  for(const rawRow of page){
   const r={...rawRow};for(const [canonical,source] of Object.entries(ds.fields||{})){const v=at(rawRow,source);if(v===undefined)throw Error(id+' 未返回映射成员 '+source);r[canonical]=v;}
   for(const col of defaults[id]||[])if(!Object.hasOwn(r,col))throw Error(id+' 缺字段 '+col+'，不得用未查字段填空');
   if(ds.uniqueGrain?.length){const g=key(ds.uniqueGrain.map(f=>r[f]??null));if(seenGrain.has(g))throw Error(id+' 重复唯一粒度 '+g);seenGrain.add(g);}
   rows.push(r);
  }
 }
 let complete=false;
 if(ds.completion){const count=at(JSON.parse(fs.readFileSync(path.resolve(root,ds.completion.file),'utf8')),ds.completion.countPath);if(!Number.isInteger(count)||count!==rows.length)throw Error(id+' 完整性记录数不一致');complete=true;}
 if(['acquired','empty_scope','source_null'].includes(ds.status)&&!complete)throw Error(id+' 需独立记录数或完整返回rowCount证据');
 if(ds.status==='empty_scope'&&rows.length)throw Error(id+' empty_scope包含记录');
 return {rows,provenance:{id,model:ds.model,period,status:ds.status,complete,rowCount:rows.length,files,retrievedAt:ds.retrievedAt,querySummary:ds.querySummary,grain:ds.grain||ds.uniqueGrain||[],unit:ds.unit||null,unitStatus:ds.unitStatus||'unverified',reason:ds.reason||null}};
}
function prepare(manifest,root){
 const period=manifest.period;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period||''))throw Error('period必须为YYYY-MM');
 if(manifest.classificationMode!=='positive-row-reference-v1')throw Error('显式配置用户确认的positive-row-reference-v1；源字段保留审计，不静默切换公式');
 const inputs=Object.fromEntries(Object.keys(defaults).map(id=>[id,load(id,manifest.datasets?.[id],root,period)]));
 for(const id of ['orders','sales','mapping'])if(!['acquired','partial','empty_scope','source_null'].includes(inputs[id].provenance.status))throw Error(id+' 未准备，先补齐查询或显式空范围证据');
 const inMonth=(r,f,id)=>{if(day(r[f]).slice(0,7)!==period)throw Error(id+' 查询行跨月份或日期不合法');};
 const sources=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.rows]));
 for(const r of sources.orders)inMonth(r,'fromorderno_month','orders');
 for(const r of sources.sales){inMonth(r,'stat_month','sales');if(r.source_flag!=='销售口径')throw Error('sales必须限定销售口径');}
 for(const r of sources.mapping){inMonth(r,'stat_month','mapping');if(r.source_flag!=='基地口径')throw Error('mapping必须限定基地口径');}
 for(const r of sources.production)inMonth(r,'zdate','production');for(const r of sources.schedule)inMonth(r,'base_finish_day','schedule');
 const mappings=new Map();for(const r of sources.mapping){const code=text(r.material_code);if(!code)continue;const m=mappings.get(code)||{cats:new Set(),groups:new Map()};if(text(r.product_categ_name))m.cats.add(text(r.product_categ_name));if(text(r.material_group))m.groups.set(text(r.material_group),text(r.material_group_name)||text(r.material_group));mappings.set(code,m);}
 // Name fallback is only allowed on a unique full organization path. Conflicting
 // codes/names remain separate source-specific keys; they are never fuzzy joined.
 const paths=new Map();for(const r of [...sources.orders,...sources.sales]){const names=key([text(r.region_name),text(r.province_region_name)]),code=key([text(r.region_code),text(r.province_region_code)]);if(!paths.has(names))paths.set(names,new Set());if(text(r.region_code)&&text(r.province_region_code))paths.get(names).add(code);}
 function dims(r,source){const code=text(r.material_code),m=mappings.get(code),names=key([text(r.region_name),text(r.province_region_name)]),codes=paths.get(names),own=text(r.region_code)&&text(r.province_region_code)?key([text(r.region_code),text(r.province_region_code)]):null;
  const orgKey=own||(codes?.size===1?[...codes][0]:codes?.size===0&&text(r.region_name)&&text(r.province_region_name)?'name:'+names:source+':unmatched:'+names);
  return {category:m?.cats.size===1?[...m.cats][0]:'品类待映射',materialGroup:m?.groups.size===1?[...m.groups.values()][0]:m?.groups.size>1?'物料组待确认':'物料组待映射',orgKey,region:text(r.region_name)||'大区未提供',province:text(r.province_region_name)||'省区未提供',skuCode:code||source+':物料缺码',skuName:text(r.material_name)||'商品名称待补充',base:text(r.belong_base??r.belong_name)||'基地未提供'};}
 const orders=sources.orders.map((r,i)=>{
  const ordered=num(r.need_qty_origin),shipped=num(r.qtyshipped),monthlyShortage=num(r.outqty),planReference=num(r.allnum),positive=monthlyShortage!=null&&monthlyShortage>0;
  const valid=positive&&[ordered,shipped,planReference].every(x=>x!=null),basic=ordered!=null&&shipped!=null?Math.max(ordered-shipped,0):null;
  return {...dims(r,'order'),sourceRow:i+1,date:day(r.fromorderno_month),ordered,shipped,monthlyShortage,planReference,positive,
   rawDemand:num(r.demand_change_outqty),rawPlan:num(r.plan_inner_outqty),
   demandGap:positive?(valid?Math.min(Math.max(ordered-planReference,0),basic):null):0,
   inPlanGap:positive?(valid?Math.max(Math.min(ordered,planReference)-shipped,0):null):0,
   basicMismatch:positive&&basic!=null&&Math.abs(monthlyShortage-basic)>.001};
 });
 const sales=sources.sales.map(r=>({...dims(r,'sales'),initialReportedDemand:num(r.plan_qty_initial),reported:num(r.plan_qty_adjusted),sourceOrdered:num(r.order_qty_origin),sourceShipped:num(r.act_dl_qty)}));
 const weights=manifest.salesAccuracyWeights;
 if(weights&&(!weights.definitionRef||!Array.isArray(weights.values)||weights.values.length!==2||weights.values.some(v=>!Number.isFinite(v)||v<0)||Math.abs(weights.values.reduce((a,b)=>a+b,0)-1)>.00001))throw Error('销售准确率需带定义引用且权重合计为1');
 function accuracy(rs){if(!weights||!rs.length||rs.some(r=>[r.initialReportedDemand,r.reported,r.sourceOrdered,r.sourceShipped].some(v=>v==null)))return null;
  const p=sum(rs,'initialReportedDemand'),a=sum(rs,'reported');if(!(p>0&&a>0))return null;
  const deviation=(r,k)=>Math.abs(r.sourceOrdered>r[k]?r.sourceShipped-r[k]:Math.max(r.sourceOrdered,r.sourceShipped)-r[k]);
  return 100*(1-weights.values[0]*rs.reduce((s,r)=>s+deviation(r,'initialReportedDemand'),0)/p-weights.values[1]*rs.reduce((s,r)=>s+deviation(r,'reported'),0)/a);
 }
 function classificationSum(rs,k){const positive=rs.filter(r=>r.positive);if(!rs.length)return null;if(!positive.length)return 0;const known=positive.filter(r=>r[k]!=null);return known.length?partial(known,k):null;}
 function aggregate(os,ss){const p=os.filter(r=>r.positive);return {initialReportedDemand:sum(ss,'initialReportedDemand'),reported:sum(ss,'reported'),ordered:sum(os,'ordered'),shipped:sum(os,'shipped'),monthlyShortage:sum(os,'monthlyShortage'),gap:classificationSum(os,'demandGap'),inPlanReference:classificationSum(os,'inPlanGap'),accuracy:accuracy(ss),accuracyMissingReason:weights?'源下单或提报必要值缺失／分母非正':'准确率定义或权重未确认',salesDemandPlanVariance:sum(ss,'reported')!=null&&sum(os,'ordered')!=null?sum(ss,'reported')-sum(os,'ordered'):null,salesRows:ss.length,orderRows:os.length,positiveRows:p.length,missingPlanRows:p.filter(r=>r.planReference==null).length,missingPlanShortage:partial(p.filter(r=>r.planReference==null),'monthlyShortage'),matchStatus:os.length&&ss.length?'both':os.length?'order_only':'sales_only'};}
 function details(os,ss){const codes=new Set([...os,...ss].map(r=>r.skuCode));return [...codes].map(code=>{const o=os.filter(r=>r.skuCode===code),s=ss.filter(r=>r.skuCode===code),agg=aggregate(o,s),pos=o.filter(r=>r.positive),known=pos.filter(r=>r.planReference!=null);return {...agg,skuCode:code,skuName:(o[0]||s[0]).skuName,planReference:known.length?partial(known,'planReference'):null,nullPlanRows:agg.missingPlanRows,demandGap:agg.gap,inPlanGap:agg.inPlanReference,unit:orderUnit,records:pos.map(r=>({sourceRow:r.sourceRow,date:r.date,ordered:r.ordered,shipped:r.shipped,monthlyShortage:r.monthlyShortage,planReference:r.planReference,demandGap:r.demandGap,inPlanGap:r.inPlanGap}))};});}
 if(!['orders','sales'].every(id=>manifest.datasets[id].unit==='件'&&manifest.datasets[id].unitStatus==='verified'))throw Error('跨表月度卡片需先核验订单及销售数量为件；未知单位保留原始sourceViews，不用改标签代替换算');
 const orderUnit='件';
 const productionUnit=manifest.datasets.production?.unitStatus==='verified'&&manifest.datasets.production.unit==='件'?'件':'源数量单位（待核验）';
 const grouped=new Map();for(const [type,rs] of [['o',orders],['s',sales]])for(const r of rs){const k=key([r.category,r.materialGroup,r.orgKey]);if(!grouped.has(k))grouped.set(k,{dims:r,o:[],s:[]});grouped.get(k)[type].push(r);}
 const crossDimensionRows=[...grouped.values()].map(({dims:r,o,s})=>({category:r.category,materialGroup:r.materialGroup,region:r.region,province:r.province,scopeKey:key([r.category,r.materialGroup,r.orgKey]),...aggregate(o,s),unit:orderUnit,detailRows:details(o,s)}));
 function tree(os,ss,levels,view,depth=0,parents=[]){
  const field=levels[depth],values=new Set([...os,...ss].map(r=>r[field]));
  return [...values].map(v=>{const o=os.filter(r=>r[field]===v),s=ss.filter(r=>r[field]===v),scopeKey=key([...parents,v]);const node={object:v,view,scopeKey,unit:orderUnit,...aggregate(o,s),findingIds:[]};
   if(depth+1<levels.length)node.children=tree(o,s,levels,view,depth+1,[...parents,v]);else node.detailRows=details(o,s);
   return node;});
 }
 const categoryTrees=tree(orders,sales,['category','region','province'],'品类经理'),baseTrees=tree(orders,sales,['base','region','province'],'基地经理');
 const classificationTree=xs=>xs.map(r=>({...r,gap:r.inPlanReference,children:r.children?classificationTree(r.children):undefined}));
 const findings=[];
 function prodTree(rs,depth=0,parents=[]){const field=['factory_name','classify1','material_code'][depth],map=new Map();for(const r of rs){const k=text(r[field])||(depth===1?'品类待映射':'源维度未填写');if(!map.has(k))map.set(k,[]);map.get(k).push(r);}
  return [...map].map(([object,rows])=>{const planned=sum(rows,'planned'),actual=sum(rows,'actual'),scopeKey=key([...parents,object]);const node={object,scopeKey,level:['base','category','sku'][depth],planned,actual,gap:depth===2?(planned==null||actual==null?null:Math.max(planned-actual,0)):null,unit:productionUnit,findingIds:[]};
   if(depth<2){node.children=prodTree(rows,depth+1,[...parents,object]);node.gap=sum(node.children,'gap');}
   if(depth===0){const reasons=new Map();for(const r of rows){const reason=text(r.deviation_reason)||'原因未填写';if(!reasons.has(reason))reasons.set(reason,[]);reasons.get(reason).push(r);}
    for(const [reason,records] of reasons){node.findingIds.push(findings.length);findings.push({object,scopeKey,channel:'self',status:'supported_unverified',reasonText:reason,fact:'生产记录理由：'+reason,impact:null,unit:productionUnit,evidence:['sourceId:production'],boundary:'生产事实尚未建立订单供给时间链。',records:records.map(r=>({date:day(r.zdate),sku:text(r.material_code),order:r.order_code??null,batch:r.batch_no??null,line:r.workcenter??null,shift:null,planned:r.planned,actual:r.actual,gap:r.planned==null||r.actual==null?null:Math.max(r.planned-r.actual,0),reason}))});}
   }return node;});
 }
 const prod=sources.production.map(r=>({...r,planned:num(r.plan_qty),actual:num(r.actual_qty)})),planRows=prodTree(prod),agg=aggregate(orders,sales),positive=orders.filter(r=>r.positive);
 const totalShort=sum(orders,'monthlyShortage'),uncovered=totalShort!=null&&agg.gap!=null&&agg.inPlanReference!=null?totalShort-agg.gap-agg.inPlanReference:null;
 const d={pipelineVersion:'source-bundle-v1',title:period+'订单满足率原因分析',scope:{period,object:manifest.scope||'本期查询业务范围',cutoff:manifest.cutoff||null,unit:orderUnit,unitStatus:orderUnit==='件'?'verified':'unverified',productionUnit,productionUnitStatus:productionUnit==='件'?'verified':'unverified',draft:true},
  metric:{initialReportedDemand:agg.initialReportedDemand,reportedDemand:agg.reported,need:agg.ordered,shipped:agg.shipped,rawShipped:agg.shipped,shippedIsActual:true,monthlyShortage:totalShort,rate:manifest.orderRateDefinition?.formula==='one-minus-published-shortage-over-need'&&manifest.orderRateDefinition.definitionRef&&agg.ordered>0&&totalShort!=null?1-totalShort/agg.ordered:null,
   formula:manifest.orderRateDefinition?.definitionRef?'本次定义：1－发布缺货量÷需求量':'满足率定义待核验',salesDemandPlanVariance:agg.salesDemandPlanVariance,demandChangeShortage:agg.gap,inPlanShortage:agg.inPlanReference,classificationComplete:false,classificationNote:'正缺货源行逐组复算参考；计划缺值 '+agg.missingPlanRows+' 条；未覆盖差额 '+(uncovered??'待核')+'，不构成完整互斥归因。',classificationDefinitions:{demand:'正缺货源行 MIN(MAX(需求－计划,0),MAX(需求－发货,0))；必要值缺失不计算。',plan:'正缺货源行 MAX(MIN(需求,计划)－发货,0)；必要值缺失不计算。'}},
  classificationAudit:{status:'conflict',rawDemandChange:sum(orders,'rawDemand'),rawInPlan:sum(orders,'rawPlan'),positiveSourceDemand:sum(positive,'rawDemand'),positiveSourcePlan:sum(positive,'rawPlan'),reason:'原始分类值与复算参考分别保存；按当次计划版本和发布缺货勾稽。',sourceId:'orders',positiveRows:positive.length,missingPlanRows:agg.missingPlanRows,missingPlanShortage:agg.missingPlanShortage,uncovered,sourceMismatchRows:positive.filter(r=>r.basicMismatch).length},
  calculation:{rate:'published',classification:'published',productionRate:'ratio-v1',salesDemandPlanVariance:'adjusted-minus-order-v1'},
  productionMetric:{planned:sum(prod,'planned'),actual:sum(prod,'actual'),gap:sum(planRows,'gap')},findings,planRows,demandRows:[...categoryTrees,...baseTrees],classificationPlanRows:classificationTree(baseTrees),classificationPlanDimensionRows:classificationTree(categoryTrees),crossDimensionRows,
  overallRows:[...categoryTrees,...baseTrees].map(function overall(r){return {...r,gap:r.monthlyShortage,...(r.children?{children:r.children.map(overall)}:{})};}),transferRows:[],oeRows:[],odRows:[],actions:[],summary:[],
  scheduleSupplyRows:sources.schedule,scheduleSupplyMetadata:{...manifest.scheduleSupplyMetadata,complete:inputs.schedule.provenance.complete,sourceStatus:inputs.schedule.provenance.status,querySummary:inputs.schedule.provenance.querySummary},
  crossDimensionAudit:{positiveRows:positive.length,salesRows:sales.length,orderRows:orders.length,groups:crossDimensionRows.length,both:crossDimensionRows.filter(r=>r.matchStatus==='both').length,salesOnly:crossDimensionRows.filter(r=>r.matchStatus==='sales_only').length,orderOnly:crossDimensionRows.filter(r=>r.matchStatus==='order_only').length,ambiguousCategorySkus:[...mappings.values()].filter(m=>m.cats.size>1).length,ambiguousMaterialGroupSkus:[...mappings.values()].filter(m=>m.groups.size>1).length},
  dataProvenance:Object.values(inputs).map(x=>x.provenance).filter(p=>p.files?.length),analysisReview:{status:'REVIEW_REQUIRED',note:'新数据已准备；需依据证据生成全量综合结论，不复用旧正文。'},sourceViews:[]};
 for(const [id,input] of Object.entries(inputs))d.sourceViews.push({id,title:id+' 查询源记录',source:input.provenance.model||id,status:input.provenance.status,rows:input.rows,fields:input.rows[0]?Object.keys(input.rows[0]).map(name=>({name,label:name})):[],retrievedAt:input.provenance.retrievedAt,complete:input.provenance.complete});
 for(const [target,original] of [['ordered',agg.ordered],['shipped',agg.shipped],['monthlyShortage',agg.monthlyShortage],['initialReportedDemand',agg.initialReportedDemand],['reported',agg.reported]])if(original!=null&&Math.abs(partial(crossDimensionRows,target)-original)>.001)throw Error('跨源绑定未守恒 '+target);
 return d;
}
module.exports={prepare,load};
if(require.main===module){const file=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);const d=prepare(JSON.parse(fs.readFileSync(file,'utf8')),path.dirname(file));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(d,null,2));console.log(JSON.stringify({output:out,crossDimensionAudit:d.crossDimensionAudit,classificationAudit:d.classificationAudit}));}
