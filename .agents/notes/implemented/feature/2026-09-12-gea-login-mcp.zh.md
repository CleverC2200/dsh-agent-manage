# Agent Note: 通过登录所有者发现 GEA MCP

Status: implemented

## Problem

市场插件无法仅凭传输 URL 发现获授权的 GEA 工具。GEA 登录封装在独立插件的进程内，MCP 传输会话不具备业务授权能力。

## Decision

GEA Host 继续独占登录、凭据与 Consumer 权威。当前 v2 发现与执行合同见 [GEA Cube-New MCP](../../../../docs/guides/gea-mcp.zh.md)；[原生业务资源](2026-10-04-selected-business-resources.zh.md#可信-cube-引用)持有个人 Agent 的可信引用规则。

Manage 发布服务端 schema 与受限工具；GEA 从实际 Core Session 的已启用业务来源或可信 Cube 引用反查 Consumer。个人配置不能指定 Consumer、网关或登录 Token。个人引用沿同一 Consumer 发布 Cube inspect/query 及[知识目录/问答工具](2026-10-15-gea-knowledge-tools.zh.md)，仍受服务端授权、身份/来源撤销和子 Agent 工具过滤交集约束。早期可选 v1 transport 服务与单一 `gea-readonly` 配置已退出。

退出、环境切换、过期和 owner 卸载中止旧调用并拒绝迟到结果；网关凭据不写入外部 MCP 配置。普通个人 Agent 配置不依赖 GEA。

发现能力是否可用与整个 Agent 是否可运行分别处理。上述 GEA MCP 指南持有就绪及新输入恢复合同；Manage 复用 Core 的输入通知、提示组装和工具注册，连接与 Consumer 权威仍归 GEA。

## Alternatives considered

**持久化 MCP URL 和登录凭证。** 网关需要业务会话元数据，持久化凭证也会脱离其所属登录生命周期，因此不采用。

**市场插件读取 GEA 登录内部状态。** 这会让仓库耦合到私有状态，并把系统凭证暴露给登录所有者之外的代码。采用受控 fetch 能力保留凭证归属。

**用官方 MCP 连接管理器替换受控桥。** 它的公开配置持有 URL 或 stdio 连接，不负责 GEA 的 Session 到 Consumer 执行合同。保留现有服务可避免迁移凭据或引入另一套连接及重试策略。

## Consequences

来源发现、原生发布、模型可见 schema 和真实业务成功分别留证。本 Note 保留登录归属理由，v2 与个人引用合同替代原 transport 和单预设方案。[原 ADR](../../../../docs/history/decision-snapshots/2026-09-12-gea-mcp-login-owner.md)保留早期输入。

## Runtime acceptance (2026-09-12)

真实实例最初加载的是已安装的旧市场包，而非本工作区。实例补丁停用旧入口并插入本地构建，热加载保留 GEA 登录。网关成功注册五个工具，并通过实际宿主工具运行时完成 2026 年 9 月只读查询。这验证了该实例，不代表 npm 发布。
