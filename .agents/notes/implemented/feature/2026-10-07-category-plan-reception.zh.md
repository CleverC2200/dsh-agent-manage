# Agent Note: 品类计划资源接收

Status: implemented

## Problem

当前品类原型保留了作者 UI，但缺少原已声明的 Agent 资源。

## Decision

Manage 保留原 `category-plan` Prompt、Skill 和空 MCP 声明。Workbench 将它们组装进现有静态品类包，保留原包、页面及 Consumer 标识。本决定补充[业务资源归属](../architecture/2026-10-01-business-resource-ownership.zh.md)，不取代现有归属决定。

## Alternatives considered

**恢复旧页面桥及 conversation preset。** 当前页面 owner 和官方 Core Session 已承担这些职责。恢复旧路径会重复接线。

**保留旧刷新重置文案。** 当前 UI 已恢复未发文字和视图意图。Skill 按当前行为说明，并区分临时模拟任务与持久业务动作。

## Consequences

作者状态通过现有通道提供模拟 context 和可见元素。UI 意图归真实 Session。选用资源不发送模型请求，模拟数据仍不进入真实业务执行。源码合同和 iframe 检查不证明 Native grant 验收。
