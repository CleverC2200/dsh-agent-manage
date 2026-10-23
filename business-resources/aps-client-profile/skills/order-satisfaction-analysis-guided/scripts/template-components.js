/* Template DOM contract: cause-analysis-head → analysis-kpis → analysis-body.
 * Keep the original four supply cards, channel rows and inline drilldown structure.
 * Only data values and evidence-backed captions are supplied by the report input. */
(function(root){
 const C=root.AnalysisCore,e=C.esc,n=C.number,q=v=>v==null?'—':C.qty(v,'件');
 const sum=(rs,k)=>rs.length&&rs.every(r=>r[k]!=null)?rs.reduce((s,r)=>s+r[k],0):null;
 const ratio=(a,b)=>a!=null&&b>0?(100*a/b).toFixed(2)+'%':'—';
 const gap=r=>r.gap??null;
 const help=(label,text)=>`<button type="button" class="kpi-help" aria-label="${e(label)}口径说明" aria-expanded="false" data-help="${e(text)}">?</button>`;
 const accuracyCell=r=>r.accuracy==null?`<span class="accuracy-empty" title="${e(r.accuracyNote||'当前范围未取得正式准确率')}">—<small>${e(r.accuracyMissingReason||'未取得正式值')}</small></span>`:`<span title="${e(r.accuracyNote||'当前范围销售提报准确率')}">${n(r.accuracy)}%</span>`;
 const total=rs=>{const planned=sum(rs,'planned'),actual=sum(rs,'actual');return {planned,actual,gap:sum(rs,'gap'),rate:rs.length===1?rs[0].rate:undefined};};
 function productionRate(d,r){return r.rate!==undefined?(r.rate==null?'—':(100*r.rate).toFixed(2)+'%'):d.calculation?.productionRate==='ratio-v1'?ratio(r.actual,r.planned):'—';}
 function cards(d,prod,transfer,oe,od){
  const q=v=>C.qty(v,d.scope?.productionUnit||'件');
  return `<div class="analysis-kpis">${[['计划生产量','planned'],['实际执行量','actual'],['偏差量','gap'],['生产达成率','rate']].map(([label,key])=>{
   const value=r=>key==='rate'?productionRate(d,r):q(r[key]);
   return `<div class="analysis-kpi"><div class="analysis-kpi-title"><span>${label}</span>${help(label,'当前合计仅展示自产统计范围；调拨、OE、OD单列，未经对象、时间及去重核验不相加。实际生产量不等于合格入库或订单可用量；偏差读取本次发布值，不是订单因果量。')}</div><div class="kpi-total${key==='gap'?' bad':''}"><span>当前合计 · 自产</span><strong>${value(prod)}</strong></div><div class="kpi-channel-list"><div class="kpi-channel self"><span>自产</span><strong>${value(prod)}</strong></div><div class="kpi-channel transfer"><span>调拨</span><strong>${value(transfer)}</strong></div><div class="kpi-channel oe"><span>OE</span><strong>${value(oe)}</strong></div><div class="kpi-channel od"><span>OD</span><strong>${value(od)}</strong></div></div></div>`;
  }).join('')}</div>`;
 }
 function evidence(d,r){return (r.findingIds||[]).map(i=>d.findings[i]).filter(f=>f&&['verified_fact','verified_cause','supported_unverified'].includes(f.status));}
 function demandDetailTable(r,sourceBank){
  const rows=r.detailRows||[];
  const sourceButton=x=>{if(!x.records?.length)return '—';const id=String(sourceBank.size);sourceBank.set(id,x);return `<button type="button" class="btn demand-source-records" data-source-records="${id}" aria-expanded="false">查看（${x.records.length}）</button>`;};
  return `<details open class="demand-detail-block"><summary>需求变化明细（${rows.length}个SKU）</summary><div class="check-content"><p class="check-meta">当前基地×大区×省区下钻至SKU；源计划字段版本尚待核验，故仅作参考。数量单位均为件。</p>${rows.length?`<div class="report-table-wrap"><table class="demand-detail-table"><thead><tr><th>SKU编码</th><th>商品名称</th><th>源计划量参考（件）</th><th>需求量（件）</th><th>发货量（件）</th><th>发布缺货（件）</th><th>需求变化参考（件）</th><th>计划内参考（件）</th><th>源记录</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${e(x.skuCode)}</td><td>${e(x.skuName||'—')}</td>${['planReference','ordered','shipped','monthlyShortage','demandGap','inPlanGap'].map(k=>`<td class="number">${n(x[k])}</td>`).join('')}<td>${sourceButton(x)}</td></tr>`).join('')}</tbody></table></div>`:'<p>— · 当前对象尚无SKU明细，不生成推算记录。</p>'}</div></details>`;
 }
 function bindSourceRecords(host,bank){
  host.querySelectorAll('[data-source-records]').forEach(button=>button.onclick=()=>{
   const sku=bank.get(button.dataset.sourceRecords),row=button.closest('tr');
   if(button.getAttribute('aria-expanded')==='true'){row.nextElementSibling?.remove();button.setAttribute('aria-expanded','false');button.textContent=`查看（${sku.records.length}）`;root.ReportResponsive?.mount(host);return;}
   const detail=document.createElement('tr');detail.className='demand-source-row';
   detail.innerHTML='<td colspan="9"><div class="demand-source-panel"></div></td>';row.after(detail);
   button.setAttribute('aria-expanded','true');button.textContent='收起记录';
   const panel=detail.firstElementChild.firstElementChild,pageSize=10;
   function show(page){
    const pages=Math.ceil(sku.records.length/pageSize),records=sku.records.slice(page*pageSize,(page+1)*pageSize);
    panel.innerHTML=`<div class="demand-source-head"><div><strong>${e(sku.skuCode)} · ${e(sku.skuName||'—')}</strong><small>源记录 · 共 ${sku.records.length} 条 · 数量单位：件</small></div><button type="button" class="btn" data-source-close>关闭</button></div><div class="report-table-wrap demand-record-table"><table><thead><tr><th>日期</th><th>需求量（件）</th><th>发货量（件）</th><th>发布缺货（件）</th><th>源计划量参考（件）</th><th>需求变化参考（件）</th><th>计划内参考（件）</th></tr></thead><tbody>${records.map(x=>`<tr><td>${e(String(x.date||'—').slice(0,10))}</td>${['ordered','shipped','monthlyShortage','planReference','demandGap','inPlanGap'].map(k=>`<td class="number">${n(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="demand-source-pages"><span>第 ${page+1} / ${pages} 页 · ${page*pageSize+1}–${Math.min((page+1)*pageSize,sku.records.length)} 条</span><button type="button" class="btn" data-source-prev ${page===0?'disabled':''}>上一页</button><button type="button" class="btn" data-source-next ${page+1===pages?'disabled':''}>下一页</button></div>`;
    panel.querySelector('[data-source-close]').onclick=()=>{button.click();button.focus();};
    panel.querySelector('[data-source-prev]').onclick=()=>show(page-1);
    panel.querySelector('[data-source-next]').onclick=()=>show(page+1);
   }
   show(0);root.ReportResponsive?.mount(host);
  });
 }
 function planDrill(d,r,depth,filter){return root.ProductionReasons.render(d,r,depth,filter);}
 function drill(d,r,mode,depth=0,filter='all',sourceBank=new Map()){
  if(mode==='plan')return planDrill(d,r,depth,filter);
  const facts=evidence(d,r),children=r.children||[];
  const demandTitle=[r.object,r.region,r.province].filter(Boolean).join(' × ');
  const values=mode==='plan'?[['计划生产量',r.planned],['实际执行量',r.actual],['偏差量',gap(r)]]:[['初始提报',r.initialReportedDemand],['纠偏提报',r.reported],['实际下单',r.ordered],['分类缺货量',r.gap]];
  return `<div class="reason-drilldown plan-drilldown"><div class="plan-drilldown-head"><div><div class="plan-drilldown-kicker">已选对象 · 需求变化分析</div><h4>${e(demandTitle)}</h4><div class="plan-drilldown-sub">候选原因与明细分开呈现；明细数量不自动归入任何候选原因。</div></div><div class="plan-drilldown-metrics">${values.map(([k,v])=>`<div class="plan-drilldown-metric"><span>${k}</span><strong>${q(v)}</strong></div>`).join('')}</div></div><div class="supply-checks"><details open><summary>需求变化原因核查（${facts.length}项）</summary><div class="check-content"><div class="plan-reason-grid">${facts.length?facts.map(f=>`<article class="plan-reason-card"><div class="plan-reason-card-top"><span class="reason-role">${e(f.object)}</span><span class="pill supported">${e(C.labels[f.status])}</span></div><div class="plan-reason-title"><h5>${e(f.fact)}</h5></div><p>证据：${e((f.evidence||[]).join('；'))}</p><p>边界：${e(f.boundary)}</p></article>`).join(''):'<p>— · 当前对象尚无可验证原因证据，不继承其他对象的原因。</p>'}</div></div></details>${demandDetailTable(r,sourceBank)}${children.length?`<details><summary>下级组织明细（${children.length}）</summary><div class="check-content"><div class="report-table-wrap"><table><thead><tr><th>对象</th><th>计划／提报（件）</th><th>实际／发货（件）</th><th>差额（件）</th><th>继续下钻</th></tr></thead><tbody>${children.map(c=>`<tr><td>${e(c.object)}</td><td class="number">${n(c.reported)}</td><td class="number">${n(c.shipped)}</td><td class="number">${n(c.gap)}</td><td><details><summary>查看分析</summary>${depth<10?drill(d,c,mode,depth+1,filter,sourceBank):'<p>更深明细见全量底表。</p>'}</details></td></tr>`).join('')}</tbody></table></div></div></details>`:''}</div></div>`;
 }
 function mount(host,d,selected,mode,view,allRows){
  const unit=mode==='plan'?(d.scope?.productionUnit||'件'):(d.scope?.unit||'件'),q=v=>C.qty(v,unit);
  const positive=v=>v==null?null:Math.max(v,0);
  host.dataset.analysisMode=mode;
  let expanded=null,detailAll=false,sort='gap',asc=false,reasonFilter='all';
  const roots=selected?[selected]:allRows;
  const r=selected||{object:mode==='plan'?'全部生产基地':'全部对象',reported:sum(roots,'reported'),ordered:sum(roots,'ordered'),shipped:sum(roots,'shipped'),gap:sum(roots,'gap')};
  const items=mode==='plan'?roots.flatMap(x=>x.children?.length?x.children.map(c=>({...c,object:x.object+' × '+c.object})):([x])):roots.flatMap(x=>x.children?.length?x.children.flatMap(region=>region.children?.length?region.children.map(province=>({...province,object:x.object,region:region.object,province:province.object})):({...region,object:x.object,region:region.object})):([x]));
  const prod=mode==='plan'?{...total(roots),...(!selected?d.productionMetric:{})}:null;
  // Match only exact source objects. Do not invent base mappings for transfers.
  const channelRows=key=>selected?(d[key]||[]).filter(x=>x.object===selected.object):(d[key]||[]);
  const tr=total(channelRows('transferRows')),oe=total(channelRows('oeRows')),od=total(channelRows('odRows'));
  function render(){
   const sourceBank=new Map();
   const filtered=mode==='plan'?items.filter(x=>root.ProductionReasons.matches(d,x,reasonFilter)):items;
   const sorted=filtered.slice().sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return 1;if(y==null)return -1;return(asc?1:-1)*(typeof x==='string'?x.localeCompare(y,'zh-CN'):x-y);});
   const visible=detailAll?sorted:sorted.slice(0,10),denom=sum(items.filter(x=>!x.salesOnly).map(x=>({...x,gap:mode==='plan'?positive(x.gap):x.gap})),'gap');
   const rowKey=x=>JSON.stringify([x.object,x.region??null,x.province??null,x.scopeKey??null]);
   const header=(label,key)=>`<th aria-sort="${key===sort?(asc?'ascending':'descending'):'none'}"><button class="sort-button" data-detail-sort="${key}">${label} ${key===sort?(asc?'↑':'↓'):'↕'}</button></th>`;
   const cols=mode==='plan'?8:13;
   const head=mode==='plan'?`${header('执行对象（基地×品类）','object')}${header('日生产计划累计（'+unit+'）','planned')}${header('实际生产累计（'+unit+'）','actual')}${header('自产偏差量（'+unit+'）','gap')}<th>生产计划达成率${help('生产计划达成率','采用发布生产达成率；仅显式选择比例复核模式时按实际÷计划计算。')}</th><th>当前范围偏差占比${help('当前范围偏差占比','本条非负生产偏差÷当前列表非负生产偏差之和，不是订单原因贡献。')}</th><th>原因线索</th><th>原因下钻</th>`:`${header(view==='base'?'基地':'品类','object')}<th>大区</th><th>省区</th><th>销售提报准确率</th>${header('初始提报（件）','initialReportedDemand')}${header('纠偏提报（件）','reported')}${header('实际下单（'+C.metricUnit(d,'need')+'）','ordered')}<th>计划偏差量（件）</th>${header('月度发货（'+C.metricUnit(d,'shipped')+'）','shipped')}${header('分类缺货量（件）','gap')}<th>缺口占比</th><th>原因线索</th><th>原因下钻</th>`;
   const body=visible.map((x,i)=>{
    const nums=mode==='plan'?[n(x.planned),n(x.actual),n(x.gap),productionRate(d,x),ratio(positive(x.gap),denom)]:[e(x.region||'—'),e(x.province||'—'),accuracyCell(x),n(x.initialReportedDemand),n(x.reported),n(x.ordered),`<span title="${e(x.salesDemandPlanVarianceNote||'采用本次发布值')}">${n(x.salesDemandPlanVariance)}</span>`,n(x.shipped),n(x.gap),ratio(x.gap,denom)];
    const isExpanded=expanded===rowKey(x);
    return `<tr class="drill-row${isExpanded?' selected':''}" data-template-row="${i}"><td><strong>${e(x.object)}</strong></td>${nums.map(v=>`<td class="number">${v}</td>`).join('')}<td>${mode==='plan'?root.ProductionReasons.tagSummary(d,x):`<span class="pill supported">${evidence(d,x).length?'有线索 · 待核查':'—'}</span>`}</td><td><button class="btn drill-button" data-template-detail="${i}" aria-expanded="${isExpanded}">${isExpanded?'收起分析':'查看分析'}</button></td></tr>${isExpanded?`<tr class="inline-drill-row"><td colspan="${cols}">${drill(d,x,mode,0,reasonFilter,sourceBank)}</td></tr>`:''}`;
   }).join('')||`<tr><td colspan="${cols}">— · 当前分类明细未取得，保留原模板结构，不填充模拟记录。</td></tr>`;
   const metric=d.metric||{},scopeMetric=selected?{
    initialReportedDemand:r.initialReportedDemand,
    reportedDemand:r.reported,
    need:r.ordered,
    salesDemandPlanVariance:r.salesDemandPlanVariance,
    shipped:r.shipped,
    demandChangeShortage:r.gap
   }:{
    initialReportedDemand:metric.initialReportedDemand,
    reportedDemand:metric.reportedDemand,
    need:metric.need,
    salesDemandPlanVariance:metric.salesDemandPlanVariance,
    shipped:C.actualShipped(d),
    demandChangeShortage:metric.demandChangeShortage
   },scopeLabel=selected?`${r.object} · ${view==='base'?'基地':'品类'}月度口径`:'全国月度口径',monthlyMetrics=[
    ['销售初始需求提报量（月度）',scopeMetric.initialReportedDemand,'与页面顶部同名指标使用同一销售口径；选择对象后读取该对象的数据契约字段，当前维度不支持时显示—，不得按比例分摊。'],
    ['销售纠偏需求提报量（月度）',scopeMetric.reportedDemand,'与页面顶部同名指标使用同一销售口径；选择对象后读取该对象的数据契约字段，当前维度不支持时显示—。'],
    ['已开订单需求量（月度）',scopeMetric.need,'与页面顶部同名指标使用同一订单池和统计期间；选择对象后切换为该对象汇总。'],
    ['销售月度需求计划偏差量',scopeMetric.salesDemandPlanVariance,(selected?r.salesDemandPlanVarianceNote:metric.salesDemandPlanVarianceNote)||'只读取当前对象的数据契约字段；展示层不自行计算，缺失显示—。'],
    ['已开订单发货量（月度）',scopeMetric.shipped,'与页面顶部同名指标使用同一订单池和统计期间；选择对象后切换为该对象汇总。'],
    ['需求变化分类缺货量',scopeMetric.demandChangeShortage,'选择对象后显示该对象的需求变化分类量；与计划内缺货量共同接受分类完整性与勾稽校验。']
   ];
   const kpis=mode==='plan'?cards(d,selected?prod:{...prod,...d.productionMetric},tr,oe,od):`<div class="analysis-kpis six">${monthlyMetrics.map(([label,v,note],i)=>`<div class="analysis-kpi"><div class="analysis-kpi-title"><span>${label}</span>${help(label,note)}</div><strong>${C.qty(v,C.metricUnit(d,['initialReportedDemand','reportedDemand','need','salesDemandPlanVariance','shipped','demandChangeShortage'][i]))}</strong><small class="kpi-scope">${e(scopeLabel)}</small></div>`).join('')}</div>${selected&&r.scopeNote?`<p class="check-meta demand-scope-note">${e(r.scopeNote)}</p>`:''}`;
   const audit=mode==='plan'?`勾稽：日生产计划累计 ${q(prod.planned)} − 实际生产累计 ${q(prod.actual)} = 净差 ${q(prod.planned!=null&&prod.actual!=null?prod.planned-prod.actual:null)}；发布偏差汇总 ${q(prod.gap)}；列表非负偏差合计 ${q(denom)}。净差与各子项非负偏差不必相等，不作订单缺货归因。`:'勾稽：仅在唯一订单商品、最终计划版本及分类数据完整时验证。当前分类缺货量 '+q(r.gap)+'；缺失项不补零。';
   host.innerHTML=`<div class="cause-analysis-head"><div><h3>${mode==='plan'?'C 生产计划供给':'A 需求变化月度复盘'}：${e(r.object)}${mode==='plan'?'的供给兑现情况':''}</h3><p>${mode==='plan'?'自产、调拨、OE、OD在同组指标卡内并列展示；缺失项显示“—”，不按0处理。':'未选择对象时六项与页面顶部全国月度指标同源同值；选择基地或品类后切换为当前对象，源模型不支持的维度显示“—”。两个视角不相加。'}</p></div><span class="pill supported">${mode==='plan'?'生产事实 · 订单因果待核':'分类证据待核'}</span></div>${kpis}${mode==='plan'?root.ProductionReasons.overview(d,roots,reasonFilter):''}<div class="analysis-body"><div class="analysis-section-title"><strong>${mode==='plan'?'基地×品类自产计划明细':'基地／品类→大区→省区需求复盘'}</strong><span class="hint">点击表头排序 · 原因下钻</span></div><div class="report-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${filtered.length>10?`<button class="btn detail-toggle" id="templateDetailToggle">${detailAll?'收起至 Top10':'展开全部'}（${filtered.length}）</button>`:''}<div class="audit-equation">${audit}</div></div>`;
   host.querySelectorAll('[data-template-detail]').forEach(btn=>btn.onclick=ev=>{ev.stopPropagation();const x=visible[Number(btn.dataset.templateDetail)];expanded=expanded===rowKey(x)?null:rowKey(x);render();});
   host.querySelectorAll('[data-template-row]').forEach(row=>row.onclick=ev=>{if(!ev.target.closest('button,details,summary'))row.querySelector('[data-template-detail]').click();});
   host.querySelectorAll('[data-detail-sort]').forEach(btn=>btn.onclick=()=>{asc=sort===btn.dataset.detailSort?!asc:false;sort=btn.dataset.detailSort;render();});
   host.querySelectorAll('[data-dictionary-filter]').forEach(btn=>btn.onclick=()=>{reasonFilter=reasonFilter===btn.dataset.dictionaryFilter?'all':btn.dataset.dictionaryFilter;detailAll=true;render();});
   const toggle=host.querySelector('#templateDetailToggle');if(toggle)toggle.onclick=()=>{detailAll=!detailAll;render();};
   bindSourceRecords(host,sourceBank);
   root.ReportResponsive?.mount(host);
  }
  render();
 }
 root.TemplateComponents={mount};
})(globalThis);
