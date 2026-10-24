---
name: order-satisfaction-analysis
description: 分析订单满足率、需求变更与计划内缺货；核验同月订单和销售范围，关联生产执行与排程，使用统一模板生成可下钻的HTML及全量结论报告。适用于产销协同订单满足率复盘和报告复跑。
---

# 订单满足率分析与报告

本Skill管理查询范围、数据处理、证据解释和报告验收。口径、字段、实际数值分别核验；已经取得的数据保留，缺数、真实零、部分覆盖和定义冲突分别展示。不要把“汇总量、原因标签、页面已生成”当作分析完成。

## 读取路径

- 完整报告首次执行必读 [按模板逐块取数教程](references/template-walkthrough.md)：逐项卡片、列表、下钻、Cube输入、脚本顺序和缺数诊断。生成前运行 `check-template-coverage.cjs`；INCOMPLETE只能作为诊断稿，不能称完整验收通过。

- 首次取数或改变指标/字段：读 [表字段与页面绑定索引](references/source-to-report-map.md) 和 [指标契约](references/metric-and-data-contract.md)。
- 运行/重新生成：读 [运行步骤与脚本职责](references/runbook.md)，按实际工具返回填写 [源数据清单示例](references/source-bundle.example.json)。
- 页面修改：读 [交互契约](references/interactive-analysis-contract.md) 与 [验收清单](references/acceptance-checklist.md)。
- 维护Skill或检查遗漏：读 [本次失败复盘](references/failure-lessons.md)。9月历史差异仅见 [带日期的核验记录](references/2026-09-source-reconciliation.md)，重跑必须重查，不能填入历史数值。

## 1. 建立范围与定义

运行 `node scripts/guided-report.cjs init <任务目录>`，填写period、cutoff、object、unit及任务状态。月份、业务过滤、源粒度和版本属于本次输入，不写死在脚本里。

按主提示词登记的WeKnora知识库查询指标定义/权重/单位/版本；不重新要求查询飞书。使用本轮可用的MCP名称和协议，先inspect再query。返回COMPLETED但内容是错误不算取得定义。定义快照不等于物理加工已经验证。

`make-query-plan.cjs`生成查询意图，不能直接当作Cube参数。字段/日期类型现场确认；所有订单数量来自同月同业务过滤的 `agents_scm_order_plan_exe_m`；销售提报和准确率来自 `agents_scm_demand_sales_f` 的销售口径。只在当前对象确有来源时填数。

## 2. 保存完整查询证据并查清缺数

每项使用 `pending / acquired / partial / source_null / empty_scope / unsupported / query_failed / not_applicable / conflict`，定义见 [缺数排查](references/gap-triage.md)。未查询不等于系统无数据。保留完整返回、字段元数据、查询身份、分页终止/独立COUNT、刷新时间和哈希；规范化副本不冒充原始返回。

大结果一律用 `node scripts/ingest-mcp-result.cjs <返回JSON或转存文件> <数据集名> <输出文件> <字段映射.json> --period YYYY-MM` 落盘：脚本会拒绝 `hasMorePages=true` 的结果、列出缺失成员并打印行数/合计/sha256，避免手工抄写与把部分数据当全量。取大页前先用 `limit:1` + `total:true` 探明组数；业务粒度只用编码维度，名称字段仅作展示。

生产同时核查MES执行与生产排程。MES不覆盖某SKU时，继续查排程、来源类型、期间和单位；库存/调拨按可验证的事实保留。所有来源无匹配后才显示已查无匹配。不能用全国数据填当前对象，也不能靠增加一段“0匹配”说明结束排查。

任务单与dataProvenance记录实际证据。取得orders/sales/production/schedule后登记目标数组绑定、源行数和完整性。字段或单位尚未核验只影响对应指标，不推断其他指标也无数据。

## 3. 用脚本整理数据并核对绑定

本次跨表流程使用 `prepare-source-bundle.cjs`，输入为任务目录中的源数据清单。脚本负责：字段显式映射、分页/行数检查、同月过滤核对、订单全量与正缺货子集、逐源行复算、销售准确率基础计算、SKU映射歧义、两表分别聚合后的全外关联、需求/生产树与源行绑定。模型不手抄大型JSON、不心算、不再写只适用本期的临时构造器。

```text
node scripts/prepare-source-bundle.cjs <源数据清单.json> <report-data.json>
node scripts/audit-bindings.cjs <report-data.json> <binding-audit.json>
node scripts/guided-report.cjs packet <report-data.json> <任务目录>
```

