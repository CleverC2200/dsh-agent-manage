const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),os=require('node:os');
const C=require('./report-core.js'),generate=require('./generate-report.cjs');
if(!process.argv[2])throw Error('用法：node test-report.cjs <生成HTML路径>');
const htmlPath=path.resolve(process.argv[2]);let checks=0;const check=(v,msg)=>{assert.ok(v,msg);checks++;};
async function main(){
 for(let o=0;o<=10;o++)for(let p=0;p<=10;p++)for(let s=0;s<=12;s++){
  const r=C.classify({finalPlan:p,totalOrder:o,totalShipped:s});check(r.monthlyShortage===r.demandChangeShortage+r.inPlanShortage,'逐行分类勾稽');
 }
 check(C.classify({finalPlan:null,totalOrder:10,totalShipped:0})===null,'缺计划不补零');
 const raw=JSON.parse(fs.readFileSync(path.join(path.dirname(htmlPath),fs.existsSync(path.join(path.dirname(htmlPath),'report-data.json'))?'report-data.json':'report-data.normalized.json'),'utf8')),d=C.normalize(raw),html=fs.readFileSync(htmlPath,'utf8');
 check(d.scope.unit==='件'||(d.scope.unitStatus==='unverified'&&d.scope.unit==='源数量单位（待核验）'),'订单数量单位有明确状态');
 check(d.scope.productionUnit==='件'||(d.scope.productionUnitStatus==='unverified'&&d.scope.productionUnit==='源数量单位（待核验）'),'生产数量单位有明确状态');
 check([...d.planRows,...d.transferRows,...d.oeRows,...d.odRows].every(r=>r.unit===d.scope.productionUnit),'供给明细单位遵守声明');
 check(d.demandRows.every(r=>r.unit===d.scope.unit),'订单明细单位遵守声明');
 check(d.findings.every(f=>[C.CORE_UNIT,d.scope.unit,d.scope.productionUnit].includes(f.unit)),'证据数量单位已声明');
 check(html.includes(C.rate(d)),'报告满足率与输入数据一致');
 check(!d.findings.some(f=>f.status==='verified_cause'&&(!f.orderSupplyLink||!f.eventTime)),'已验证根因具备关联与时序');
 // Raw-material evidence may retain its original unit; core unit checks are structural above.
 const source=fs.readFileSync(path.join(__dirname,'../assets/订单满足率分析模板.html'),'utf8');
 for(const m of source.matchAll(/<style>([\s\S]*?)<\/style>/g))check(html.includes(m[0]),'原始 CSS 完整保留');
 check(html.indexOf('class="metric-grid"')<html.indexOf('class="sidebar"'),'指标先于步骤导航');
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){new vm.Script(m[1]);checks++;}
 assert.throws(()=>C.normalize({...raw,metric:{...raw.metric,need:-1}}));checks++;
 assert.throws(()=>C.normalize({...raw,scope:{...raw.scope,unit:'吨'}}));checks++;
 assert.throws(()=>C.normalize({...raw,findings:[{status:'verified_cause',evidence:[],impact:1,unit:'件'}]}));checks++;
 assert.throws(()=>C.normalize({...raw,calculation:{classification:'legacy-minmax-v1'},orderRowsComplete:true,orderRows:[{key:'1',finalPlan:null,totalOrder:1,totalShipped:0}]}));checks++;
 const sample=C.normalize({...raw,orderRowsComplete:false,orderRows:[{key:'1',finalPlan:1,totalOrder:2,totalShipped:0}]});check(sample.metric.monthlyShortage===raw.metric.monthlyShortage,'样本不覆盖全量');
 const env=require('./report-environment.cjs').resolveDOM({cwd:path.dirname(htmlPath)});
 if(!env.module){const pending={status:'INCOMPLETE',staticChecks:checks,algorithmFixtureCases:1573,domInteractions:'NOT_RUN',dataContract:require('./audit-report-data.cjs')(d).status,businessConclusion:'MANUAL_REVIEW_REQUIRED',visualBrowser:'NOT_RUN',next:'提供已有jsdom绝对路径到DOM_TEST_MODULE后重试；不要循环安装依赖'};fs.writeFileSync(path.join(path.dirname(htmlPath),'validation-checks.json'),JSON.stringify(pending,null,2));throw Error('静态检查完成，DOM依赖未就绪；见validation-checks.json及report-environment.cjs');}
 const {JSDOM}=env.module;
 const templateDom=new JSDOM(source,{runScripts:'dangerously',url:'https://template.local/',beforeParse(w){w.HTMLElement.prototype.scrollIntoView=function(){};}}),templateDoc=templateDom.window.document;
 check(templateDoc.querySelector('#dimensionTabs [data-dim]')?.dataset.dim==='product','模板需求变化模块默认品类视角在前');
 templateDoc.querySelector('[data-cause="plan"]').click();
 const templateChannels=[...templateDoc.querySelector('.analysis-kpi .kpi-channel-list').children].map(x=>x.textContent.trim().replace(/—|[\d,.]+\s*件|[\d.]+%/g,'').trim());
 check(templateChannels.join(',')==='自产,调拨,OE,OD','模板计划内缺货指标卡维度顺序');
 const logs=[];const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://local.invalid/',beforeParse(w){w.print=()=>logs.push('print');w.URL.createObjectURL=()=>{logs.push('download');return'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>logs.push(s)}});}});
 const w=dom.window,$=s=>w.document.querySelector(s),click=s=>{const el=$(s);check(Boolean(el),'交互元素存在：'+s);el.click();};
 click('#nextBtn');check($('.panel.active').dataset.panel==='1','下一步');
 const availableCause=d.metric.demandChangeShortage!=null?'demand':'plan';click(`[data-cause="${availableCause}"]`);check($('.panel.active').dataset.panel==='2','原因卡跳转');
 if(availableCause==='demand'){
  // Missing dimensions are valid; exercise available dimensions only.
  check(w.document.querySelector('#dimensionTabs [data-view]')?.dataset.view==='product','需求变化默认先展示品类视角');
  
  const demandCards=[...w.document.querySelectorAll('#specificAnalysis > .analysis-kpis.six > .analysis-kpi')];
  check(demandCards.length===6,'需求变化六张月度指标卡');
  check(demandCards[0].textContent.includes(C.number(d.metric.initialReportedDemand)),'初始提报与顶部指标对齐');
  check(demandCards[1].textContent.includes(C.number(d.metric.reportedDemand)),'纠偏提报与顶部指标对齐');
  check(demandCards[2].textContent.includes(C.number(d.metric.need)),'已开订单需求与顶部指标对齐');
  check(demandCards[4].textContent.includes(C.number(C.actualShipped(d))),'已开订单发货与顶部指标对齐');
  click('[data-view="base"]');
 }
 if(w.document.querySelector('[data-row]')){click('[data-row]');check($('#specificAnalysis').textContent.length>0,'对象下钻');if(availableCause==='demand'){
   const selectedBase=d.demandRows.filter(r=>/基地/.test(r.view)).sort((a,b)=>(b.gap||0)-(a.gap||0))[0],cards=[...w.document.querySelectorAll('#specificAnalysis > .analysis-kpis.six > .analysis-kpi')];
   check(cards[2].querySelector('strong').textContent===C.qty(selectedBase.ordered,'件'),'基地选择后已开订单需求切换');
   check(cards[4].querySelector('strong').textContent===C.qty(selectedBase.shipped,'件'),'基地选择后已开订单发货切换');
   check(cards[5].querySelector('strong').textContent===C.qty(selectedBase.gap,'件'),'基地选择后分类缺货切换');
   if(selectedBase.initialReportedDemand==null)check(cards[0].querySelector('strong').textContent==='—','基地不支持销售提报维度时不硬分摊');
   if($('[data-template-detail]')){click('[data-template-detail]');check(Boolean($('.demand-detail-block')),'需求变化明细位于行内展开');check(Boolean($('.demand-detail-table')),'需求变化SKU明细表存在');if(w.document.querySelector('.demand-source-records'))check(true,'SKU源记录可展开');click('[data-template-detail]');}
   if(d.demandRows.some(r=>/品类/.test(r.view))){click('[data-view="product"]');click('[data-row]');
   const selectedProduct=d.demandRows.filter(r=>/品类/.test(r.view)).sort((a,b)=>(b.gap||0)-(a.gap||0))[0],productCards=[...w.document.querySelectorAll('#specificAnalysis > .analysis-kpis.six > .analysis-kpi')];
   check(productCards[0].querySelector('strong').textContent===C.qty(selectedProduct.initialReportedDemand,'件'),'品类选择后初始提报切换');
   check(productCards[1].querySelector('strong').textContent===C.qty(selectedProduct.reported,'件'),'品类选择后纠偏提报切换');
   check(productCards[2].querySelector('strong').textContent===C.qty(selectedProduct.ordered,'件'),'品类选择后已开订单需求切换');}
  }if($('#clearObject'))click('#clearObject');}
 click('[data-cause="plan"]');check(!w.document.querySelector('[data-view="inventory"]'),'计划内缺货不显示计划与库存准备Tab');
 click('[data-view="base"]');check(!w.document.querySelector('[data-view="overallBase"]'),'原因页不混入总缺货标签');
 check($('#causeDimensionGrid')?.classList.contains('single'),'直接继承模板维度容器');
 check(w.document.querySelectorAll('#specificAnalysis > .analysis-kpis > .analysis-kpi').length===4,'供给四张原版指标卡');
 check(w.document.querySelectorAll('#specificAnalysis .kpi-channel.transfer').length===4,'每张指标卡保留调拨行');
 check(w.document.querySelectorAll('#specificAnalysis .kpi-channel.oe').length===4,'每张指标卡在调拨后保留OE行');
 check(w.document.querySelectorAll('#specificAnalysis .kpi-channel.od').length===4,'每张指标卡在OE后保留OD行');
 check(Boolean($('#specificAnalysis > .cause-analysis-head'))&&Boolean($('#specificAnalysis > .analysis-body .audit-equation')),'模板头部与底部勾稽位置');
 if($('[data-template-detail]')){click('[data-template-detail]');check(Boolean($('.inline-drill-row .plan-drilldown')),'明细行内展开');click('[data-template-detail]');check(!$('.inline-drill-row'),'明细再次点击收起');}
 if(!d.transferRows.length)check([...w.document.querySelectorAll('.kpi-channel.transfer strong')].every(x=>x.textContent==='—'),'调拨缺失全部为破折号');
 if(!d.oeRows.length)check([...w.document.querySelectorAll('.kpi-channel.oe strong')].every(x=>x.textContent==='—'),'OE缺失全部为破折号');
 if(!d.odRows.length)check([...w.document.querySelectorAll('.kpi-channel.od strong')].every(x=>x.textContent==='—'),'OD缺失全部为破折号');
 if(d.planRows.length){
  const first=d.planRows.slice().sort((a,b)=>(b.gap||0)-(a.gap||0))[0];click('[data-row="0"]');
  check($('#specificAnalysis .cause-analysis-head h3').textContent.includes(first.object),'条形联动对象正确');
  const cards=[...w.document.querySelectorAll('#specificAnalysis > .analysis-kpis > .analysis-kpi')];
  check(cards[0].querySelector('.kpi-channel:not(.transfer) strong').textContent===C.qty(first.planned,d.scope.productionUnit),'自产计划绑定真实值');
  check(cards[1].querySelector('.kpi-channel:not(.transfer) strong').textContent===C.qty(first.actual,d.scope.productionUnit),'自产实际绑定真实值');
  check(cards.every(c=>c.children[0].className==='analysis-kpi-title'&&c.children[1].classList.contains('kpi-total')&&c.children[2].className==='kpi-channel-list'),'原模板指标卡子节点层级');
 }
 check(C.qty(null,'件')==='—'&&C.qty(0,'件')==='0 件','缺失和真实零值区分');
 click('[data-step="3"]');$('.report-nav a[href="#report-section-2"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));check($('.report-nav a[aria-current="location"]').hash==='#report-section-2','章节目录选中同步');check(w.document.querySelectorAll('.report-nav a[aria-current]').length===1,'章节单选');
 click('.kpi-help');check($('.kpi-help').getAttribute('aria-expanded')==='true','提示打开');w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));check($('.kpi-help').getAttribute('aria-expanded')==='false','提示关闭');
 const reportBefore=$('#reportDocument').innerHTML;check(!reportBefore.includes('report-lazy-state'),'进入第4步后全量报告已按需加载');click('[data-step="3"]');click('#copyReport');await Promise.resolve();check(logs.some(x=>x.includes('## 全量底表')),'复制全量');click('#downloadReport');check(logs.includes('download'),'下载');click('#printReport');check(logs.includes('print'),'打印');w.dispatchEvent(new w.Event('afterprint'));check($('#reportDocument').innerHTML===reportBefore,'筛选和打印不改变正式报告');
 const fixture=C.normalize(raw);fixture.scope={...fixture.scope,unit:'件',productionUnit:'件',mock:true};fixture.findings=(fixture.findings||[]).map(f=>({...f,unit:'件'}));
 // Synthetic scenarios must not inherit live sales scopes or authored monthly conclusions.
 delete fixture.salesReporting;delete fixture.conclusion;
 for(const name of ['demandRows','planRows','transferRows','oeRows','odRows','overallRows'])fixture[name]=(fixture[name]||[]).map(r=>({...r,unit:'件'}));
 fixture.orderRows=[];fixture.orderRowsComplete=false;fixture.metric.classificationComplete=false;fixture.metric.demandChangeShortage=120;fixture.demandRows=Array.from({length:12},(_,i)=>({view:'基地经理',object:'测试基地'+i,gap:10,reported:20,ordered:30,shipped:20,unit:'件',children:[{object:'测试大区',gap:10,unit:'件',children:[{object:'测试省区',gap:10,unit:'件',detailRows:[{skuCode:'SKU'+i,skuName:'测试商品',planReference:20,ordered:30,shipped:20,monthlyShortage:10,demandGap:10,inPlanGap:0,unit:'件',records:[{date:'2026-09-01',planReference:20,ordered:30,shipped:20,monthlyShortage:10,demandGap:10,inPlanGap:0,unit:'件'}]}]}]}]}));
 for(const base of fixture.demandRows){const sku=base.children[0].children[0].detailRows[0];sku.records=Array.from({length:23},(_,i)=>({...sku.records[0],date:`2026-09-${String(i+1).padStart(2,'0')}`}));}
 const fixtureUnits=rs=>{for(const row of rs||[]){row.unit='件';fixtureUnits(row.children);}};for(const key of ['demandRows','planRows','transferRows','oeRows','odRows','overallRows'])fixtureUnits(fixture[key]);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'order-report-fixture-'));generate(fixture,temp);const testHTML=fs.readFileSync(path.join(temp,'订单满足率原因分析报告.html'),'utf8');
 const fd=new JSDOM(testHTML,{runScripts:'dangerously'}),fdoc=fd.window.document;
 fdoc.querySelector('[data-view="base"]').click();
 check(fdoc.querySelectorAll('[data-row]').length===10,'Top10');fdoc.getElementById('toggleRows').click();check(fdoc.querySelectorAll('[data-row]').length===12,'展开全部');fdoc.querySelector('[data-row]').click();fdoc.querySelector('[data-template-detail]').click();check(fdoc.querySelector('.inline-drill-row').textContent.includes('测试大区'),'大区行内下钻');check(fdoc.querySelector('.inline-drill-row').textContent.includes('测试省区'),'省区明细保留');check(fdoc.querySelector('.inline-drill-row').textContent.includes('测试商品'),'SKU明细保留');check(fdoc.querySelector('.demand-source-records'),'源记录折叠保留');
 {const source=fdoc.querySelector('[data-source-records]'),skuRow=source.closest('tr');
 check(!fdoc.querySelector('.demand-source-panel'),'点击前不预建源记录DOM');source.click();
 const sourceRow=skuRow.nextElementSibling;
 check(sourceRow.classList.contains('demand-source-row')&&sourceRow.firstElementChild.colSpan===9,'源记录在SKU下一行跨全部列展开');
 check(!source.closest('td').querySelector('table'),'操作单元格内无嵌套子表');
 check(sourceRow.querySelectorAll('.demand-record-table tbody tr').length===10,'源记录首屏仅加载10条');
 sourceRow.querySelector('[data-source-next]').click();check(sourceRow.textContent.includes('11–20 条'),'源记录下一页');
 sourceRow.querySelector('[data-source-next]').click();check(sourceRow.querySelectorAll('.demand-record-table tbody tr').length===3&&sourceRow.querySelector('[data-source-next]').disabled,'末页完整且禁用下一页');
 sourceRow.querySelector('[data-source-prev]').click();check(sourceRow.textContent.includes('11–20 条'),'源记录上一页');
 sourceRow.querySelector('[data-source-close]').click();check(!fdoc.querySelector('.demand-source-row')&&source.getAttribute('aria-expanded')==='false','关闭清理明细并恢复按钮');
 source.click();check(fdoc.querySelector('.demand-source-row'),'关闭后可重新展开');source.click();check(!fdoc.querySelector('.demand-source-row'),'同一按钮再次点击收起');}
 check(C.markdown(fixture).includes('测试基地11 → 测试大区 → 测试省区'),'全量导出包含非Top10子层');
 const attack={...fixture,title:'</script><script>globalThis.pwned=1</script>'};generate(attack,temp);const ad=new JSDOM(fs.readFileSync(path.join(temp,'订单满足率原因分析报告.html'),'utf8'),{runScripts:'dangerously'});check(!ad.window.pwned,'脚本注入隔离');
 const scenarioInput={...fixture,calculation:{rate:'ratio-v1'},metric:{...fixture.metric,need:1000,shipped:500,monthlyShortage:500},scenario:{unit:'件',exclusive:true,costUnit:'元',items:[{name:'测试调拨',max:100,costPerUnit:2},{name:'测试补产',max:50,costPerUnit:3}]}};
 generate(scenarioInput,temp);const sd=new JSDOM(fs.readFileSync(path.join(temp,'订单满足率原因分析报告.html'),'utf8'),{runScripts:'dangerously'});
 const slider=sd.window.document.querySelector('[data-scenario="0"]');slider.value=100;slider.dispatchEvent(new sd.window.Event('input'));check(sd.window.document.getElementById('scenarioStats').textContent.includes('200 元'),'情景滑块成本');check(sd.window.document.querySelectorAll('[data-step]').length===5,'可选第五步');
 assert.throws(()=>C.normalize({...scenarioInput,scenario:{...scenarioInput.scenario,exclusive:false}}));checks++;
 sd.window.close();await new Promise(resolve=>setImmediate(resolve));dom.window.close();fd.window.close();ad.window.close();
 const result={status:'PASS',technicalStatus:'PASS',checks,testScopes:{algorithmFixtureCases:1573,otherAssertions:checks-1573},domInteractions:'PASS',dataContract:require('./audit-report-data.cjs')(d).status,businessConclusion:'MANUAL_REVIEW_REQUIRED',legacyFormulaCases:1573,visualBrowser:'NOT_RUN',sourceData:{testPerformedLiveQueries:false,declaredSource:d.scope.sourceLabel||null,salesRetrievedAt:d.salesReporting?.retrievedAt||null,provenance:d.dataProvenance||[]},domModule:env.path,fixtureDirectory:temp};
 fs.writeFileSync(path.join(path.dirname(htmlPath),'validation-checks.json'),JSON.stringify(result,null,2));console.log(result);
}main().catch(e=>{console.error(e);process.exitCode=1;});
