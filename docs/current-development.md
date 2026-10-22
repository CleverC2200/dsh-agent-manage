# Current Manage development / Manage 当前开发

本地轻预检、影响计划、依赖准备、容量准入、构建复用与收尾使用相邻 GEA 的 [开发构建入口](../../dsh-gea-plugin/docs/development-builds.md)及本仓原生环境。 / Local preflight, impact plans, dependency preparation, capacity admission, build reuse and finish reports use the sibling GEA [development entry](../../dsh-gea-plugin/docs/development-builds.md) and this repository’s native environment.

This checkout implements Agent/resource management and supplied-input calculations. Business pages belong to Workbench; Session and drafts belong to Core; business identity, credentials and authorization belong to GEA Host. / 本仓维护 Agent/资源管理与输入数据的纯计算。业务页面归 Workbench，Session 与草稿归 Core，业务身份、凭据与授权归 GEA Host。

## Input and checks / 输入与检查

From the isolated project root, read `docs/agents/current-development.md` and its registered frozen integration input before editing. The root historical clones are not current development targets. Candidate verification reports source inputs, not installed runtime or business acceptance. / 修改前从隔离项目根读取 `docs/agents/current-development.md` 及其冻结整合输入；根同名历史克隆不是当前目标。候选核验只报告源码输入，不证明运行装载或业务验收。

The package manager, engines, commands and exports are declared in [package.json](../package.json). The [lock](../pnpm-lock.yaml), [workspace build permissions](../pnpm-workspace.yaml) and [official type paths](../tsconfig.official-paths.json) own reproducible inputs. Before frozen installation, prepare the registered official SDK at the relative paths declared there. Installation alone does not create those SDK outputs. / 工具链、命令与导出由 package 声明，锁、workspace 构建许可和官方类型路径负责可复现输入。冻结安装前准备声明路径中的固定官方 SDK；安装本仓不等于 SDK 已生成。

Use `corepack pnpm install --frozen-lockfile --ignore-scripts` after validating the input. This avoids the package's implicit prepare build; explicit checks/build run only when their inputs are ready. `prepare` and `prepack` keep the existing installation/package behavior. / 核输入后冻结安装并关闭隐式脚本，输入就绪后显式检查和构建；既有 prepare/prepack 的安装与打包行为保持。

Set `DSH_WORKBENCH_CHECKOUT` to the registered Workbench checkout when it is not the sibling directory; the wrapper only invokes its shared developer CLI. / Workbench 不在同级时，DSH_WORKBENCH_CHECKOUT 指定已登记 checkout；本仓 wrapper 只调用共享开发期 CLI。

Use `corepack pnpm run check:knowledge` for current local references, documented scripts and public exports. Use the applicable `check:architecture`, `test:contract` and behavior tests for changes; `check:refactor` remains the standing aggregate. / 当前本地引用、文档命令与公开导出由 check:knowledge 核验；架构、契约与行为使用相应入口，check:refactor 保留综合门禁。

The [dual official Core decision](../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.md) and [中文](../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.zh.md) own the exact rc.2/alpha.1 runtime peers and `DSH_CORE_CHECKOUT` capability matrix. [Clean CI](clean-ci.md) prepares the selected registered SDK before consumer installation; CI binds its Core head explicitly and runs both registered baselines. / [干净 CI](clean-ci.md) 在消费者安装前准备所选登记 SDK，CI 显式绑定 Core head 并分别运行两版基线。

## Current ownership / 当前决定归属

- [Order fulfillment governed read](../.agents/notes/implemented/feature/2026-10-21-order-fulfillment-governed-read.md) and [中文](../.agents/notes/implemented/feature/2026-10-21-order-fulfillment-governed-read.zh.md) own the order01 declarations, source gaps and Gateway authorization boundary. / order01 声明、字段缺口与网关授权边界归该决定。

- [Customer inventory governed read](../.agents/notes/implemented/feature/2026-10-19-customer-inventory-governed-read.md) and [中文](../.agents/notes/implemented/feature/2026-10-19-customer-inventory-governed-read.zh.md) own the current customer snapshot table, governed SQL path, derivations and unknown-field boundary. / 客户库存最新快照表、受控SQL链路、派生口径与未知字段边界归该决定。

