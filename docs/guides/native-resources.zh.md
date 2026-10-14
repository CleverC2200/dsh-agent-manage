# 原生资源选用与业务组合

[English](native-resources.md) | 中文

## 发现与选用

包 owner 可通过 `publishPreset` 为已启用的 Prompt 资源声明安装时发布。Manage 在 owner 登记时校验并发布原组合，使其在首次选用前出现在官方预设列表；不自动选用、不改变用户默认、不写恢复索引，也不授予 GEA 权限。禁用资源不发布；无效资源保留诊断，不阻止健康资源发布。owner 卸载释放声明，演示资源不启用该选项。

`GET /api/agent-manage/resources?cwd=...` 根据明确的原生工作区绝对路径返回提示词和可由用户调用的 Skill 轻量清单，安装启用事实沿用资源所属模块。`POST /api/agent-manage/resources/select` 仅接受 `{ "id": "...", "cwd": "/absolute/workspace" }`，经官方原生 preset/Skill 接口发布所选原资源。发现、正文选用和工作台新 Session 使用同一个当前原生工作区；尚无 Session 时使用明确配置的隔离工作区，Skill 只暂存 `/skill-name` 草稿，不自动请求模型。未安装 Skill 和 Consumer 业务授权分别报告。`selected-resources.json` 只保存已选标识以恢复必要声明，不保存资源正文或凭据。

Skill 选用在返回成功或保存选中身份前解析官方 `agent-resource-skill` 预设。broken 预设拒绝选用，沿现有释放句柄清理；释放失败保留句柄供显式重试。恢复已选 Skill 时，broken 预设使加载拒绝，不重写恢复索引。[选用决定](../../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.zh.md)持有该生命周期。

资源选用只接受同源POST JSON，流式计数不超过64KiB，在选用前拒绝超限正文并返回413，chunked同样受限。坏包内Skill元数据只诊断并跳过该项，健康资源继续可用，取消仍向调用者抛出。

Manage 提供 `skill_reference_read`，只读当前模型可见 Skill 正文明确链接的本地相对参考文件。沿宿主文件系统读权限与同一工作区/scope/取消信号，核 UTF-8、大小和行分页限制，并在返回前重新确认安装 owner。MCP 资源仍使用对应服务的 reader。

## 基地库存问题的入口

普通或自定义预设会话加载 `inventory-aqkc` Skill 后，可以解释库存规则，不能因此取得 `base-safety-stock` 业务身份。需要实际取数时，Workbench 的“使用基地库存 Agent 分析”入口选用已启用的基地库存资源并创建新 Core Session，复制原问题为新草稿，关联基地库存页面。用户默认预设、原会话和原草稿保留；页面连接完成后由用户发送。

Skill 区分规则说明、同会话页面分析和受控独立查询。页面失败与独立 MCP 来源分别说明；角色名称或子智能体提示词不改变实际父会话的身份。运行条件和权限由 GEA 继续校验。

## 引用读取与计算

纯 `forecast_compute` 能力沿调用者工作区核已安装启用的 `sinian-demand-baseline`。原 §5.5 精确十进制算法、缺数据分支、草案与无外写语义保持。结果携算法版本、完整输入 SHA-256 和是否来自实际用户消息的完整 JSON；这些来源事实不核验业务来源、不授予 Consumer 权限，模型声明 `data_mode` 不算来源证明。

Manage 验证已选用提示词的 `pageAgents` 后，在资源摘要和选用结果中返回可选的 `interpreters` 数组。数组只包含原声明允许、资源仍已注册启用且没有已记录加载错误的解释器。工作台据此选择官方 Session 的预设。GEA 继续检查实际预设和所需 Consumer 权限。

公开的 `dsh-agent-manage/forecast-source` 导出提供 `forecast_compute` 使用的算法版本、规范输入 hash、用户消息输入校验和当前 baseline 指纹。GEA 在现有身份与 Session 证据库中使用这些函数。Manage 保留十进制计算和来源校验，GEA 保留业务授权。

## 业务资源组合

