# Agent Note: GEA 受控 MCP 桥接入知识工具

Status: implemented

## Problem

原 GEA 桥仅发布 Cube 方法。用户需要按授权发现知识库并问答，同时沿用唯一身份并淘汰旧库回退。

## Decision

Manage 沿现有 GEA MCP 服务，在 Cube 工具之外发布 weknora_list_knowledge_bases 与 weknora_ask 的服务端 Schema。GEA 从实际 Core Session 选择 Consumer，负责凭据、来源校验、答案校验与取消。Manage 保留既有登录发布、preset 范围和串行释放行为。

[知识执行合同](../../../../../dsh-gea-plugin/docs/knowledge-mcp.md)持有知识参数、结果和失败规则。本决定扩展桥的工具合同，不替代选中资源身份与 MCP 资源读取决定。

## Alternatives considered

**独立知识 MCP 连接。** 它会重复登录工具发布和凭据生命周期。现有桥已提供注册及实际调用 Session 接口。

**固定知识库的包装工具。** 它会保留过期目录并隐藏人员与 Consumer 授权。保留两个服务端工具可动态发现目录并使用原始 Schema。

## Consequences

知识与 Cube 共用注册，GEA 分别处理两者结果。仅使用知识的 Agent 无需 Cube 来源。业务 Session 选择、迟到调用拒绝和退出释放仍为必要条件。源码与夹具验证不证明真实授权、知识迁移、安装或业务验收。
