const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.DOM_TEST_MODULE);const html=fs.readFileSync(process.argv[2],'utf8'),dom=new JSDOM(html,{runScripts:'dangerously'}),w=dom.window,doc=w.document;
const d=JSON.parse(doc.getElementById('analysisData').textContent);let checks=0;const check=(ok,m)=>{assert.ok(ok,m);checks++;};
check(d.metric.rate===null,'正式满足率保持未知');check(d.sourceMetric.rate===.4601671,'源值保留');
const cards=doc.querySelector('.metric-grid').textContent;for(const n of ['1,493,316','687,174.82','806,141.18','46.02%','待核验'])check(cards.includes(n),'顶部源值 '+n);
check(doc.querySelector('[data-panel="1"]').textContent.includes('27,111,249.24'),'两类源缺货保留');
check(d.sourceViews.length===14,'14个数据集');
const choose=i=>{const s=doc.getElementById('sourceViewSelect');s.value=String(i);s.dispatchEvent(new w.Event('change',{bubbles:true}));};
for(let i=0;i<d.sourceViews.length;i++){
 choose(i);const v=d.sourceViews[i];check(doc.getElementById('sourceRowCount').textContent.includes(v.rows.length+'个'),'范围行数 '+v.id);
 let expected=v.rows;
 for(let level=0;level<v.hierarchy.length;level++){
  const key=v.hierarchy[level],val=expected[0][key];doc.querySelector('[data-source-drill="0"]').click();expected=expected.filter(r=>r[key]===val);
  check(doc.getElementById('sourceRowCount').textContent.includes(expected.length+'个'),'下钻同对象 '+v.id+'/'+level);
 }
 check(!doc.querySelector('[data-source-drill]'),'叶节点不造下钻 '+v.id);
 const visible=doc.querySelectorAll('#sourceExplorer tbody tr').length;check(visible===Math.min(20,expected.length),'源行分页 '+v.id);
 doc.querySelector('[data-source-level="0"]').click();check(doc.getElementById('sourceRowCount').textContent.includes(v.rows.length+'个'),'返回全国 '+v.id);
}
choose(0);doc.getElementById('sourceSearch').value='绝无匹配测试对象';doc.getElementById('sourceSearchGo').click();check(doc.getElementById('sourceRowCount').textContent.includes('0个'),'空筛选不补零');
choose(1);doc.getElementById('sourceNext').click();check(doc.querySelector('#sourceExplorer').textContent.includes('第2/'),'下一页可达');
check(d.sourceViews.find(x=>x.id==='production_detail_0').rows.length===5221,'全部生产记录保留');
const result={status:'PASS',checks,datasets:d.sourceViews.length,rows:d.sourceViews.reduce((s,v)=>s+v.rows.length,0),formalRate:d.metric.rate,sourceRate:d.sourceMetric.rate,visualBrowser:'NOT_RUN'};
fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(result);dom.window.close();
