const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare}=require('./prepare-source-bundle.cjs'),{make}=require('./make-query-plan.cjs'),Supply=require('./supply-scope.js'),{audit}=require('./audit-bindings.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'order-skill-fixture-'));
try{
 const org={region_code:'R',province_region_code:'P',region_name:'大区甲',province_region_name:'省区甲'};
 const order=(sku,need,ship,out,plan)=>({...org,fromorderno_month:'2030-02-01',belong_base:'基地甲',material_code:sku,material_name:sku+'商品',need_qty_origin:need,qtyshipped:ship,outqty:out,allnum:plan,demand_change_outqty:999,plan_inner_outqty:888});
 const orders=[order('A',100,50,50,80),order('A',20,20,0,0),order('B',10,0,10,null)];
 const sale=sku=>({...org,stat_month:'2030-02-01',source_flag:'销售口径',belong_name:'基地甲',material_code:sku,material_name:sku+'商品',plan_qty_initial:60,plan_qty_adjusted:80,order_qty_origin:100,act_dl_qty:50});
 const sales=[sale('A'),sale('C')],mapping=['A','B','C'].map(sku=>({stat_month:'2030-02-01',source_flag:'基地口径',material_code:sku,product_categ_name:sku==='B'?'缺计划类':'任意新品类',material_group:'G',material_group_name:'组甲'}));
 const production=[{zdate:'20300203',factory_name:'基地甲',material_code:'C',classify1:'任意新品类',plan_qty:10,actual_qty:8,order_code:'M1',deviation_reason:'设备检修'}];
 const schedule=['工厂甲','工厂乙'].map((factory,i)=>({base_finish_day:'20300203',factory_name:factory,material_code:'A',material_name:'A商品',measure_unit:'ST',data_source:'工厂',order_no:'O'+i,order_qty:10,confirm_qty:8,deliv_qty:8}));
 const manifest={period:'2030-02',classificationMode:'positive-row-reference-v1',salesAccuracyWeights:{values:[.5,.5],definitionRef:'fixture-only'},orderRateDefinition:{formula:'one-minus-published-shortage-over-need',definitionRef:'fixture-only'},datasets:{}};
 for(const [id,rows] of Object.entries({orders,sales,mapping,production,schedule})){fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify({period:manifest.period,rowCount:rows.length,rows}));manifest.datasets[id]={status:'acquired',period:manifest.period,files:[id+'.json'],rowsPath:'rows',completion:{file:id+'.json',countPath:'rowCount'},unit:'件',unitStatus:'verified',model:id,retrievedAt:'2030-03-01',querySummary:'isolated synthetic fixture'};}
 let d=prepare(manifest,root);assert.equal(d.metric.need,130);assert.equal(d.metric.rawShipped,70);assert.equal(d.metric.demandChangeShortage,20);assert.equal(d.metric.inPlanShortage,30);assert.equal(d.metric.monthlyShortage,60);assert.equal(d.classificationAudit.uncovered,10);
 assert.equal(d.crossDimensionRows.find(r=>r.category==='缺计划类').inPlanReference,null,'全缺计划不能变0');
 assert.equal(d.crossDimensionRows.find(r=>r.category==='任意新品类').ordered,120,'仅销售SKU不冲掉订单');
 assert.equal(audit(d).errors.length,0);
 const ref=Supply.reference(schedule,new Set(['A']),'任意新品类',30);assert.equal(ref.groups.length,2,'不同工厂同SKU独立');assert.equal(ref.matchedSkuCount,1);assert(ref.unit.includes('待核验'),'ST未核验不改件');
 const nullRef=Supply.reference([{...schedule[0],deliv_qty:null}],new Set(['A']),'x',1);assert.equal(nullRef.totals.delivered,null);assert.equal(nullRef.totals.gap,null);
 assert.equal(Supply.reference([schedule[0],{...schedule[1],measure_unit:'KG'}],new Set(['A']),'x',1).status,'unit_conflict');
 const query=make({period:'2030-02',filters:{orders:{region_code:'R'}}});assert(query.datasets.orders.sql.includes("fromorderno_month < '2030-03-01'"));assert(!query.datasets.orders.sql.includes('outqty>0'));assert(query.datasets.schedule.sql.includes("base_finish_day < '20300301'"));assert.equal(query.datasets.salesReconcile.sql,null);
 const broken=structuredClone(d);broken.crossDimensionRows[0].detailRows=[];assert(audit(broken).errors.length>0);
 const duplicate=structuredClone(manifest);duplicate.datasets.orders.files.push('orders.json');assert.throws(()=>prepare(duplicate,root),/重复分页/);
 const badPeriod=structuredClone(manifest);badPeriod.period='2030-03';assert.throws(()=>prepare(badPeriod,root),/期间/);
 const result=require('./generate-report.cjs')(d,path.join(root,'report'));assert(fs.existsSync(path.join(result.out,'订单满足率原因分析报告.html')));
 console.log(JSON.stringify({status:'PASS',checks:['source-completeness','same-period','full-vs-positive-pool','null-plan','single-source-groups','cross-total','generic-category-supply','factory-sku-key','null-delivery','unit-conflict','read-only-query-plan','missing-binding','duplicate-pages','render-contract']}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
