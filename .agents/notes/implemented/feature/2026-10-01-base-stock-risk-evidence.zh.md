# Agent Note: 基地库存风险证据

Status: implemented

## Problem

迁入页面已计算库存、订单与货龄判断，但 Agent 只收到四舍五入的洞察文字，缺少精确数量、排名覆盖和业务快照。把风险计算写入提示词会产生第二个规则负责人。

## Decision

Workbench 用 `parts.inventoryInsight.evidence` 发布既有引擎的确定性结果，包含精确指标、前三对象、覆盖标志、缺失输入以及分别记录的目标、库存和订单来源。同一查询状态 effect 在当前范围加载、空结果或失败时撤销证据。Manage 的 inventory-aqkc Skill 读取这些结果与当前 SKU 筛选；身份和受控执行仍归 GEA。

本决定补充[业务资源归属](../architecture/2026-09-29-workbench-business-resources.zh.md)，不取代其装载和权限契约。

## Alternatives considered

**由提示词重算。** 会重复分类与排序逻辑，并可能补造授权结果没有返回的数值。

**只增加文字摘要。** 舍入后的文字不能证明精确数量，也不足以区分完整与不完整排名。

## Consequences

能力保持只读，不新增工具或 Consumer。低于目标、实际订单缺口、当前超龄存量和未来新增超龄分别解释。长 SKU 数组保留截断标志，分页不能代替完整引擎汇总。固定 Host 输入对照原分类和数值；mock 异常与真实 Page/Agent 证据分别验收。
