# 固定查询与周报生成流程

客户端默认调用 `plan_operations_weekly_run`。准备好下述两份 JSON 后传入 inputDirectory。工具保存计划，按阶段调度当前会话的业务工具，逐页保存原始响应，最后复用合并器、固定模板和成品校验。输出目录内的 report.html 为报告，quality.json 为缺口，results-manifest.json 记录批次和耗时。成功后直接交付。编辑有证据的结论时，仅更新该输出目录中的 report-seed.json，运行 `node <Skill目录>/scripts/run-weekly.cjs <输出目录>`，从原始响应重建并执行相同校验，无需再查业务数据。

## 1. 一次准备输入

先读取本轮已授权、有效版本的指标定义和 inspect 结果。已有同版本定义可复用；知识库只查询未明确或冲突的口径，不在制作报告中途重复问相同制度。历史数据和其他 Consumer 的结果不可复用。

用 `scripts/create-input.cjs <新的已授权输出目录>` 生成两份空白输入。该命令拒绝覆盖已有文件；其中没有真实数据或预填 Cube 成员。填写 JSON，不改脚本。输出目录必须在当前获授权工作区内，遇拒绝立即停止相关写入并说明，不反复换目录试探。

`report-seed.json`：

- `schemaVersion:1`；meta 含 title、month、week、cutoff、scope、version；month/week 为可读期间范围，cutoff 带时区。
- `definitions` 使用六项固定 id：cancellation、amendment、fulfillment、ontime、stockAge、shippingDays。可补实际 target；不得自行猜测阈值。
- `summary` 为有当期证据的结论数组；`analysis.base/director/category` 为相应观察与原因状态数组。
- `actions` 为第05模块执行情况，字段 line/action/problem/status/owner/due/evidence；`longTerm` 为 name/content/target/owner/milestone；`nextWeek` 为重点事项数组。它们保持静态展示，不生成下钻。
- `relations` 显式声明父子关系，例如 `{fromScope:"base",toScope:"sku",on:[{parent:"实际基地响应键",child:"实际基地响应键"}],coverage:"全量/部分说明"}`；SKU→订单行须同时匹配基地和 SKU，按需要继续到源记录。不存在可靠关联就不添加关系，不跨范围硬拼。fromScope 每层只声明一个下一层关系，不可成环。

## 2. 先验查询方案

`query-config.json`：

标准六指标、当前会话授权全范围周报优先填写 context、windows 和已确认的 `publishedModelRevision`，bindings 留空。工具定向 inspect 六个已发布视图，核对本轮 model_revision，直接用返回的 name、aliasMember 生成查询和字段映射。此模式覆盖全国、基地、应责总监、品项和基地 SKU。指定筛选范围、定制指标状态、订单行或批次关联时，按下文填写显式 bindings 与 relations，保留全部筛选条件和下钻键。

- `context`：cutoff、scope、authorizationScope（非密钥授权范围标识）、definitionVersion、sourceVersion。它们绑定复用指纹，不代替运行时授权。
- `windows`：month、previousMonth、yearMonth、week、previousWeek、yearWeek，各为显式起止日期 `["YYYY-MM-DD","YYYY-MM-DD"]`。遵循原期间规则；缺少窗口则登记缺口，不自动猜同比日期。
- `bindings[]` 每个指标一个，字段 id、model、inspectionSource（本轮检查证据文件）、members（实际发布成员白名单）、measures、timeDimension、baseDimension、filters、responseFields、scopes。
- `responseFields` 用本轮结果的真实键映射 value/numerator/denominator/missingReason/skuCode/skuName/generation；不能假定返回键与 View 查询前缀相同。需要保留源记录号、业务日期、数量、单位等底层字段时用 `detailFields:[{key:"orderNo",field:"实际响应键",label:"订单号"}]`；程序原样展示标量，不合并基础记录。来源明确发布状态且定义有效时，可配置 responseFields.status、statusMap 和 statusDefinitionSource；缺少其中任一项不自动判级。value_final 百分比已乘100，4.02直接显示4.02%，不要再次乘100或重做服务端底表加工。
- `scopes[]`：id 为 national/base/director/category/sku/order/batch；dimensions 为实际分组成员，responseKeys 为稳定源响应键数组，keyNames 可将不同指标响应键按相同顺序统一为 base/sku 等本地关联键，responseLabels 为名称响应键数组，periods 指定所需期间，filters 保留实际过滤。SKU和总监必须带基地维度；遵守模型对 calculation_scope、scope_base 等条件的实际说明。members白名单不代表任意组合可查，必须按 inspect 的组合合同填写。
- 仅为报告实际用到的指标/维度/比较窗口计划查询：全国6项；基地/总监默认满足率、准交率、货龄、可发货天数；品项默认满足率、货龄、可发货天数。SKU及源记录先取本月/本周，不无条件扩展全部历史明细。

