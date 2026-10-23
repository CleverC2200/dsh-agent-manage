const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JSDOM}=require('./report-environment.cjs').resolveDOM().module;
const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'}),w=dom.window;
for(const f of ['report-core.js','production-reason-dictionary.js','production-reasons.js','template-components.js'])w.eval(fs.readFileSync(path.join(__dirname,f),'utf8'));
const D=w.ProductionReasonDictionary;
assert.equal(D.entries.length,52);assert.equal(new Set(D.entries.map(x=>x.code)).size,52);
assert.equal(D.classify('人员不足').primary,'B01');assert.equal(D.classify('纸箱不够').primary,'E01');
assert.equal(D.classify('人员不足，换产').state,'multiple');assert.equal(D.classify('人员不足，换产').primary,null);
assert.equal(D.classify('设备故障').primary,null);assert.equal(D.classify('开机三台').primary,null);
assert.equal(D.classify('1').state,'invalid');assert.equal(D.classify('无故障').primary,null);
assert.equal(w.ProductionReasons.aggregate([{primary:'B01',gap:null}])[0].quantity,null);
const d={findings:[],transferRows:[]};
const base={object:'基地',scopeKey:'base',planned:200,actual:130,gap:70,findingIds:[],children:[]};
for(const [name,reason,qty] of [['品类甲','人员不足',30],['品类乙','纸箱不够',40]]){
 const child={object:name,scopeKey:'base/'+name,planned:100,actual:100-qty,gap:qty,findingIds:[],children:[]};
 const fact={scopeKey:child.scopeKey,channel:'self',reasonText:reason,status:'supported_unverified',records:[{date:'2026-09-01',sku:name,order:'MO-'+name,planned:100,actual:100-qty,gap:qty}]};
 child.findingIds.push(d.findings.length);d.findings.push(fact);base.findingIds.push(d.findings.length);d.findings.push({...fact,scopeKey:base.scopeKey});base.children.push(child);
}
// Multi-tag records remain visible by default but never inflate classification totals.
base.findingIds.push(d.findings.length);d.findings.push({scopeKey:'base',channel:'self',reasonText:'人员不足，换产',status:'supported_unverified',records:[{gap:10,sku:'额外'}]});
const host=w.document.getElementById('host');w.TemplateComponents.mount(host,d,null,'plan','base',[base]);
const overview=host.querySelector('.production-reason-overview');
assert(overview.previousElementSibling.classList.contains('analysis-kpis'));assert(overview.nextElementSibling.classList.contains('analysis-body'));
assert.equal(host.querySelectorAll('.kpi-channel.oe').length,4);assert.equal(host.querySelectorAll('.kpi-channel.od').length,4);
assert([...host.querySelectorAll('.kpi-channel.oe strong,.kpi-channel.od strong')].every(x=>x.textContent==='—'));
assert.equal(overview.querySelectorAll('.reason-bar').length,2);
const groups=w.ProductionReasons.aggregate(w.ProductionReasons.records(d,base));assert.equal(groups.reduce((s,g)=>s+g.quantity,0),70);
assert.equal(host.querySelectorAll('[data-template-row]').length,2);
host.querySelector('[data-dictionary-filter="B"]').click();assert.equal(host.querySelectorAll('[data-template-row]').length,1);assert(host.querySelector('[data-template-row]').textContent.includes('品类甲'));
host.querySelector('[data-template-detail]').click();assert(host.querySelector('.production-source-records').textContent.includes('B01'));assert(!host.querySelector('.inline-drill-row .reason-chart'));
host.querySelector('[data-dictionary-filter="E01"]').click();assert.equal(host.querySelectorAll('[data-template-row]').length,1);assert(host.querySelector('[data-template-row]').textContent.includes('品类乙'));
host.querySelector('[data-dictionary-filter="all"]').click();assert.equal(host.querySelectorAll('[data-template-row]').length,2);
const lightweight=new w.DOMParser().parseFromString(w.ProductionReasons.render(d,base,0,'all'),'text/html');
assert.equal(lightweight.querySelectorAll('.production-sku-row').length,2);
assert.equal(lightweight.querySelectorAll('.production-analysis').length,1);
assert.equal(lightweight.querySelectorAll('.production-sku-list .selected').length,0);
console.log('PASS 52-code dictionary, uncertain/multiple tags, no duplicated quantity, KPI-summary-table order, family/code filters, neutral SKU summary and no recursive drilldown DOM');
