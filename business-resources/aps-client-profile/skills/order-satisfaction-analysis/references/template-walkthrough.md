# 按模板逐块取数、汇总和绑定教程

本教程是完整月报的执行入口。详细公式见 source-to-report-map.md，输入结构见 source-bundle.example.json。表名是业务入口；Cube 的实际 Model/View、dimension、measure 必须 inspect 后映射，不能把物理列名直接拼成未核验的 Cube 成员。

## 1. 开始前准备五份数据

先查 WeKnora：数量单位、销售准确率版本及权重、满足率公式、计划版本、生产与排程单位。保留完整问答与引用。查询不是 COMPLETED 或回答没有对应定义时登记未确认，不把整个报告清空。

| 数据集 | 表 | 必取业务字段（对应Cube成员现场inspect） | 期间与范围 |
|---|---|---|---|
| orders | agents_scm_order_plan_exe_m | fromorderno_month,belong_base,region_code,region_name,province_region_code,province_region_name,material_code,material_name,need_qty_origin,qtyshipped,outqty,allnum,demand_change_outqty,plan_inner_outqty | 完整本月、统一业务条件；不能只取Top30，不能先筛掉非缺货行 |
| sales | agents_scm_demand_sales_f | stat_month,source_flag,material_code,material_name,基地与大区省区编码/名称,plan_qty_initial,plan_qty_adjusted,order_qty_origin,act_dl_qty | 同月，source_flag=销售口径 |
| mapping | agents_scm_demand_sales_f | stat_month,source_flag,material_code,product_categ_name,material_group,material_group_name | 同月，source_flag=基地口径；覆盖全量订单和销售SKU |
| production | agents_mes_prod_oee_line_result_d | zdate,factory_name,classify1,material_code,plan_qty,actual_qty,order_code,batch_no,workcenter,deviation_reason | 本月日期；保留生产单/批次/产线/原因的粒度 |
| schedule | agents_prod_schedule_detail_d | base_finish_day,act_ship_date,factory_name,material_code,material_name,order_no,internal_order_no,data_source,measure_unit,order_qty,confirm_qty,deliv_qty | 本月计划完成日；完整查询当前范围或未覆盖SKU，记录范围 |

物理 zdate 可能公开为 production_date，数量可能公开为带 _total/_value 的 measure，字段映射放 manifest.datasets.<id>.fields：键为脚本标准列，值为返回行的真实键。例如返回键若确为 Model.plan_qty_total，则填 {"plan_qty":"Model.plan_qty_total"}。禁止猜成员名称。rowsPath 指向实际结果数组；保留原始MCP输出，规范化副本注明来源。

全国汇总查询仅用于独立对账，不能代替完整维度数据。Cube若合并了源行，必须确认复算所需粒度没有丢失；非线性公式不能在合并后的 N/P/S 上计算。无法取得所需粒度时登记阻断，不能假装已完成逐行复算。

每页显式保留 offset/limit/totalRowCount/hasMorePages 等实际返回信息，hasMorePages=true 时继续。COUNT 必须与明细查询的分组粒度、过滤条件一致，物理记录数不能用来校验不同粒度的聚合行数。分页元数据缺失先保存原始错误，再用同期间最小合法查询定位；有数据但缺完整性证明可标partial，真正工具失败标query_failed，均不能写empty_scope。

## 2. 模板卡片：逐项对应

| 模板位置 | 数据计算 | 输出绑定 |
|---|---|---|
| 初始销售提报 | sales SUM(plan_qty_initial) | metric.initialReportedDemand |
| 纠偏销售提报 | sales SUM(plan_qty_adjusted) | metric.reportedDemand |
| 已开需求/发货 | orders完整池分别SUM(need_qty_origin/qtyshipped) | metric.need / rawShipped与shipped；shippedIsActual=true |
| 已开缺货 | orders SUM(outqty)，保留源发布值 | metric.monthlyShortage |
| 满足率 | 经知识库确认后1−SUM(outqty)/SUM(need_qty_origin) | metric.rate；零分母null |
| 缺货卡三个紧凑标签 | 正缺货逐行需求变更参考、计划内参考、发布缺货减两项已知合计 | metric.demandChangeShortage / inPlanShortage；classificationAudit.uncovered |
| 卡片帮助/折叠审计 | 正缺货行数、计划缺值数及缺货量、源分类值和复算差异 | classificationAudit，源冲突不清除复算值 |

分类脚本输入同一 orders。筛 outqty>0；N=need_qty_origin，S=qtyshipped，P=allnum。逐行需求变更=min(max(N−P,0),max(N−S,0))；计划内=max(min(N,P)−S,0)。必要值null时不补0；先逐行算再汇总。它是用户确认的诊断参考，源字段求和另保留，不能因源字段不勾稽把诊断量一起停用。总缺货也不能改成SUM(N)−SUM(S)。

## 3. 需求变更模块：六卡→维度表→SKU→源行