```text
node <Skill目录>/scripts/make-query-plan.cjs query-config.json query-plan.json
```

客户端由专用工具在第一条业务查询前生成计划，先 summary 再 detail，每批至多4条、仅同模型，全流程最多2个业务调用并发。默认汇总范围包含全部六个比较期间；确实不支持的窗口记录缺口。明细默认本月、本周。独立命令用于离线复核或显式降级执行。

工具原始结果必须保留 datasets/name/offset/hasMorePages/dataStatus/rows 等元数据。用获授权文件写入路径保存响应，不将大型行集重复粘贴到多轮提示词。记录 `results-manifest.json`：

```json
{"context":{"cutoff":"与计划一致","scope":"与计划一致","authorizationScope":"与计划一致","definitionVersion":"与计划一致","sourceVersion":"与计划一致"},"files":[{"path":"response-001.json","batchIndex":0,"queriedAt":"实际查询时间（带时区）"}]}
```

query rejected 时只按明确错误修正绑定，不执行 measure-only/time-only 等试探阶梯，不在相同失败参数上自动重试。来源不支持维度则记录缺口；一次失败不重新跑已完成的全部指标。

## 3. 固定合并、分页和出报

```text
node <Skill目录>/scripts/assemble-data.cjs query-plan.json results-manifest.json report-seed.json report-data.json
node <Skill目录>/scripts/generate-report.cjs report-data.json 计划运营周报-本期周期.html
```

合并器检查上下文、数据集名称、连续offset、稳定组键、重复记录、完整性和代次。未完成分页的指标不填正式值，输出 `nextPages`，只按其请求继续下一页，追加到同一 manifest 后重新合并；不要重查第一页。超时/权限/不支持的字段保留为缺口，能完成的指标继续。不同代次拒绝合并，需统一来源后重取受影响集。

`report-data.json.national[指标id][期间]` 与 `groups[维度][]` 由合并器填充。组记录包含 id/name/keyValues/skuCode/skuName/metrics；metrics 同 national。观察值为 `{value:数字或null,complete:true,source:指纹}`，仅完整结果可展示为数值。百分比直接使用权威值，差值由固定程序计算；不平均比例、天数，不把SKU求和冒充全国。手工补入数据也必须遵循相同结构并保留真实来源。

来源明确提供且有有效口径依据的状态可填写 `statusVerified:true,status:"healthy|warning|severe"`，否则统一显示口径待确认，不从变化趋势猜风险颜色。程序不硬编码阈值。

固定生成器保留原五段式结构、11px表头/12px深灰正文、单文件本地交付和第01—04模块多层下钻；第05模块没有下钻。HTML输出同时生成 `.quality.json`，逐条核对缺口和来源。更底层数据取不到时说明原因，不把缺口隐藏。

只在校验发现真实输入错误时修正 JSON 并重跑，不改生成器/模板绕过校验。记录计划耗时、各请求耗时、合并/生成耗时；性能收益需同周期同范围实测，不能将本地毫秒级模板渲染宣称为整体报告耗时。
