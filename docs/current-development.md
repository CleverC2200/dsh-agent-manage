# Current Manage development / Manage 当前开发

This checkout implements Agent/resource management and supplied-input calculations. Business pages belong to Workbench; Session and drafts belong to Core; business identity, credentials and authorization belong to GEA Host. / 本仓维护 Agent/资源管理与输入数据的纯计算。业务页面归 Workbench，Session 与草稿归 Core，业务身份、凭据与授权归 GEA Host。

## Input and checks / 输入与检查

From the isolated project root, read `docs/agents/current-development.md` and its registered frozen integration input before editing. The root historical clones are not current development targets. Candidate verification reports source inputs, not installed runtime or business acceptance. / 修改前从隔离项目根读取 `docs/agents/current-development.md` 及其冻结整合输入；根同名历史克隆不是当前目标。候选核验只报告源码输入，不证明运行装载或业务验收。

The package manager, engines, commands and exports are declared in [package.json](../package.json). The [lock](../pnpm-lock.yaml), [workspace build permissions](../pnpm-workspace.yaml) and [official type paths](../tsconfig.official-paths.json) own reproducible inputs. Before frozen installation, prepare the registered official SDK at the relative paths declared there. Installation alone does not create those SDK outputs. / 工具链、命令与导出由 package 声明，锁、workspace 构建许可和官方类型路径负责可复现输入。冻结安装前准备声明路径中的固定官方 SDK；安装本仓不等于 SDK 已生成。

Use `corepack pnpm install --frozen-lockfile --ignore-scripts` after validating the input. This avoids the package's implicit prepare build; explicit checks/build run only when their inputs are ready. `prepare` and `prepack` keep the existing installation/package behavior. / 核输入后冻结安装并关闭隐式脚本，输入就绪后显式检查和构建；既有 prepare/prepack 的安装与打包行为保持。

Set `DSH_WORKBENCH_CHECKOUT` to the registered Workbench checkout when it is not the sibling directory; the wrapper only invokes its shared developer CLI. / Workbench 不在同级时，DSH_WORKBENCH_CHECKOUT 指定已登记 checkout；本仓 wrapper 只调用共享开发期 CLI。

Use `corepack pnpm run check:knowledge` for current local references, documented scripts and public exports. Use the applicable `check:architecture`, `test:contract` and behavior tests for changes; `check:refactor` remains the standing aggregate. / 当前本地引用、文档命令与公开导出由 check:knowledge 核验；架构、契约与行为使用相应入口，check:refactor 保留综合门禁。

The [dual official Core decision](../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.md) and [中文](../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.zh.md) own the exact rc.2/alpha.1 runtime peers and `DSH_CORE_CHECKOUT` capability matrix. The development SDK remains the registered alpha.1 input. / 两版官方 Core 决定持有精确运行 peer 和能力验证矩阵，开发 SDK 继续使用已登记的 alpha.1。

## Current ownership / 当前决定归属

- [Selected native resources](../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.md) and [中文](../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.zh.md) own one official Skill/preset publication interface, explicit cwd and selected-identity recovery. / 统一原生资源发布、明确 cwd 和选中身份恢复。
- [Cleanup metadata](../.agents/notes/implemented/architecture/2026-10-01-business-resource-ownership.md) and [中文](../.agents/notes/implemented/architecture/2026-10-01-business-resource-ownership.zh.md), extended by [async result ownership](../.agents/notes/implemented/bug-fix/2026-10-09-async-result-ownership.md) and [中文](../.agents/notes/implemented/bug-fix/2026-10-09-async-result-ownership.zh.md), preserve parsed metadata, failed-release handles, cache generations and panel-kind lifetimes. / 元数据、失败释放、缓存代际和 kind 有效期。
- [Official entry](../.agents/notes/implemented/architecture/2026-10-04-official-workbench-entry.md) and [中文](../.agents/notes/implemented/architecture/2026-10-04-official-workbench-entry.zh.md) own public main discovery and style lifetime; [current settings](../.agents/notes/implemented/simplification/2026-09-30-current-settings-surface-only.md) and [中文](../.agents/notes/implemented/simplification/2026-09-30-current-settings-surface-only.zh.md) remove the older DOM page path. / 官方 main 入口、样式寿命和唯一现行设置接口。
- [One official SDK](../.agents/notes/implemented/process/2026-10-04-one-official-sdk.md) and [中文](../.agents/notes/implemented/process/2026-10-04-one-official-sdk.zh.md) own the fixed input; [UI baseline rationale](../.agents/notes/implemented/process/2026-09-29-source-core-ui-baseline.md) and [中文](../.agents/notes/implemented/process/2026-09-29-source-core-ui-baseline.zh.md) retain icon and React dedupe reasons. / 固定官方输入，保留图标与 React 去重理由。
- [Durable roles](../.agents/notes/implemented/architecture/2026-09-09-subagent-catalog.md) and [中文](../.agents/notes/implemented/architecture/2026-09-09-subagent-catalog.zh.md), [project layout](../.agents/notes/implemented/architecture/2026-09-09-layout-registry.md) and [中文](../.agents/notes/implemented/architecture/2026-09-09-layout-registry.zh.md) own role policy, project scope and supported dialects. / 持久角色、项目作用域及支持格式。
- [Inventory contract](design/inventory-compute.md) and [中文](design/inventory-compute.zh.md), [APS ownership](../.agents/notes/implemented/architecture/2026-10-08-aps-ownership.md) and [中文](../.agents/notes/implemented/architecture/2026-10-08-aps-ownership.zh.md) describe public `dsh-agent-manage/inventory-compute/*` and `dsh-agent-manage/aps-compute/*` exports. / 公开纯计算的输入与结果合同。

[MCP resource reading](../.agents/notes/implemented/bug-fix/2026-09-14-mcp-resource-reader.md) and [中文](../.agents/notes/implemented/bug-fix/2026-09-14-mcp-resource-reader.zh.md) preserve same-connection URI reading, cancellation and explicit binary results. / MCP 资源读取保持同连接 URI、取消与明确的二进制结果。

## Reference and history / 参考与历史

[CONTRIBUTING](../CONTRIBUTING.md) covers contributions; [Agent Notes](../.agents/notes/README.md) define current ownership, bilingual pairs and partial supersession. Browse lifecycle/class folders when a decision is relevant. Proposed notes can describe partly implemented work and are not acceptance receipts. / 贡献和 Note 生命周期各归原入口；按相关决定浏览目录，proposed 可包含部分实现，不是验收回执。

[The current knowledge decision](../.agents/notes/implemented/process/2026-10-09-current-agent-knowledge.md) and [中文](../.agents/notes/implemented/process/2026-10-09-current-agent-knowledge.zh.md) own this navigation and checker invocation. / 当前知识决定持有导航与检查调用。

Historical design/research/promotion/release and upstream-proposal documents retain their original reasons, samples and failed observations. Their dates, old host assumptions and release plans are not current configuration or authorization. [The old engineering plan](design/engineering-refactor-plan.md) is historical background, not the current module map. Archived Notes remain frozen; do not repair their outgoing links. / 历史材料保留理由、样本与失败，旧宿主假设和发行计划不作为当前配置或授权。旧工程计划只是背景，归档 Note 原件冻结。

Current tgz delivery, user storage and official persisted Sessions remain unchanged. Local source, offline tests, remote CI, Windows archive execution and real Native/business/model acceptance require separate evidence. / 当前 tgz、用户存储和官方 Session 协议保持；源码、离线、CI、Windows 与真实运行分别留证。
