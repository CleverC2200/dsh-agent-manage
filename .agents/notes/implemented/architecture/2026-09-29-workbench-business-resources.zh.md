# Agent Note: 工作台业务能力资源

Status: implemented

## Problem

业务页面迁移后，提示词和 Skill 不应继续由数据接入插件维护，也不能形成第二套能力目录。

## Decision

Agent Manage 拥有 inventory-fc 能力资源，并导出已组装工作台资源的运行时装载器。页面与能力身份仍来自既有分离声明。GEA 校验 Consumer 和影响等级后，调用装载器写入既有原生 Skill 根目录，并将提示词装入现有 profile 映射。凭据和执行仍归 GEA。

## Alternatives considered

新建业务注册表会重复现有能力目录；任意外部路径会削弱资源包边界。因此文件引用在 realpath 后必须仍处于资源目录内。旧包保留原兼容入口。

## Consequences

工作台构建依赖同级 Agent Manage 资源。原生 Skill 发现与来源路径保留。清理只在当前内容仍属于本次装载时恢复旧文件。本地 fixture 验证不能证明真实业务授权。已查阅活动说明，没有覆盖同一决策的旧说明；GEA MCP 登录归属 ADR 继续适用。
