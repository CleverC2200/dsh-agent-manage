/* Business-facing conclusions; raw evidence paths stay in the exported index. */
const number=v=>Number.isFinite(v)?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(v):'—';
const pct=v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—';
const state={verified_fact:'已核验数量事实',supported_unverified:'有记录支持，机制待核查',hypothesis:'待核查假设',verified_cause:'已验证根因'};
const taskNames={definition:'指标定义',orders:'订单范围',classification:'缺货分类',sales:'销售提报',category:'品类映射',production:'生产记录',transfer:'调拨',oe:'OE',od:'OD',inventory:'库存时点',linkage:'订单与供给关联'};
function auditCard(c,f){return c.analysisType==='audit'||/占位|无业务含义|原值[“"' ]*[01][”"'） )]/.test(f.reasonText||'')||/^[01]$/.test((f.reasonText||'').trim());}
function productionOverview(d){
 return (d.planRows||[]).map(r=>({object:r.object,planned:r.planned,actual:r.actual,netGap:Number.isFinite(r.planned)&&Number.isFinite(r.actual)?r.planned-r.actual:null,hasReasonEvidence:(r.findingIds||[]).some(i=>(d.findings?.[i]?.records||[]).length>0)}));
}
function review(d,packet,cards){
 const issues=[];
 const shortCount=productionOverview(d).filter(r=>r.netGap>0).length;
 const prose=JSON.stringify([d.summary,d.planNarrative,d.conclusion?.sections]);
 if(shortCount>1&&/(?:只有|仅有|唯一)[^。；]{0,22}(?:一个|1个|唯一)[^。；]{0,10}(?:基地|欠产)|(?:只有|仅有)[^。；]{0,22}基地[^。；]{0,6}(?:净欠产|未达产)|其余四[^。；]{0,8}超产/.test(prose))issues.push({code:'CONCLUSION_BASE_COUNT_CONFLICT',object:'综合结论',message:'正文声称只有一个欠产基地，但计划实绩识别出'+shortCount+'个；逐节核对摘要、正文及附录，不能只改表格。'});

 for(const row of productionOverview(d))if(row.netGap>0&&!row.hasReasonEvidence)issues.push({code:'PRODUCTION_GAP_WITHOUT_REASON',object:row.object,message:'该基地存在净欠产，但报告未绑定原因记录；不能称其他基地均超产或生产问题已完整解释。'});
 for(const c of cards){
  const f=packet.facts.find(x=>x.findingId===c.findingId);if(!f)continue;
  if(f.kind==='demand'&&/(?:说明[^。；]{0,24}(?:问题不在|主要不是)|主要不是[^。；]{0,12}生产|因此[^。；]{0,30}更可能|缺货对应的是[^。；]{0,20}整体发运)/.test(c.interpretation||''))issues.push({code:'AGGREGATE_CAUSAL_EXCLUSION',object:c.object,message:'仅凭总量或跨来源对照排除生产/需求原因，缺少SKU、需要时点和供给关联；改为独立事实及待核查假设。'});
  if(f.kind==='demand'&&c.status==='verified_fact'&&/(?:更可能|很可能|机制上|导致|造成)/.test(c.interpretation||''))issues.push({code:'FACT_CONTAINS_INFERENCE',object:c.object,message:'事实卡混入机制推断；将事实和假设分开，推断不得标为已验证事实。'});
  if(auditCard(c,f))issues.push({code:'REASON_CODE_UNRESOLVED',object:c.object,message:'理由编码含义未核验，仅列口径与证据审计，不作为业务缺货原因。'});
  if(/(?:\d[\d.,]*\s*%|满足率高于|缺货量低于|环比下降|覆盖率达到)/.test(c.acceptance||'')&&!c.targetSource)issues.push({code:'UNAPPROVED_PERFORMANCE_TARGET',object:c.object,message:'验收含未经确认的绩效目标；应改为可复核证据闭环，或明确目标来源与批准状态。'});
 }
 return issues;
}
function cardBlocks(c,f){
 const s=f.stats,values=f.kind==='demand'?
 [['已开订单需求',number(s.ordered)],['已开订单缺货',number(s.monthlyShortage)],['初始提报',number(s.initialReportedDemand)],['纠偏提报',number(s.adjustedReportedDemand)],['准确率',s.accuracyPercent==null?'—':number(s.accuracyPercent)+'%']]:
 [['计划',number(s.planned)],['实际',number(s.actual)],['净差（正为欠产）',number(s.netGap)],['源行欠产正差合计',number(s.positiveRowGap)],['有记录的生产日期数',s.datedDays],['出现欠产记录的日期数',s.shortDays]];
 return [{heading:c.object},{text:state[c.status]||'待复核'},{text:c.interpretation},
 {type:'details',summary:'查看数量依据与分析边界',blocks:[{type:'table',headers:['依据','本期值'],rows:values},...(f.reasonText?[{text:'生产理由原文：'+f.reasonText}]:[]),{text:c.boundary},{text:'证据索引见随附 evidence-links.json；原始记录随报告保存。'}]},
 {text:'建议核查 / 改善：'+c.action},{text:'建议协同角色：'+c.owner+'；完成依据：'+c.acceptance}];
}
function sections(d,p,cards,gaps,issues){
 // Authored business synthesis has priority; never replace it with a mechanical card transcript.
 if(d.conclusion?.sections?.length)return d.conclusion.sections;
 const demand=[],production=[],audit=[];
 for(const c of cards){const f=p.facts.find(x=>x.findingId===c.findingId);if(!f)continue;const target=auditCard(c,f)?audit:f.kind==='demand'?demand:production;target.push(...cardBlocks(c,f));}
 const unit=d.scope?.unit||'源数量单位',pu=d.scope?.productionUnit||unit,m=d.metric||{},plan=productionOverview(d),short=plan.filter(r=>r.netGap>0);
 const total={planned:plan.every(r=>Number.isFinite(r.planned))?plan.reduce((n,r)=>n+r.planned,0):null,actual:plan.every(r=>Number.isFinite(r.actual))?plan.reduce((n,r)=>n+r.actual,0):null};
 const summary=[{text:(d.scope?.object||'本期范围')+' · '+(d.scope?.period||'期间待确认')+' · 业务截止 '+(d.scope?.cutoff||'待确认')},
 {type:'table',headers:['业务指标','本期值'],rows:[['订单满足率',pct(m.rate)],['已开订单需求（'+unit+'）',number(m.need)],['实际发货（'+unit+'）',number(m.rawShipped??(m.shippedIsActual?m.shipped:null))],['已开订单缺货（'+unit+'）',number(m.monthlyShortage)],['初始销售提报（'+unit+'）',number(m.initialReportedDemand)],['纠偏销售提报（'+unit+'）',number(m.reportedDemand)]]},
 ...(d.summary?[{text:d.summary}]:[]),{text:'生产计划与实绩分别核对：本期有 '+short.length+' 个基地净欠产'+(short.length?'（'+short.map(r=>r.object+' '+number(r.netGap)+' '+pu).join('；')+'）':'')+'。生产总量不能排除某个SKU或需要时点缺货，生产偏差不等于订单损失。'}];
 const supplies=[{type:'table',headers:['生产基地','计划（'+pu+'）','实际（'+pu+'）','净差（正为欠产）'],rows:plan.map(r=>[r.object,number(r.planned),number(r.actual),number(r.netGap)])},...production];
 const selected=cards.filter(c=>{const f=p.facts.find(f=>f.findingId===c.findingId);return f&&!auditCard(c,f)});
 const result=[{title:'本期判断与管理重点',blocks:summary},{title:'需求侧：重点对象与仍待解释的问题',blocks:demand.length?demand:[{text:'当前只形成对象分布，尚未审阅需求机制；不能由缺货规模认定提报不准。'}]},{title:'供给侧：生产兑现与机制证据',blocks:supplies},
 {title:'分对象行动与完成依据',blocks:[{type:'table',headers:['对象','建议动作','建议角色','完成依据'],rows:selected.map(c=>[c.object,c.action,c.owner,c.acceptance])}]},
 {title:'口径、证据与分析边界',blocks:[{text:'报告为待业务复核稿。原始数据、查询页、证据卡及程序检查随报告交付；程序检查不证明业务因果。'},...(d.method?[{text:d.method}]:[]),{type:'table',headers:['受限分析分支','状态','缺什么证据'],rows:gaps.map(g=>[taskNames[g.id]||g.id,g.status,g.reason])},...issues.map(i=>({text:(i.object?i.object+'：':'')+i.message})),...audit]}];
 return result;
}
module.exports={sections,review,productionOverview,auditCard};