- [Resource runtime management](../.agents/notes/implemented/architecture/2026-10-15-resource-runtime-management.md) and [中文](../.agents/notes/implemented/architecture/2026-10-15-resource-runtime-management.zh.md) own runtime configuration, status, credential events, backend remounts and ordered release behind `Catalog.runtime`. / 运行配置、状态、凭据事件、后端重挂与释放顺序归 `Catalog.runtime`。

- [Installed panel resources](../.agents/notes/implemented/architecture/2026-10-14-installed-panel-resources.md) and [中文](../.agents/notes/implemented/architecture/2026-10-14-installed-panel-resources.zh.md) own source-limited reads and serialized personal-resource writes with runtime notification; plugin sources are read-only. / 已安装资源按需读取，个人资源统一写入并通知运行时；插件源只读。

- [Selected native resources](../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.md) and [中文](../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.zh.md) own one official Skill/preset publication interface, explicit cwd and selected-identity recovery. / 统一原生资源发布、明确 cwd 和选中身份恢复。
- [Cleanup metadata](../.agents/notes/implemented/architecture/2026-10-01-business-resource-ownership.md) and [中文](../.agents/notes/implemented/architecture/2026-10-01-business-resource-ownership.zh.md), extended by [async result ownership](../.agents/notes/implemented/bug-fix/2026-10-09-async-result-ownership.md) and [中文](../.agents/notes/implemented/bug-fix/2026-10-09-async-result-ownership.zh.md), preserve parsed metadata, failed-release handles, cache generations and panel-kind lifetimes. / 元数据、失败释放、缓存代际和 kind 有效期。
- [Official entry](../.agents/notes/implemented/architecture/2026-10-04-official-workbench-entry.md) and [中文](../.agents/notes/implemented/architecture/2026-10-04-official-workbench-entry.zh.md) own public main discovery and style lifetime; [current settings](../.agents/notes/implemented/simplification/2026-09-30-current-settings-surface-only.md) and [中文](../.agents/notes/implemented/simplification/2026-09-30-current-settings-surface-only.zh.md) remove the older DOM page path. / 官方 main 入口、样式寿命和唯一现行设置接口。
- [One official SDK](../.agents/notes/implemented/process/2026-10-04-one-official-sdk.md) and [中文](../.agents/notes/implemented/process/2026-10-04-one-official-sdk.zh.md) own the fixed input; [UI baseline rationale](../.agents/notes/implemented/process/2026-09-29-source-core-ui-baseline.md) and [中文](../.agents/notes/implemented/process/2026-09-29-source-core-ui-baseline.zh.md) retain icon and React dedupe reasons. / 固定官方输入，保留图标与 React 去重理由。
- [Durable roles](../.agents/notes/implemented/architecture/2026-09-09-subagent-catalog.md) and [中文](../.agents/notes/implemented/architecture/2026-09-09-subagent-catalog.zh.md), [project layout](../.agents/notes/implemented/architecture/2026-09-09-layout-registry.md) and [中文](../.agents/notes/implemented/architecture/2026-09-09-layout-registry.zh.md) own role policy, project scope and supported dialects. / 持久角色、项目作用域及支持格式。
- [Inventory contract](design/inventory-compute.md) and [中文](design/inventory-compute.zh.md), [APS ownership](../.agents/notes/implemented/architecture/2026-10-08-aps-ownership.md) and [中文](../.agents/notes/implemented/architecture/2026-10-08-aps-ownership.zh.md) describe public `dsh-agent-manage/inventory-compute/*` and `dsh-agent-manage/aps-compute/*` exports. / 公开纯计算的输入与结果合同。

[MCP resource reading](../.agents/notes/implemented/bug-fix/2026-09-14-mcp-resource-reader.md) and [中文](../.agents/notes/implemented/bug-fix/2026-09-14-mcp-resource-reader.zh.md) preserve same-connection URI reading, cancellation and explicit binary results. / MCP 资源读取保持同连接 URI、取消与明确的二进制结果。

- [GEA knowledge tools](../.agents/notes/implemented/feature/2026-10-15-gea-knowledge-tools.md) and [中文](../.agents/notes/implemented/feature/2026-10-15-gea-knowledge-tools.zh.md) extend the existing governed bridge to dynamic knowledge discovery and single-turn answers. GEA retains identity and result ownership. / 现有受控桥接入动态知识目录及单轮问答，身份和结果处理仍归 GEA。

## Reference and history / 参考与历史