1. 先按material_code用mapping补品类和物料组。销售口径品类为空时，不代表基地口径映射也为空；查询基地口径全量后才能判定。多值映射单独保留，不能复制事实量。
2. sales与orders分别按品类×物料组×大区×省区聚合，再全外关联。优先编码路径；唯一完整名称路径才可回退。禁止先连接事实表再SUM。
3. 六卡分别绑定 initialReportedDemand、reported、ordered、salesDemandPlanVariance=reported−ordered、shipped、gap。两侧单位未确认一致时差额null并说明，不能把已有两侧数量隐藏。
4. 维度列表用crossDimensionRows；每行还绑定accuracy、monthlyShortage、inPlanReference、matchStatus。品类树用demandRows的view=品类经理，基地树用view=基地经理。
5. 点击组织行展开detailRows，按SKU显示；点击SKU展开records。父级需求参考字段是gap，SKU字段是demandGap；计划内分别是inPlanReference和inPlanGap，不可错绑。
6. 准确率只使用sales下单/发货和两版提报。按source-to-report-map公式和知识库权重计算，不用orders下单代填；源值确实为空可以留空，说明缺哪个字段。
7. 原因核查使用关联到当前对象的findingIds和证据；没有需求变更事件记录时保留数量明细，但不编造促销/临时加单原因。

验收：切换每个品类后六卡、列表、SKU和源行都切换；同层子项与父项核对，不能把不同层级全部相加。单边分组保留，真实零显示0，未取得显示—。

## 4. 计划内模块：条形图→C供给四卡→原因→列表下钻

条形图使用classificationPlanDimensionRows / classificationPlanRows的订单分类参考。点击后取当前对象计划内参考>0的订单SKU集合，按编码筛供给数据。不能用生产classify1名称硬匹配订单品类，也不能套全国生产量。

| 模板模块 | 来源/汇总 | 绑定与脚本 |
|---|---|---|
| C计划/执行/偏差/达成率四卡 | MES plan_qty/actual_qty；排程order_qty/deliv_qty独立展示 | productionMetric、planRows；scheduleSupplyRows、scheduleSupplyMetadata；supply-scope.js筛对象 |
| 自产、调拨、OE、OD行 | 根据已验证来源定义、单位及计划/兑现配对 | 未确认渠道不从data_source猜OE/OD；不能把所有排程归为自产 |
| 总的原因字典汇总/细分布 | MES deviation_reason原文唯一源记录匹配字典 | production-reasons.js、production-reason-dictionary.js；无原文排程不生成原因标签 |
| 基地×品类自产列表 | 当前SKU集合内MES按基地×生产品类汇总；保留SKU正差、净差、源行正差各自名称 | planRows及其子节点/源记录；prepare-source-bundle.cjs生成 |
| 排程列表 | 来源×单位×工厂×SKU聚合order_qty/deliv_qty；confirm_qty另列 | scheduleSupplyRows交给supply-scope.js；不能把交付量称MES实绩 |
| 列表下钻 | MES日期/SKU/生产单/批次/产线/原因；排程日期/排程单/来源/单位/计划/交付 | template-components.js统一全宽跨列展开，默认收起；不能嵌长表在操作列 |

MES未匹配继续查schedule；MES查询失败也不省略schedule任务。两者都失败保留订单分类并记录错误，不能宣称该品类没有生产。单位ST/KG/PAK分别处理，有知识库确认换算才跨单位合计。执行与排程不相加。数量匹配仅是供给参考，订单因果还需要订单需要时点与实际可用事件。

## 5. 总的原因分析

conclusion.sections覆盖：全国缺货及两类参考/未覆盖量；全部品类需求问题；全部生产基地与排程供给事实；原因原文和证据边界；缺数/冲突；行动、建议责任角色、验收依据。汇总基于全量数据，不受当前点击或Top10限制。仅有分类量不能称已验证原因；生产偏差不能直接等同订单影响量。

## 6. 实际执行顺序

在Skill目录执行，下列路径替换为本次真实路径，不手写大型report-data：

```text
node scripts/guided-report.cjs init <任务目录>
# 完成WeKnora、Cube inspect、全量分页取数，填写source-bundle与任务单
node scripts/prepare-source-bundle.cjs <source-bundle.json> <report-data.json>
node scripts/audit-bindings.cjs <report-data.json> <binding-audit.json>
node scripts/check-template-coverage.cjs <report-data.json> <任务目录/work-order.json> <template-coverage.json>
node scripts/guided-report.cjs packet <report-data.json> <任务目录>
# 审阅analysis-cards，补全结论；数据改变后重新packet和复核卡片
node scripts/guided-report.cjs check <report-data.json> <任务目录>
node scripts/guided-report.cjs build <report-data.json> <任务目录> <新输出目录>
```

prepare-source-bundle负责归一字段、过滤、逐行复算、映射、分别汇总关联及树结构；渲染器只渲染，不能补查询。完整性检查为INCOMPLETE时仍可保留诊断稿，但不得交付为已完整验证。浏览器实点每品类、每来源及至少一条有效下钻，检查全宽展开、切换后重置旧选择、排序分页和总分析。结构检查与组件模拟通过不等于浏览器通过。

## 7. 本次缺数报告的反例（2026-10-23）

审查用户提供报告的report-data/work-order/acceptance发现：订单SKU仅前30组且hasMorePages=true；映射使用销售口径而非基地口径；分类量因源冲突置null，未执行正缺货复算；没有crossDimensionRows和排程任务；planRows为空；生产查询记录GEA_CUBE_NEW_PAGE_METADATA错误；验收却为READY_WITH_GAPS。前五项是流程/绑定遗漏，生产错误是接口阻断，不能混为真实零或来源无数据。此案例只用于防漏，不将历史数量写入通用模板。
