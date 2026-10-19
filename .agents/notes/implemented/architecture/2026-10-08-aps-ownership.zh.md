# Agent Note: APS计算与分析归属

Status: implemented

## Problem

原APS候选把业务计算放在Workbench，并在GEA保存分析Skill。直接接收会继续维持重复归属。

## Decision

Manage通过`aps-compute/*`公开导出维护原纯计算，原分析Skill在`business-resources/aps-analysis`只有一份来源。Workbench消费该导出，呈现原PC页面并持有当前范围的界面状态。GEA持有身份与受控执行。选用时先校验capability的显式Skill、Consumer引用与所属prompt一致，再挂载。引用不授予业务权限。

## Alternatives considered

**整树恢复旧候选。** 这会覆盖当前46接口并保留过时归属，因此只取固定来源中必要源码。

**计算与Skill仍由旧owner保存。** 同一规则会继续有多个维护者。页面改用公开Manage模块，GEA删除重复分析provider。

## Consequences

计算与维度模块继续由Manage维护。原50个字面预期用例正文不变，并消费公开导出。`production-output`通过`metrics`接收显式`MES_QUANTITY`合同：同期间计划和实绩先求和后相除，重复或不完整事实不出达成率，覆盖范围仅为MES已返回产线。旧未来排程仍不产生达成率。Workbench负责配置查询与工厂名称归一化，两者都不授予权限。类型标注及原未用变量按当前Manage标准调整。模拟接收必须显式编译，未装载SQL能力并保留缺失值。实际Native与业务授权属于后续独立验收。17历史note仍保留在固定来源证据中。

`classified-stock` 只提供已明确分类库存分组的展示合计及已匹配、归属未确认分组数，不改变健康判断、比率及对比所使用的严格范围计算。Workbench 对部分观察量明确标注并禁用其对比；实时下钻层级由已返回的维度生成，不沿用演示品类字典。

页面简报在起止日不同时，将日发货源的累计量标为“期间发货量”；单日仍显示“日发货量”。内部指标键与数量计算不变。

`stockCoverageObservation` 只接收 SQL 在基地×SKU 匹配后、品类汇总前生成的可选聚合，返回数量、需求、覆盖数及天数供页面观察。聚合不完整、来源失败或分母为零时保持未知；完整范围指标、健康判断及跨期比较保持原口径。
