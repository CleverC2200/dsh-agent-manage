(function(){
 const host=document.getElementById('sourceExplorer');if(!host)return;
 const d=JSON.parse(document.getElementById('analysisData').textContent),views=d.sourceViews||[],C=AnalysisCore,e=C.esc;
 let index=0,path=[],term='',page=0,sort=null,asc=true;const size=20;
 const value=(v,f)=>v==null?'—':typeof v==='number'?(f.meta?.value_encoding==='fraction_0_1'?(v*100).toFixed(2)+'%':C.number(v)):String(v)===''?'（空白）':String(v);
 function draw(){
  const v=views[index];if(!v){host.textContent='未提供源数据视图';return;}
  let rs=v.rows.filter(r=>path.every((x,i)=>r[v.hierarchy[i]]===x));
  if(term)rs=rs.filter(r=>Object.values(r).some(x=>String(x??'').toLowerCase().includes(term.toLowerCase())));
  const level=path.length,key=v.hierarchy[level],grouped=Boolean(key);let display=rs;
  if(grouped){const groups=new Map();for(const r of rs){const val=r[key];if(!groups.has(val))groups.set(val,[]);groups.get(val).push(r);}
   display=[...groups].map(([val,items])=>{const row={[key]:val,__rows:items.length,__key:val};for(const f of v.fields){if(f.name===key)continue;const a=items.map(x=>x[f.name]);const agg=f.meta?.aggregation;row[f.name]=items.length===1?a[0]:['sum','additive_sum','count'].includes(agg)&&a.every(Number.isFinite)?a.reduce((s,x)=>s+x,0):null;}return row;});
  }
  const fields=grouped?v.fields.filter(f=>f.name===key||f.type==='number'):v.fields;
  if(sort)display.sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return 1;if(y==null)return -1;return(asc?1:-1)*(typeof x==='number'?x-y:String(x).localeCompare(String(y),'zh-CN'));});
  const pages=Math.max(1,Math.ceil(display.length/size));page=Math.min(page,pages-1);const shown=display.slice(page*size,(page+1)*size);
  host.innerHTML=`<div class="source-toolbar"><label>数据视角 <select id="sourceViewSelect">${views.map((x,i)=>`<option value="${i}" ${i===index?'selected':''}>${e(x.title)}（${x.rows.length}组）</option>`).join('')}</select></label><label>查找 <input id="sourceSearch" value="${e(term)}" placeholder="基地、组织、SKU或理由"></label><button class="btn" id="sourceSearchGo">查询</button><button class="btn" id="sourceExport">导出当前范围CSV</button></div><p class="source-status">${e(v.status)} · ${e(v.note)}</p><p>来源：${e(v.source)} · 查询时间：${e(v.retrievedAt)}。已取到的NULL以“—”保留，0为真实零；分组只汇总明确可加且无缺值的字段，比率不平均。</p><nav class="source-breadcrumb"><button class="btn" data-source-level="0">全部</button>${path.map((x,i)=>` › <button class="btn" data-source-level="${i+1}">${e(x??'（未填写）')}</button>`).join('')}</nav><p role="status" id="sourceRowCount">当前范围${rs.length}个源查询分组；${grouped?'点击“下钻”查看下级或源行':'正在显示完整源查询行'}。</p><div class="report-table-wrap" style="max-width:100%;overflow:auto"><table><thead><tr>${grouped?'<th>下钻</th>':''}${fields.map(f=>`<th><button class="sort-button" data-source-sort="${e(f.name)}">${e(f.label||f.name)}${f.unit?' · '+e(f.unit):''}</button></th>`).join('')}</tr></thead><tbody>${shown.map((r,i)=>`<tr>${grouped?`<td><button class="btn" data-source-drill="${i}">下钻（${r.__rows}组）</button></td>`:''}${fields.map(f=>`<td>${e(value(r[f.name],f))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${fields.length+1}">该筛选无返回记录，不补零。</td></tr>`}</tbody></table></div><div class="source-toolbar"><button class="btn" id="sourcePrev" ${page===0?'disabled':''}>上一页</button><span>第${page+1}/${pages}页 · 共${display.length}项</span><button class="btn" id="sourceNext" ${page+1===pages?'disabled':''}>下一页</button></div>`;
  host.querySelector('#sourceViewSelect').onchange=x=>{index=Number(x.target.value);path=[];term='';page=0;sort=null;draw();};
  const search=()=>{term=host.querySelector('#sourceSearch').value;page=0;draw();};host.querySelector('#sourceSearchGo').onclick=search;host.querySelector('#sourceSearch').onkeydown=x=>{if(x.key==='Enter')search();};
  host.querySelectorAll('[data-source-level]').forEach(b=>b.onclick=()=>{path=path.slice(0,Number(b.dataset.sourceLevel));page=0;draw();});
  host.querySelectorAll('[data-source-drill]').forEach(b=>b.onclick=()=>{path.push(shown[Number(b.dataset.sourceDrill)].__key);page=0;sort=null;draw();});
  host.querySelectorAll('[data-source-sort]').forEach(b=>b.onclick=()=>{asc=sort===b.dataset.sourceSort?!asc:true;sort=b.dataset.sourceSort;page=0;draw();});
  host.querySelector('#sourcePrev').onclick=()=>{page--;draw();};host.querySelector('#sourceNext').onclick=()=>{page++;draw();};
  host.querySelector('#sourceExport').onclick=()=>{const csv=x=>'"'+String(x??'').replace(/"/g,'""')+'"';const text=[v.fields.map(f=>f.label||f.name),...rs.map(r=>v.fields.map(f=>r[f.name]))].map(r=>r.map(csv).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=v.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 }
 draw();
})();
