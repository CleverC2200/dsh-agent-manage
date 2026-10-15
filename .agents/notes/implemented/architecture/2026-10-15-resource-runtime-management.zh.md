# Agent Note: 资源运行管理集中持有操作与挂载

Status: implemented

## Problem

Catalog 保存运行时配置和状态，插件入口另行排队挂载、监听凭据，并用双向回调接线。后端选择与 OAuth 重新授权依赖调用方记住应重建哪个注册表。

## Decision

`Catalog.runtime` 提供 `RuntimeManagement` interface，集中处理 MCP/LSP 配置、脱敏、状态、后端选择、重新授权、对账与释放。路由与项目 MCP 挂载直接使用该 interface；Catalog 不再转发这些操作或暴露运行时 setter。

Catalog 继续持有发现、源获取、安装状态、一致快照与共享变更队列。运行时写入进入该队列，验证并持久化配置，使 Catalog 快照失效，等待既有资源刷新，再协调挂载，最后发布 Catalog 监听事件。`Catalog.changePanelResources` 保持既有流水线。运行管理消费 Catalog 选出的套件，不解析磁盘格式或另存安装状态。

宿主装配一次提供设置、凭据删除和工具观察的惰性 adapter。凭据突发通知共享当前挂载执行和一次新快照补跑。释放先停止凭据事件及定时器，让四类真实 surface adapter 各自等待在途操作再释放，本地清理不等待 MCP。`RuntimeReconciler` 保留各表面的排队和失败隔离；MCP、LSP、命令和 Hook adapter 保留不同的宿主合同。

MCP 指纹包含所选后端，因此即使配置未变，后端切换也会重建连接；不支持的传输由实际后端 adapter 报告。OAuth 强制重建在旧挂载释放失败后保留待办，显式重试先清理再重建所属挂载。OAuth 记录寻址仍使用共享 `mcpAuthRecordKey`，凭据格式和已有记录不变。

GEA Schema 发布使用 GEA 自有的身份信号。同身份资源刷新先准备发现结果再替换当前 Schema，身份变化则先退役旧代际。刷新监听器向 Core 串行 `agent/created` 事件返回队列。对于已开始的组装，公开工具 provider 捕获其发布版本；`system-prompt/assemble` waterfall 等待就绪，只在版本改变时让 Core 重新组装。作用域、PTC 模式与工具顺序仍由 Core 持有。组装取消后不等待忽略取消的发现 provider。

## Alternatives considered

**保留 Catalog 操作转发与 setter 回调。** 这会继续保留额外 interface，并让入口重复组装顺序规则。本次迁移全部现有调用方到 `Catalog.runtime`。

**引入垂直 feature module。** 发现、已安装资源与运行时快照仍共用 Catalog 数据源。按 [ADR-0001](../../../../docs/adr/0001-catalog-centered-modular-refactor.md)，维持一个包和 Catalog 中心，在 `application` 内组织运行管理。

**只在 `agent/pre-step` 等待。** Core 在此钩子之前已捕获工具 Schema，因此等待后仍会发送旧的首轮组装。发布版本检查使用更早的公开组装合同。

## Consequences

运行时配置、状态、凭据事件和挂载生命周期共用一个 owner。宿主服务保持惰性读取，以适配 Cordis 在 Manage 启动后才提供服务的顺序。已有用户配置、源检出、运行时归属与失败释放句柄保留。

本次扩展[运行时调度](2026-09-08-runtime-reconciliation-scheduling.zh.md)；其各表面并行决定与[已安装资源](2026-10-14-installed-panel-resources.zh.md)规则继续有效。GEA 服务须在现行 v2 合同中投影既有 `identitySignal()`，不暴露凭据或增加身份 owner。

行为测试经公开运行时 interface 覆盖 HTTP OAuth 重新授权及精确挂载归属、配置脱敏、后端重挂、清理重试、慢启动期间凭据通知与释放顺序。这些结果证明选定 SDK 下的本地源码行为，不证明已安装 Native、真实模型、业务、CI 或发布验收。

[English](2026-10-15-resource-runtime-management.md)

个人 Agent 的 MCP 关联由 `UserAgents` 旁的 `AgentMcp` 管理，保存共享连接身份和每 Agent 关联，配置、凭据和连接生命周期仍归 `Catalog.runtime`。源导入的 Host 目录单独保存，不进入可编辑服务 JSON；校验和挂载时沿用该目录，HTTP 请求不能自填目录或声明插件身份。

经认证的 Agent 路由供内联编辑和关联操作共用。工具 schema 和 dispatch 同时按 Core `composedPreset` 与当前关联收窄，已运行 Session 也立即受新开关约束，未知个人 MCP 命名空间拒绝使用。移除关联保留共享定义。插件 MCP 的直接编辑被拒，仍允许启停。连接状态读取既有 supervisor，成功发现零工具也视为已连接。受控本地 HTTP 验证覆盖初始化、工具发现、取消、真实 Session 作用域和重启；实际客户端与业务验收仍需单独留证。
