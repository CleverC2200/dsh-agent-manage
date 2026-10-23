const assert=require('node:assert/strict'),fs=require('fs');
const {JSDOM}=require('./report-environment.cjs').resolveDOM().module;
const C=require('./report-core.js'),R=require('./conclusion-report.js');
const d=C.normalize(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
const dom=new JSDOM(C.report(d)),doc=dom.window.document;
const expected=d.conclusion?.sections;
if(expected?.length){
 assert.equal(doc.querySelectorAll('.report-block').length,expected.length);
 assert.equal(doc.querySelectorAll('.report-nav a').length,expected.length);
 expected.forEach((s,i)=>assert.ok(doc.querySelector('#report-section-'+i).textContent.includes(s.title)));
 R.mount(doc.body,d,C);
 function verify(blocks){for(const b of blocks||[]){if(typeof b==='string')assert.ok(doc.body.textContent.includes(b));else if(b.text||b.heading)assert.ok(doc.body.textContent.includes(b.text||b.heading));if(b.blocks)verify(b.blocks);}}
 expected.forEach(s=>verify(s.blocks));
}
const md=C.markdown(d);assert.match(md,/完整证据与明细附录/);
for(const f of d.findings)assert.ok(md.includes(f.object),'下载保留全部证据对象');
const legacy=C.normalize({title:'旧输入兼容',scope:{object:'任意对象',unit:'件'},metric:{demandChangeShortage:0,inPlanShortage:null},conclusion:{summary:['<img src=x onerror=alert(1)>'],demand:['需求事实'],plan:['生产事实']}});
const legacyDom=new JSDOM(C.report(legacy)),safe=legacyDom.window.document;
assert.equal(safe.querySelectorAll('img').length,0);assert.equal(safe.querySelectorAll('.report-block').length,6,'六段仅为旧输入兼容布局');
assert.match(safe.querySelector('.conclusion-metrics').textContent,/0 件/);assert.match(safe.querySelector('.conclusion-metrics').textContent,/—/);
const fixture=C.normalize({title:'异期任意章节',scope:{object:'新对象',period:'异期',unit:'件'},metric:{},conclusion:{subtitle:'由证据决定的专题',sections:[{title:'<img src=x onerror=alert(1)>',blocks:[{heading:'任意机制'},{type:'details',summary:'记录',blocks:[{type:'table',headers:['对象','值'],rows:Array.from({length:31},(_,i)=>[i%2?'乙':'甲',i===0?null:i]),pageSize:7,filterColumn:0}]}]},{title:'其他独立问题',blocks:[{text:'无需固定类别或规定分析深度'}]}]}});
const fd=new JSDOM(C.report(fixture)).window.document;R.mount(fd.body,fixture,C);
assert.equal(fd.querySelectorAll('.report-block').length,2);assert.equal(fd.querySelectorAll('img').length,0,'标题/正文/单元格转义');
assert.equal(fd.querySelectorAll('tbody tr').length,7);assert.match(fd.querySelector('tbody').textContent,/—/);
fd.querySelector('[data-conclusion-more]').click();assert.equal(fd.querySelectorAll('tbody tr').length,14);
fd.querySelector('[data-conclusion-filter="0"]').click();assert.equal(fd.querySelectorAll('tbody tr').length,7);assert.ok([...fd.querySelectorAll('tbody tr')].every(r=>r.cells[0].textContent==='甲'));
const before=fd.body.innerHTML;R.print(fd.body,true);assert.equal(fd.querySelectorAll('tbody tr').length,16,'打印当前筛选全量');R.print(fd.body,false);assert.equal(fd.body.innerHTML,before,'打印恢复阅读状态');
assert.ok(R.markdown(fixture,C).includes('30'),'导出不被首屏/筛选裁剪');
assert.ok(!fd.body.textContent.includes(d.scope.period),'异期输入不泄露本期数据');
assert.throws(()=>C.report({...fixture,conclusion:{sections:[{title:'无效分页',blocks:[{type:'table',headers:['a'],rows:[],pageSize:-1}]}]}}),/正整数/);
dom.window.close();legacyDom.window.close();console.log('PASS 自定义章节、生产机制正文、旧输入兼容、异期数据、转义、分页筛选、打印恢复、全量导出');
