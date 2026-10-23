# 数据源、指标与页面绑定索引

这是取数和实现索引，不替代现行口径。指标定义、权重、单位、版本从主提示词登记的知识库（WeKnora）核对；不要求重新读取飞书。物理表/字段须现场 inspect。知识库定义、物理字段和查询实际值三者分别留证。

## 1. 统一查询范围

任务输入 `period=YYYY-MM`；月份区间为 `[月初,下月月初)`。所有订单指标从同一份全月行中计算，保留零发货、超发和负数源值。业务过滤记录到查询清单；不能仅在某个卡片追加地区或基地过滤。

**粒度硬规则（2026-10 补丁）**：业务粒度只用编码维度（基地、大区编码、省区编码、物料编码），`grain` 与 `uniqueGrain` 均按编码声明；物料名称、组织名称等文本字段只用于展示，**不进入分组与唯一性校验**。同一编码因名称变体会被拆成多组（9 月实测 13,462 → 14,634 组），按名称取数会导致重复分组并需要额外合并。取大页前先用 `limit:1` + `total:true` 探明组数。

| 数据集 | 已核验表入口 | 时间字段与格式 | 固定过滤/粒度 | 用途 |
|---|---|---|---|---|
| orders | `ai_db.agents_scm_order_plan_exe_m` | `fromorderno_month`，日期时间 | 同月及任务业务范围；物理月度行，名义维度为基地×物料×大区×省区，唯一性需查 | 已开需求、发货、发布缺货、两类源值和正缺货复算 |
| sales | `ai_db.agents_scm_demand_sales_f` | `stat_month`，日期 | `source_flag='销售口径'`；保留各行基础量 | 初始/纠偏提报、销售准确率基础量 |
| mapping | 同上 | 同月 `stat_month` | `source_flag='基地口径'`；只取物料维度映射 | SKU→品类/物料组；不把基地口径数量混入销售口径 |
| production | `ai_db.agents_mes_prod_oee_line_result_d` | `zdate`，`YYYYMMDD`字符串 | 日期×工厂×SKU×生产单×批次×产线×原因原文 | 自产执行和原因字典 |
| schedule | `ai_db.agents_prod_schedule_detail_d` | `base_finish_day`，`YYYYMMDD`；另保留 `act_ship_date` | 排程单×SKU×计划完成日×工厂×来源×单位；唯一性需查 | MES没有覆盖时继续核查；也可与执行来源切换比较 |
| salesReconcile | `ai_db.agents_sales_plan_demand_m` | 日期物理列尚未在包中固定，现场 inspect 后配置 | 同月；该表没有已知 `source_flag` | `plannum/allnum` 与两版销售提报交叉对账，不能替代准确率输入 |
| stock | `ai_db.agents_scm_stock_detail_d` | `data_month`、`the_date` | 月×日×基地×SKU，核验唯一性 | 生产入库、调拨与库存参考；未核验累计/日流量前不汇总 |
| transfer | `ai_db.agents_scm_warehouse_transfer_plan_data_d` | `plan_month`、`snapshot_date` | 仓×SKU×计划版本×快照日期 | 调拨计划、在途、待发；不直接当作接收兑现 |

`agents_scm_inventory_sku_data_d` 是另一库存入口，含 `month_date/warehouseid/material_code/available_qty/live_qty/freeze_qty`；未返回9月记录不能推断 stock 表也没有9月记录。`agents_scm_material_in_out_summary_d.prod_date` 是生产日期字段，不能未经核验当出入库发生日期。`agents_scm_execute_detail_d` 可查订单执行明细，但本次月报不自动改用它替换月表。

## 2. 全国卡片和订单分类

