# 报告数据契约

本文件定义当前生成器输入及字段语义；查询、公式与版本规则见[指标契约](metric-and-data-contract.md)，布局及联动见[交互契约](interactive-analysis-contract.md)，证据评级见[证据契约](evidence-and-output-contract.md)。不要在三处重复维护同一规则。

## 分步执行扩展

完整报告使用 `guided-report.cjs` 的任务单、证据包及审阅卡片。具体顺序见SKILL。新增 `classificationAudit` 保存被停用分类的原值、来源和原因；null不表示冲突已解决。全国分类停用时，下级gap/inPlanReference保持null，总缺货只放monthlyShortage/overallRows。

生产字段中的占位符不算SKU/产线/生产单关联。dataProvenance为空必须记录覆盖风险。任务bindings核对查询结果是否真正进入报告，sourceRows>0而目标数组为空、hasMorePages=true均阻断完成声明。来源文件随build导出并计算哈希。

analysis-cards同时支持需求层级路径和生产根级finding：interpretation/boundary/action由模型依据本期证据填写，数量统计由程序形成；它不验证自然语言机制是否真实，因此输出仍标待业务复核。需求准确率使用0–100编码，缺失不补，合法负值保留。

字段名属于现有程序接口，不是业务公式。若当前接口无法表达新的正式口径，应说明差异并在授权范围内调整生成器，不能为了兼容接口伪造值。

## 基础输入

必需 `title`、`scope`、`metric`；未知数值为 `null`。以下是数据骨架，不是实际报告内容：

```json
{
  "title": "订单满足率原因分析报告",
  "scope": {"object": "全国", "period": null, "cutoff": null, "unit": "件", "productionUnit": "件", "mock": false},
  "metric": {"need": null, "shipped": null, "monthlyShortage": null, "demandChangeShortage": null, "inPlanShortage": null, "initialReportedDemand": null, "reportedDemand": null, "salesDemandPlanVariance": null, "classificationComplete": false},
  "orderRows": [], "demandRows": [], "planRows": [], "transferRows": [], "oeRows": [], "odRows": [], "overallRows": [],
  "summary": "", "demandNarrative": "", "planNarrative": "", "planPreparation": "",
  "findings": [], "actions": [], "method": ""
}
```

实际交付填写已核验范围、来源和方法。刷新时间、业务截止及时区分开记录；`scope.sourceLabel` 可标识本次来源。核心数量字段单位为件，物料原单位仅保留在证据中；无法核验换算或影响量时填null。

## 指标字段

### 生成器执行模式

默认只读取发布值，不因为有订单明细就重算。输入应携带本次口径快照，以下模式仅指定可执行算法，不代替口径核验：

- `metric.rate`：正式满足率，0–1编码；显式null表示缺失。未提供时不自动用发货÷需求替代。
- `calculation.rate = "ratio-v1"`：经核验后显式启用分子÷需求复核及相同算法的情景试算；没有该配置时情景仍可展示恢复量/成本，但新满足率不推算。
- `calculation.classification = "legacy-minmax-v1"`：显式选择指标契约中的历史源行公式，要求完整且粒度合适的 `orderRows` 与 `orderRowsComplete: true`。默认/ `"published"` 使用输入分类量，缺底层计划不抹去发布结果。
- `calculation.salesDemandPlanVariance = "adjusted-minus-order-v1"`：本次用户明确确认时，按“纠偏提报－已开订单需求”生成全国及当前对象对照差额，保留正负号；任一输入缺失则留空。下级订单仅覆盖缺货记录时标明子集对照，不称完整订单池偏差。不配置该模式则仍采用提供的发布值，不能据此覆盖知识库中的指标定义或 Cube 的正式度量。
- `classificationComplete: true` 表示两类为同范围完整互斥分区，才执行两类合计等于缺货的校验；不能仅凭订单行完整自动声明分类完整。
- `metric.rawShipped` 为真实发货。只有明确设置 `metric.shippedIsActual: true` 才允许以 `metric.shipped` 兼作发货展示，避免将等效分子冒充发货。
- `metric.classificationDefinitions.demand/plan`、`metric.formula`、`metric.shortageNote` 提供本次口径说明；不提供时只显示通用提示，不加载模板旧公式。
- 生产对象 `rate` 与汇总 `productionMetric.rate` 同样使用0–1发布值；汇总指标可由 `productionMetric` 提供。仅在 `calculation.productionRate = "ratio-v1"` 时复算实际÷计划。生产 `gap` 读取输入偏差，展示层不再默认截零重算。

