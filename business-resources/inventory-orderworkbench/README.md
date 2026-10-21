# 订单履约 Agent Skills

本包包含 1 个问数编排 Skill、5 个订单履约业务分析 Skill、3 个订单工作台运营管理 Skill 和 1 个订单确认自动化 Skill，服务于订单履约页面的交付/销售、仓配、品项三个区域及订单工作台。

## Skill 清单

1. `fulfillment-query-orchestrator`：识别问题、补齐查询条件、路由到一个或多个业务 Skill，并汇总结果。
2. `order-fulfillment-risk`：订单状态、履约节点、超时/预警和订单级满足率。
3. `sku-inventory-shortage`：SKU/基地库存、缺货量、可发货天数及货龄。
4. `production-fulfillment-progress`：排产、生产进度及生产/调拨对订单需求的覆盖。
5. `warehouse-logistics-fulfillment`：基地、仓库、物流商、运单和仓配履约节点。
6. `sales-organization-analysis`：销售组织、省区/大区、渠道和客户的订单履约汇总。
7. `fulfillment-sales-confirmation-automation`：人工触发销售确认；未确认时每小时提醒，并在授权确认后更新 OMS、下发 WMS/TMS。
8. `operations-kpi-performance-analysis`：订单工作台六项核心指标的周/月达成、目标对比、环比同比及多维排名预警。
9. `operations-exception-root-cause`：经营异常的影响量化、证据归因、待验证假设与分级改善建议。
10. `improvement-action-closure`：短期改善与长期机制的责任、时限、证据、验收和升级闭环。

## 调用原则

- Agent 核心负责意图识别、查询计划和多 Skill 协调；业务计算由对应专业 Skill 负责。
- 用户问题涉及多个业务域时，编排 Skill 可并行调用多个 Skill，但最终统一统计范围、快照时间和口径后再回答。
- 订单号、客户、SKU、基地、销售组织、地区、渠道和时间范围是可组合筛选条件，不应被误当作互斥维度。
- 页面上的演示数据只用于原型展示。未连接真实数据源前，所有结果必须明确标成演示/模拟数据，不得伪装成实时事实。
- 自动化执行由人工触发，不监听新订单自动发起。每次提醒、订单变更和下发均基于当前订单版本并保留审计记录。
- 订单工作台遵循“指标达成 → 异常归因 → 改善闭环”的链路；根因、措施与关闭结论均应有可追溯证据。
