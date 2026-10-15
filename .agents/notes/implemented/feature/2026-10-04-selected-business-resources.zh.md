# Agent Note: 已选原生业务资源

Status: implemented

## Problem

持久 Session 在重启后保留预设身份，而包资源定义只有进程内有效期。文件系统副本与回退 persona 会分散资源归属。

## Decision

用户原销售主提示词与问数 Skill 作为独立 Catalog 配置源随包保存在 `business-resources/sales-plan`。启动只发现来源，不导入、启用或绑定个人 Agent；显式导入复用 Agent 卡片和 Skill 引用。完整提示词超过套件 systemPrompt 的字节限制，因此使用既有 Agent 卡片，不截断原文或提高限额。正文仅修正个人可信 Cube 身份合同，Cube 查询参考原样保留。源基线和个人修改分开保存，原 `gea-readonly` profile 及四个预测 Skill 保持。[来源记录](../../../../business-resources/sales-plan/README.md)列明已有与缺失资产。真实 Core 首轮用例只替换外部 Gateway 响应；客户端装载、模型与真实业务验收分别留证。

Manage 持有唯一的资源interface与已启用包资源的官方Skill Provider。Catalog继续持有Suite源、安装与启用事实。当前包在自己的effect下登记私有文件引用；浏览器选用稳定资源标识并传入原生工作区绝对路径上下文，不传资源文件路径或Consumer覆盖。目录只返回轻量摘要；Prompt 正文在选用时或已启用包 owner 明确启用 `publishPreset` 时装载，Skill 正文仍在选用时装载。原文件与用户草稿不覆盖。

Skill 和 Prompt 选用均确认官方 Registry resolve 未返回 broken 后才提交选中身份。Skill 激活失败沿现有预设释放句柄回滚，已保留的挂载也重新核对可用性；释放失败保留句柄供显式重试。恢复已选 Skill 时，broken 预设使 load 拒绝，原恢复索引保持不变。

所选persona通过官方preset registry发布。持久Session保留preset标识；Manage只持久化已选标识，并在owner登记时恢复定义。页面释放不撤销持久Session需要的定义；owner退出释放自己的进程内声明，恢复索引保留。未安装或已禁用资源明确失败，不回退另一persona。

公开发现路由要求绝对路径cwd query，选用要求{id,cwd}。两者向现有资源/Skill interface传入同一个原生工作区；Workbench新Session也使用该工作区。缺失或相对路径以INVALID_AGENT_RESOURCE_WORKSPACE失败，不在运行时回退另一项目。请求大小边界、owner与取消保护保持。

本决定取代[2026-09-29业务资源归属](../architecture/2026-09-29-workbench-business-resources.zh.md)中的文件系统mount和兼容路径；包内路径约束、独立页面解释器选择与GEA受控执行归属仍保持。既有市场dialect的Skill根替换语义保留，业务包正文原文保真。

Manage 的现有 runtime 同时持有 `skill_reference_read` 与纯 §5.5 `forecast_compute` 能力。官方 Skill registry 是唯一目录与正文加载入口。参考读取核当前可由模型调用的 Skill、正文明确相对链接、宿主文件系统权限、UTF-8/大小/分页与调用者取消；owner 撤销或变化后不返回旧正文。计算沿同工作区核已安装启用的 `sinian-demand-baseline`，保持原十进制算法，并把输入 hash/版本及实际完整用户输入来源与业务授权分开报告。不新增 provider、备用目录、独立运行插件包或 Consumer 权威。

GEA 保留执行身份与真实业务数据/证据保护，其旧 Skill 正文/参考 loader、工具包/加载状态和纯计算在当前调用者接上 Manage 与官方 loader 后退出。原 Skill/persona 正文不改写。Manage 在 `business-resources/sinian-demand-forecast` 携带固定 `company-agent-suites/suites/sinian-demand-forecast` 完整快照，包括四个原销售 Skill、references、基线脚本与例子。既有包 Skill Provider 在默认启动时集中登记 APS 分析与销售 Skill，GEA 销售 profile 保留既有身份与授权。`SOURCE.json` 记录源提交、文件 hash 及源仓未声明独立许可证的事实。普通安装不依赖包外 Home 副本。离线检查覆盖不变的十四组参考算法、缺十进制数据、来源核对、参考可见性及 owner 撤销；真实安装及 Consumer/model 验收归同组运行。

