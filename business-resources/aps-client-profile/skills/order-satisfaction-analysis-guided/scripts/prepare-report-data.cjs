/* Explicit field adapter for verified flat query pages. No live queries or inferred formulas. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const audit=require('./audit-report-data.cjs');
const get=(r,key)=>key==null?null:String(key).split('.').reduce((v,k)=>v?.[k],r)??null;
const numeric=(v,key)=>{if(v==null)return null;if(v===''||!Number.isFinite(Number(v)))throw Error('无效数量：'+key);return Number(v);};
const quantities=['planned','actual','gap','initialReportedDemand','reported','ordered','shipped','monthlyShortage','inPlanReference','planReference'];
const sum=(rs,key)=>rs.length&&rs.every(r=>r[key]!=null)?rs.reduce((s,r)=>s+r[key],0):null;
function prepare(manifest,baseDir){
 const d=manifest.template?JSON.parse(fs.readFileSync(path.resolve(baseDir,manifest.template),'utf8')):JSON.parse(JSON.stringify(manifest.report||{}));
 if(!d.scope||!d.metric)throw Error('提供template或含scope/metric的report骨架');
 d.findings??=[];d.dataProvenance??=[];
 const targets=new Set();
 for(const ds of manifest.datasets||[]){
  if(!['production','demand'].includes(ds.kind))throw Error('未知数据集类型');
  if(ds.kind==='demand'&&!['base','category'].includes(ds.view))throw Error('需求数据集view须明确base或category');
  const target=ds.kind+':'+(ds.view||'');if(targets.has(target))throw Error('同一目标数据集请合并到files，避免重复覆盖');targets.add(target);
  if(!ds.fields)throw Error('缺少显式fields映射');
  if(ds.unit!=='件'||ds.additive!==true)throw Error('适配前核验件单位和数量可加性，不能只改标签');
  if(!Array.isArray(ds.grain)||!ds.grain.length)throw Error('明确查询粒度grain，以便检查重复分页');
  const rows=[],seen=new Set(),files=[];
  for(const file of ds.files||[]){
   const absolute=path.resolve(baseDir,file),raw=fs.readFileSync(absolute),data=JSON.parse(raw),page=ds.rowsPath?get(data,ds.rowsPath):data;
   if(!Array.isArray(page))throw Error('rowsPath未指向记录数组：'+file);
   files.push({file,sha256:crypto.createHash('sha256').update(raw).digest('hex'),rows:page.length});
   for(const source of page){
    const r={};for(const [key,field] of Object.entries(ds.fields||{})){
     if(['__proto__','constructor','prototype'].includes(key))throw Error('无效字段映射');
     r[key]=quantities.includes(key)?numeric(get(source,field),field):get(source,field);
    }
    if(ds.categoryMap){if(ds.categoryMapVerified!==true)throw Error('SKU品类映射须先核验');r.category??=ds.categoryMap[String(r.sku)]??null;}
    const key=JSON.stringify(ds.grain.map(k=>r[k]??null));
    if(seen.has(key))throw Error('重复查询粒度，检查分页/唯一键：'+key);seen.add(key);
    r.unit='件';rows.push(r);
   }
  }
  if(!files.length)throw Error('数据集没有查询结果文件');
  const provenance={id:ds.id||ds.kind,model:ds.model||null,period:ds.period||null,retrievedAt:ds.retrievedAt||null,grain:ds.grain,complete:ds.complete===true,rowCount:rows.length,files};
  d.dataProvenance.push(provenance);
  const levels=ds.kind==='production'?['base','category','sku']:[ds.view==='category'?'category':'base','region','province'];
  const build=(group,depth,parents=[])=>{
   const map=new Map();for(const r of group){const value=r[levels[depth]];const object=value==null?levels[depth]==='category'?'品类待映射':'源维度未填写':String(value);if(!map.has(object))map.set(object,[]);map.get(object).push(r);}
   return [...map].map(([object,rs])=>{
    const scopeKey=JSON.stringify([...parents,object]),node={object,level:levels[depth],scopeKey,unit:'件',findingIds:[],sourceId:provenance.id};
    for(const key of quantities)if(ds.fields[key]!=null)node[key]=sum(rs,key);
    if(ds.kind==='production'){
     if(ds.gapAggregation==='net-positive-v1')node.gap=node.planned!=null&&node.actual!=null?Math.max(node.planned-node.actual,0):null;
     else if(ds.fields.gap==null)node.gap=null;
     const reasons=new Map();for(const r of rs){const reason=String(r.reason??'');if(!reasons.has(reason))reasons.set(reason,[]);reasons.get(reason).push(r);}
     for(const [reason,items] of reasons){node.findingIds.push(d.findings.length);d.findings.push({object:[...parents,object].join(' × '),scopeKey,channel:'self',status:'supported_unverified',reasonText:reason,impact:null,unit:'件',fact:reason?'生产记录理由：'+reason:'源记录未填写理由',records:items.map(r=>({date:r.date??null,sku:r.sku??null,order:r.order??null,batch:r.batch??null,line:r.line??null,shift:r.shift??null,planned:r.planned??null,actual:r.actual??null,gap:r.gap??null})),evidence:['sourceId:'+provenance.id],boundary:'理由关联不是独立损失分摊，也不自动等同订单缺货因果。'});}
    }else{
     node.view=ds.view==='category'?'品类经理':'基地经理';node.accuracy=null;
     if(depth===levels.length-1){
      const skus=new Map();for(const r of rs){const key=JSON.stringify([r.sku??null,r.skuName??null]);if(!skus.has(key))skus.set(key,[]);skus.get(key).push(r);}
      node.detailRows=[...skus.values()].map(items=>({skuCode:items[0].sku??null,skuName:items[0].skuName??null,planReference:sum(items,'planReference'),ordered:sum(items,'ordered'),shipped:sum(items,'shipped'),monthlyShortage:sum(items,'monthlyShortage'),demandGap:sum(items,'gap'),inPlanGap:sum(items,'inPlanReference'),unit:'件',records:items.map(r=>({date:r.date??null,ordered:r.ordered??null,shipped:r.shipped??null,monthlyShortage:r.monthlyShortage??null,planReference:r.planReference??null,demandGap:r.gap??null,inPlanGap:r.inPlanReference??null}))}));
     }
    }
    if(depth<levels.length-1)node.children=build(rs,depth+1,[...parents,object]);
    return node;
   });
  };
  const nodes=build(rows,0);
  if(ds.kind==='production')d.planRows=nodes;
  else{d.demandRows??=[];const view=ds.view==='category'?'品类经理':'基地经理';d.demandRows=d.demandRows.filter(r=>r.view!==view).concat(nodes);}
 }
 if(targets.size)d.analysisReview={status:'REVIEW_REQUIRED',note:'适配器只整理事实，不生成原因判断。审阅conclusion后可更新状态。'};
 return {data:d,audit:audit(d)};
}
module.exports={prepare};
if(require.main===module){
 const file=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),result=prepare(JSON.parse(fs.readFileSync(file,'utf8')),path.dirname(file));
 if(file===out)throw Error('输出不能覆盖适配清单');
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result.data,null,2));fs.writeFileSync(out+'.audit.json',JSON.stringify(result.audit,null,2));
 console.log({output:out,audit:result.audit.status,issues:result.audit.issues.length});if(result.audit.status==='ERROR')process.exitCode=1;
}