- 原始分类源字段与诊断复算分别保留。按本次用户确认的 `outqty>0` 源行逐条复算后汇总；计划缺值为null，全缺值分组不能变0。两类参考、未覆盖差额和缺值统计分别展示，不把差额当第三类根因，保持classificationComplete:false。
- 需求/发货全国指标仍来自完整订单池；不能拿正缺货子集的需求/发货覆盖它。原始需求变更/计划内源值及冲突不能被隐藏。
- 销售和订单先分别聚合再关联。SKU映射采用同月基地口径维度；组织优先完整编码路径，唯一名称路径只是受控回退。单边分组、多值映射保留，不能多对多放大。
- 准确率只使用销售源下单/发货和已确认权重；不平均SKU比率，不截断负值。未知定义保留null并说明。
- MES与排程独立取数和展示；排程交付不称生产实绩，来源×工厂×SKU分别聚合。单位未知不改成件，交付null不补0；生产净差、SKU正差和源行正差分别标识。

旧合规report-data可复用；单来源扁平数据可使用 `prepare-report-data.cjs`，详见 [输入准备](references/input-preparation.md)。数据修改后重新packet和检查，旧分析卡不得自动套到新输入。

## 4. 分析对象并形成全量结论

按 [分析示例](references/analysis-worked-example.md) 审阅analysis-cards，回答观察事实、原文支持、机制、反证、证据边界、行动及验收。不要只写“人员/设备”。数量和日期统计由脚本计算；没有理由原文的排程不能补原因标签。

在 `conclusion.sections` 写综合分析，覆盖需求与供给主要问题、未解释部分及可执行核查行动；基于全量数据，不受界面当前选择或Top10限制。来源汇总不能证明某订单及时可用；verified_cause必须具备订单供给关联、事件时间、影响量和反证核验。规则见 [证据契约](references/evidence-and-output-contract.md) 与 [结论复核](references/conclusion-review.md)。

## 5. 统一模板生成与验证

```text
node scripts/guided-report.cjs check <report-data.json> <任务目录>
node scripts/guided-report.cjs build <report-data.json> <任务目录> <新输出目录>
```

沿用assets模板和共用组件。缺货卡用紧凑三标签；审计说明按需展开。需求侧六卡→维度表→SKU→源记录完整绑定。计划内条形分布下直接接C供给模块，不加回已删除的长篇订单月度复盘。

C模块保留四卡和渠道行。所有品类共用SKU筛选和来源选择：MES优先、无覆盖时检查排程，有两源可切换但不相加。保留MES原因字典、细分类分布、基地×品类与SKU/原文下钻；排程使用同样的整行分析面板，字段名称按实际口径显示。操作列只放按钮，下一行colspan展开，禁止把长子表塞进操作单元格。

运行 `self-check.cjs` 和binding-audit。按验收清单实际点选所有品类/基地、来源切换、原因筛选、行展开/收起、SKU源行、排序/全部及第四模块。视觉在工具允许时检查桌面/窄屏；工具拒绝访问不绕过。代码、组件逻辑、浏览器视觉、业务口径、目标环境实跑分别记录，未执行为NOT_RUN。

## 6. 交付

交付HTML、全量Markdown、report-data、完整查询证据、binding-audit、acceptance和构建哈希。数据不足可交付带边界的报告，不宣称完整根因已验证。已取得源记录通过sourceViews保留筛选/排序/分页/导出，但源表浏览不能替代业务下钻。

运行包不含凭据、本期业务数据和本机路径。部署MCP由主提示词/宿主负责；本Skill不自动派发任务、修改计划或写回业务系统。

本包为运行版；开发回归与模板同步工具保留在开发版。运行时使用data-contract-audit.json及业务人工复核，不宣称完成开发回归或浏览器验收。

### MES未覆盖时的排程补查

订单分类与生产供给分别取数：品类由同月agents_scm_demand_sales_f基地口径映射订单SKU；分类量由agents_scm_order_plan_exe_m正缺货源行复算。MES匹配不到不影响订单分类值。MES未覆盖SKU必须继续通过Cube inspect/query排程agents_prod_schedule_detail_d，并向知识库核验字段和单位。存在其他品类的MES记录不能把排程标为not_applicable。模型不可用记录query_failed及错误证据，保留订单数值，不写已查无数据。历史直连排程仅作追查线索，不能替代本次MCP结果。