资源摘要和选用结果返回已选 profile 验证过的页面解释器列表。Manage 每次读取都按当前资源 owner 过滤，owner 卸载后也不返回旧选项。工作台负责选择器和官方 Session 导航。GEA 继续负责预设与 Consumer 授权。已选资源身份的恢复索引保持原格式。

`forecast-source` 导出让 GEA 使用同一套纯输入与 baseline 校验。GEA 将已保存的计算证据绑定到当前执行、Session 和 subject。baseline 正文或可见性变化使旧证据失效。计算实现仍归 Manage。

稳定预设 `agent-resource-skill` 使用[标准组合接口](../../../../docs/design/standard-preset-composition.md)。插件声明来自当前官方 standard 文档，保留禁用项和用户配置。官方 Skill 发现与加载工具各保留一份；资源选择只返回 Skill 名称，不发布业务 profile。注册目录的描述说明这个用途。资源摘要投影各 Skill 原有描述，Workbench 在现有资源列表显示该投影。

真实 Core Session 测试核对最终工具、命令、自动与手动压缩、继续执行和选中身份恢复。预设集成入口经过实际 GEA hooks 并核对无业务 profile 的执行拒绝。独立客户端入口使用官方 InputHub，并通过独立 Host process 的回执提供所选资源和真实 Session；它的 wire adapter 提供公开 Session/工作区接口。测试覆盖空草稿、已有文字、取消、重进与旧草稿，不将 Host 编译库装入浏览器源码图。这些离线观察不证明 Native 安装或外部模型、业务执行。

业务 prompt 组合现遵循[业务标准能力](../architecture/2026-10-09-business-standard-capabilities.zh.md)。该决定持有完整 standard 声明、可信 Agent 元数据及通用能力与业务额度的分离。本记录继续持有资源选择、provider 生命周期与恢复规则。

完整 Manage 冷启动恢复在读取选中索引前等待既有 StandardPreset 初始化 fiber，只建立局部等待，不轮询、不回退预设，也不新增就绪权威。公开 app-boot 可能在资源 inject child 完成前返回，因此离线 fixture 等实际 `agentResources` 发布并核 Connection Fetch 路由。普通、模块 import gate 和干净首次启动保留选中预设、包内 Skill、最终工具/命令/压缩、工作区与旧持久 Session；真实模块失败时资源保持不可用，并保留启动诊断。

## Alternatives considered

