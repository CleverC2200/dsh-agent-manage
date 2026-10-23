const fs=require('fs'),path=require('path'),base=path.join(__dirname,'..'),file=path.join(base,'assets/订单满足率分析模板.html');
let html=fs.readFileSync(file,'utf8');
const marker='<!-- SHARED_REASON_UI_START -->',end='<!-- SHARED_REASON_UI_END -->';
const block=marker+'\n<style>'+fs.readFileSync(path.join(base,'assets/data-binding.css'),'utf8')+'</style>\n<style>'+fs.readFileSync(path.join(base,'assets/conclusion-report.css'),'utf8')+'</style>\n'+['report-responsive.js','conclusion-report.js','report-core.js','production-reason-dictionary.js','production-reasons.js','template-components.js'].map(f=>'<script>'+fs.readFileSync(path.join(__dirname,f),'utf8')+'</script>').join('\n')+'\n'+end;
if(html.includes(marker))html=html.replace(/<!-- SHARED_REASON_UI_START -->[\s\S]*?<!-- SHARED_REASON_UI_END -->/,()=>block);else html=html.replace('<script>',()=>block+'\n<script>');
const start=html.indexOf('  function renderPlanDetailRow(row,totals) {'),stop=html.indexOf('  const barList =',start);
html=html.slice(0,start)+`  function renderPlanDetailRow(row,totals) {
    const [name,total,amount,status,statusClass,unused,meta] = row;
    const expanded = name === planDetailSelection;
    const line = \`<tr class="drill-row\${expanded?' selected':''}" data-plan-detail-row="\${name}"><td><strong>\${name}</strong></td><td>\${meta.planned} 件</td><td>\${meta.actual} 件</td><td>\${amount} 件</td><td>\${(meta.actual/meta.planned*100).toFixed(1)}%</td><td>\${(amount/totals.gap*100).toFixed(1)}%</td><td>模拟原文线索</td><td><button class="btn" data-plan-detail="\${name}">\${expanded?'收起分析':'查看分析'}</button></td></tr>\`;
    if(!expanded)return line;
    const findings=['模拟：包装膜未按承诺到货','模拟：包装机停机'].map((reasonText,i)=>({scopeKey:name,channel:'self',reasonText,status:'supported_unverified',records:[{date:'示例日期',sku:'DEMO-SKU',order:'DEMO-'+(i+1),planned:meta.planned*(i?0.4:0.6),actual:meta.actual*(i?0.4:0.6),gap:amount*(i?0.4:0.6)}]}));
    return line+\`<tr class="inline-drill-row"><td colspan="8">\${ProductionReasons.render({findings},{object:name,scopeKey:name,planned:meta.planned,actual:meta.actual,findingIds:[0,1],children:[]})}</td></tr>\`;
  }
`+html.slice(stop);
const branch=html.indexOf("      const objectRows = [...matchedRows].sort((a,b) => b[2] - a[2]);");
const branchEnd=html.indexOf('      renderEvidenceConclusion();',branch);
if(branch>=0&&branchEnd>branch){
 const prefix=html.slice(0,branch),suffix=html.slice(branchEnd);
 html=prefix+`      const objectRows = [...matchedRows].sort((a,b) => b[2] - a[2]);
      const demo={findings:[],transferRows:[]},demoBases=new Map();
      for(const row of objectRows){
        const meta=row[6],baseName=meta.base||'示例基地';
        if(!demoBases.has(baseName))demoBases.set(baseName,{object:baseName,scopeKey:'demo:'+baseName,planned:0,actual:0,gap:0,findingIds:[],children:[]});
        const base=demoBases.get(baseName),child={object:row[0].split('×').pop(),scopeKey:'demo:'+row[0],planned:meta.planned,actual:meta.actual,gap:row[2],findingIds:[],children:[]};
        ['模拟：包装膜不足','模拟：包装机故障'].forEach((reasonText,i)=>{
          const f={scopeKey:child.scopeKey,channel:'self',reasonText,status:'supported_unverified',records:[{date:'模拟日期',sku:'DEMO-SKU',order:'DEMO-'+i,planned:meta.planned*(i?0.4:0.6),actual:meta.actual*(i?0.4:0.6),gap:row[2]*(i?0.4:0.6)}]};
          child.findingIds.push(demo.findings.length);demo.findings.push(f);
          base.findingIds.push(demo.findings.length);demo.findings.push({...f,scopeKey:base.scopeKey});
        });
        base.children.push(child);base.planned+=meta.planned;base.actual+=meta.actual;base.gap+=row[2];
      }
      TemplateComponents.mount(host,demo,null,'plan','base',[...demoBases.values()]);
`+suffix;
}
html=html.replace('OrderReport.render(buildAnalysisReport())','AnalysisCore.report(AnalysisCore.normalize(buildAnalysisReport()))');
html=html.replaceAll('OrderReport.markdown(buildAnalysisReport())','AnalysisCore.markdown(AnalysisCore.normalize(buildAnalysisReport()))');
fs.writeFileSync(file,html);