| 报告指标/数据字段 | 表字段与计算 | 范围、空值及说明 |
|---|---|---|
| 初始销售需求提报量 `metric.initialReportedDemand` | sales：SUM(`plan_qty_initial`) | 销售口径完整本期；任何缺值另记，不借纠偏量填补 |
| 纠偏销售需求提报量 `metric.reportedDemand` | sales：SUM(`plan_qty_adjusted`) | 同上 |
| 已开订单需求量 `metric.need` | orders：SUM(`need_qty_origin`) | 完整本期订单池；不擅称其为未加工OMS原始需求 |
| 已开订单发货量 `metric.rawShipped` / `shipped` | orders：SUM(`qtyshipped`) | 与需求同池；保留符号、超发；设置 `shippedIsActual:true` |
| 已开订单缺货量 `metric.monthlyShortage` | orders：SUM(`outqty`) | 发布值独立保留，不替换为汇总需求减发货 |
| 订单满足率 `metric.rate` | 已确认发布口径可为 `1-SUM(outqty)/SUM(need_qty_origin)` | 必须有定义引用；不能临时改成发货/需求，零分母为null |
| 原始需求变更/计划内缺货 | orders：SUM(`demand_change_outqty`)、SUM(`plan_inner_outqty`) | 完整范围与正缺货子集分别保存；进入 `classificationAudit`，冲突不能隐藏 |
| 正缺货复算参考 | 同一 orders 数据中筛 `outqty>0`；令 N=`need_qty_origin`，S=`qtyshipped`，P=`allnum` | 用户本次确认的诊断范围；不要把此范围的需求/发货替代全国指标 |
| 需求变更复算 `demandGap` | 逐源行 `MIN(MAX(N-P,0),MAX(N-S,0))` 后 SUM | 必要值缺失则该行null；部分有值展示已知合计和缺值数，全缺值保留null |
| 计划内复算 `inPlanGap` | 逐源行 `MAX(MIN(N,P)-S,0)` 后 SUM | 与上项同源同筛选；不能先汇总 N/P/S 再套非线性公式 |
| 未覆盖差额 | 发布缺货－两项已知复算参考 | 总缺货卡第三个紧凑标签，仅为审计差额，不是第三类业务根因 |
| 勾稽审计 | 正缺货行数、P缺值数/对应源缺货、`outqty`与`MAX(N-S,0)`不一致数、已知计划行差额 | 放帮助提示/折叠审计，不能塞成长段卡片正文 |

不要把 `plan_order_qty_origin`、`plan_act_dl_qty`、`allnum`、需求或发货的相似字段名当作同义；按现行知识库与加工说明确认。9月 `allnum` 的最终计划版本仍有边界，不把复算升级为正式归因。

## 3. 需求变化：六卡、列表、SKU与源记录

显示路径：品类→物料组→大区→省区→SKU；基地视角按基地→大区→省区→SKU。物料编码 `material_code` 作主关联；组织优先 `region_code/province_region_code`。代码缺失时只接受唯一且完全相同的完整名称路径，保留歧义和单边记录。

先分别聚合 sales/orders，之后全外关联；不能先连接两张事实表再 SUM。相同物料对应多个品类或物料组时标待确认，不任选映射、不展开复制事实量。

| 卡片/列 | `crossDimensionRows` 或同范围节点字段 | 底层来源 |
|---|---|---|
| 初始提报 | `initialReportedDemand` | sales 的 `plan_qty_initial` |
| 纠偏提报 | `reported` | sales 的 `plan_qty_adjusted` |
| 已开需求 | `ordered` | orders全量的 `need_qty_origin` |
| 需求计划偏差 | `salesDemandPlanVariance` | 纠偏提报－同范围已开需求；保留正负，属于并列对照 |
| 已开发货 | `shipped` | orders全量的 `qtyshipped` |
| 需求变更参考 | `gap`；SKU为 `demandGap` | orders正缺货子集的逐行复算 |
| 源缺货、计划内参考 | `monthlyShortage`、`inPlanReference`；SKU为 `inPlanGap` | orders相应范围 |
| 销售提报准确率参考 | `accuracy` | sales的计划版本、`order_qty_origin`、`act_dl_qty`；不是orders中的需求/发货 |
| SKU明细 | `detailRows` | 按相同完整维度路径，再按SKU汇总；单边数据保留 |
| 正缺货源行 | `detailRows[].records` | 日期、源行序号、需求、发货、发布缺货、计划、两项复算 |

