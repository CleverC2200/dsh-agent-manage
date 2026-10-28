# Agent Note: Business roles retain official standard capabilities

Status: implemented

## Problem

业务资源此前只发布 persona 和 Skill 工具。GEA 又把业务工具白名单用于所有工具、将通用工具计入业务额度，并在额度耗尽后隐藏全部工具。因此，即使业务授权有效，业务角色也缺少标准工具和压缩能力。

## Decision

Manage 使用 `composeStandardPreset` 发布所选业务提示词，将业务 persona 与声明的附加插件追加到活跃官方 standard 文档。保留标准 persona 配置、运行上下文、禁用表达式、命令和隔离压缩组。standard 已提供 Skill 工具，业务资源不重复注册。资源身份校验、选中标识恢复、取消与释放所有权沿用既有规则。

普通 Manage bundle 将官方 registry 的 `config.default` 设为 `auto-negotiation`。Core 用户 `selectedDefault` 保留优先级。移除 bundle 同时撤销该配置层；未保存用户选择时恢复 Core 的 `standard`，已保存的公司预设选择保持原值，由 Core 返回既有缺失预设诊断。此范围是官方 bundle 开关，不包括独立禁用底层 Host entry。不改写用户选择、既有 Session 或草稿。

智能编排预设声明 Consumer 为 `workbench` 的受管 Cube 来源。GEA 从实际 Core 预设解析该来源，智能编排继续使用通用预设组合，模型请求与网关 MCP 调用采用同一声明编码。来源可用性控制 Cube 与知识库 MCP 接入，原 persona、Skills 和标准通用能力沿用既有组合。服务端授权与本地来源就绪分别判断。

`BusinessResourceDefinition.presetName` 和 `description` 是可信、可选的 Agent 目录元数据。资源发现和官方预设目录显示相同内容。未显式提供时，采用可信执行 profile 的 label 与同一函数生成的描述。页面标题仍归 Workbench。

GEA 只限制未声明的 `gea_` 工具；执行守卫也会在模型 pre-step 之前检查业务工具声明。业务调用与证据额度只计 GEA 工具执行；Core 通用工具与可选插件继续遵循各自策略。结果与证据转换只作用于 GEA 和既有本地预测计算器，保留通用工具的官方结果。资源撤销仍可阻断整个业务 Session。Consumer 路由、身份代际、取消与业务 effect 限制继续归 GEA。

共用固定 Core 测试 Host 补上真实附件、存储、查询、connection、Session controller 和 schedule provider。因此当前启用的三十个标准工具全部可用，真实子 Agent 创建也能应用官方 schedule 禁止规则。此前二十五工具的测试 Host 未激活 schedule 与图片读取。

## Alternatives considered

**在 GEA 添加标准工具白名单。** 这会重复维护 Core 能力选择，随插件或用户设置变化而过期，因此没有采用。

**在 standard 之外再次注册 Skill 工具。** 官方作用域中已存在相同工具名，重复注册会失败或形成独立所有权，因此没有采用。

**删除所有业务校验以开放标准能力。** 执行时仍需校验资源状态、Consumer 路由和当前身份，因此没有采用。

## Consequences

基地库存角色保留稳定 Session 标识、原 Consumer 和跨 Consumer 声明，目录名为“基地库存Agent”；业务页面命名独立。测试通过真实官方 Session、压缩、文件系统、Plan 与子 Agent 接口执行，挂载实际 GEA Business 和工具 hooks。只有 completion 与外部网关使用可重复的本地 adapter。这是源码与离线证据，不代表用户运行采用或生产授权。

本决定更新[原生业务资源选用](../feature/2026-10-04-selected-business-resources.zh.md)中的组合细节。原 Note 仍持有资源生命周期、选中身份恢复和官方 Skill provider。

公开 Workbench 资源选择测试通过官方 InputHub 与独立的实际 Core/GEA Host 进程，所选结果驱动 Session preset 和请求工作区；原任务草稿与持久文本保持。

销售计划与产销协同保留 `gea-readonly` 和 `gea-html-inventory-apsplan`。GEA 将可信 Agent 名称与描述投影到 Manage，页面标题保持独立。产销 Consumer 仍为 `aps`，保留已声明的 `sales_forecast` 跨 Consumer 与三个包内 Skill。销售保留原在线只读工具、四个已声明的安装来源 Skill 与 `sales_forecast` Consumer。每类测试均覆盖实际 Session、压缩、越权拒绝及子 Agent 继承。既有可选销售 readonly validation 继续在 Host 执行链校验，许可在线读取成功，submit 与 approve 在传输前拒绝。目录元数据不会安装缺失 Skill 或启用隐藏页面。
