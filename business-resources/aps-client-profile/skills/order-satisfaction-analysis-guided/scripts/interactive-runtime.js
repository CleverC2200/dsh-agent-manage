(()=>{
 const d=JSON.parse(document.getElementById('analysisData').textContent),C=AnalysisCore,$=id=>document.getElementById(id),e=C.esc;
 let step=0,cause='demand',view='product',selected=null,ascending=false,all=false,sortKey='gap',stack=[];
 const titles={demand:'需求变化缺货量',plan:'计划内缺货量'};
 let stepCount=4;
 let reportReady=false,navLinks=[];
 function bindReportNav(){navLinks=[...document.querySelectorAll('.report-nav a')];navLinks.forEach(a=>a.addEventListener('click',()=>activateSection(a.hash)));activateSection(navLinks[0]?.hash);}
 function ensureReport(){if(reportReady)return;$('reportDocument').innerHTML=C.report(d);globalThis.ConclusionReport?.mount($('reportDocument'),d,C);reportReady=true;bindReportNav();}
 function showStep(i){step=(i+stepCount)%stepCount;if(step===3)ensureReport();document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',Number(p.dataset.panel)===step));document.querySelectorAll('[data-step]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.step)===step);b.setAttribute('aria-current',Number(b.dataset.step)===step?'step':'false');});$('prevBtn').disabled=step===0;$('stepHint').textContent=`第 ${step+1} / ${stepCount} 步`;$('nextBtn').textContent=step===stepCount-1?'回到第一步':'下一步 →';}
 const amount=()=>d.metric[cause==='demand'?'demandChangeShortage':'inPlanShortage'];
 function rows(){
   if(view==='overallBase'||view==='overallProduct')return (d.overallRows||[]).filter(r=>view==='overallBase'?/基地/.test(r.view):/品类/.test(r.view));
   if(cause==='plan')return (view==='transfer'?(d.transferRows||[]):d.planRows).map(r=>({...r,unit:r.unit||d.scope.productionUnit}));
   return d.demandRows.filter(r=>view==='base'?/基地/.test(r.view):/品类/.test(r.view));
 }
 function render(){
  $('causeTitle').textContent='在“'+titles[cause]+'”内部找重点对象';$('causeAmount').textContent='当前原因量 '+C.qty(amount(),d.scope.unit).replace(/&[^;]+;/g,'');
  $('causeContext').textContent=d.metric.classificationNote||(amount()==null?'当前未提供正式分类量；请核对数据来源与口径快照，已有供给证据仍可核查。':'各视角解释同一原因量，不跨视角相加。');
  $('causeBreadcrumb').textContent=d.scope.object+' › '+titles[cause];
  $('causeDefinition').textContent=cause==='demand'?C.classificationText(d,'demand'):'分类缺货量与生产偏差分别核验。下方保留日生产计划与实绩供给核查；生产偏差不等于订单缺货。';
  const views=cause==='demand'?[['product','品类视角'],['base','基地视角']]:[['base','生产基地']];

  $('dimensionTabs').innerHTML=views.map(([k,t])=>`<button class="tab ${k===view?'active':''}" role="tab" aria-selected="${k===view}" data-view="${k}">${t}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;selected=null;stack=[];all=false;render();});
  if(view.startsWith('overall')){
   $('causeTitle').textContent='总缺货重点对象';$('causeAmount').textContent='总缺货 '+C.qty(d.metric.monthlyShortage,d.scope.unit);
   $('causeContext').textContent='按当前维度查看总缺货分布，分类缺货量仍单独核验。';
   $('causeBreadcrumb').textContent=d.scope.object+' › 总缺货分布';$('causeDefinition').textContent='选择对象查看其明细与关联证据。';
  }
  const list=rows().sort((a,b)=>{const x=a[sortKey]??a[sortKey==='planned'?'reported':sortKey==='actual'?'shipped':sortKey],y=b[sortKey]??b[sortKey==='planned'?'reported':sortKey==='actual'?'shipped':sortKey];if(x==null)return 1;if(y==null)return -1;return(ascending?1:-1)*(typeof x==='string'?x.localeCompare(y,'zh-CN'):x-y);});const visible=all?list:list.slice(0,10),max=Math.max(1,...list.map(r=>r.gap||0));
  const fields=[['object','对象'],['planned','计划／提报'],['ordered','下单'],['actual','实际／发货'],['gap','差额／分类量']];
  $('barList').innerHTML=`<div class="report-sort-toolbar"><label>排序字段 <select id="sortKey">${fields.map(([k,t])=>`<option value="${k}" ${sortKey===k?'selected':''}>${t}</option>`).join('')}</select><button class="btn" id="sortRows">${ascending?'升序':'降序'} ↕</button><button class="btn" id="toggleRows">${all?'收起至 Top10':'展开全部'}（${list.length}）</button></div>`+(visible.length?visible.map((r,i)=>`<button class="bar-row ${selected?.object===r.object?'selected':''}" data-row="${i}" aria-pressed="${selected?.object===r.object}"><span>${e(r.object)}</span><div class="bar-track"><div class="bar-fill" style="width:${100*(r.gap||0)/max}%"></div></div><span class="bar-value">${C.qty(r.gap,r.unit||d.scope.unit)}</span></button>`).join(''):'<p>当前维度缺少可映射明细；已有查询事实见下方证据。不能以总缺货量代替需求变化缺货量。</p>');
  if(cause==='plan')$('barList').insertAdjacentHTML('beforeend','<p class="check-meta">已取得 '+list.length+' 个生产基地；'+list.filter(r=>r.gap>0).length+' 个基地月度非负净差大于0。0表示月度合计不欠产，并非无数据；仍可点击查看SKU或日生产欠产。此图是生产供给核查，不是订单计划内缺货的基地分布。</p>');
  $('barTitle').textContent=cause==='plan'?'C 生产计划供给 · 生产基地自产偏差量（点击联动）':'A 需求变化 · 分类缺货量（点击联动）';
  ReportControls.enhance($('sortKey'));
  $('sortKey').onchange=()=>{sortKey=$('sortKey').value;render();};
  $('sortRows').onclick=()=>{ascending=!ascending;render();};$('toggleRows').onclick=()=>{all=!all;render();};
  document.querySelectorAll('[data-row]').forEach(b=>b.onclick=()=>{const r=visible[Number(b.dataset.row)];selected=selected?.object===r.object?null:r;stack=[];render();});
  TemplateComponents.mount($('specificAnalysis'),d,selected,cause,view,list);
 }
 if(d.scenario?.items?.length){
  stepCount=5;
  document.querySelector('.sidebar').insertAdjacentHTML('beforeend','<button class="step-btn" data-step="4"><span class="step-no">5</span><span class="step-name">What If 决策比较</span></button>');
  document.querySelector('.main').insertAdjacentHTML('beforeend',`<section class="panel" data-panel="4"><h2>What If · 情景试算，不代表执行</h2><p>仅使用已明确范围、单位和互斥关系的恢复上限；成本为情景假设。</p><div class="whatif-layout"><div class="card">${d.scenario.items.map((s,i)=>`<div class="slider-row"><div class="slider-head">${e(s.name)} <b id="scenario-value-${i}">0</b></div><p>上限 ${C.qty(s.max,d.scope.unit)}；成本 ${C.number(s.costPerUnit)} ${e(d.scenario.costUnit)}/${e(d.scope.unit)}</p><input aria-label="${e(s.name)}恢复量" type="range" min="0" max="${s.max}" step="any" value="0" data-scenario="${i}"></div>`).join('')}</div><div class="result-box"><div class="label">试算后满足率</div><div class="result-rate" id="scenarioRate"></div><div class="progress"><i id="scenarioProgress"></i></div><div id="scenarioStats"></div><p>尚需核查新鲜度、时效、客户优先级、切换损失及未来库存风险；未执行任何业务动作。</p></div></div></section>`);
  const updateScenario=()=>{let recovery=0,cost=0;document.querySelectorAll('[data-scenario]').forEach(x=>{const i=Number(x.dataset.scenario),v=Number(x.value);recovery+=v;cost+=v*d.scenario.items[i].costPerUnit;$('scenario-value-'+i).textContent=C.number(v);});const pct=d.calculation?.rate==='ratio-v1'?100*(d.metric.shipped+recovery)/d.metric.need:null;$('scenarioRate').textContent=pct==null?'— · 未配置情景满足率算法':pct.toFixed(2)+'%';$('scenarioProgress').style.width=Math.min(pct??0,100)+'%';$('scenarioStats').innerHTML=`<p>恢复量 ${C.qty(recovery,d.scope.unit)}</p><p>剩余缺货 ${C.qty(d.metric.monthlyShortage-recovery,d.scope.unit)}</p><p>增量成本 ${C.number(cost)} ${e(d.scenario.costUnit)}</p><p>单位恢复成本 ${recovery?C.number(cost/recovery):'不适用'} ${e(d.scenario.costUnit)}/${e(d.scope.unit)}</p>`;};
  document.querySelectorAll('[data-scenario]').forEach(x=>x.oninput=updateScenario);updateScenario();
 }
 document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>showStep(Number(b.dataset.step)));
 document.querySelectorAll('[data-cause]').forEach(b=>b.onclick=()=>{cause=b.dataset.cause;view=cause==='demand'?'product':'base';selected=null;document.querySelectorAll('[data-cause]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});render();showStep(2);});
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
