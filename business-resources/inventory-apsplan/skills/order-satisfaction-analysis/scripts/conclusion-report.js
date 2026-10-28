(function(root){
  const mounted=new WeakMap();
  const dataTable=(b,C,rows=b.rows)=>C.table(b.headers,rows.map(r=>r.map(v=>v==null?'—':v)));
  function tableView(b,C,filter=null,limit=b.pageSize||20){
    const values=Number.isInteger(b.filterColumn)?[...new Set(b.rows.map(r=>r[b.filterColumn]))]:[];
    const rows=filter===null?b.rows:b.rows.filter(r=>r[b.filterColumn]===filter);
    return (values.length?`<div class="conclusion-filters" role="group" aria-label="${C.esc(b.filterLabel||'明细筛选')}">${[null,...values].map((v,i)=>`<button type="button" class="btn ${filter===v?'selected':''}" data-conclusion-filter="${i-1}" aria-pressed="${filter===v}">${C.esc(v===null?'全部':v)}</button>`).join('')}</div>`:'')+`<p role="status" class="conclusion-footnote">当前 ${rows.length} 条，展示 ${Math.min(limit,rows.length)} 条；下载报告保留全部记录。</p>`+dataTable(b,C,rows.slice(0,limit))+`<button type="button" class="btn" data-conclusion-more ${limit>=rows.length?'hidden':''}>显示更多</button>`;
  }
  function blocks(list,C,prefix,registry){return (list||[]).map((b,i)=>{
    const id=prefix+'.'+i;if(typeof b==='string')return `<p>${C.esc(b)}</p>`;
    if(b.heading)return `<h4>${C.esc(b.heading)}</h4>`;
    if(b.type==='table'){
      if(!Array.isArray(b.headers)||!Array.isArray(b.rows))throw Error('结论表格缺少表头或记录');
      if(b.pageSize!=null&&(!Number.isInteger(b.pageSize)||b.pageSize<1))throw Error('结论表格分页数量必须为正整数');
      if(b.pageSize){registry?.set(id,b);return `<div data-conclusion-table="${id}">${tableView(b,C)}</div>`;}
      return dataTable(b,C);
    }
    if(b.type==='details')return `<details class="conclusion-evidence"><summary>${C.esc(b.summary)}</summary>${blocks(b.blocks,C,id,registry)}</details>`;
    return `<p>${C.esc(b.text)}</p>`;
  }).join('');}
  function mount(host,d,C){
    const registry=new Map(),views=[];(d.conclusion?.sections||[]).forEach((s,i)=>blocks(s.blocks,C,String(i),registry));
    host.querySelectorAll('[data-conclusion-table]').forEach(el=>{
      const b=registry.get(el.dataset.conclusionTable);if(!b)return;
      const values=Number.isInteger(b.filterColumn)?[...new Set(b.rows.map(r=>r[b.filterColumn]))]:[];
      let filter=null,limit=b.pageSize;
      function draw(print=false){el.innerHTML=tableView(b,C,filter,print?Infinity:limit);
        el.querySelectorAll('[data-conclusion-filter]').forEach(btn=>btn.onclick=()=>{const index=Number(btn.dataset.conclusionFilter);filter=index<0?null:values[index];limit=b.pageSize;draw();});
        el.querySelector('[data-conclusion-more]').onclick=()=>{limit+=b.pageSize;draw();};
      }draw();views.push(draw);
    });mounted.set(host,views);
  }
  function print(host,enabled){(mounted.get(host)||[]).forEach(draw=>draw(enabled));}
  function sections(d,C){
    const x=d.conclusion||{}, e=C.esc, unit=d.scope.unit;
    if(x.sections?.length)return x.sections.map((s,i)=>[s.title,blocks(s.blocks,C,String(i))]);
    const paras=blocks=>(blocks||[]).map(b=>typeof b==='string'?`<p>${e(b)}</p>`:b.heading?`<h4>${e(b.heading)}</h4>`:`<p>${e(b.text)}</p>`).join('');
    const pct=(v,total)=>v==null||!(total>0)?'—':(v/total*100).toFixed(1)+'%';
    const rank=(rows,key)=>[...rows].sort((a,b)=>(b[key]??-Infinity)-(a[key]??-Infinity));
    const bases=d.demandRows.filter(r=>/基地/.test(r.view||'')),cats=d.demandRows.filter(r=>/品类/.test(r.view||''));
    const amounts=rows=>C.table(['对象','初始提报（'+unit+'）','纠偏提报（'+unit+'）','需求变化缺货（'+unit+'）','占需求变化总量','计划内缺货（'+unit+'）','占计划内总量'],rows.map(r=>[r.object,C.number(r.initialReportedDemand),C.number(r.reported),C.number(r.gap),pct(r.gap,d.metric.demandChangeShortage),C.number(r.inPlanReference),pct(r.inPlanReference,d.metric.inPlanShortage)]));
    const orgRows=(key)=>rank(bases.flatMap(b=>(b.children||[]).flatMap(r=>(r.children||[]).map(p=>({...p,base:b.object,region:r.object})))),key);
    const orgTable=(key)=>{const rows=orgRows(key).filter(r=>r[key]>0);return rows.length?`<details class="conclusion-evidence"><summary>组织重点清单 · 前5项（全量见下载报告）</summary>${C.table(['基地','大区 / 组织','省区 / 组织','分类缺货（'+unit+'）'],rows.slice(0,5).map(r=>[r.base,r.region,r.object,C.number(r[key])]))}</details>`:'';};
    const headline=(title,value)=>`<div class="conclusion-metric"><span>${title}</span><strong>${C.qty(value,unit)}</strong></div>`;
    const cards=`<div class="conclusion-metrics">${headline('需求变化缺货',d.metric.demandChangeShortage)}${headline('计划内缺货',d.metric.inPlanShortage)}${headline('已开订单缺货',d.metric.monthlyShortage)}</div>`;
    const summary=x.summary?.length?paras(x.summary):`<div class="conclusion-columns"><div><h4>需求变化缺货</h4><p>${e(d.demandNarrative||'尚无需求变化分析结论；参考下方对象分布。')}</p></div><div><h4>计划内缺货</h4><p>${e(d.planNarrative||'尚无计划内分析结论；参考下方供给核查。')}</p></div></div>`;
    const framework=paras(x.framework||['按本期重要异常和证据选择分析路径。需求与供给可以分析到不同深度；不以生产偏差代替订单缺货，不为缺少依据的对象补造原因。']);
    const production=C.table(['生产对象','计划（'+unit+'）','实际产出（'+unit+'）','生产偏差（'+unit+'）'],d.planRows.map(r=>[r.object,C.number(r.planned),C.number(r.actual),C.number(r.gap)]));
    const selected=x.evidenceIds||[];
    const evidence=selected.map(i=>d.findings[i]).filter(Boolean);
    const boundary=paras(x.boundary||[d.method||'指标定义、期间及证据状态见本次口径快照。']);
    return [
      ['核心结论',cards+summary],
      ['双维度框架与问题分布',framework+amounts(rank(bases,'monthlyShortage'))],
      ['需求变化缺货',paras(x.demand||[d.demandNarrative||'尚未形成需求变化原因判断。'])+amounts(rank(cats,'gap'))+orgTable('gap')],
      ['计划内缺货与供给核查',paras(x.plan||[d.planNarrative||'尚未形成计划兑现原因判断。'])+orgTable('inPlanReference')+`<details class="conclusion-evidence"><summary>生产计划与实绩对照</summary>${production}<p>生产偏差与订单分类缺货保持各自口径，按订单商品及需要时间关联后再判断影响。</p></details>`],
      ['分对象行动',C.table(['优先级','对象','核查 / 改善建议','建议协同角色','完成依据'],(x.actions||d.actions).map(a=>[a.priority||'—',a.object,a.task,a.owner,a.acceptance]))],
      ['口径与证据说明',boundary+(evidence.length?`<details class="conclusion-evidence"><summary>关键证据（${evidence.length}项）</summary>${evidence.map(C.finding).join('')}</details>`:'')+`<p class="conclusion-footnote">全部原因证据、层级数据与源记录保存在下载报告中。结论使用全量输入，不随当前页面筛选改变。</p>`]
    ];
  }
  function render(d,C){const list=sections(d,C);return `<article class="analysis-report dual-conclusion"><header class="report-cover"><h2>${C.esc(d.title)}</h2><p>${C.esc(d.scope.object)} · ${C.esc(d.scope.period)} · ${C.esc(d.conclusion?.subtitle||'需求与供给综合分析')}</p></header><nav class="report-nav">${list.map((s,i)=>`<a href="#report-section-${i}">${i+1} ${C.esc(s[0])}</a>`).join('')}</nav>${list.map((s,i)=>`<section class="report-block" id="report-section-${i}"><h3>SECTION ${String(i+1).padStart(2,'0')} ${C.esc(s[0])}</h3>${s[1]}</section>`).join('')}</article>`;}
  function markdown(d,C){return sections(d,C).map(([title,html])=>'## '+title+'\n\n'+html.replace(/<\/(th|td)>/g,' | ').replace(/<\/tr>/g,'\n').replace(/<\/(p|h4|summary)>/g,'\n\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")).join('\n\n');}
  function fullBlocks(list){return (list||[]).map(b=>typeof b==='string'?b:{...b,...(b.type==='table'?{pageSize:null}:{}),...(b.blocks?{blocks:fullBlocks(b.blocks)}:{})});}
  function fullMarkdown(d,C){const full=d.conclusion?.sections?.length?{...d,conclusion:{...d.conclusion,sections:d.conclusion.sections.map(s=>({...s,blocks:fullBlocks(s.blocks)}))}}:d;return markdown(full,C);}
  const api={render,markdown:fullMarkdown,mount,print};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ConclusionReport=api;
})(globalThis);
