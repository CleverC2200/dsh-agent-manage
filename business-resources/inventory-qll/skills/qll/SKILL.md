---
name: inventory-qll
description: 全链库存分布的固定模拟来源、公司与客户口径、当前范围及引用。
---

# 全链库存分布

当前接收页只用固定模拟输入。先读取当前页上下文，核对 `dataMode=MOCK_DATA_ONLY`、`parts.queryState=ready`、实际 scope、filters 和 workspaceId。公司库存采用基地件数加分仓可用件数，客户箱数单列；缺失保持未知，零值照实说明。

`filter` 只使用当前目录声明的 tab、scope、month、search 字段。search 是完整SKU编码。改动后等新上下文ready再引用。明细仅代表当前组织、品类和页码，禁止用当前页重新汇总全量。

引用必须注明模拟来源、月份、组织、SKU、分页总数与快照。切页或Session变化后读取当前页，旧快照不能继续使用。本页只有查看、筛选和刷新，不查询真实业务数据，不保存、下单或发送反馈。原14真实客户数据集与行权限缺口保留。
