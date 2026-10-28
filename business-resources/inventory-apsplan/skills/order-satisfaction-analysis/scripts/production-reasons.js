/* Shared dictionary summary above the category table; raw evidence stays inline. */
(function(root){
 const C=root.AnalysisCore,e=C.esc,q=v=>C.qty(v,'件'),D=root.ProductionReasonDictionary;
 const caches=new WeakMap();
 function records(d,r){
  let cache=caches.get(d);if(!cache){cache=new Map();caches.set(d,cache);}if(cache.has(r.scopeKey))return cache.get(r.scopeKey);
  const result=[];
  for(const f of (r.findingIds||[]).map(i=>d.findings[i]).filter(Boolean)){
   if(!r.scopeKey||f.scopeKey!==r.scopeKey||!['verified','verified_fact','verified_cause','supported_unverified'].includes(f.status)||f.channel==='transfer')continue;
   const tagging=D.classify(f.reasonText);if(tagging.state==='invalid')continue;
   result.push(...(f.records||[]).map(x=>({...x,reason:f.reasonText,...tagging})));
  }
  cache.set(r.scopeKey,result);return result;
 }
 const quantity=rs=>rs.every(x=>Number.isFinite(x.gap))?rs.reduce((s,x)=>s+x.gap,0):null;
 const accepts=(record,key)=>key==='all'||record.primary===key||(key.length===1&&record.primary?.startsWith(key));
 function matches(d,r,key){return key==='all'||records(d,r).some(x=>accepts(x,key));}
 function aggregate(rs){
  return D.entries.map(item=>{const selected=rs.filter(x=>x.primary===item.code);return {...item,records:selected,quantity:quantity(selected)};}).filter(x=>x.records.length).sort((a,b)=>b.quantity-a.quantity||a.code.localeCompare(b.code));
 }
 function overview(d,roots,filter='all'){
  const unit=d.scope?.productionUnit||'件',q=v=>C.qty(v,unit);
  // Use one level only: never add parent/category/SKU copies together.
  const rs=roots.flatMap(r=>records(d,r)),gs=aggregate(rs),max=Math.max(1,...gs.map(g=>g.quantity));
  const families=Object.entries(D.families).map(([code,label])=>({code,label,children:gs.filter(g=>g.family===code)})).filter(g=>g.children.length);
  const multiple=rs.filter(x=>x.state==='multiple').length,review=rs.filter(x=>x.state==='review').length;
  const current=filter==='all'?'全部原因':e(filter+' '+(D.entries.find(x=>x.code===filter)?.label||D.families[filter]||''));
  return `<section class="production-reason-overview" aria-label="自产原因字典汇总"><div class="production-reason-heading"><div><span class="panel-kicker">生产原因 · 字典归类</span><h4>自产原因字典汇总</h4><p>按理由原文匹配 A–K 字典，数量为欠产分组正差（${e(unit)}），不等同于订单缺货影响量。</p></div><div class="reason-filter-toolbar"><button type="button" class="btn ${filter==='all'?'selected':''}" data-dictionary-filter="all" aria-pressed="${filter==='all'}">全部原因</button><span role="status">当前：${current}</span></div></div>
  <div class="reason-family-grid">${families.map(g=>`<button type="button" class="reason-family-card ${filter===g.code?'selected':''}" data-dictionary-filter="${g.code}" aria-pressed="${filter===g.code}"><span class="reason-family-name">${g.code} ${e(g.label)}</span><strong>${q(g.children.every(x=>x.quantity!=null)?g.children.reduce((s,x)=>s+x.quantity,0):null)}</strong><small>${g.children.length}个细分类 · ${g.children.reduce((s,x)=>s+x.records.length,0)}条记录</small></button>`).join('')}</div>
  <div class="reason-distribution"><div class="reason-distribution-head"><div><h5>细分类数量分布</h5><p>点击原因可联动筛选下方基地、SKU 与原始记录</p></div><span>${gs.length} 个有效细分类</span></div><div class="reason-chart" role="group" aria-label="原因字典细分类柱状图">${gs.map(g=>`<button type="button" class="reason-bar ${filter===g.code?'selected':''}" data-dictionary-filter="${g.code}" aria-pressed="${filter===g.code}"><span>${g.code} ${e(g.label)}</span><span class="reason-bar-track"><span style="width:${100*g.quantity/max}%"></span></span><strong>${q(g.quantity)}</strong></button>`).join('')||'<p>当前范围暂无唯一命中的原因分类，不生成推算柱条。</p>'}</div></div>
  <p class="reason-boundary">打标边界：${multiple}条记录命中多个标签、${review}条理由不足以匹配细分类，仍保留在全部原始记录中供复核，不进入分类数量柱图；每条唯一命中记录只计量一次。</p></section>`;
 }
 function tags(x){return x.tags.length?x.tags.map(t=>`<span class="reason-dictionary-tag">${e(t.code+' '+t.label)}</span>`).join('')+(x.state==='multiple'?'<small>多标签，主因待确认</small>':''):'<span class="check-meta">细分类待确认</span>';}
 function tagSummary(d,r){const list=[...new Map(records(d,r).flatMap(x=>x.tags).map(t=>[t.code,t])).values()];return list.length?`<details class="reason-row-tags"><summary>${list.length}个字典标签</summary>${list.map(t=>`<span class="reason-dictionary-tag">${e(t.code+' '+t.label)}</span>`).join('')}</details>`:'—';}
 function render(d,r,depth=0,filter='all'){
  const unit=d.scope?.productionUnit||'件',q=v=>C.qty(v,unit);
  const rs=records(d,r).filter(x=>accepts(x,filter)),delta=r.gap??null;
  const children=(r.children||[]).filter(c=>matches(d,c,filter));
  return `<section class="production-analysis reason-drilldown plan-drilldown"><div class="plan-drilldown-head"><div><div class="plan-drilldown-kicker">已选对象 · 生产原因记录</div><h4>${e(r.object)}</h4><p class="check-meta">原因汇总及筛选位于上方四张指标卡下；当前筛选：${filter==='all'?'全部原因':e(filter)}。</p></div><div class="plan-drilldown-metrics">${[['计划生产量',r.planned],['实际执行量',r.actual],['发布生产偏差',delta]].map(([k,v])=>`<div class="plan-drilldown-metric"><span>${k}</span><strong>${q(v)}</strong></div>`).join('')}</div></div><div class="supply-checks">
  <details open class="production-source-records"><summary>生产偏差原始记录（${rs.length}条）</summary><p class="check-meta">保留理由原文与字典标签；日期×SKU×生产单／批次×产线源分组。规则打标不等于已验证根因。</p><div class="report-table-wrap reason-record-scroll"><table><thead><tr><th>日期</th><th>SKU</th><th>生产单</th><th>批次</th><th>产线／班次</th><th>计划（${e(unit)}）</th><th>实际（${e(unit)}）</th><th>正差（${e(unit)}）</th><th>理由原文</th><th>字典标签</th></tr></thead><tbody>${rs.map(x=>`<tr>${['date','sku','order','batch'].map(k=>`<td>${e(x[k]||'—')}</td>`).join('')}<td>${e(x.line||'—')} / ${e(x.shift||'—')}</td>${['planned','actual','gap'].map(k=>`<td>${C.number(x[k])}</td>`).join('')}<td>${e(x.reason)}</td><td>${tags(x)}</td></tr>`).join('')||'<tr><td colspan="10">当前筛选无明确理由记录。</td></tr>'}</tbody></table></div></details>
  ${children.length?`<details class="production-sku-details"><summary>SKU汇总与继续分析（${children.length}项）</summary><p class="check-meta">只展示当前筛选相关SKU，月度指标不随原因标签截断；点击上方原因标签筛选，SKU行保持中性展示。</p><div class="production-sku-list">${children.map(c=>`<div class="production-sku-row"><strong>${e(c.object)}</strong><span>计划 ${q(c.planned)}</span><span>实际 ${q(c.actual)}</span><span>正差 ${q(c.gap)}</span></div>`).join('')}</div></details>`:''}</div></section>`;
 }
 root.ProductionReasons={records,aggregate,overview,matches,render,tagSummary,bind:()=>{}};
})(globalThis);
