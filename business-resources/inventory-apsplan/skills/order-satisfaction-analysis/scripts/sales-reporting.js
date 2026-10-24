// Bind independently queried sales versions to exact base / organization paths.
(function(root){
 function variance(d){
  if(d.calculation?.salesDemandPlanVariance!=='adjusted-minus-order-v1')return d;
  const formula='纠偏提报量－已开订单需求量；正数为提报高于订单，负数为订单高于提报。';
  const calc=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
  d.metric.salesDemandPlanVariance=calc(d.metric.reportedDemand,d.metric.need);
  d.metric.salesDemandPlanVarianceNote=formula+' 按本次用户确认的对照口径计算。';
  const walk=r=>{r.salesDemandPlanVariance=calc(r.reported,r.ordered);r.salesDemandPlanVarianceNote=formula+(r.salesDemandPlanVariance==null?' 当前路径缺少纠偏提报或订单需求，保留缺失。':' 当前路径订单组织明细可能仅含缺货记录，按展示范围对照，不等于完整订单池偏差。');(r.children||[]).forEach(walk);};
  (d.demandRows||[]).forEach(walk);return d;
 }
 function apply(d){
  const s=d.salesReporting;if(!s)return variance(d);
  const label=v=>v==null||v===''?'未提供':String(v);
  const baseLabel=v=>v==null||v===''?'基地未映射（销售提报）':String(v);
  const key=(...v)=>JSON.stringify(v);
  const indexes={};
  for(const [level,fields] of [['base',['base']],['region',['base','region']],['province',['base','region','province']]]){
   indexes[level]=new Map();for(const row of s[level]||[]){const k=key(...fields.map(f=>row[f]??null));if(indexes[level].has(k))throw Error('销售提报路径重复：'+k);indexes[level].set(k,row);}
  }
  const create=(object,view)=>({object,view,unit:d.scope.unit,initialReportedDemand:null,reported:null,ordered:null,shipped:null,gap:null,monthlyShortage:null,inPlanReference:null,salesDemandPlanVariance:null,accuracy:null,findingIds:[],salesOnly:true,children:[]});
  for(const br of s.base||[]){
   let b=d.demandRows.find(x=>/基地/.test(x.view)&&x.object===baseLabel(br.base));
   if(!b){b=create(baseLabel(br.base),'基地经理');d.demandRows.push(b);}
   b.salesBaseValue=br.base??null;
   for(const rr of (s.region||[]).filter(x=>(x.base??null)===(br.base??null))){
    b.children??=[];let r=b.children.find(x=>x.object===label(rr.region));
    if(!r){r=create(label(rr.region),'基地经理');b.children.push(r);}
    for(const pr of (s.province||[]).filter(x=>(x.base??null)===(br.base??null)&&(x.region??null)===(rr.region??null))){
     r.children??=[];let p=r.children.find(x=>x.object===label(pr.province));
     if(!p){p=create(label(pr.province),'基地经理');p.region=label(pr.region);p.province=label(pr.province);r.children.push(p);}
    }
   }
  }
  function bind(node,level,values){
   const row=indexes[level].get(key(...values));node.initialReportedDemand=row?.initial??null;node.reported=row?.adjusted??null;
   if(s.accuracyRetrievedAt){
    node.accuracy=row?.accuracyMonthly==null?null:row.accuracyMonthly*100;
    node.accuracyInitial=row?.accuracyInitial==null?null:row.accuracyInitial*100;
    node.accuracyAdjusted=row?.accuracyAdjusted==null?null:row.accuracyAdjusted*100;
    const reasons=[];
    if(!row)reasons.push('无匹配销售记录');
    else {if(row.sourceOrder==null)reasons.push('销售源下单量缺失');if(row.sourceShipped==null)reasons.push('销售源发货量缺失');if(row.initial==null||row.adjusted==null)reasons.push('提报版本缺失');else if(row.initial<=0||row.adjusted<=0)reasons.push('提报分母非正');}
    node.accuracyMissingReason=node.accuracy==null?(reasons.join('、')||'Cube返回空值，待核验'):null;
    node.accuracyNote=node.accuracy==null?node.accuracyMissingReason:'Cube正式月度准确率；初始与纠偏各50%，不平均SKU准确率，不截断负值。';
   }
   node.salesReportingNote=row?'销售口径 · '+s.period+' · 查询 '+s.retrievedAt+'；初始与纠偏独立查询。':'本次完整销售口径查询未返回该路径；不推定为零。';
   node.scopeNote=node.salesReportingNote+' 销售提报使用完整范围；订单下级明细仍为原缺货记录范围。'+(d.calculation?.salesDemandPlanVariance==='adjusted-minus-order-v1'?'计划偏差按本次确认口径取“纠偏提报－当前路径已开订单需求”，保留正负号；下级对照不代表全量订单池偏差。':'未配置差额复核时不自行计算计划偏差。')+(node.salesOnly?' 当前路径仅有销售提报，订单量及分类缺货保留缺失。':'');
  }
  for(const b of d.demandRows.filter(x=>/基地/.test(x.view))){
   const bv=Object.hasOwn(b,'salesBaseValue')?b.salesBaseValue:b.object;bind(b,'base',[bv]);
   for(const r of b.children||[]){const rv=r.object==='未提供'?null:r.object;bind(r,'region',[bv,rv]);for(const p of r.children||[]){const pv=p.object==='未提供'?null:p.object;bind(p,'province',[bv,rv,pv]);}}
  }
  if(s.national){d.metric.initialReportedDemand=s.national.initial;d.metric.reportedDemand=s.national.adjusted;}
  return variance(d);
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={apply};else root.SalesReporting={apply};
})(globalThis);
