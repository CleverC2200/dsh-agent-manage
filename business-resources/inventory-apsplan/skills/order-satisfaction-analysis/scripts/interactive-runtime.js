(()=>{
 const d=JSON.parse(document.getElementById('analysisData').textContent),C=AnalysisCore,$=id=>document.getElementById(id),e=C.esc;
 // The classification tree was assembled before monthly order fields were
 // attached to the parallel demand tree. Align only identical base paths.
 for(const base of d.classificationPlanRows||[]){
  const monthly=(d.demandRows||[]).find(x=>/基地/.test(x.view||'')&&x.object===base.object);
  if(!monthly)continue;
  for(const key of ['ordered','shipped'])base[key]=monthly[key]??null;
  for(const region of base.children||[]){
   const sourceRegion=(monthly.children||[]).find(x=>x.object===region.object);
   if(!sourceRegion)continue;
   for(const key of ['ordered','shipped'])region[key]=sourceRegion[key]??null;
   for(const province of region.children||[]){
    const sourceProvince=(sourceRegion.children||[]).find(x=>x.object===province.object);
    if(sourceProvince)for(const key of ['ordered','shipped'])province[key]=sourceProvince[key]??null;
   }
  }
 }
 function productionDetailModel(skuSet=null,scopeTitle=null,orderPlanReference=null){
  const findings=[...(d.findings||[])];
  const sum=(rows,key)=>rows.length&&rows.every(row=>row[key]!=null)?rows.reduce((total,row)=>total+row[key],0):null;
  const bases=(d.planRows||[]).map(base=>{
   const groups=(base.children||[]).map(category=>{
    const children=(category.children||[]).filter(sku=>!skuSet||skuSet.has(String(sku.object).split(' ')[0])).map(sku=>({...sku,scopeKey:base.object+' / '+category.object+' / '+sku.object,findingIds:[]}));
    return {...category,scopeKey:base.object+' / '+category.object,findingIds:[],children,
     ...(skuSet?{planned:sum(children,'planned'),actual:sum(children,'actual'),gap:sum(children,'gap'),rate:undefined}:{} )};
   }).filter(category=>!skuSet||category.children.length);
   const candidates=new Map();
   for(const category of groups)for(const sku of category.children){const code=String(sku.object).split(' ')[0];if(!candidates.has(code))candidates.set(code,[]);candidates.get(code).push({category,sku});}
   // A SKU repeated within one category has one reason assignment; a SKU
   // crossing categories cannot be assigned without a finer source key.
   const bySku=new Map([...candidates].filter(([,targets])=>new Set(targets.map(x=>x.category.scopeKey)).size===1).map(([code,targets])=>[code,targets[0]]));
   const baseFindingIds=[];
   for(const id of base.findingIds||[]){
    const original=d.findings[id];if(!original)continue;
    const scopedRecords=skuSet?(original.records||[]).filter(record=>skuSet.has(String(record.sku))):original.records||[];
    if(!scopedRecords.length)continue;
    const fact=skuSet?{...original,records:scopedRecords}:original;
    if(skuSet){baseFindingIds.push(findings.length);findings.push(fact);}else baseFindingIds.push(id);
    const grouped=new Map();
    for(const record of scopedRecords){const target=bySku.get(String(record.sku));if(!target)continue;const key=target.category.scopeKey;let entry=grouped.get(key);if(!entry){entry={target,records:[]};grouped.set(key,entry);}entry.records.push(record);}
    for(const {target,records} of grouped.values()){
     const categoryFact={...fact,scopeKey:target.category.scopeKey,records};target.category.findingIds.push(findings.length);findings.push(categoryFact);
     const skuGroups=new Map();for(const record of records){const sku=bySku.get(String(record.sku))?.sku;if(!sku)continue;if(!skuGroups.has(sku))skuGroups.set(sku,[]);skuGroups.get(sku).push(record);}
     for(const [sku,skuRecords] of skuGroups){sku.findingIds.push(findings.length);findings.push({...fact,scopeKey:sku.scopeKey,records:skuRecords});}
    }
   }
   return {...base,children:groups,findingIds:baseFindingIds,
    ...(skuSet?{planned:sum(groups,'planned'),actual:sum(groups,'actual'),gap:sum(groups,'gap'),rate:undefined}:{} )};
  }).filter(base=>!skuSet||base.children.length);
  const matchedCodes=new Set(bases.flatMap(base=>base.children.flatMap(category=>category.children.map(sku=>String(sku.object).split(' ')[0]))));
  const totals=skuSet?{planned:bases.length?sum(bases,'planned'):null,actual:bases.length?sum(bases,'actual'):null,gap:bases.length?sum(bases,'gap'):null}:d.productionMetric;
  return {...d,findings,planRows:bases,productionMetric:totals,
   productionMatchAudit:skuSet?{scope:scopeTitle,orderSkuCount:skuSet.size,matchedSkuCount:matchedCodes.size,orderPlanReference}:null,
   productionReferenceScope:skuSet?`${scopeTitle}的计划内缺货涉及${skuSet.size}个SKU，其中${matchedCodes.size}个与生产SKU编码匹配。下方是这些SKU的生产供给参考；尚未核对订单、日期、库存及调拨时序。`:null,
   calculation:skuSet?{...d.calculation,productionRate:'ratio-v1'}:d.calculation};
 }
 const productionDetail=productionDetailModel();
 let step=0,cause='demand',view='product',selected=null,ascending=false,all=false,sortKey='gap',stack=[],supplySource='auto';
 const titles={demand:'需求变化缺货量',plan:'计划内缺货量'};
 let stepCount=4;
 let reportReady=false,navLinks=[];
 function bindReportNav(){navLinks=[...document.querySelectorAll('.report-nav a')];navLinks.forEach(a=>a.addEventListener('click',()=>activateSection(a.hash)));activateSection(navLinks[0]?.hash);}
 function ensureReport(){if(reportReady)return;$('reportDocument').innerHTML=C.report(d);globalThis.ConclusionReport?.mount($('reportDocument'),d,C);reportReady=true;bindReportNav();}
 function showStep(i){step=(i+stepCount)%stepCount;if(step===3)ensureReport();document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',Number(p.dataset.panel)===step));document.querySelectorAll('[data-step]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.step)===step);b.setAttribute('aria-current',Number(b.dataset.step)===step?'step':'false');});$('prevBtn').disabled=step===0;$('stepHint').textContent=`第 ${step+1} / ${stepCount} 步`;$('nextBtn').textContent=step===stepCount-1?'回到第一步':'下一步 →';}
 const amount=()=>d.metric[cause==='demand'?'demandChangeShortage':'inPlanShortage'];
 function rows(){
   if(view==='overallBase'||view==='overallProduct'){const found=(d.overallRows||[]).filter(r=>view==='overallBase'?/基地/.test(r.view):/品类/.test(r.view));return found.length?found:(view==='overallBase'?(d.overallRows||[]).filter(r=>r.object==='全国').flatMap(r=>r.children||[]):[]);}
   if(cause==='plan'&&view==='product'&&d.classificationPlanDimensionRows?.length)return d.classificationPlanDimensionRows;
   if(cause==='plan'&&d.classificationPlanRows?.length)return d.classificationPlanRows;
   if(cause==='plan')return (view==='transfer'?(d.transferRows||[]):d.planRows).map(r=>({...r,unit:r.unit||d.scope.productionUnit}));
   return d.demandRows.filter(r=>view==='base'?/基地/.test(r.view):/品类/.test(r.view));
 }
 function render(){
  if(cause==='demand'&&view==='product'&&!d.demandRows.some(r=>/品类/.test(r.view))&&d.overallRows?.length)view='overallBase';
  $('specificAnalysis').classList.toggle('cause-analysis',cause!=='plan'||view.startsWith('overall'));
  $('causeTitle').textContent='在“'+titles[cause]+'”内部找重点对象';$('causeAmount').textContent='当前原因量 '+C.qty(amount(),d.scope.unit).replace(/&[^;]+;/g,'');
  $('causeContext').textContent=d.metric.classificationNote||(amount()==null?'当前未提供正式分类量；请核对数据来源与口径快照，已有供给证据仍可核查。':'各视角解释同一原因量，不跨视角相加。');
  $('causeBreadcrumb').textContent=d.scope.object+' › '+titles[cause];
  $('causeDefinition').textContent=cause==='demand'?C.classificationText(d,'demand'):d.classificationPlanRows?.length?C.classificationText(d,'plan'):'分类缺货量与生产偏差分别核验。下方保留日生产计划与实绩供给核查；生产偏差不等于订单缺货。';
  const views=cause==='demand'?[['product','品类视角'],['base','基地视角'],...(d.overallRows?.length?[['overallBase','总缺货·基地']]:[])]:d.classificationPlanDimensionRows?.length?[['product','品类／物料组'],['base','基地视角']]:[['base',d.classificationPlanRows?.length?'基地视角':'生产基地']];

  $('dimensionTabs').innerHTML=views.map(([k,t])=>`<button class="tab ${k===view?'active':''}" role="tab" aria-selected="${k===view}" data-view="${k}">${t}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;selected=null;stack=[];all=false;supplySource='auto';render();});
  if(view.startsWith('overall')){
   $('causeTitle').textContent='总缺货重点对象';$('causeAmount').textContent='总缺货 '+C.qty(d.metric.monthlyShortage,d.scope.unit);
   $('causeContext').textContent='按当前维度查看总缺货分布，分类缺货量仍单独核验。';
   $('causeBreadcrumb').textContent=d.scope.object+' › 总缺货分布';$('causeDefinition').textContent='选择对象查看其明细与关联证据。';
  }
  const list=rows().sort((a,b)=>{const x=a[sortKey]??a[sortKey==='planned'?'reported':sortKey==='actual'?'shipped':sortKey],y=b[sortKey]??b[sortKey==='planned'?'reported':sortKey==='actual'?'shipped':sortKey];if(x==null)return 1;if(y==null)return -1;return(ascending?1:-1)*(typeof x==='string'?x.localeCompare(y,'zh-CN'):x-y);});const visible=all?list:list.slice(0,10),max=Math.max(1,...list.map(r=>r.gap||0));
  const fields=[['object','对象'],['planned','计划／提报'],['ordered','下单'],['actual','实际／发货'],['gap','差额／分类量']];
  $('barList').innerHTML=`<div class="report-sort-toolbar"><label>排序字段 <select id="sortKey">${fields.map(([k,t])=>`<option value="${k}" ${sortKey===k?'selected':''}>${t}</option>`).join('')}</select><button class="btn" id="sortRows">${ascending?'升序':'降序'} ↕</button><button class="btn" id="toggleRows">${all?'收起至 Top10':'展开全部'}（${list.length}）</button></div>`+(visible.length?visible.map((r,i)=>`<button class="bar-row ${selected?.object===r.object?'selected':''}" data-row="${i}" aria-pressed="${selected?.object===r.object}"><span>${e(r.object)}</span><div class="bar-track"><div class="bar-fill" style="width:${100*(r.gap||0)/max}%"></div></div><span class="bar-value">${C.qty(r.gap,r.unit||d.scope.unit)}</span></button>`).join(''):'<p>当前维度缺少可映射明细；已有查询事实见下方证据。不能以总缺货量代替需求变化缺货量。</p>');
  if(cause==='plan'&&!d.classificationPlanRows?.length)$('barList').insertAdjacentHTML('beforeend','<p class="check-meta">已取得 '+list.length+' 个生产基地；'+list.filter(r=>r.gap>0).length+' 个基地月度非负净差大于0。0表示月度合计不欠产，并非无数据；仍可点击查看SKU或日生产欠产。此图是生产供给核查，不是订单计划内缺货的基地分布。</p>');
  $('barTitle').textContent=view.startsWith('overall')?'总缺货分布（不代表两类缺货归属）':cause==='plan'&&d.classificationPlanRows?.length?`计划内缺货复算参考 · ${view==='product'?'品类':'基地'}分布`:cause==='plan'?'C 生产计划供给 · 生产基地自产偏差量（点击联动）':'A 需求变化 · 分类缺货量（点击联动）';
  ReportControls.enhance($('sortKey'));
  $('sortKey').onchange=()=>{sortKey=$('sortKey').value;render();};
  $('sortRows').onclick=()=>{ascending=!ascending;render();};$('toggleRows').onclick=()=>{all=!all;render();};
  document.querySelectorAll('[data-row]').forEach(b=>b.onclick=()=>{const r=visible[Number(b.dataset.row)];selected=selected?.object===r.object?null:r;stack=[];supplySource='auto';render();});
  if(view.startsWith('overall')){$('specificAnalysis').innerHTML='<p>当前显示总缺货分布；分类参考值按正缺货记录独立复算。</p>'+C.table(['对象','已开订单缺货量','单位'],(selected?[selected]:list).map(r=>[r.object,C.number(r.gap),r.unit||C.metricUnit(d,'monthlyShortage')]));}
  else if(cause==='plan'&&d.classificationPlanRows?.length){
   $('specificAnalysis').innerHTML='<section id="productionSupplyEvidence" class="cause-analysis"></section>';
   const selectedSkuRows=!selected?[]:view==='product'?(d.crossDimensionRows||[]).filter(x=>x.category===selected.object).flatMap(x=>x.detailRows||[]):C.flatten([selected]).flatMap(x=>x.detailRows||[]);
   const selectedSkus=selected?new Set(selectedSkuRows.filter(x=>x.inPlanGap>0).map(x=>String(x.skuCode).trim())):null;
   const supply=selected?productionDetailModel(selectedSkus,selected.object,selected.gap):productionDetail;
   const schedule=SupplyScope.reference(d.scheduleSupplyRows,selectedSkus,selected?.object||'全部排程范围',selected?.gap??null,d.scheduleSupplyMetadata||{});
   const canSchedule=!!schedule?.rows?.length;
   const chooseSchedule=canSchedule&&(supplySource==='schedule'||(supplySource==='auto'&&!supply.planRows.length));
   if(chooseSchedule)supply.scheduleReference=schedule;
   if(schedule){
    $('specificAnalysis').insertAdjacentHTML('afterbegin',`<div class="report-sort-toolbar" role="group" aria-label="供给来源"><span>供给口径</span><button class="btn ${!chooseSchedule?'primary':''}" data-supply-source="mes">生产执行</button><button class="btn ${chooseSchedule?'primary':''}" data-supply-source="schedule" ${canSchedule?'':'disabled'}>生产排程</button><span class="check-meta">两种来源独立核查，不叠加。${schedule.status==='unit_conflict'?'排程包含多种单位，需先按单位分组或核验换算。':''}</span></div>`);
    $('specificAnalysis').querySelectorAll('[data-supply-source]').forEach(b=>b.onclick=()=>{supplySource=b.dataset.supplySource;render();});
   }
   TemplateComponents.mount($('productionSupplyEvidence'),supply,null,'plan','base',supply.planRows);
  }
  else TemplateComponents.mount($('specificAnalysis'),d,selected,cause,view,list);
 }
 if(d.scenario?.items?.length){
  stepCount=5;
  document.querySelector('.sidebar').insertAdjacentHTML('beforeend','<button class="step-btn" data-step="4"><span class="step-no">5</span><span class="step-name">What If 决策比较</span></button>');
  document.querySelector('.main').insertAdjacentHTML('beforeend',`<section class="panel" data-panel="4"><h2>What If · 情景试算，不代表执行</h2><p>仅使用已明确范围、单位和互斥关系的恢复上限；成本为情景假设。</p><div class="whatif-layout"><div class="card">${d.scenario.items.map((s,i)=>`<div class="slider-row"><div class="slider-head">${e(s.name)} <b id="scenario-value-${i}">0</b></div><p>上限 ${C.qty(s.max,d.scope.unit)}；成本 ${C.number(s.costPerUnit)} ${e(d.scenario.costUnit)}/${e(d.scope.unit)}</p><input aria-label="${e(s.name)}恢复量" type="range" min="0" max="${s.max}" step="any" value="0" data-scenario="${i}"></div>`).join('')}</div><div class="result-box"><div class="label">试算后满足率</div><div class="result-rate" id="scenarioRate"></div><div class="progress"><i id="scenarioProgress"></i></div><div id="scenarioStats"></div><p>尚需核查新鲜度、时效、客户优先级、切换损失及未来库存风险；未执行任何业务动作。</p></div></div></section>`);
  const updateScenario=()=>{let recovery=0,cost=0;document.querySelectorAll('[data-scenario]').forEach(x=>{const i=Number(x.dataset.scenario),v=Number(x.value);recovery+=v;cost+=v*d.scenario.items[i].costPerUnit;$('scenario-value-'+i).textContent=C.number(v);});const pct=d.calculation?.rate==='ratio-v1'?100*(d.metric.shipped+recovery)/d.metric.need:null;$('scenarioRate').textContent=pct==null?'— · 未配置情景满足率算法':pct.toFixed(2)+'%';$('scenarioProgress').style.width=Math.min(pct??0,100)+'%';$('scenarioStats').innerHTML=`<p>恢复量 ${C.qty(recovery,d.scope.unit)}</p><p>剩余缺货 ${C.qty(d.metric.monthlyShortage-recovery,d.scope.unit)}</p><p>增量成本 ${C.number(cost)} ${e(d.scenario.costUnit)}</p><p>单位恢复成本 ${recovery?C.number(cost/recovery):'不适用'} ${e(d.scenario.costUnit)}/${e(d.scope.unit)}</p>`;};
  document.querySelectorAll('[data-scenario]').forEach(x=>x.oninput=updateScenario);updateScenario();
 }
 document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>showStep(Number(b.dataset.step)));
 document.querySelectorAll('[data-cause]').forEach(b=>b.onclick=()=>{cause=b.dataset.cause;view=cause==='demand'||d.classificationPlanDimensionRows?.length?'product':'base';selected=null;document.querySelectorAll('[data-cause]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});render();showStep(2);});
 $('prevBtn').onclick=()=>showStep(step-1);$('nextBtn').onclick=()=>showStep(step+1);$('backToCauses').onclick=()=>showStep(1);
 document.addEventListener('click',ev=>{const b=ev.target.closest('.kpi-help');if(!b)return;const open=b.getAttribute('aria-expanded')!=='true';b.classList.toggle('open',open);b.setAttribute('aria-expanded',String(open));});
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape')document.querySelectorAll('.kpi-help').forEach(b=>{b.classList.remove('open');b.setAttribute('aria-expanded','false');});});
 $('downloadReport').onclick=()=>{const url=URL.createObjectURL(new Blob([C.markdown(d)],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='订单满足率原因分析报告.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('reportExportStatus').textContent='已生成全量 Markdown 文件';};
 $('copyReport').onclick=async()=>{try{await navigator.clipboard.writeText(C.markdown(d));$('reportExportStatus').textContent='已复制全量报告';}catch{$('reportExportStatus').textContent='剪贴板不可用，请下载报告';}};
 let opened=[];$('printReport').onclick=()=>{showStep(3);opened=[...document.querySelectorAll('#reportDocument details')].map(x=>[x,x.open]);opened.forEach(([x])=>x.open=true);globalThis.ConclusionReport?.print($('reportDocument'),true);document.body.classList.add('report-print');window.print();};window.addEventListener('afterprint',()=>{document.body.classList.remove('report-print');globalThis.ConclusionReport?.print($('reportDocument'),false);opened.forEach(([x,v])=>x.open=v);});
 function activateSection(hash){navLinks.forEach(a=>{if(a.hash===hash)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}
 let scheduled=false;
 function trackSection(){scheduled=false;if(step!==3)return;const edge=(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+(document.querySelector('.report-nav')?.offsetHeight||0)+24;let current=navLinks[0];for(const a of navLinks){const section=document.querySelector(a.hash);if(section&&section.getBoundingClientRect().top<=edge)current=a;}if(current)activateSection(current.hash);}
 window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(trackSection);}},{passive:true});
 showStep(0);render();
})();
