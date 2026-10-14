# Agent Note: 已选原生业务资源

Status: implemented

## Problem

持久 Session 在重启后保留预设身份，而包资源定义只有进程内有效期。文件系统副本与回退 persona 会分散资源归属。

## Decision

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
