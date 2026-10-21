# Agent Note: 订单履约受控读取

Status: implemented

## Problem

已接收履约资源仅解释模拟数据。用户提供完整提示词、七个 Skill，指定 Consumer 为 order01，并要求按在线履约规格接入不同权限的数据面板。

## Decision

Manage 保留原提示词字节、Skill 业务规则与语义参考，记录原始和包内摘要。运行 profile 与安装说明声明 order01 受控只读及当前缺失指标。页面、profile、capability、MCP 保持一致；GEA Host 继续唯一持有业务身份、凭据和委托。Workbench 使用既有包旁命名查询配置和所属页面 SQL 通道；Gateway 强制当前用户行列授权。不增加前端角色授权表、其他 Consumer 回退、数据库直连或业务写入路径。

本决定仅就当前履约执行部分替代[已接收模拟业务资源](2026-10-07-received-mock-business-resources.zh.md)。原决定继续持有冻结模拟基线、其他原型和共享装配。[已选原生业务资源](2026-10-04-selected-business-resources.zh.md)继续持有发现、选用和生命周期，本次不改这些机制。

Workbench 的 `docs/order-fulfillment-data.md` 维护实现和逐字段缺口。来源订单、可关联追踪和库存分别说明，不虚构完整履约账本。缺有效执行单映射、需求排除、应交付分母、源快照或分配依据时正式指标保持未知；重复源键数量不盲目累加。默认本日按上海时间计算，明确使用源创建时间筛选，因为缺少要求的期望交付时间。飞书与 OMS/WMS/TMS 自动化仍未接入。

## Alternatives considered

**把数据库账户当用户授权。** 它只能证明源数据可读，不能代替 order01 Gateway 授权。

**根据前端角色标签选择全量数据集。** 这会产生第二授权权威，可能暴露未授权行列。

**从原型补缺或推测正式指标。** 这会掩盖源字段和文档公式冲突。

## Consequences

源码检查验证资源、命名查询、权限元数据和取消；源 SQL 回放不证明 Gateway 资源发布、真实用户授权、官方 Loader 接收或业务验收。已有 Session 与草稿仍归 Core；Consumer 变化不改持久会话，也不授予跨 Consumer 权限。本地实现不包含远端写入或客户端安装变更。