准确率：每版 `1-SUM(ABS(逐行偏差))/SUM(该版计划)`；逐行偏差 `IF(下单>计划,发货-计划,MAX(下单,发货)-计划)`。初始/纠偏权重由知识库版本传入，不能固化50/50或60/40。必要值缺失或分母非正返回null；不平均SKU准确率，不截断负准确率。`salesAccuracyWeights.definitionRef`记录所用定义。

## 4. 计划内缺货：条形图直连C模块

条形图来自 orders 的 `inPlanGap`，不是生产偏差。点品类/基地，取得该对象正缺货且计划内复算>0的SKU集合，按**编码**筛供给源。页上默认“品类分布 → C供给兑现”，不插回用户已删除的长篇订单月度复盘；必要的订单源行保留折叠入口/源数据浏览。

| 供给字段 | MES执行来源 | 排程来源（独立口径） |
|---|---|---|
| 计划 | `plan_qty` | `order_qty` |
| 实际/交付 | `actual_qty`，明确称生产执行量 | `deliv_qty`，明确称排程交付量；`confirm_qty`另列，不互填 |
| 偏差 | 基地×品类×SKU汇总后取正差并向上加总；另列全国净差和源行正差 | 来源×工厂×SKU汇总后取正差再求和；另列排程净差 |
| 比率 | 本次确认的发布比率或 `SUM(actual_qty)/SUM(plan_qty)` | `SUM(deliv_qty)/SUM(order_qty)`，分母<=0为null |
| 组织/品类 | `factory_name/classify1/material_code` | `factory_name/product_categ_name/material_code` |
| 源行 | `zdate/workcenter/order_code/batch_no/deviation_reason` | `base_finish_day/act_ship_date/order_no/internal_order_no/data_source/measure_unit` |
| 原因字典 | 由 `deviation_reason` 原文匹配字典，按唯一源记录计量 | 未取得原因原文字段，不沿用MES原因标签 |

有MES记录默认展示执行；MES无匹配而排程有匹配时展示排程参考。有两种源时提供来源切换，不能相加或用排程交付伪装MES实绩。任何品类都走同一规则，不写“调理肉”特判。空值不能变0；所有源都无匹配后才显示已查无匹配，并记录尝试过的表/期间/键。

排程 ST/KG/PAK 按源单位分组；ST不自动等于件。只有 `unitMapping` 提供已核验单位、换算系数和定义引用才能换算。混合单位未处理时阻止该份汇总，原始记录保留来源浏览。MES与排程的合计不跨来源叠加。

调拨、OE、OD保留模板渠道行；仅在含义、时间点、计划/兑现配对及单位确认后填数据。`data_source='外协'`不自动等于OE或OD。`transfer_onway_qty/transfer_prepare_qty`不是已兑现量。

## 5. 核查不能跳过的边界

- 库存月计划（如 `produce_plan/produce_plan_adj`）会重复出现在多天记录中，不能逐日SUM；先确认版本、快照时间及唯一键，再取适用快照。库存余额不跨天相加。
- `produce_in_qty/base_transfer_in/wx_transfer_in`是否日流量须核验；同一天多个版本先去重，未核验不填生产执行卡。
- 供给SKU匹配证明对象可对照，不能证明某笔订单可及时使用。订单原因量还需要需要日期、承诺、实际入库/放行、库存与调拨时序。
- 全国净差、SKU正差、源行正差本来可能不同。页面和明细须标同一计算粒度，不能为了勾稽强行改值。

## 订单分类到排程供给的独立关联

订单分类与生产供给分别取数：品类由同月agents_scm_demand_sales_f基地口径映射订单SKU；分类量由agents_scm_order_plan_exe_m正缺货源行复算。MES匹配不到不影响订单分类值。MES未覆盖SKU必须继续通过Cube inspect/query排程agents_prod_schedule_detail_d，并向知识库核验字段和单位。存在其他品类的MES记录不能把排程标为not_applicable。模型不可用记录query_failed及错误证据，保留订单数值，不写已查无数据。历史直连排程仅作追查线索，不能替代本次MCP结果。