以下描述本 checkout 的源码声明。实际装载、真实身份、授权、源行与模型行为须分别留证。资源选用与页面可见不授予业务写入。

客户库存、订单工作台与订单履约资源保存在 `business-resources/inventory-customer`、`inventory-orderworkbench` 和 `inventory-orderfulfillment`。原Prompt与Skill只解释模拟数据。Workbench把资源组装进原页面包，选用后关联官方Core Session，不发送模型请求。MCP能力声明为空，GEA拒绝业务SQL读取。

已有区域原型使用 `business-resources/plan-regional` 中的原 `plan-regional` 资源。Workbench将其组装到当前 `gea-regional-plan` 页面；Manage通过原生资源选用发布原Prompt与Skill。MCP能力列表为空，GEA只授予view访问。恢复UI草稿不代表真实计划保存。

原品类计划资源保存在 `business-resources/category-plan`。Workbench 将它组装进 `lib/static/category`，保留原 `category-plan`、`plan-region-category` 和 `category-plan-prototype` 标识。Skill 区分按 Session 恢复的 UI 意图和未发文字，以及不落库的临时模拟任务。MCP 能力声明仍为空。

MPS资源 `business-resources/inventory-mps` 保留原模拟Prompt、Skill和view声明，Workbench装配进现有静态MPS页。Skill只读取当前挂载步骤。界面意图和未发送文字在当前Session恢复，模拟派生结果不存业务库。`SOURCE.json`记录历史 `governed-sql-read` 声明，当前MCP能力为空。

inventory-dealer保留原规则，声明通过公共GEA受控SQL通道读取已登记的10张表。保留原Consumer标识，MCP能力为governed-sql-read。页面可见和资源启用分别控制。201条输入仅用于离线验证。建议采纳与订单校验只保存本地草稿，不提交补货订单。正式接口与数据的实际验证仍待完成。

全链分布资源保存在 `business-resources/inventory-qll`。当前源码声明公司只读的七表与 `governed-sql-read`，Workbench经当前GEA grant和公开通道读取固定查询。Manage的 `full-chain-source-rows` 归一化原字段、数量和速度，再交同一公开计算。客户渠道未启用；源码接线和本地fixture不证明当前真实身份、数据或行权限。

同一资源解释当前公司范围的GEA库存、订单缺口与货龄趋势。Workbench持有读取、分页和Session临时事实，Manage持有原计算。缺期间保持null，源码/fixture接收不证明当前真实身份、行权限或模型验收。

个人库存资源保存在 `business-resources/inventory-personal`，保留日监控、优先事项与反馈字段。当前声明以独立Consumer通过公共GEA受控SQL读取已登记的9张表，MCP能力为`governed-sql-read`。固定输入仅用于离线回归，正式接口与数据的实际验收尚未完成。页面默认隐藏。反馈字段按Session恢复；页面草稿动作通过Core公开编辑事件追加未发送文字，保留已有文字和引用，不排入模型Task。

## 公开计算导出

库存纯计算通过 `dsh-agent-manage/inventory-compute/*` 公开提供。经销商政策、覆盖和补货、全链指标及个人库存日报只接已收窄的输入并返回结果，不读取数据、访问 Session 或授予业务权限。Workbench 装配页面时编译此公开源码导出。接口说明见[计算合同](../design/inventory-compute.zh.md)。

APS 页面使用公开 `aps-compute/*` 源码和运行时导出。原预测及问题分析 Skill 与参考只有 `business-resources/aps-analysis` 一份来源。`BusinessResources` 在选用时校验显式资源引用；资源引用不授予 GEA 业务权限。

DMS模拟接收资源只有 `business-resources/inventory-dms` 一份。`src/inventory-compute/dms-mock-packets.ts` 维护输入数量、三位小数与M/Z分笔键的纯计算。Workbench拥有页面内存模拟器，复用现有销售工作流投影。资源不包含DMS凭据、SQL能力或写MCP。

Skill 资源会话使用当前官方标准组合，保留通用工具与压缩。现有资源列表显示各 Skill 的描述；选择 Skill 不授予业务 Consumer。
