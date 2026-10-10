# Agent Note: 工作台业务能力资源

Status: implemented

## Problem

业务页面迁移后，提示词和 Skill 不应继续由数据接入插件维护，也不能形成第二套能力目录。

## Decision

Agent Manage 拥有 inventory-fc 与 inventory-aqkc 能力资源，公开 `business-resources` 导出通过 `BusinessResources` 发布已组装资源。页面与能力身份仍来自既有分离声明。`prompt.json` 的 `pageAgents` 列出可解读本页的已安装预设，包含页面自己的预设；它不授予跨 Consumer 查询权限。GEA 分别校验页面 Consumer、影响等级、所选预设、对应 Session 和网关 Consumer 授权。[原生资源选用](../feature/2026-10-04-selected-business-resources.zh.md)以 Manage 官方 Skill Provider 与预设发布替代旧文件挂载；本记录继续持有包归属和解释器/Consumer 分离。凭据和执行仍归 GEA。

## Alternatives considered

新建业务注册表会重复现有能力目录；把 `pageAgents` 当作 `crossConsumers` 会仅为提供另一种解读能力而扩大查询权限；任意外部路径会削弱资源包边界。因此文件引用在 realpath 后必须仍处于资源目录内，已退场的资源 manifest 明确拒绝，不添加适配。

## Consequences

工作台构建依赖同级 Agent Manage 资源。原生 Skill 发现与来源路径保留。[资源清理](2026-10-01-business-resource-ownership.zh.md)保留元数据与未确认的文件清理归属；[异步结果归属](../bug-fix/2026-10-09-async-result-ownership.zh.md)保留失败预设释放的重试句柄。分仓 Agent 与全链 Agent 可用各自 Session 解读同页，页面 SQL 仍使用原 Consumer。本地 fixture 验证不能证明真实业务授权；GEA MCP 登录归属 ADR 继续适用。
