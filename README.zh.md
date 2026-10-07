<img src="docs-site/public/favicon.svg" alt="" width="48" height="48" />

公司版 0.6.3-company.4 修复 Windows ZIP 来源同步，保留解压目录越界检查。

# dsh-agent-manage

**[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)的插件市场与 Agent 能力管理工作区。**

复用 Claude Code、Codex、Cursor、Kimi 等已识别布局中支持的内容及社区兼容布局，在 DSH Web 界面管理自己的技能、命令、代理角色、MCP 服务和 LSP 服务。支持的布局原地读取，无需转换清单或手动将文件复制到 DSH。各格式的具体限制见能力矩阵。

[English](README.md) | 简体中文 | [文档站](https://github.com/CleverC2200/dsh-agent-manage/tree/main/docs/guides)

[![License](https://img.shields.io/github/license/CleverC2200/dsh-agent-manage)](LICENSE)

[快速开始](#快速开始) · [日常使用](#日常使用) · [兼容性](#兼容性与运行边界) · [常见问题](#常见问题)

![当前六页签 Agent Plugins 工作区](docs/screenshot-workspace.png)

## 你可以用它做什么

- **复用生态套件。** 添加 Git 仓库、本地目录或压缩包作为来源，浏览、预览、安装和启用其中的套件，让支持的能力在 DSH 运行时生效。
- **建立自己的工具集。** 创建技能、可复用的斜杠命令和代理角色；随时编辑，也可以保留文件而暂时禁用。
- **沿用项目资源。** 直接发现项目 `.claude/`、`.agents/` 中的技能与代理，无需安装或复制文件。
- **集中管理服务。** 自行新增 MCP 服务和 LSP 服务，为已安装的服务配置凭据与授权，查看 MCP / LSP 状态，在同一工作区定位服务不可用的原因。

本隔离项目只支持登记的当前核心源码与公开接口。项目命令和套件指令通过异步 `agent/created` 初始化，完成后才开始首次模型请求；旧 `agent/session-start` 监听已删除。

## 快速开始

本分支的包名为 `dsh-agent-manage`；新 npm 包尚未在本次工作中发布或验证，使用下方 GitHub 来源。替换旧包时应先移除旧 profile 中的插件条目，再安装新包，避免双重加载。已有 `dsh-agent-plugins-market` 设置命名空间与数据路径保留兼容。

需要 Node.js 24+、启用了技能服务的 DSH Web profile；使用 Git 来源还需要 Git。当前仓库声明的 DSH peer 包版本范围为 `0.2.1-alpha.1`，各项能力还取决于 profile 提供的宿主服务，详见[宿主要求](docs/guides/usage.zh.md#宿主要求)。

将 `<name>` 替换为你的 profile 名称后安装：

```sh
dsh plugin --profile <name> add github:CleverC2200/dsh-agent-manage
```

1. 重启 DSH，打开 **设置 → 智能体市场**。仅支持本项目登记的当前 DSH 源码基线及其 settings.section 正式槽位。
2. 在**插件市场**添加来源，例如 `https://github.com/anthropics/claude-plugins-official`。插件不预置来源。
3. 打开套件查看内容，确认后安装，并确保套件已启用。
4. 如果套件提供技能，先在**技能**页签查看，再在聊天中输入 `/` 查找允许手动调用的技能。如果提供 MCP，前往 **MCP 服务**检查状态，处理凭据或连接提示后再使用工具。

GitHub 安装和 profile 配置方式见[使用指南](docs/guides/usage.zh.md#其他安装方式)。

## 日常使用

MCP 详情将保留凭据的“重试连接”与需要确认的“重新授权”分开，详情内不再显示启用开关。

工作区包含六个页签：

| 页签     | 可以做什么                                                                                 |
| -------- | ------------------------------------------------------------------------------------------ |
| 插件市场 | 添加来源、预览套件、安装 / 卸载、启用 / 禁用和刷新。                                       |
| 技能     | 浏览技能，创建或编辑自己的可复用指令。                                                     |
| 命令     | 管理通过 `/名称` 调用的提示词模板；`$ARGUMENTS` 替换为命令后输入的文本。                   |
| 代理角色 | 从 DSH 下拉选择供应商、模型和思考强度，管理角色指令与工具；通过 `subagents_run` 委派任务。 |
| MCP 服务 | 自行新增服务或配置已安装的服务及其凭据与授权，查看连接状态并重试失败的服务。               |
| LSP 服务 | 新增并配置语言服务器，查看运行状态。                                                       |

**来源（source）**表示内容来自哪里，**套件（suite）**是从中发现的可安装单元。添加来源用于发现套件；安装并启用套件决定其运行时能力是否生效。套件详情用于预览文件，MCP 凭据和覆盖配置在 **MCP 服务**中编辑。

自建技能、命令和角色以 Markdown 保存于 `~/.dsh/agent-plugins/user/`，项目原生资源继续保留在项目中。路径和优先级见[存储与发现](docs/guides/usage.zh.md#存储与发现)。

启动仅使用当前 `$DSH_HOME/agent-plugins` 标准存储。旧 `userRoot` 或 `dataRoot` 配置在运行时挂载前以 `MANAGE_STORAGE_UPGRADE_REQUIRED` 拒绝；新 profile 应删除这些旧配置。启动不读取或搬移旧树，也不导入旧后端 `settings.json`。原数据保留原位；确需转换时另行授权升级。标准 DSH_HOME、插件用户根、data、user 和 `.sources` 目录不得为符号链接。

## 兼容性与运行边界

支持的**布局方言（layout dialect）**描述文件如何组织。[统一优先级表](#布局识别优先级)并列列出套件清单与 Marketplace 目录索引。

[`schemas/`](schemas/README.md) 中十种当前布局契约均有独立读取测试。[布局审计](docs/layout-coverage.zh.md)将它们对应到固定提交号的 README 仓库快照，并区分布局/组件兼容与完整原厂运行时等价。

支持的**运行时能力（runtime surface）**描述 DSH 能使用什么：

| 能力  | 支持情况与条件                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------- |
| 技能  | 接入宿主技能目录，允许手动调用的技能出现在斜杠菜单；展开支持的根路径占位符。                       |
| 命令  | 通过宿主命令服务注册斜杠命令。                                                                     |
| 代理  | 动态子代理目录与 `subagents_run`；需要宿主 agents、tools、LLM 和 subagents 服务。                  |
| MCP   | 默认使用内置桥接，支持 stdio、带 OAuth 的 Streamable HTTP 和旧式 SSE；也可切换宿主客户端兼容模式。 |
| Hooks | 运行 `dsh-hooks-claude-code` 桥接映射支持的 command-hook 子集。                                    |
| LSP   | 宿主具备 LSP 包时实际挂载；Agent 调用还需要 profile 暴露 LSP 工具。                                |

代理角色直接发布到动态 `subagent-catalog`，采用与 DSH skills catalog 相同的逐 step 比对、条目持久化和完整替换机制。通过 `subagents_run(role, prompt)` 传入目录中的准确 ID，由工具解析角色的供应商、模型和 `reasoning_effort`，再应用角色指令及工具限制。角色不再生成 `agent-*` 或 `persona-*` 技能/命令条目。模型继承、目录刷新与 `market_agent` 迁移说明见[代理角色](docs/guides/agent-roles.zh.md)。

### 布局识别优先级

**同一个套件目录**同时存在多个清单时，按下表顺序选择第一个存在的文件来确定布局：

| 优先级 | 布局 | 套件清单 | Marketplace 目录索引 |
| --- | --- | --- | --- |
| 1 | agent-plugins.org v1 / 根兼容清单 | `plugin.json` | 无专属索引 |
| 2 | Universal 兼容布局 | `.plugin/plugin.json` | `.plugin/marketplace.json` |
| 3 | Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| 4 | Cursor | `.cursor-plugin/plugin.json` | `.cursor-plugin/marketplace.json` |
| 5 | Kimi Code | `kimi.plugin.json`，其次 `.kimi-plugin/plugin.json` | `.kimi-plugin/marketplace.json` |
| 6 | Codex | `.codex-plugin/plugin.json` | `.agents/plugins/marketplace.json`，其次 `.agents/plugins/api_marketplace.json` |
| 7 | ZCode | `.zcode-plugin/plugin.json` | 无专属索引 |
| 8 | Qoder CLI | `.qoder-plugin/plugin.json` | `.qoder-plugin/marketplace.json` |
| 9 | GitHub Copilot CLI | `.github/plugin/plugin.json` | `.github/plugin/marketplace.json` |
| 回退 | 技能集合 / 共享索引 | 无已知清单时按技能集合约定发现 | 根 `marketplace.json` |

- **先选择，再解析：**高优先级清单无效时给出诊断，不会自动重试低优先级清单。
- **根清单身份：**根 `plugin.json` 只有声明了受识别的 agent-plugins.org `$schema`，才按 v1 严格校验；否则按 Claude 兼容清单读取。
- **组件补充：**通常不合并多个清单。非 v1 根 `plugin.json` 缺失的组件声明可以从 `.claude-plugin/plugin.json` 补齐；根清单中的显式声明优先，marketplace 条目声明补充剩余缺项。

**两列遵循同一布局优先级。** 索引查找跳过无专属索引的布局，同一布局的别名按表内顺序尝试。根 `marketplace.json` 是共享回退，既不是技能集合的清单，也不是 agent-plugins.org v1 的专属索引，不继承根 `plugin.json` 的优先级。

读取阶段收集所有存在的索引，套件扫描采用第一个能产出套件的索引，不会合并全部索引；无效或空索引允许继续尝试下一项。该优先级不意味着项目原生目录之间互斥。

顺序定义见 [`src/model/layouts.ts`](src/model/layouts.ts)，选择与根清单补充逻辑见 [`src/catalog/manifests.ts`](src/catalog/manifests.ts)。

### 布局能力支持矩阵

按官方文档、本插件源码与「每个 schema 一个真实仓库」逐项核验（2026-09-08）。表中描述的是**本插件接入范围**：“通用”表示仅按本插件共用目录规则读取，不代表该平台定义了对应能力；“部分”须结合下方限制阅读。[兼容性报告](docs/compat-report.md)记录抽样仓库、提交号、schema 结论与扫描器输出。

| 布局 | Skills | Agents | Commands | MCP | Hooks | LSP |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/plugins-reference) | 声明 + 默认技能 | 声明 Markdown | 声明 Markdown | 文件 / 内联 | 命令事件子集 | 文件 / 内联 |
| [Codex](https://developers.openai.com/plugins/build/plugins) | 支持 | 通用 | 通用 | 部分：`.mcp.json` | 兼容事件子集 | 通用内联 |
| [Cursor](https://cursor.com/docs/reference/plugins) | 支持 | 部分：仅 `.md` | 部分：仅 `.md` | 部分：见下方限制 | 原生事件不支持 | 通用内联 |
| Kimi Code | 声明技能 + 启动技能 | 声明 Markdown | 声明命令 | 内联 | 内联命令事件 | 通用扩展，非原生 |
| [ZCode](https://zcode.z.ai/en/docs/plugin) `.zcode-plugin/` | 通用 | 通用 | 通用 | `.mcp.json` + 内联覆盖 | 通用 | 通用内联，非原生 |
| [Qoder CLI](https://docs.qoder.com/cli/plugins-reference) `.qoder-plugin/` | 通用 | 通用 | 通用 | 部分：优先 `.mcp.json` | 通用 | 通用内联，非原生 |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) | 声明技能 | `.md` / `.agent.md` | 声明 Markdown | 文件 / 内联 | 映射命令事件 | 文件 / 内联 |
| Universal 兼容布局 `.plugin/` | 通用 | 通用 | 通用 | 通用 | Claude 格式子集 | 通用内联 |
| [agent-plugins.org v1](https://agent-plugins.org/specification) | 支持 | 通用，非标准 | 通用，非标准 | 标准 `mcp.json` | 通用，非标准 | 仅目录预览，非标准 |
| 无清单技能集合 | 支持 | 通用 | 通用 | 通用文件 | Claude 格式子集 | 仅目录预览 |
| 项目原生目录（见下文） | 支持 | 可移植 Markdown 角色 | 会话作用域命令 | JSON / Codex TOML | 已映射命令事件子集 | 诊断，不挂载 |

- **组件路径：**支持声明文件、目录树和数组，按 realpath 限制在套件内部。命令、代理和详情面板消费同一组资源。Cursor 命令还支持 `.mdc`、`.markdown`、`.txt`；Qoder 命令映射支持文件与内联内容。Claude/Codex 技能声明补充默认发现；无清单集合也支持平铺技能 Markdown 文件。
- **代理身份：**`reviewer.agent.md` 与 `reviewer.md` 在子代理目录中保留不同角色 ID，不再生成 `agent-*` 技能或命令别名。普通技能本身采用这些名称的不受影响。
- **MCP：**按方言解析声明文件、内联表和数组。支持 Cursor 无 schema 的 `mcp.json`；agent-plugins v1 保持严格 schema 校验。Claude/ZCode 声明叠加默认配置，Cursor 声明替换默认配置，Copilot/Universal 包含 `.github/mcp.json`，Kimi Code 使用内联声明。无效显式配置不会复活默认配置。Codex app 连接器不属于此适配器。
- **Hooks：**支持声明文件/目录及内联配置，包括 Kimi 数组和保留 argv 引用边界的 ZCode process hooks。受支持的 Copilot/Cursor 生命周期名称映射到已有 command-hook 桥。没有 DSH 对应点的事件（如 `afterFileEdit`）给出诊断，不伪造执行。
- **LSP：**用户套件支持声明文件、数组、内联表，以及 `.lsp.json` 和 Copilot/Universal 的 `lsp.json`、`.github/lsp.json`、`lsp-config/servers.json`。反向域名目录定义仍为预览。项目 LSP 保留宿主作用域限制。
- **规范边界：**agent-plugins.org v1 的可移植核心只有 skills 与 MCP，不能把通用 agents / commands / hooks 扫描称为标准能力。Universal 是本插件识别的兼容布局名称：[OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins)文档同样使用 `.plugin/plugin.json`，[Vercel 仓库](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json)也在使用，但不存在跨厂商规范。
- **Kimi Code：**当前 schema 覆盖两种清单路径、启动技能、附加技能指令、系统提示、内联 hooks 和 catalog 别名。历史 `kimi-cli` 根 tools 协议是另一套系统，不能与当前 Kimi Code schema 混淆。
- **ZCode 边界：**已识别 `.zcode-plugin/plugin.json` 与根 `marketplace.json`，包含按名称索引的插件表。内联 MCP 按同名键覆盖 `.mcp.json`。尚未实现 marketplace 的 zip + `sha256` 分发契约。
- **Qoder 边界：**已识别 `.qoder-plugin/plugin.json` 与 `.qoder-plugin/marketplace.json`。MCP 优先读取 `.mcp.json`，无 schema 的 `mcp.json` 作为回退。
- **GitHub Copilot CLI：**`.plugin/plugin.json` 保留 Universal 身份。两种路径均消费声明组件及默认 MCP/LSP 文件。隔离测试在嵌套套件根也去除竞争清单，防止 Claude 回退冒充 Copilot 测试通过。
- **项目目录：**[Claude 项目技能](https://code.claude.com/docs/en/skills)与 [Codex 的 `.agents/skills`](https://developers.openai.com/codex/skills)有官方依据；`.agents/agents`、`.agents/commands` 是本插件的通用发现约定。

### 项目布局开关

插件设置卡提供**扫描项目 Agent 布局**（`dsh-agent-plugins-market.scanProjectLayouts`，默认 `true`）。关闭后立即移除本插件的项目原生候选；配置源与宿主自身的技能提供器独立运行。文件原位只读，不安装、不改写、不删除。

注册表读取 `.claude`、`.agents`、`.codex`、`.cursor`、`.kimi`、`.zcode`、`.qoder`、`.github` 下的技能。除 `.codex` 与 `.kimi` 外启用可移植 Markdown agents；两者的 TOML/YAML 格式需要独立适配器。角色执行按调用会话确定项目。项目 commands、受支持的 MCP 服务和已映射命令 hooks 注册在各 Agent 独立作用域，会话启动或目录变更通知时刷新，关闭总开关即撤销。

MCP 读取根 `.mcp.json`、`.cursor/mcp.json`，以及 `.qoder/settings.json`、`.qoder/settings.local.json` 的 `mcpServers` 表（本机配置覆盖同名项目配置）。ZCode 读取 `zcode.json`、`.zcode/config.json` 的 `mcp.servers`，原生表为空时回退到 `.agents/mcp.json`。Codex 通过 `smol-toml` 读取 `.codex/config.toml` 的 `[mcp_servers.*]`，保留 stdio/HTTP 配置、环境变量/请求头引用、启停、工具过滤和超时。不支持的服务字段会报诊断，宿主客户端模式会拒绝无法执行的策略。相对可执行路径从项目根解析。Claude/Qoder 设置 hooks 与明确启用的 ZCode 配置 hooks 使用桥支持的命令事件子集。校验后的 hooks 写入私有运行时临时文件，销毁时删除，项目原文件保持不变。项目 LSP 给出诊断且不挂载，修改宿主不属于本插件范围。见[架构决策与支持边界](docs/adr/2026-09-09-layout-registry.md)。

### 抽样验证

`schemas/` 中的每个 schema 都会对照一个真实仓库核验——取 GitHub 代码搜索为该布局返回的 star 最高候选（2026-09-08）——再用本插件自己的扫描器读取该 checkout。九个样本中有六个**被遮蔽（shadowed）**：仓库同时提供多种方言，优先级更高的清单胜出，因此能力面仍被发现，但抽样方言自身的身份未被采用。[兼容性报告](docs/compat-report.md)记录了提交号、schema 错误与扫描备注。

| 布局 | 抽样仓库 | 方言清单 | Schema | 扫描器 |
| --- | --- | --- | --- | --- |
| Claude Code | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) | `.claude-plugin/plugin.json` | 通过 | 接入 |
| Codex | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `.codex-plugin/plugin.json` | 通过 | 被遮蔽 |
| Cursor | [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | `.cursor-plugin/plugin.json` + marketplace | 通过 | 被遮蔽 |
| Kimi | [obra/superpowers](https://github.com/obra/superpowers) | `.kimi-plugin/plugin.json` | 通过 | 被遮蔽 |
| Universal | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | `.plugin/plugin.json` | 通过 | 接入 |
| agent-plugins.org v1 | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `plugin.json` | 通过 | 接入 |
| ZCode | [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) | `.zcode-plugin/plugin.json` + `marketplace.json` | 通过 | 被遮蔽 |
| Qoder CLI | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `.qoder-plugin/plugin.json` | 通过 | 被遮蔽 |
| GitHub Copilot CLI | [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | `.github/plugin/marketplace.json` | 通过 | 被遮蔽 |

**扫描器**列描述未修改的仓库：**接入**表示自身清单胜出，**被遮蔽**表示其它方言胜出，**未读取**表示无套件。它与单布局隔离测试分开判断。无清单集合使用真实 Universal 仓库技能、在测试中移除清单验证，补齐十种布局覆盖。快照位于 `tests/fixtures/real-layouts/`，保留提交号、文件哈希与许可证，详见[审计表](docs/layout-coverage.zh.md)。

核验依据包括 `src/catalog/manifests.ts`、`surfaces.ts`、`validate.ts`、`native-project.ts` 与 `src/runtime/hooks-mounts.ts`。[兼容性报告](docs/compat-report.md)补充「每个 schema 一个真实仓库」并由本插件扫描器实测。这是文档、源码与抽样核验，并非每个平台的端到端兼容认证。

能读取一种布局，并不保证复现原平台的全部行为。无效声明会被诊断并跳过。项目原生命令与受支持的 MCP 服务使用宿主的 Agent 作用域注册；项目 MCP 服务名包含会话身份，以避免应用级命名冲突。

启用第三方套件前请检查其内容：启用的服务和 hooks 可以执行程序。详见[运行时与安全边界](docs/guides/usage.zh.md#运行时与安全边界)。

## 常见问题

**安装后为什么找不到技能或工具？**

检查套件及对应能力是否启用。技能可能限制手动调用；MCP / LSP 面板显示用户服务故障。项目资源还需要开启项目扫描；不支持的原生字段与项目 LSP 声明进入扫描诊断，作用域挂载错误记录在宿主日志中。

**在哪里配置 MCP token？**

在 **MCP 服务**中打开对应服务。缺失环境变量引用时显示 `needs-credentials`。宿主管理的凭据只写不读；启动环境中的凭据需要修改环境后重启 DSH。

**套件没有声明的服务怎么添加？**

在 **MCP 服务**或 **LSP 服务**中点击新增并填入声明。声明会先校验，保存到 `~/.dsh/agent-plugins/data/` 下，并与套件服务走同一套挂载生命周期。从宿主配置观察到的服务保持只读。

**来源下载失败怎么办？**

可以使用本地目录、收编手动克隆的仓库，或配置代理与镜像，见[配置市场源](docs/guides/usage.zh.md#配置市场源)。

**本地修改什么时候生效？**

没有文件监听。本地来源的发现结果最多缓存 30 秒，刷新来源可立即使缓存失效。项目发现有独立的五秒缓存。已经打开的页面不会自动刷新。

**删除来源会删除文件吗？**

只有勾选确认框里的「同时删除市场目录」才会删除。它删除该源在 `~/.dsh/agent-plugins/.sources/<id>` 下的目录——包括你手动克隆后被收编的目录。指向 `.sources/` 之外的本地目录源永不删除。

## 更多文档

- [使用指南](docs/guides/usage.zh.md)：安装、来源配置、存储、宿主要求、MCP / LSP 和反馈设置。
- [插件规范](schemas/README.md)：各布局的参考 schema 与依据，以及内置的 agent-plugins.org v1.0.0 契约。
- [兼容性报告](docs/compat-report.md)：每个 schema 一个真实仓库，含提交号、schema 结论与扫描器输出。
- [贡献指南](CONTRIBUTING.md)：开发环境、检查命令和 PR 流程。
- [安全政策](SECURITY.md) · [版本记录](CHANGELOG.md) · [MIT 许可](LICENSE)。
- [领域词汇](CONTEXT.md) · [架构设计](docs/adr/0001-catalog-centered-modular-refactor.md)。

已安装资源编辑、角色模型路由与标准存储见[代理角色与存储](docs/guides/agent-roles.zh.md)。

下载区域在「设置 → 插件 → 插件配置 → 智能体市场」中切换。手动选择保存后立即更新选中状态；保存失败显示错误并保留原选择。

同时加载 GEA 插件时，GEA 登录后自动发现获授权的 MCP 工具。Consumer 选择、生命周期和验收边界见 [GEA 登录与 MCP](docs/guides/gea-mcp.zh.md)。

GEA MCP 的工具可见性及调用仅限本地 DSH `gea-readonly` 预设（需求预测入口）。可在 Consumer 字段旁通过 `geaMcp.agentPreset` 指定其他本地预设；服务端 Consumer 授权与本地预设限制是两个独立边界。其他预设及不携带 Agent 的调用均被拒绝；登录刷新、已有和新建 Agent、空会话切换预设均维持此限制。继承相同预设的子 Agent 同样拥有访问权。宿主 MCP 状态页仍保留连接信息用于诊断。宿主缺少 `agents` 或 `agentPresets` 服务时不挂载此集成。

声明 resources 能力的 MCP 服务会提供带服务名前缀的 `dsh_read_resource` 工具。传入该服务返回的完整资源 URI，通过原连接、授权、取消信号和超时读取。文本资源写入工具结果及会话记录；二进制资源明确显示为非文本结果。不会将资源 URI 当作任意 HTTP 地址下载。

私有 GitHub 套件可使用显式 archive 来源，例如 `https://api.github.com/repos/OWNER/REPO/zipball/REF`。桌面管理员在启动环境提供 `DSH_AGENT_MANAGE_GITHUB_TOKEN`，授权只发送给首次 HTTPS GitHub API 请求，不发送到重定向目标，也不写入来源配置。下载失败保留已安装内容。

下载区域选择立即反映显式选择；自动模式跟随探测结果。

插件拆分隔离工作区面向同级 DSH 0.2.1-alpha.1 源码构建，DSH peer 固定到该版本，Cordis 固定为 4.0.5-alpha.1；图标使用新的 Regular 导出。UI primitives 开发链接指向同一源码，测试对 React 去重。使用此组合前从同级 GEA 仓执行源码兼容检查。

管理页面消费 Workbench 插件安装和释放的工作台资源 `1.0.0`。Manage 的构建 CSS 由自身 apply 生命周期管理，不在模块加载时留下样式，也不修改或同步 Core 主题。明暗主题、字号和状态颜色仍由官方宿主持有。

## 分仓库存分离资源

`business-resources/inventory-fc` 与 `business-resources/inventory-aqkc` 持有迁移后的只读 Skill、提示词、MCP 声明和能力元数据。工作台构建通过已有 `declarations.page/capability` 引用将其与页面组合。导出的 `dsh-agent-manage/business-resources` 装载器读取并校验 Skill/提示词身份；GEA 在装载前校验 Consumer、页面 ID 和影响等级。沿用原生 Skill 路径，卸载保留后续编辑。资源配置不包含凭据，登录与受控执行仍归 GEA。HTML 资源必须使用当前 v2 协议和显式 Agent Manage 声明；旧 manifest 明确拒绝。 `prompt.json` 的 `pageAgents` 只列出允许解读本页的预设，不增加跨 Consumer 权限。当前分仓页列出分仓库存与全链库存两项；GEA 还会逐项检查预设是否安装、当前登录是否得到该 Consumer 的授权。

配置及 Session 约束见[分仓页面的 Agent 能力选择](docs/guides/branch-stock-page-agents.zh.md)。

同一个原生 Skill 根目录中，装载器拒绝同模块的重叠装载；GEA 同样拒绝同一现有 preset 的重叠提示词替换，避免旧卸载动作删除或复活其他拥有者。

业务资源装载器通过目录使用的同一 YAML 解析器返回 `skillName` 和 `skillDescription`，消费方不再解析 Skill。清理读取遇到 ENOENT 以外的失败时报告错误并保留归属；修复文件后先重试清理，再重新挂载。后续用户编辑和主动删除仍保留。

## 官方工作台入口与视觉生命周期

在同组官方 DSH 中，通过 **工作台 → Agent 市场**（`agent-plugin-workspace`）打开已有资源工作区；设置区仍呈现同一工作区。目录以官方 `main` 注册为可见性事实，Workbench 注册只提供标题元数据。Manage 的构建 CSS 由插件 `apply` effect 安装和释放，消费 Workbench 插件提供的 `--workbench-*`；不在模块加载时插入永久样式，不同步或修改官方 Core 主题。主题及字号始终由官方宿主持有。

### 原生资源选用

`GET /api/agent-manage/resources?cwd=...` 根据明确的原生工作区绝对路径返回提示词和可由用户调用的 Skill 轻量清单，安装启用事实沿用资源所属模块。`POST /api/agent-manage/resources/select` 仅接受 `{ "id": "...", "cwd": "/absolute/workspace" }`，经官方原生 preset/Skill 接口发布所选原资源。发现、正文选用和工作台新 Session 使用同一个当前原生工作区；尚无 Session 时使用明确配置的隔离工作区，Skill 只暂存 `/skill-name` 草稿，不自动请求模型。未安装 Skill 和 Consumer 业务授权分别报告。`selected-resources.json` 只保存已选标识以恢复必要声明，不保存资源正文或凭据。

资源选用只接受同源POST JSON，流式计数不超过64KiB，在选用前拒绝超限正文并返回413，chunked同样受限。坏包内Skill元数据只诊断并跳过该项，健康资源继续可用，取消仍向调用者抛出。

Manage 提供 `skill_reference_read`，只读当前模型可见 Skill 正文明确链接的本地相对参考文件。沿宿主文件系统读权限与同一工作区/scope/取消信号，核 UTF-8、大小和行分页限制，并在返回前重新确认安装 owner。MCP 资源仍使用对应服务的 reader。

纯 `forecast_compute` 能力沿调用者工作区核已安装启用的 `sinian-demand-baseline`。原 §5.5 精确十进制算法、缺数据分支、草案与无外写语义保持。结果携算法版本、完整输入 SHA-256 和是否来自实际用户消息的完整 JSON；这些来源事实不核验业务来源、不授予 Consumer 权限，模型声明 `data_mode` 不算来源证明。

本轮开发SDK登记为固定官方 `dsh-v0.2.1-alpha.1` / `5badb15009ae1756c3afe0ae0cef1faafc290ccc` 标准构建。Host/Client类型和真实开发依赖消费同一批官方包，运行peer对应其实际版本。客户端只声明真实slots/locale/settings接口，不保已移除client-runtime alias。Manage资源/MCP的实际implementation和官方Core插件管理继续保持原有独立归属。

Manage 验证已选用提示词的 `pageAgents` 后，在资源摘要和选用结果中返回可选的 `interpreters` 数组。数组只包含原声明允许、资源仍已注册启用且没有已记录加载错误的解释器。工作台据此选择官方 Session 的预设。GEA 继续检查实际预设和所需 Consumer 权限。

公开的 `dsh-agent-manage/forecast-source` 导出提供 `forecast_compute` 使用的算法版本、规范输入 hash、用户消息输入校验和当前 baseline 指纹。GEA 在现有身份与 Session 证据库中使用这些函数。Manage 保留十进制计算和来源校验，GEA 保留业务授权。

客户库存、订单工作台与订单履约资源保存在 `business-resources/inventory-customer`、`inventory-orderworkbench` 和 `inventory-orderfulfillment`。原Prompt与Skill只解释模拟数据。Workbench把资源组装进原页面包，选用后关联官方Core Session，不发送模型请求。MCP能力声明为空，GEA拒绝业务SQL读取。

已有区域原型使用 `business-resources/plan-regional` 中的原 `plan-regional` 资源。Workbench将其组装到当前 `gea-regional-plan` 页面；Manage通过原生资源选用发布原Prompt与Skill。MCP能力列表为空，GEA只授予view访问。恢复UI草稿不代表真实计划保存。

原品类计划资源保存在 `business-resources/category-plan`。Workbench 将它组装进 `lib/static/category`，保留原 `category-plan`、`plan-region-category` 和 `category-plan-prototype` 标识。Skill 区分按 Session 恢复的 UI 意图和未发文字，以及不落库的临时模拟任务。MCP 能力声明仍为空。

MPS资源 `business-resources/inventory-mps` 保留原模拟Prompt、Skill和view声明，Workbench装配进现有静态MPS页。Skill只读取当前挂载步骤。界面意图和未发送文字在当前Session恢复，模拟派生结果不存业务库。`SOURCE.json`记录历史 `governed-sql-read` 声明，当前MCP能力为空。

inventory-dealer保留固定原规则，本批只加载已登记的201条本地模拟输入。保留原Consumer标识，MCP能力为空。页面可见和资源启用分别控制。真实授权与补货业务验收仍待补测。

全链分布资源保存在 `business-resources/inventory-qll`。当前声明固定mock且MCP查询能力为空。Workbench保留原公司/客户计算与当前Session引用，真实客户数据和行权限仍未验。