旧数据迁移时补充已核验的发布值/语义标识或显式模式；不得为避免空值而无依据开启旧算法。运行 开发包专项回归测试 可验证发布值、显式复核、缺数和DOM绑定，再联跑通用报告回归。

| 字段 | 语义/绑定 |
|---|---|
| `metric.need` | 已开订单需求量 |
| `metric.shipped` | 满足率同口径分子；不一定等于原始发货 |
| `metric.rawShipped` | 原始发货；采用等效满足量/封顶分子时单独保留 |
| `monthlyShortage` | 正式已开订单缺货量 |
| `demandChangeShortage` / `inPlanShortage` | 正式两类缺货量 |
| `initialReportedDemand` / `reportedDemand` | 初始/纠偏销售提报，独立版本 |
| `salesDemandPlanVariance` | 本次正式销售需求计划偏差量，可带符号；展示组件不自行推导 |

业务标题使用已开订单需求量、发货量、缺货量，不能把等效满足量标为实际发货。全国发货卡优先绑定 `rawShipped`；若只有分子且不能证明就是发货，发货卡应留空并说明。源语义通过 `needNote`、`shippedNote`、`formula` 等口径说明保留，不用名称掩盖冲突。

需求变化六卡依次为初始提报、纠偏提报、订单需求、计划偏差、订单发货和需求变化缺货。未选对象时同名全国卡同源同值，选中后绑定当前对象；不以全国值填充下级。源模型不支持的字段为null并说明，不删除卡片。

可选 `salesReporting` 提供已核验销售提报查询结果，`scripts/sales-reporting.js` 负责绑定，生成器不查询业务系统。结构为 `model, revision, baseMember, sourceFlag, period, retrievedAt, national, base[], region[], province[]`；记录含 `base, region, province, initial, adjusted, recordCount`，全国记录不需维度字段。`initial/adjusted` 对应独立初始/纠偏版本，空值保留null。按源基地与大区、省区完整路径精确匹配，并保留查询来源；全国卡绑定national、下级绑定当前路径。销售独有节点标 `salesOnly:true`，订单指标保持null，不进入订单分类分布分母。空基地使用单独展示节点，源值仍为null；既有订单对象未在销售查询返回时不推定0。输入准备阶段核验完整性及父子合计，不能仅为填卡复制父级数值。

正式准确率可在同一路径提供 `accuracyInitial, accuracyAdjusted, accuracyMonthly`（Cube0–1编码）、`sourceOrder, sourceShipped` 及 `salesReporting.accuracyRetrievedAt`。绑定层只将准确率乘100一次，不以订单模型的数量补齐销售模型公式；负准确率保留源值。`accuracyMissingReason` 标明无匹配销售路径、销售源下单量/发货量缺失、提报分母非正或Cube返回空值。初始与纠偏量已取得，不代表准确率所需字段齐全。

## 明细接口

### 订单与需求

- `orderRows`：`key, finalPlan, totalOrder, totalShipped`。用于同口径源行复核；完整订单池显式声明 `orderRowsComplete: true`。样本不覆盖全量指标。已有正式分类度量时无需为生成报告伪造订单行，`method` 记录来源与覆盖。
- `demandRows`：`view`（基地经理/品类经理）、`object, initialReportedDemand, reported, ordered, salesDemandPlanVariance, shipped, monthlyShortage, gap, scopeNote, unit, children, findingIds, accuracy`。`gap` 为需求变化分类缺货；`children` 按大区→省区，各层独立绑定同范围指标。`accuracy` 使用0–100数值。
- 省区 `detailRows`：`skuCode, skuName, finalPlan或planReference, ordered, shipped, monthlyShortage, demandGap, inPlanGap, unit, records`。计划版本未确认时只能称源计划参考，不能冒充最终计划。`records` 保留可用的日期、源键和数量，按真实粒度描述。
- 两种管理视角不相加。提报与准确率的完整分页、映射和回退只遵循指标契约，此处不再指定唯一查询路径。

