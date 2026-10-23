const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JSDOM}=require('./report-environment.cjs').resolveDOM().module,bind=require('./sales-reporting.js'),C=require('./report-core.js');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),d=bind.apply(JSON.parse(JSON.stringify(input))),s=d.salesReporting;
assert(s);assert.equal(d.metric.initialReportedDemand,s.national.initial);assert.equal(d.metric.reportedDemand,s.national.adjusted);
let checked=0;
for(const b of s.base){const node=d.demandRows.find(r=>/基地/.test(r.view)&&r.salesBaseValue===b.base);assert(node);assert.equal(node.initialReportedDemand,b.initial);assert.equal(node.reported,b.adjusted);checked++;
 for(const r of s.region.filter(r=>r.base===b.base)){const region=node.children.find(x=>x.object===(r.region||'未提供'));assert(region);assert.equal(region.initialReportedDemand,r.initial);assert.equal(region.reported,r.adjusted);checked++;
 for(const p of s.province.filter(x=>x.base===b.base&&x.region===r.region)){const province=region.children.find(x=>x.object===(p.province||'未提供'));assert(province);assert.equal(province.initialReportedDemand,p.initial);assert.equal(province.reported,p.adjusted);checked++;}}
}
assert.equal(checked,s.base.length+s.region.length+s.province.length);
const before=JSON.stringify(d.demandRows);bind.apply(d);assert.equal(JSON.stringify(d.demandRows),before,'重复生成不重复追加组织');
const empty=d.demandRows.find(r=>r.salesBaseValue===null);assert.equal(empty.salesOnly,true);assert.equal(empty.gap,null);assert.equal(empty.ordered,null);
const noMatch=d.demandRows.find(r=>r.object==='濮阳');if(noMatch){assert.equal(noMatch.initialReportedDemand,null);assert.equal(noMatch.reported,null);}
const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'}),w=dom.window;
for(const script of ['report-core.js','template-components.js'])w.eval(fs.readFileSync(path.join(__dirname,script),'utf8'));
const base=d.demandRows.find(r=>r.object==='郑州'),host=w.document.getElementById('host');
w.TemplateComponents.mount(host,d,base,'demand','base',[base]);
const kpis=host.querySelectorAll('.analysis-kpis>.analysis-kpi');assert.equal(kpis[0].querySelector('strong').textContent,C.qty(base.initialReportedDemand,'件'));assert.equal(kpis[1].querySelector('strong').textContent,C.qty(base.reported,'件'));
assert.equal(host.querySelectorAll('.analysis-body> .report-table-wrap>table>thead th').length,13);
host.querySelector('[data-template-detail]').click();assert.equal(host.querySelectorAll('.inline-drill-row').length,1,'相同基地的多个省区只展开当前行');
const first=host.querySelector('[data-template-row]');assert.match(first.textContent,/\d/);assert.ok(host.querySelector('.plan-drilldown-metrics').textContent.includes('初始提报'));
host.querySelector('[data-template-detail]').click();assert.equal(host.querySelectorAll('.inline-drill-row').length,0);
dom.window.close();console.log(`PASS ${checked}个基地/大区/省区路径、版本独立、空基地、缺失、幂等、指标卡和单行展开`);
