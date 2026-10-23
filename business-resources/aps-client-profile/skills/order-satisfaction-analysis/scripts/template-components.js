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
   return `<div class="analysis-kpi"><div class="analysis-kpi-title"><span>${label}</span>${help(label,d.productionReferenceScope?'当前仅统计与订单侧计划内缺货SKU编码匹配的生产SKU；偏差为匹配SKU正差之和。生产供给不等于订单可用量或已验证订单原因。':'当前合计仅展示自产统计范围；调拨、OE、OD单列，未经对象、时间及去重核验不相加。实际生产量不等于合格入库或订单可用量；偏差读取本次发布值，不是订单因果量。')}</div><div class="kpi-total${key==='gap'?' bad':''}"><span>当前合计 · 自产</span><strong>${value(prod)}</strong></div><div class="kpi-channel-list"><div class="kpi-channel self"><span>自产</span><strong>${value(prod)}</strong></div><div class="kpi-channel transfer"><span>调拨</span><strong>${value(transfer)}</strong></div><div class="kpi-channel oe"><span>OE</span><strong>${value(oe)}</strong></div><div class="kpi-channel od"><span>OD</span><strong>${value(od)}</strong></div></div></div>`;
  }).join('')}</div>`;
 }
 function evidence(d,r){return (r.findingIds||[]).map(i=>d.findings[i]).filter(f=>f&&['verified_fact','verified_cause','supported_unverified'].includes(f.status));}
 function demandDetailTable(r,sourceBank){
  const rows=r.detailRows||[];
  const sourceButton=x=>{if(!x.records?.length)return '<span class="check-meta">无正缺货源行</span>';const id=String(sourceBank.size);sourceBank.set(id,x);return `<button type="button" class="btn demand-source-records" data-source-records="${id}" aria-expanded="false">查看（${x.records.length}）</button>`;};
  return `<details open class="demand-detail-block"><summary>需求变化明细（${rows.length}个SKU）</summary><div class="check-content"><p class="check-meta">${r.materialGroup?'当前品类×物料组×大区×省区':'当前基地×大区×省区'}下钻至SKU。初始／纠偏提报来自销售表，订单需求、发货和发布缺货来自订单表；已知最终计划仅汇总正缺货源行，与订单全量数量并列查看，不直接相减。最终计划缺值单列。</p>${rows.length?`<div class="report-table-wrap"><table class="demand-detail-table"><thead><tr><th>SKU编码</th><th>商品名称</th><th>初始提报（件）</th><th>纠偏提报（件）</th><th>正缺货行已知最终计划（件）</th><th>计划缺值（条）</th><th>订单需求（件）</th><th>订单发货（件）</th><th>发布缺货（件）</th><th>需求变更参考（件）</th><th>计划内参考（件）</th><th>正缺货源行</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${e(x.skuCode)}</td><td>${e(x.skuName||'—')}</td>${['initialReportedDemand','reported','planReference','nullPlanRows','ordered','shipped','monthlyShortage','demandGap','inPlanGap'].map(k=>`<td class="number">${n(x[k])}</td>`).join('')}<td>${sourceButton(x)}</td></tr>`).join('')}</tbody></table></div>`:'<p>— · 当前对象没有SKU明细；跨表汇总范围见上方指标。</p>'}</div></details>`;
 }
 function bindSourceRecords(host,bank){
  host.querySelectorAll('[data-source-records]').forEach(button=>button.onclick=()=>{
   const sku=bank.get(button.dataset.sourceRecords),row=button.closest('tr');
   if(button.getAttribute('aria-expanded')==='true'){row.nextElementSibling?.remove();button.setAttribute('aria-expanded','false');button.textContent=`查看（${sku.records.length}）`;root.ReportResponsive?.mount(host);return;}
   const detail=document.createElement('tr');detail.className='demand-source-row';
   detail.innerHTML='<td colspan="12"><div class="demand-source-panel"></div></td>';row.after(detail);
   button.setAttribute('aria-expanded','true');button.textContent='收起记录';
   const panel=detail.firstElementChild.firstElementChild,pageSize=10;
   function show(page){
    const pages=Math.ceil(sku.records.length/pageSize),records=sku.records.slice(page*pageSize,(page+1)*pageSize);
    panel.innerHTML=`<div class="demand-source-head"><div><strong>${e(sku.skuCode)} · ${e(sku.skuName||'—')}</strong><small>正缺货源行 · 共 ${sku.records.length} 条 · 数量单位：件</small></div><button type="button" class="btn" data-source-close>关闭</button></div><div class="report-table-wrap demand-record-table"><table><thead><tr><th>源行序号</th><th>源日期</th><th>需求量（件）</th><th>发货量（件）</th><th>发布缺货（件）</th><th>最终计划（件）</th><th>需求变更参考（件）</th><th>计划内参考（件）</th></tr></thead><tbody>${records.map(x=>`<tr><td>${n(x.sourceRow)}</td><td>${e(String(x.date||'—').slice(0,10))}</td>${['ordered','shipped','monthlyShortage','planReference','demandGap','inPlanGap'].map(k=>`<td class="number">${n(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="demand-source-pages"><span>第 ${page+1} / ${pages} 页 · ${page*pageSize+1}–${Math.min((page+1)*pageSize,sku.records.length)} 条</span><button type="button" class="btn" data-source-prev ${page===0?'disabled':''}>上一页</button><button type="button" class="btn" data-source-next ${page+1===pages?'disabled':''}>下一页</button></div>`;
    panel.querySelector('[data-source-close]').onclick=()=>{button.click();button.focus();};
    panel.querySelector('[data-source-prev]').onclick=()=>show(page-1);
    panel.querySelector('[data-source-next]').onclick=()=>show(page+1);
   }
   show(0);root.ReportResponsive?.mount(host);
  });
 }
 function planDrill(d,r,depth,filter){return root.ProductionReasons.render(d,r,depth,filter);}
 function mountScheduleReference(host,d){
  const ref=d.scheduleReference,rows=ref.rows||[],number=v=>v==null?null:Number(v),fmt=v=>C.qty(v,ref.unit||'源单位待核验');
  const sources=[...new Set((ref.groups||[]).map(x=>x.channel||'来源未提供'))],preferred=sources.includes('工厂')?'工厂':sources[0];
  let showAll=false,sortKey='gap',ascending=false,expanded=null,selectedSource=preferred;
  const cardValue=(v,i)=>i===3?(v==null?'—':v.toFixed(2)+'%'):fmt(v);
  function render(){
   const skus=(ref.groups||[]).filter(x=>(x.channel||'来源未提供')===selectedSource),sourceRows=rows.filter(x=>(x.data_source||'来源未提供')===selectedSource);
   const planned=sum(skus,'planned'),delivered=sum(skus,'delivered'),gap=sum(skus,'gap'),net=planned!=null&&delivered!=null?planned-delivered:null,matchedSkuCount=new Set(skus.map(x=>x.code)).size;
   const cards=[['排程计划量',planned,'9月计划完成日的匹配订单SKU排程量'],['排程交付量',delivered,'同批排程记录的交付量；源值为空时保留“—”'],['SKU未交付差额',gap,'先按来源×工厂×SKU汇总计划与交付，再取正差；与月度净差不同'],['排程交付率',planned>0&&delivered!=null?100*delivered/planned:null,'交付量÷计划量；不代表订单满足率']];
   const sorted=skus.slice().sort((a,b)=>{const x=a[sortKey],y=b[sortKey];if(x==null)return y==null?0:1;if(y==null)return -1;return(ascending?1:-1)*(typeof x==='string'?x.localeCompare(y,'zh-CN'):x-y);});
   const visible=showAll?sorted:sorted.slice(0,10);
   host.innerHTML=`<div class="cause-analysis-head"><div><h3>C 生产计划供给：${e(ref.scope)}的供给兑现情况</h3><p>按订单SKU编码匹配本期生产排程；订单缺货与生产排程按各自口径并列核查。</p></div><span class="pill supported">生产排程 · 订单因果待核</span></div>
   <div class="supply-match-note" role="status">${e(ref.scope)}的计划内缺货复算参考为 <strong>${C.qty(ref.orderPlanReference,d.scope?.unit)}</strong>，涉及 <strong>${n(ref.orderSkuCount)} 个订单SKU</strong>。当前“${e(selectedSource)}”排程匹配 <strong>${n(matchedSkuCount)} 个SKU、${n(sourceRows.length)} 条记录</strong>；数量单位：${e(ref.unit)}。不同来源独立查看，不相加。</div>
   ${sources.length>1?`<div class="view-tabs schedule-source-tabs" aria-label="排程来源">${sources.map(x=>`<button type="button" class="tab${x===selectedSource?' active':''}" data-schedule-source="${e(x)}">${e(x)}</button>`).join('')}</div>`:''}
   <div class="analysis-kpis">${cards.map(([label,value,note],i)=>`<div class="analysis-kpi"><div class="analysis-kpi-title"><span>${label}</span>${help(label,note)}</div><div class="kpi-total${i===2?' bad':''}"><span>当前合计 · 生产排程</span><strong>${cardValue(value,i)}</strong></div><div class="kpi-channel-list"><div class="kpi-channel self"><span>当前排程</span><strong>${cardValue(value,i)}</strong></div><div class="kpi-channel transfer"><span>调拨</span><strong>—</strong></div><div class="kpi-channel oe"><span>OE</span><strong>—</strong></div><div class="kpi-channel od"><span>OD</span><strong>—</strong></div></div></div>`).join('')}</div>
   <div class="analysis-body"><div class="analysis-section-title"><strong>匹配订单SKU的生产排程明细</strong><span class="hint">点击表头排序 · 点击行查看排程源记录</span></div><div class="report-table-wrap"><table><thead><tr><th>来源</th><th>工厂</th><th><button class="sort-button" data-schedule-sort="name">商品</button></th><th>SKU编码</th><th><button class="sort-button" data-schedule-sort="planned">计划量（${e(ref.unit)}）</button></th><th><button class="sort-button" data-schedule-sort="delivered">交付量（${e(ref.unit)}）</button></th><th><button class="sort-button" data-schedule-sort="gap">未交付差额（${e(ref.unit)}）</button></th><th>交付率</th><th>源行</th></tr></thead><tbody>${visible.map(x=>{
    const open=expanded===x.key;
    const sourceRows=x.source.map(row=>`<tr><td>${e(String(row.base_finish_day).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'))}</td><td>${e(x.code)}</td><td>${e(row.order_no)}</td><td class="number">${n(number(row.order_qty))}</td><td class="number">${row.confirm_qty==null?'—':n(number(row.confirm_qty))}</td><td class="number">${row.deliv_qty==null?'—':n(number(row.deliv_qty))}</td></tr>`).join('');
    return `<tr class="drill-row${open?' selected':''}" data-schedule-row="${e(x.key)}"><td>${e(x.channel)}</td><td>${e(x.factory)}</td><td>${e(x.name)}</td><td>${e(x.code)}</td><td class="number">${n(x.planned)}</td><td class="number">${n(x.delivered)}</td><td class="number">${n(x.gap)}</td><td class="number">${x.planned>0&&x.delivered!=null?(100*x.delivered/x.planned).toFixed(2)+'%':'—'}</td><td><button type="button" class="btn drill-button" data-schedule-detail="${e(x.key)}" aria-expanded="${open}">${open?'收起分析':'查看分析'}</button></td></tr>${open?`<tr class="inline-drill-row"><td colspan="9"><section class="production-analysis reason-drilldown plan-drilldown"><div class="plan-drilldown-head"><div><div class="plan-drilldown-kicker">已选对象 · 生产排程记录</div><h4>${e(x.channel)} × ${e(x.factory)} × ${e(x.name)}</h4><p class="check-meta">SKU ${e(x.code)} · 当前来源和商品的全部匹配排程；未取得生产偏差原因原文。</p></div><div class="plan-drilldown-metrics">${[['排程计划量',x.planned],['排程交付量',x.delivered],['未交付差额',x.gap]].map(([label,value])=>`<div class="plan-drilldown-metric"><span>${label}</span><strong>${fmt(value)}</strong></div>`).join('')}</div></div><div class="supply-checks"><details open class="production-source-records"><summary>生产排程原始记录（${x.source.length}条）</summary><p class="check-meta">按计划完成日期与排程单号查看；排程交付不等于已验证的订单可用供给。</p><div class="report-table-wrap reason-record-scroll"><table><thead><tr><th>计划完成日</th><th>SKU</th><th>排程单号</th><th>计划量（${e(ref.unit)}）</th><th>确认量（${e(ref.unit)}）</th><th>交付量（${e(ref.unit)}）</th></tr></thead><tbody>${sourceRows}</tbody></table></div></details></div></section></td></tr>`:''}`;
   }).join('')}</tbody></table></div>${skus.length>10?`<button type="button" class="btn detail-toggle" id="scheduleToggle">${showAll?'收起至 Top10':'展开全部'}（${skus.length}）</button>`:''}<div class="audit-equation">同批排程：计划 ${fmt(planned)} − 交付 ${fmt(delivered)} = 净差 ${fmt(net)}；按SKU取正差 ${fmt(gap)}。排程交付不等于订单可用供给，尚需核对订单需要日期、库存及调拨。</div></div>`;
   host.querySelectorAll('[data-schedule-detail]').forEach(button=>button.onclick=event=>{event.stopPropagation();expanded=expanded===button.dataset.scheduleDetail?null:button.dataset.scheduleDetail;render();});
   host.querySelectorAll('[data-schedule-row]').forEach(row=>row.onclick=event=>{if(!event.target.closest('button')){expanded=expanded===row.dataset.scheduleRow?null:row.dataset.scheduleRow;render();}});
   host.querySelectorAll('[data-schedule-sort]').forEach(button=>button.onclick=()=>{ascending=sortKey===button.dataset.scheduleSort?!ascending:false;sortKey=button.dataset.scheduleSort;render();});
   host.querySelectorAll('[data-schedule-source]').forEach(button=>button.onclick=()=>{selectedSource=button.dataset.scheduleSource;expanded=null;showAll=false;render();});
   const toggle=host.querySelector('#scheduleToggle');if(toggle)toggle.onclick=()=>{showAll=!showAll;render();};
   root.ReportResponsive?.mount(host);
  }
  render();
 }
 function drill(d,r,mode,depth=0,filter='all',sourceBank=new Map()){
  if(mode==='plan')return planDrill(d,r,depth,filter);
  const facts=evidence(d,r),children=r.children||[];
  const demandTitle=[r.object,r.materialGroup,r.region,r.province].filter(Boolean).join(' × ');
  const values=mode==='plan'?[['计划生产量',r.planned],['实际执行量',r.actual],['偏差量',gap(r)]]:[['初始提报',r.initialReportedDemand],['纠偏提报',r.reported],['实际下单',r.ordered],['分类缺货量',r.gap]];
  return `<div class="reason-drilldown plan-drilldown"><div class="plan-drilldown-head"><div><div class="plan-drilldown-kicker">已选对象 · 需求变化分析</div><h4>${e(demandTitle)}</h4><div class="plan-drilldown-sub">候选原因与明细分开呈现；明细数量不自动归入任何候选原因。</div></div><div class="plan-drilldown-metrics">${values.map(([k,v])=>`<div class="plan-drilldown-metric"><span>${k}</span><strong>${q(v)}</strong></div>`).join('')}</div></div><div class="supply-checks"><details open><summary>需求调整事件证据（${facts.length}项）</summary><div class="check-content"><div class="plan-reason-grid">${facts.length?facts.map(f=>`<article class="plan-reason-card"><div class="plan-reason-card-top"><span class="reason-role">${e(f.object)}</span><span class="pill supported">${e(C.labels[f.status])}</span></div><div class="plan-reason-title"><h5>${e(f.fact)}</h5></div><p>证据：${e((f.evidence||[]).join('；'))}</p><p>边界：${e(f.boundary)}</p></article>`).join(''):'<p>当前对象已有需求变更分类参考值和正缺货源行，但尚未取得订单增改日志、最终计划版本及生效时间，不能认定需求变化的业务原因。请在下方SKU明细查看已取得的记录。</p>'}</div></div></details>${demandDetailTable(r,sourceBank)}${children.length?`<details><summary>下级组织明细（${children.length}）</summary><div class="check-content"><div class="report-table-wrap"><table><thead><tr><th>对象</th><th>计划／提报（件）</th><th>实际／发货（件）</th><th>差额（件）</th><th>继续下钻</th></tr></thead><tbody>${children.map(c=>`<tr><td>${e(c.object)}</td><td class="number">${n(c.reported)}</td><td class="number">${n(c.shipped)}</td><td class="number">${n(c.gap)}</td><td><details><summary>查看分析</summary>${depth<10?drill(d,c,mode,depth+1,filter,sourceBank):'<p>更深明细见全量底表。</p>'}</details></td></tr>`).join('')}</tbody></table></div></div></details>`:''}</div></div>`;
 }
 function mount(host,d,selected,mode,view,allRows,appendHtml=''){
  if(mode==='plan'&&d.scheduleReference?.rows?.length){host.dataset.analysisMode=mode;mountScheduleReference(host,d);return;}
  const unit=mode==='plan'?(d.scope?.productionUnit||'件'):(d.scope?.unit||'件'),q=v=>C.qty(v,unit);
  const positive=v=>v==null?null:Math.max(v,0);
  host.dataset.analysisMode=mode;
  let expanded=null,detailAll=false,sort='gap',asc=false,reasonFilter='all';
  const roots=selected?[selected]:allRows;
  const r=selected||{object:mode==='plan'?(d.productionReferenceScope?'匹配订单SKU的生产供给参考':'全部生产基地'):'全部对象',reported:sum(roots,'reported'),ordered:sum(roots,'ordered'),shipped:sum(roots,'shipped'),gap:sum(roots,'gap')};
  const cross=mode!=='plan'&&view==='product'&&d.crossDimensionRows?.length;
  const items=mode==='plan'?roots.flatMap(x=>x.children?.length?x.children.map(c=>({...c,object:x.object+' × '+c.object})):([x])):cross?d.crossDimensionRows.filter(x=>!selected||x.category===selected.object).map(x=>({...x,object:x.category,salesOnly:!x.orderRows,scopeNote:'同月物料编码映射至品类与物料组；销售提报和订单数量各自汇总。'+(x.matchStatus==='both'?'两表均有该维度记录。':x.matchStatus==='sales_only'?'该维度只有销售记录。':'该维度只有订单记录。')})):roots.flatMap(x=>x.children?.length?x.children.flatMap(region=>region.children?.length?region.children.map(province=>({...province,object:x.object,region:region.object,province:province.object})):({...region,object:x.object,region:region.object})):([x]));
  const prod=mode==='plan'?{...total(roots),...(!selected?d.productionMetric:{})}:null;
  // Match only exact source objects. Do not invent base mappings for transfers.
  const channelRows=key=>selected?(d[key]||[]).filter(x=>x.object===selected.object):(d[key]||[]);
  const tr=total(channelRows('transferRows')),oe=total(channelRows('oeRows')),od=total(channelRows('odRows'));
  function render(){
   const sourceBank=new Map();
   const match=mode==='plan'?d.productionMatchAudit:null;
   const noMatch=!!(match&&match.orderSkuCount>0&&match.matchedSkuCount===0);
   const matchNote=match?`<div class="supply-match-note${noMatch?' no-match':''}" role="status">${e(match.scope)}的计划内缺货复算参考为 <strong>${C.qty(match.orderPlanReference,d.scope.unit)}</strong>；涉及 <strong>${C.number(match.orderSkuCount)} 个订单SKU</strong>，其中 <strong>${C.number(match.matchedSkuCount)} 个</strong>在本期生产明细中按编码匹配。${noMatch?'以下生产指标显示“—”表示未取得匹配记录，不是生产量或缺货量为 0。':'以下仅展示匹配SKU的生产供给参考，尚未核对订单需要时点与库存调拨。'}</div>`:'';
   const filtered=mode==='plan'?items.filter(x=>root.ProductionReasons.matches(d,x,reasonFilter)):items;
   const sorted=filtered.slice().sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return 1;if(y==null)return -1;return(asc?1:-1)*(typeof x==='string'?x.localeCompare(y,'zh-CN'):x-y);});
   const visible=detailAll?sorted:sorted.slice(0,10),denom=sum(items.filter(x=>!x.salesOnly).map(x=>({...x,gap:mode==='plan'?positive(x.gap):x.gap})),'gap');
   const rowKey=x=>JSON.stringify([x.object,x.region??null,x.province??null,x.scopeKey??null]);
   const header=(label,key)=>`<th aria-sort="${key===sort?(asc?'ascending':'descending'):'none'}"><button class="sort-button" data-detail-sort="${key}">${label} ${key===sort?(asc?'↑':'↓'):'↕'}</button></th>`;
   const cols=mode==='plan'?8:cross?16:13;
   const head=mode==='plan'?`${header('执行对象（基地×品类）','object')}${header('日生产计划累计（'+unit+'）','planned')}${header('实际生产累计（'+unit+'）','actual')}${header('自产偏差量（'+unit+'）','gap')}<th>生产计划达成率${help('生产计划达成率','采用发布生产达成率；仅显式选择比例复核模式时按实际÷计划计算。')}</th><th>当前范围偏差占比${help('当前范围偏差占比','本条非负生产偏差÷当前列表非负生产偏差之和，不是订单原因贡献。')}</th><th>原因线索</th><th>原因下钻</th>`:`${header(view==='base'?'基地':'品类','object')}${cross?'<th>物料组</th>':''}<th>大区</th><th>省区</th><th>${cross?'销售提报准确率参考':'销售提报准确率'}</th>${header('初始提报（件）','initialReportedDemand')}${header('纠偏提报（件）','reported')}${header('订单需求（'+C.metricUnit(d,'need')+'）','ordered')}<th>提报－订单对照（件）</th>${header('订单发货（'+C.metricUnit(d,'shipped')+'）','shipped')}${cross?'<th>源缺货（件）</th>':''}${header('需求变更参考（件）','gap')}${cross?'<th>计划内参考（件）</th>':''}<th>分类参考占比</th><th>${cross?'数据覆盖':'原因线索'}</th><th>明细下钻</th>`;
   const body=visible.map((x,i)=>{
    const nums=mode==='plan'?[n(x.planned),n(x.actual),n(x.gap),productionRate(d,x),ratio(positive(x.gap),denom)]:[...(cross?[e(x.materialGroup||'—')]:[]),e(x.region||'—'),e(x.province||'—'),accuracyCell(x),n(x.initialReportedDemand),n(x.reported),n(x.ordered),`<span title="${e(x.salesDemandPlanVarianceNote||'销售与订单同维度并列对照')}" >${n(x.salesDemandPlanVariance)}</span>`,n(x.shipped),...(cross?[n(x.monthlyShortage)]:[]),n(x.gap),...(cross?[n(x.inPlanReference)]:[]),ratio(x.gap,denom)];
    const isExpanded=expanded===rowKey(x);
    return `<tr class="drill-row${isExpanded?' selected':''}" data-template-row="${i}"><td><strong>${e(x.object)}</strong></td>${nums.map(v=>`<td class="number">${v}</td>`).join('')}<td>${mode==='plan'?root.ProductionReasons.tagSummary(d,x):cross?`<span class="pill supported">${e(x.matchStatus==='both'?'双表覆盖':x.matchStatus==='sales_only'?'仅销售':'仅订单')}</span>`:`<span class="pill supported">${evidence(d,x).length?'有线索 · 待核查':'—'}</span>`}</td><td><button class="btn drill-button" data-template-detail="${i}" aria-expanded="${isExpanded}">${isExpanded?'收起分析':'查看分析'}</button></td></tr>${isExpanded?`<tr class="inline-drill-row"><td colspan="${cols}">${drill(d,x,mode,0,reasonFilter,sourceBank)}</td></tr>`:''}`;
   }).join('')||`<tr><td colspan="${cols}">${noMatch?'所选订单SKU在本期生产明细中无编码匹配；生产计划、实际和偏差保持缺失状态，不填0。':'— · 当前分类明细未取得，保留原模板结构，不填充模拟记录。'}</td></tr>`;
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
   const audit=mode==='plan'?(d.productionReferenceScope?`同SKU生产参考：计划 ${q(prod.planned)} − 实际 ${q(prod.actual)} = 净差 ${q(prod.planned!=null&&prod.actual!=null?prod.planned-prod.actual:null)}；SKU正差汇总 ${q(prod.gap)}。不同粒度差额不必相等，也不能据此认定订单缺货原因。`:`勾稽：日生产计划累计 ${q(prod.planned)} − 实际生产累计 ${q(prod.actual)} = 净差 ${q(prod.planned!=null&&prod.actual!=null?prod.planned-prod.actual:null)}；发布偏差汇总 ${q(prod.gap)}；列表非负偏差合计 ${q(denom)}。净差与各子项非负偏差不必相等，不作订单缺货归因。`):cross?`销售提报和订单数量按品类、物料组、大区、省区分别汇总后并列。当前共${items.length}个分组；销售与订单并列数不表示同一订单商品池。物料组映射多值保留待确认，分类参考量仅覆盖计划值非空的正缺货记录。`:'勾稽：仅在唯一订单商品、最终计划版本及分类数据完整时验证。当前分类缺货量 '+q(r.gap)+'；缺失项不补零。';
   host.innerHTML=`<div class="cause-analysis-head"><div><h3>${mode==='plan'?'C 生产计划供给':'A 需求变化月度复盘'}：${e(r.object)}${mode==='plan'?'的供给兑现情况':''}</h3><p>${mode==='plan'?'自产、调拨、OE、OD在同组指标卡内并列展示；缺失项显示“—”，不按0处理。':cross?'销售提报与订单分别取数，按相同品类、物料组、大区、省区并列；分类缺货仅作部分覆盖的复算参考。':'未选择对象时六项与页面顶部全国月度指标同源同值；选择基地或品类后切换为当前对象，源模型不支持的维度显示—。两个视角不相加。'}</p></div><span class="pill supported">${mode==='plan'?'生产事实 · 订单因果待核':'分类证据待核'}</span></div>${matchNote}${kpis}${mode==='plan'&&!noMatch?root.ProductionReasons.overview(d,roots,reasonFilter):''}<div class="analysis-body"><div class="analysis-section-title"><strong>${mode==='plan'?'基地×品类自产计划明细':cross?'品类→物料组→大区→省区数据复盘':'基地／品类→大区→省区需求复盘'}</strong><span class="hint">点击表头排序 · 原因下钻</span></div><div class="report-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${filtered.length>10?`<button class="btn detail-toggle" id="templateDetailToggle">${detailAll?'收起至 Top10':'展开全部'}（${filtered.length}）</button>`:''}<div class="audit-equation">${audit}</div></div>${appendHtml}`;
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