### 供给与分布

- `planRows`：`object, planned, actual, gap, unit, children, findingIds, scopeKey`；子层为品类→SKU。计划类型和实际节点按查询来源说明，不固定称“滚动周计划”或“合格可用”。日生产实绩可通过 `scope.productionActualLabel` 明确标为实际产出。`gap` 是本次定义的生产偏差，不是订单根因量；记录净差与分组正差的区别。
- `transferRows`：同供给结构；兑现节点采用已核验的接收可用定义，不拿调出量代替接收量。
- `oeRows` / `odRows`：同供给结构，用于计划内缺货指标卡中的 OE、OD 维度。具体业务定义、数量字段和兑现节点必须由本次来源元数据确认；未接入或语义未核验时保持空数组并显示“—”，不得用自产或调拨数量补位。
- `overallRows`：`view, object, gap, unit, children, findingIds`，仅用于总缺货分布。
- `findingIds` 是 `findings` 数组下标，显式关联；生产行与finding还以稳定完整路径 `scopeKey` 匹配。相同ID不能证明同范围，不自动继承父级证据。无子层数据时说明停止点。

## 生产原因打标与计量

字典定义及匹配规则以 `../scripts/production-reason-dictionary.js` 为单一维护入口（用户A–K分类）。这里只定义数据接口：

- finding保留 `reasonText` 原文、`reasonTags`（code、label、family）、`primaryReasonCode`、`taggingState`（rule_matched/multiple/review/invalid）、`dictionaryVersion`。
- 生产finding还含 `channel`（self/transfer）、`reasonCategory` 和 `scopeKey`；`records` 保留 `date, sku, order, batch, line, shift, planned, actual, gap` 与来源定位。
- 唯一命中的记录才进入当前细分类数量，使用源分组正差 `gap`，不使用finding的订单影响量 `impact`。汇总取同一不重叠层级，不重复加父级/品类/SKU数量。
- 多标签记录保留全部标签，`primaryReasonCode=null`，不按每个标签重复计量；笼统、未匹配、空白或纯编码保留供复核，不硬归业务“其他”桶。
- 分类标签只表示规则匹配，不升级证据状态；仅有记录支持的分类进入汇总卡。原文、标签和状态随JSON交付。展示位置、筛选和明细联动只在交互契约维护。

## 结论、行动与情景

`findings` 可含 `object, status, fact, mechanism, impact, unit, evidence[], counterEvidence, boundary`。已验证根因还需 `orderSupplyLink, eventTime` 及同口径影响量依据；`impact` 非空本身不证明因果。历史 `verified` 转为事实时保存 `originalStatus`，其他状态按证据契约解释。

### 第四模块结论生成规则

“分析结论汇总”不是独立页面提示词，而是本 Skill 的报告编排阶段。它使用全量输入生成 `summary`、`demandNarrative`、`planNarrative`、`findings`、`actions` 和 `method`，不受页面当前选择、排序、TopN或展开状态影响。

第四模块以重要问题而非原因清单组织内容。需求与供给是观察入口，不是封闭框架；按本期异常、业务意义和证据选择比较维度、追溯路径与章节，可合并或调整顺序。需求提报可从品类定位大区、省区偏差，原因不足时止于对象与特征，不用缺货子集净差冒充准确率。生产可沿SKU、日期、产线、生产单和理由原文解释欠产机制，区分持续约束、具体事件或计划安排等不同问题，不止于字典汇总，也不要求遍历这些类型。两侧深度可以不同，只有有意义的交集才联合分析。