[业务资源决定](../architecture/2026-09-29-workbench-business-resources.zh.md#alternatives-considered)保留第二目录与任意外部路径被否决的理由。其文件挂载被官方发布替代；包归属与 Consumer 分离继续有效。

## Consequences

已选身份恢复定义，不改写 Session 数据或业务资源正文。缺少 owner 明确失败，释放失败可显式重试。Native 安装与真实业务、模型验收分别留证。包 owner 可声明 `publishPreset`，在安装/启用后发布已校验的业务预设，供官方列表发现。发布不改变当前 Session、用户默认或 selected-resources.json，也不授予 Consumer 权限；演示 owner 不启用该选项。无效 Prompt 保留资源诊断，健康 Prompt 继续发布，owner 卸载仍释放自己的声明。

## 个人完整 Agent 配置

完整个人 Agent 由 `UserAgents` 持有，与目录角色、已选择业务身份分别保存。统一配置发布 interface 串行写入 `user-agents.json`，校验外部输入，并通过 standard 组合将启用配置以稳定的 `user-agent-<id>` 身份注册。改名不改身份；持久保存与注册、resolve 分别处理。发布失败保留可编辑配置、诊断以及已有的最后可用声明。Host 启动恢复启用声明，Loader 激活完成后再核可用性。Core 的既有 generation 保留运行中 Session 的 revision。

主入口和设置共用 Agent 页，替换六 Tab 工作区入口。经认证的 Host Fetch 提供列表、保存、启停和选择；显式选择不修改默认或已有 Session。Workbench 的公开 `startAgent` 负责原生工作区和 Session 导航。每 Agent Skill 组合见下节，MCP 关联和来源同步分别沿 `AgentMcp` 与 `AgentSources` 接入。

## 个人 Agent 的 Skill 作用域

`UserAgents` 随 Agent 配置持久保存 Skill 引用和个人正文。引用保存获胜 provider 与可选源路径；来源缺失或改变时，发布与读取明确拒绝。个人定制保留原引用的资源目录，不写回受管源。`dsh-agent-manage/user-agent-skills` 在官方预设作用域内贡献配置，复用全局 provider 读取，允许选中且启用的引用，并将未选中或停用的全局 Skill 的两种调用策略设为停用。standard 声明及其原生作用域资源保留，Core 为已有 Session 保留旧 revision 作用域。

Skill 页通过已认证 Agent 配置路由读取目录、正文及保存。取消只丢弃本地编辑；保存失败保留表单。卸载时取消读取并忽略迟到结果。生产 Core Session 测试覆盖来源选择、作用域目录与工具实际调用，不证明已安装客户端或外部模型验收。

## 个人 Agent 停用、删除与恢复

停用从 Core 选择目录撤下预设，不改变宿主默认、Session 或草稿。删除在同一个人配置中写入 `deletedAt` 和 `enabled: false`，保留稳定 ID、提示词与依赖引用。删除记录在显式恢复前拒绝保存、能力编辑、启用与选择。恢复仅清除删除标记，配置仍停用。配置页直接提供恢复、依赖检查及返回列表另选 Agent 新建对话的入口。不可用的默认值单独提示，不修改宿主设置。

`UserAgents.watch` 在配置及生命周期提交后发出通知。能力消费者读取同一配置并 reconcile，不另建状态权威。写队列不等待监听器，监听器应安排异步读取且不抛错。这是配置生命周期，不拥有 Session 或业务授权。恢复后来源仍缺失时，发布与冷恢复继续拒绝，恢复操作不重建被撤销的授权。

固定官方 Core 能为运行中 Session 保留 revision，但没有独立的可选标记或持久历史 revision 注册。撤下后冷恢复会明确失败，直到用户显式恢复、启用保留配置并补齐依赖。此后恢复组合保留的当前配置，持久空白 Session 复用也核原 preset；不承诺编辑后重建过去的 revision。精确历史修订需要由 Core 提供持久 revision/可用性 interface，Manage 不增加 Session sidecar、不替换为 standard、不修改保护中的 Core。测试覆盖认证配置操作、真实 Core 持久化与重启，以及官方客户端草稿输入；实际客户端装载和外部模型验收分别处理。

## 导入 Agent 同步

`AgentSources` 在 Catalog 刷新受管 checkout 前读取旧上游 MCP 定义及用户生效覆盖，按提示词字段、Skill 名称和 MCP 服务键比较基线、个人配置与新来源。冲突支持保留本地、采用上游和经校验的手动结果；预览及取消不改变已提交 Agent。预览令牌只在 Host 内存中保留，重启或替换预览后失效；Agent revision 或 MCP 关联变化时拒绝迟到提交。来源无变化不新增 revision。

导入 Skill 引用持久保存选中正文，用户覆盖与旧 live preset 作用域不随 checkout 刷新而改正文。资源目录和参考资产仍是动态依赖，不快照整个来源树。来源 MCP 变更使用独立连接身份，原始 config 继续作为 Host 基线，个人修改沿既有 runtime override 保存。Agent 列表及来源元数据只保存引用，MCP 冲突预览经过脱敏。

`UserAgents.syncSource` 先解析声明、校验依赖，再注册并 resolve 稳定身份后持久保存。Core 没有原子替换操作，替换失败沿补偿恢复，不发布独立候选身份。发布或持久写失败恢复旧声明和原持久配置。声明释放失败保留句柄，补偿、重试或卸载时继续清理。旧 live Core revision 保留原来源连接；停用、删除 Agent 或明确移除来源仍撤销 schema 和 dispatch。默认选择、Session 和草稿继续归 Core。重启发布已提交的当前配置；精确历史 revision 冷恢复仍受上一节的 Core 合同限制。

## 可信 Cube 引用

仅 GEA Host 登记可将已安装的 BusinessResources 来源标记为 Cube 能力。`cubeSource` 直接读取当前可用性、Consumer 与 owner 撤销信号，不扫描 Skill 目录。前台目录只返回来源 ID、名称、启用意图与可用性。插件成员固定，只允许切换 Cube 启停。显式复制仅生成个人提示词正文及获准的 Skill、Cube 引用，不复制业务 profile、跨 Consumer 路由或页面动作。

个人配置最多持久保存一个 `{ sourceRef, enabled }` 引用。原生预设挂载隔离的 `userAgentCube` 声明，Core 公开 `serviceFor(actualAgent, ...)` 读取实际 Session 保留的 revision，子 Agent 继承相同声明。UserAgents 按当前启停、删除和引用状态撤销授权，沿已有生命周期 watch 通知。提示词或 Skill 更新保留旧会话引用；移除或停用立即中止旧授权，重新添加也不会恢复旧授权。

GEA 按当前身份反查来源 owner 与 Consumer。发现和调用在异步步骤前后复核相同归属，身份、关联或 owner 信号撤销在途调用；替换来源即使 Consumer 相同也拒绝旧结果。v2 bridge 保留服务端原始 schema 与首轮 publication 就绪等待；生命周期和来源变化立即刷新 schema mask。个人引用只授予两项 Cube 工具，子 Agent 继续受 Core 工具过滤交集约束，不注册业务 profile。源码及 Core 测试不证明实际客户端或真实业务验收。

## 已退役的配置入口

统一 Agent 编辑器替代[原工作区](2026-09-06-workspace-tabs-user-panels.zh.md)的六页签、市场安装交互、hash 导航及命令/LSP 编辑器，无调用方的客户端适配随之删除。Host HTTP 仅保留模型目录和 MCP 后端读取；Agent 变更通过认证配置路由。PanelResources 继续提供运行时读取，但直接调用更新或删除插件源也会被拒。个人修改归 Agent 配置所有者。

Catalog 获取、发现、缓存、锁、导入/同步及安装状态保留。MCP 传输、凭据/OAuth、命令/LSP/Hook/项目运行、子 Agent、原业务资产、原生 standard 组合，以及 Core Session、草稿与历史归属均保留。退休查询 fixture 与日期失败证据保持原件。

旧插件 MCP 连接补丁保留原覆盖文件。运行时仅应用启停，使用插件声明的连接输入，并以 `PLUGIN_MCP_OVERRIDE_RETIRED` 标明保留路径。需要定制时显式创建个人 Agent 连接；启动不改写或删除旧补丁。个人 Agent 的 MCP 定义仍可完整校验编辑。

| 旧覆盖                               | 当前行为覆盖                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 市场安装/取消和旧页签                | `user-agent-workspace.test.ts`、`agent-source-panel.test.ts`：内联取消、显式导入、三页签                                     |
| 受管源直接写入                       | `panel-resources.test.ts`、`user-agent-skills-client.test.ts`、`user-agent-skills.test.ts`：源不变与个人修改                 |
| 全局 MCP 详情/授权 HTTP 操作         | `agent-mcp.test.ts`、`agent-mcp-transports.test.ts`、`runtime-management.test.ts`：关联、真实传输、OAuth 取消/重试与归属释放 |
| 通用路由与旧可写策略                 | `routes.test.ts`、`mcp-overrides.test.ts`：旧路径未注册，旧补丁不生效且可诊断                                                |
| 市场卡片/筛选计数/网格状态及详情适配 | 随退役组件删除，已无对应产品操作                                                                                             |
