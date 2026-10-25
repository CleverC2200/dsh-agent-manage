(function(root){
  const CORE_UNIT='件';
  const esc=v=>String(v??'待补数据').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const qty=(v,u)=>v==null?'—':`${number(v)} ${esc(u||CORE_UNIT)}`;
  const labels={verified_fact:'有来源事实',verified_cause:'已验证根因',supported_unverified:'有支持待验证',hypothesis:'待核查假设',data_missing:'数据缺失',definition_conflict:'口径冲突'};
  function classify(r){
    if(['finalPlan','totalOrder','totalShipped'].some(k=>r[k]==null))return null;
    if(['finalPlan','totalOrder','totalShipped'].some(k=>!Number.isFinite(r[k])||r[k]<0))throw Error('订单商品数量无效');
    const gap=Math.max(r.totalOrder-r.totalShipped,0);
    return {...r,monthlyShortage:gap,demandChangeShortage:Math.min(Math.max(r.totalOrder-r.finalPlan,0),gap),inPlanShortage:Math.max(Math.min(r.totalOrder,r.finalPlan)-r.totalShipped,0)};
  }
  function normalize(input){
    const d=JSON.parse(JSON.stringify(input)); if(!d.scope||!d.metric)throw Error('缺少范围或指标');
    d.findings??=[];d.actions??=[];d.planRows??=[];d.demandRows??=[];d.transferRows??=[];d.oeRows??=[];d.odRows??=[];d.overallRows??=[];d.orderRows??=[];
    d.scope.unit ||= CORE_UNIT;d.scope.productionUnit ||= CORE_UNIT;
    const unknownOrder=d.scope.unitStatus==='unverified'&&d.scope.unit==='源数量单位（待核验）';
    const unknownProduction=d.scope.productionUnitStatus==='unverified'&&d.scope.productionUnit==='源数量单位（待核验）';
    if((d.scope.unit!==CORE_UNIT&&!unknownOrder)||(!unknownProduction&&d.scope.productionUnit!==CORE_UNIT))throw Error('订单数量须为件；生产单位未核验时须明确 unverified 与源数量单位（待核验）');
    function units(rows,unit){for(const r of rows){
      if(r.unit&&r.unit!==unit)throw Error('明细单位与声明不一致：'+(r.object||'未命名对象'));
      r.unit=unit;units(r.children||[],unit);
    }}
    units(d.demandRows,d.scope.unit);
    for(const r of d.overallRows)units([r],r.unit||d.metric.units?.monthlyShortage||d.scope.unit);
    units([...d.planRows,...d.transferRows,...d.oeRows,...d.odRows],d.scope.productionUnit);
    const keys=new Set();for(const r of d.orderRows){if(!r.key||keys.has(r.key))throw Error('订单商品键缺失或重复');keys.add(r.key);}
    d.metric.initialReportedDemand ??= null;
    for(const k of ['need','shipped','reportedDemand','initialReportedDemand','monthlyShortage','businessGap','demandChangeShortage','inPlanShortage'])if(d.metric[k]!=null&&(!Number.isFinite(d.metric[k])||d.metric[k]<0))throw Error('指标数量无效：'+k);
    if(d.metric.salesDemandPlanVariance!=null&&!Number.isFinite(d.metric.salesDemandPlanVariance))throw Error('指标数量无效：salesDemandPlanVariance');
    // Published metrics are authoritative; legacy source-row recomputation is opt-in.
    const local=d.calculation?.classification==='legacy-minmax-v1';
    if(d.calculation?.classification&&!local&&d.calculation.classification!=='published')throw Error('未知分类复核模式');
    const rows=local?d.orderRows.map(classify):[];
    if(local&&(!d.orderRowsComplete||!rows.every(Boolean)))throw Error('完整订单池存在缺数');
    if(local&&d.orderRowsComplete&&rows.every(Boolean))for(const k of ['monthlyShortage','demandChangeShortage','inPlanShortage']){
      const sum=rows.reduce((s,r)=>s+r[k],0);if(d.metric[k]!=null&&Math.abs(d.metric[k]-sum)>.01)throw Error('分类汇总不一致：'+k);d.metric[k]=sum;
    }
    if(local&&d.orderRowsComplete)d.metric.classificationComplete=true;
    if(d.metric.rate!=null&&!Number.isFinite(d.metric.rate))throw Error('满足率必须为0–1编码的有限数值');
    if(d.calculation?.rate&&!['published','ratio-v1'].includes(d.calculation.rate))throw Error('未知满足率计算模式');
    if(d.metric.classificationComplete&&['monthlyShortage','demandChangeShortage','inPlanShortage'].some(k=>d.metric[k]==null))throw Error('完整分类缺少数量');
    if(d.metric.classificationComplete&&Math.abs(d.metric.monthlyShortage-d.metric.demandChangeShortage-d.metric.inPlanShortage)>.01)throw Error('完整分类不勾稽');
    for(const f of d.findings){
      if(f.status==='verified'){f.originalStatus='verified';f.status='verified_fact';}
      if(!labels[f.status])throw Error('未知证据状态：'+f.status);
      if(f.status==='verified_cause'&&(!f.orderSupplyLink||!f.eventTime||!f.mechanism||!f.counterEvidence||!f.evidence?.length||f.impact==null))throw Error('已验证根因缺少订单关联、时序、影响量或证据');
      const findingUnit=f.channel==='self'?d.scope.productionUnit:(f.unit||d.scope.unit);
      if(![CORE_UNIT,d.scope.unit,d.scope.productionUnit].includes(findingUnit))throw Error('finding单位未在范围中声明');
      if(f.unit&&f.unit!==findingUnit)throw Error('finding 数量单位与声明不一致：'+(f.object||'未命名对象'));
      f.unit=findingUnit;
    }
    if(d.scenario?.items?.length){
      if(d.scenario.exclusive!==true||d.scenario.unit!==d.scope.unit||!d.scenario.costUnit||d.metric.monthlyShortage==null)throw Error('情景须明确同单位、互斥范围和缺货上限');
      if(d.calculation?.rate==='ratio-v1'&&(!(d.metric.need>0)||d.metric.shipped==null))throw Error('比例情景缺少有效分子分母');
      if(d.scenario.items.some(s=>!Number.isFinite(s.max)||s.max<0||!Number.isFinite(s.costPerUnit)||s.costPerUnit<0))throw Error('情景参数无效');
      if(d.scenario.items.reduce((s,r)=>s+r.max,0)>d.metric.monthlyShortage)throw Error('情景恢复上限超过缺货');
    }
    return d;
  }
  const rateValue=d=>Object.hasOwn(d.metric,'rate')?d.metric.rate:(d.calculation?.rate==='ratio-v1'&&d.metric.need>0&&d.metric.shipped!=null?d.metric.shipped/d.metric.need:null);
  const rate=d=>rateValue(d)==null?'—':(100*rateValue(d)).toFixed(2)+'%';
  const actualShipped=d=>Object.hasOwn(d.metric||{},'rawShipped')?d.metric.rawShipped:(d.metric?.shippedIsActual===true?d.metric.shipped:null);
  const classificationText=(d,key)=>d.metric.classificationDefinitions?.[key]||(d.calculation?.classification==='legacy-minmax-v1'?(key==='demand'?'MIN(MAX(下单−最终计划,0),MAX(下单−发货,0))':'MAX(MIN(下单,最终计划)−发货,0)'):'采用本次发布分类口径；定义详见口径快照');
  function finding(f){return `<details class="report-finding"><summary><strong>${esc(f.object)}</strong> <span class="report-state ${esc(f.status)}">${labels[f.status]}</span></summary><p>${esc(f.fact)}</p><p>作用机制：${esc(f.mechanism)}</p><p>涉及量（不自动等同因果量）：${qty(f.impact,f.unit)}</p><p>证据：${esc((f.evidence||[]).join('；'))}</p><p>反证：${esc(f.counterEvidence)}</p><p>边界／停止点：${esc(f.boundary)}</p></details>`;}
  function table(headers,rows){return `<div class="report-table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">待补数据，未生成虚构记录</td></tr>`}</tbody></table></div>`;}
  function markdown(d){return `# ${d.title}\n\n${d.scope.object} · ${d.scope.period}\n\n${d.summary}\n\n${d.metric.needLabel||'OMS需求'} ${number(d.metric.need)} ${d.scope.unit}；已开订单发货量 ${number(actualShipped(d))} ${d.scope.unit}；满足率 ${rate(d)}\n\n## 需求变化\n${d.demandNarrative}\n\n## 计划内缺货\n${d.planNarrative}\n\n${d.planPreparation||''}\n\n## 原因证据\n`+d.findings.map(f=>`### ${f.object} · ${labels[f.status]}\n${f.fact}\n机制：${f.mechanism||'待核查'}\n涉及量：${number(f.impact)} ${f.unit}\n证据：${(f.evidence||[]).join('；')}\n反证：${f.counterEvidence||'待补'}\n边界：${f.boundary}\n`).join('\n')+'\n## 行动\n'+d.actions.map(a=>`${a.object}：${a.task}；${a.owner}；${a.acceptance}`).join('\n')+'\n## 口径\n'+d.method;}
  function flatten(rows,parent=''){return (rows||[]).flatMap(r=>[{...r,object:parent?parent+' → '+r.object:r.object},...flatten(r.children,parent?parent+' → '+r.object:r.object)]);}
  function flattenDemandDetails(rows,parent=''){
    return (rows||[]).flatMap(r=>{const path=parent?parent+' → '+r.object:r.object;return [...(r.detailRows||[]).flatMap(s=>(s.records?.length?s.records:[{}]).map(x=>({path,skuCode:s.skuCode,skuName:s.skuName,date:x.date,planReference:x.planReference??s.planReference,ordered:x.ordered??s.ordered,shipped:x.shipped??s.shipped,monthlyShortage:x.monthlyShortage??s.monthlyShortage,demandGap:x.demandGap??s.demandGap,inPlanGap:x.inPlanGap??s.inPlanGap,unit:s.unit||r.unit||CORE_UNIT}))),...flattenDemandDetails(r.children,path)];});
  }
  function demandDetailExport(d,md=false){
    const rows=flattenDemandDetails(d.demandRows),headers=['对象路径','SKU编码','商品名称','日期','源计划量参考','需求量','发货量','发布缺货量','需求变化参考','计划内参考','单位'];
    const values=rows.map(r=>[r.path,r.skuCode,r.skuName,String(r.date||'').slice(0,10),number(r.planReference),number(r.ordered),number(r.shipped),number(r.monthlyShortage),number(r.demandGap),number(r.inPlanGap),r.unit]);
    const cell=v=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
    return md?'\n### 需求变化SKU与源记录\n\n|'+headers.join('|')+'|\n|'+headers.map(()=>'---').join('|')+'|\n'+values.map(r=>'|'+r.map(cell).join('|')+'|').join('\n')+'\n':'<details class="report-finding"><summary>需求变化SKU与源记录（'+values.length+'）</summary>'+table(headers,values)+'</details>';
  }
  function dataTables(d,md=false){return [['总缺货分布（非两类归属）',d.overallRows,d.scope.unit],['需求变化全量明细',d.demandRows,d.scope.unit],['自产兑现全量明细',d.planRows,d.scope.productionUnit],['调拨兑现全量明细',d.transferRows,d.scope.productionUnit],['OE全量明细',d.oeRows,d.scope.productionUnit],['OD全量明细',d.odRows,d.scope.productionUnit]].map(([title,rows,u])=>{
    const headers=['视角／对象路径','初始提报','计划／纠偏提报','下单','实际／发货','差额／分类量','单位'];
    const values=flatten(rows).map(r=>[(r.view||'')+' '+r.object,number(r.initialReportedDemand),number(r.planned??r.reported),number(r.ordered),number(r.actual??r.shipped),number(r.gap),r.unit||u]);
    const cell=v=>String(v).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
    return md?'\n### '+title+'\n\n|'+headers.join('|')+'|\n|'+headers.map(()=>'---').join('|')+'|\n'+values.map(r=>'|'+r.map(cell).join('|')+'|').join('\n')+'\n':'<details class="report-finding"><summary>'+title+'（'+values.length+'）</summary>'+table(headers,values)+'</details>';
  }).join('');}
  const conclusion=()=>typeof module!=='undefined'&&module.exports?require('./conclusion-report.js'):root.ConclusionReport;
  const metricUnit=(d,key)=>d.metric.units?.[key]||d.scope.unit;
  const api={metricUnit,CORE_UNIT,esc,qty,number,labels,classify,normalize,rate,rateValue,actualShipped,classificationText,finding,table,flatten,flattenDemandDetails,dataTables,report:d=>conclusion().render(d,api),markdown:d=>'# '+d.title+'\n\n'+conclusion().markdown(d,api)+'\n\n# 完整证据与明细附录\n\n'+markdown(d)+'\n## 全量底表\n'+dataTables(d,true)+demandDetailExport(d,true)};if(typeof module!=='undefined')module.exports=api;else root.AnalysisCore=api;
})(globalThis);