生产偏差解释与订单缺货因果是不同结论：缺少订单关联限制订单损失量的认定，不阻止分析已有生产记录。字典是汇总工具，不替代理由原文；机制判断说明依据和剩余不确定性，不能把记录关联量当独立原因贡献或已验证订单影响。

`conclusion.sections` 为本期章节数组，每项 `{title, blocks}`；可选 `subtitle`。块支持字符串、`{text}`、`{heading}`、`{type:"table", headers, rows}`、`{type:"details", summary, blocks}`。长表可配置正整数 `pageSize` 及零起始 `filterColumn`、`filterLabel`，只影响阅读，Markdown仍导出全部行。内容作为纯文本转义，不输入可执行HTML。标题、节数及表格随本期内容，不写死月份、基地、原因、数值或公式。分析正文在输入准备阶段形成，生成器只渲染、不从差额自动推导根因。

兼容旧 `summary, framework, demand, plan, boundary` 段落数组、`actions` 和 `evidenceIds`；未提供自定义章节时沿用旧版布局及已有叙述，不为填满页面推造深度分析。新输入优先使用 `sections`，无需同时维护两套正文。

正文只保留影响判断的关键证据，完整 findings、分层明细和源记录保存在JSON及下载Markdown。首屏和目录始终同时可达两类分析；完整结论不递归预建所有证据DOM。

- 先写结果，再写原因和边界；缺失值保留为空，不自行计算或补造。
- 只有 `verified_cause` 可写成“导致/造成”。其他状态分别表达为事实、待验证线索、假设、缺数或口径冲突，不能在总结时升级。
- 需求变化、生产偏差、库存、调拨和总缺货保持各自口径；不同视角不相加，重叠原因量不求和，生产偏差不改写成订单缺货影响量。
- `findings` 只保留有证据的事实、根因、重要线索及影响结论的数据停止点；不为覆盖原因清单而罗列无依据项目。
- 已验证原因可生成改善建议，待验证线索只生成核查建议；责任角色或验收依据不明确时不强行生成行动。
- 结论保留对象、数量、证据状态和停止点，不复述长明细、查询过程或页面操作。页面结构、下钻和导出仍由生成器负责。

`actions` 使用 `object, task, owner, acceptance`，按需附 `priority`；不需要为每条事实生成动作。

可选 `scenario`：`unit` 为件；`exclusive:true` 表示恢复范围已核验互斥；`costUnit` 为成本单位；`items` 包含 `name, max, costPerUnit`。未证明互斥的原因恢复量不可直接相加，上限不超过相应缺货；无情景数据不启用模拟。

## 输出一致性

生成时附带`data-contract-audit.json`（结构、覆盖和粒度风险）及`build-manifest.json`（实际使用的源码与输入指纹）。结构错误与普通缺数分别报告；fixture/DOM通过不等于本次取数完整、单位核验或业务结论正确。适配流程与依赖处理见[输入准备](input-preparation.md)，不重复维护技术步骤。

生成器使用当前模板及绑定脚本，不复制历史报告内嵌脚本。HTML可分页或延迟渲染，但全量结果可达；Markdown与JSON保留全部输入行、证据和行动，不被当前筛选或TopN裁剪。

如果正式口径更新与现有脚本计算/校验冲突，应报告具体差异，在授权范围内同步修改脚本和测试。文档精简本身不代表程序已适配新的口径。


## 已取得数据不得因口径争议隐藏

正式metric保留其语义；口径或覆盖未通过不赋正式值，但必须用sourceMetric显示已取得的源值及source/status/note/unit。sourceViews保存完整查询行、fields、hierarchy、来源、查询时间、状态与限制，通过统一生成器提供筛选、分页、排序、路径下钻和CSV导出。正文与Markdown也须保留全量。缺失、真实零、已取得待核验分别标示；不能把待核验处理成未取到。两类不勾稽时仍显示两类源值和冲突，禁止参与正式归因或情景。只有真实查询维度才能形成下钻；全国SKU与组织分布分开查询时不伪造组织×SKU关联。