[CONTRIBUTING](../CONTRIBUTING.md) covers contributions; the [engineering rules entry](standards/dsh-plugin-development-standard.md) routes to current owners and [original guidance](history/agent-guidance-before-20261010/README.md); [Agent Notes](../.agents/notes/README.md) define current ownership, bilingual pairs and partial supersession. Browse lifecycle/class folders when a decision is relevant. Proposed notes can describe partly implemented work and are not acceptance receipts. / [工程规则入口](standards/dsh-plugin-development-standard.md)指向现行 owner 与[原指引](history/agent-guidance-before-20261010/README.md)；贡献和 Note 生命周期各归原入口；按相关决定浏览目录，proposed 可包含部分实现，不是验收回执。

[The current knowledge decision](../.agents/notes/implemented/process/2026-10-09-current-agent-knowledge.md) and [中文](../.agents/notes/implemented/process/2026-10-09-current-agent-knowledge.zh.md) own this navigation and checker invocation. / 当前知识决定持有导航与检查调用。

Historical design/research/promotion/release and upstream-proposal documents retain their original reasons, samples and failed observations. Their dates, old host assumptions and release plans are not current configuration or authorization. [The old engineering plan](design/engineering-refactor-plan.md) is historical background, not the current module map. Archived Notes remain frozen; do not repair their outgoing links. / 历史材料保留理由、样本与失败，旧宿主假设和发行计划不作为当前配置或授权。旧工程计划只是背景，归档 Note 原件冻结。

Current tgz delivery, user storage and official persisted Sessions remain unchanged. Local source, offline tests, remote CI, Windows archive execution and real Native/business/model acceptance require separate evidence. / 当前 tgz、用户存储和官方 Session 协议保持；源码、离线、CI、Windows 与真实运行分别留证。

## Remaining acceptance and documentation scope / 未完成验收与文档范围

[Native resource selection](guides/native-resources.md) and [中文](guides/native-resources.zh.md) own the user and API contract. Package exports and source declarations show capabilities; they do not prove installed reception, current identity, row grants or production data. Dealer, Personal and company full-chain source have governed-read declarations; their original live/interface/data/Native acceptance remains open. The company full-chain proposed Note retains the missing raw-capture manifest boundary and customer/model gates. / 原生资源说明持有用户与 API 合同。导出与源码声明不证明安装接收、当前身份、行权限或正式数据。经销商、个人与公司全链源码已有受控读取声明，原真实接口、数据和 Native 条件仍未关闭；公司全链 proposed Note 保留原 raw capture 未进入旧 manifest 的缺口，以及客户与模型边界。

[Historical material](historical-material.md) classifies old design plans, release/research/promotion records and original ADR observations. They remain available for rationale and failed evidence; current actions follow the linked owner and task registration. / 历史导航分类旧设计计划、发行/研究/推广记录与原 ADR 观察，保留理由与失败证据，当前操作沿对应 owner 和本票登记。

The company full-chain `capability.json` routing summary still mentions customer inventory, while its rules, tables and `SOURCE.json` limit the current resource to company reads. Follow that explicit boundary; the business declaration needs a separate source correction. / 公司全链 capability.json 的路由摘要仍含客户库存，但 rules、tables 与 SOURCE.json 明确仅公司读取。按明确边界处理，业务声明须在后续源码任务校正。

The forecast [original ontology](../business-resources/sinian-demand-forecast/references/sales-ontology-v2.md) remains pending business review. Its [forecast conflict register](../business-resources/sinian-demand-forecast/references/rules-and-conflicts.md) and [input contract](../business-resources/sinian-demand-forecast/references/data-contract.md) preserve the month, candidate, seasonal and price gaps. They do not resolve every planning rule: section 1.7 warehouse subgroup counts differ from their listed members, section 3.14 leaves exact 33/103-day thresholds unclassified, and section 5.7 retains 70%/56% product-structure alternatives. Confirm the applicable source/master data and rule before using those branches; do not infer units, granted fields, live interfaces or execution authority from the ontology's system-routing descriptions.

预测原字典仍待业务审核；预测冲突表和输入合同保留月份、候选、节令与价格缺口，并未裁决全部计划规则。第1.7节仓库分组数量与列举成员不齐，第3.14节的33/103天边界未分类，第5.7节保留产品结构70%/56%两套口径。使用相关分支前确认适用来源、主数据与规则，不从字典系统路由推单位、获准字段、实时接口或执行授权。
