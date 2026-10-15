# 使用指南

[English](usage.md) | 简体中文 | [README](../../README.zh.md)

## 宿主要求

插件设置卡提供**扫描项目 Agent 布局**（`scanProjectLayouts`，默认开启），变更立即失效项目原生发现缓存。[项目布局章节](../../README.zh.md#项目布局开关)列出当前目录与执行边界；配置源的安装不受此开关影响。

Codex 项目 MCP 从 `.codex/config.toml` 读取，保留启停、环境变量引用、工具白名单/黑名单及超时；不支持的字段给出诊断。宿主 LSP 注册表是全局的，因此项目 LSP 不挂载，本插件不修改宿主 API。

- Node.js 22 或更高版本、DSH Web profile 和宿主技能服务（`ctx.skills`）。Git 来源需要 Git。
- 当前 peer 声明见 [package.json](../../package.json)。这是依赖声明，不代表已验证所有功能或历史 Web 外壳的最低支持版本。
- 斜杠命令需要宿主命令服务。`subagents_run` 角色委派需要 agents、tools、LLM 和 subagents 服务；它将保存的角色指令、供应商、模型、思考强度和工具限制应用到真实子代理，并等待结果。
- MCP 默认使用内置桥接。宿主客户端兼容模式还需要 `@deepseek-ai/dsh-mcp-client`，hooks 需要 `@deepseek-ai/dsh-hooks-claude-code`。
- LSP 挂载需要 `@deepseek-ai/dsh-lsp` 和 `@deepseek-ai/dsh-lsp-stdio`；要让 Agent 调用工具，还需在 profile 中暴露 `@deepseek-ai/dsh-tool-lsp`。对应语言服务器的可执行程序也必须可用。
- 宿主凭据服务是可选的。缺失时环境变量引用从启动环境解析，变更后需要重启。

## 其他安装方式

推荐的 CLI 命令见[快速开始](../../README.zh.md#快速开始)。也可以在 profile 中安装：

```sh
pnpm add github:CleverC2200/dsh-agent-manage
```

从 GitHub 安装：

```sh
dsh plugin --profile <name> add github:CleverC2200/dsh-agent-manage
```

npm 包包含构建后的 `lib/` 和 `client/`。GitHub 安装通过 `prepare` 构建，并依赖配置相对链接处的登记官方 SDK。隔离输入准备见[当前开发](../current-development.md)，仅 GitHub 安装不会生成这些产物。

手动管理 profile 时，安装包后，将 `dsh-agent-manage` 加入 profile 的 `dsh.profile.bundles` 数组，保留已有 bundles。包中的 `cordis.patch.yml` 提供插件配置行。依赖版本沿用包管理器写入的值。

## 配置市场源

随包销售计划配置源可供显式导入 Agent。以下是为自己的 profile 添加其他配置来源的可选种子示例。

源持久化在 `~/.dsh/agent-plugins/state.json`，也可用 cordis 配置预置（也是“持久种子”，启动时自动补齐缺失源）：

```yaml
- id: dsh-agent-manage
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: knowledge-work-plugins, url: 'https://github.com/anthropics/knowledge-work-plugins' }
```

`local: true` 的源原地读取本地目录。外部目录保留；托管 `.sources/<id>` checkout 只在移除来源时明确勾选删除文件后删除。扫描结果会缓存最多 30 秒，并在安装/启用/面板切换等操作间复用，因此本地源的工作树改动会在下一次缓存刷新时可见（任何源变更、刷新按钮，或 30 秒 TTL 到期）。启动挂载和用户技能枚举只扫描包含已启用安装的源；浏览市场仍发现全部配置源。并发读取共享扫描任务。启动不会拉取 Git 更新，来源刷新需显式触发。`archive` 源下载 HTTPS 压缩包（`.zip` / `.tar.gz` / `.tgz` / `.tar`，256 MiB 上限，可选 `sha256` 完整性校验）并解压为 checkout。

### 来源获取

在 Agent 列表的**配置来源**获取 Git、本地目录或配置包，再导入 Agent。Catalog 继续识别已有 checkout、保留外部目录、缓存扫描和维护来源锁。同步比较 Agent 基线与个人修改；取消预览不写配置。

## 存储与发现

默认根目录为 `~/.dsh/agent-plugins/`；设置 `DSH_HOME` 后改为 `$DSH_HOME/agent-plugins/`。

| 根目录下的路径         | 内容                           |
| ---------------------- | ------------------------------ |
| `state.json`           | 已配置来源和安装状态           |
| `.sources/<sourceId>/` | 来源 checkout                  |
| `user/skills/`         | 自建技能 Markdown 文件         |
| `user/commands/`       | 自建命令 Markdown 文件         |
| `user/agents/`         | 自建角色 Markdown 文件         |
| `data/`                | 运行时数据、覆盖配置与反馈记录 |

自建条目支持 frontmatter `disabled: true`，停止注册但保留文件。命令将正文转交给模型，并把 `$ARGUMENTS` 替换为调用时的文本。自建角色进入动态[子代理目录](agent-roles.zh.md)，不再进入技能或斜杠命令菜单。

项目维度的状态和 checkout 位于 `<project>/.dsh/agent-plugins/`。[项目布局章节](../../README.zh.md#项目布局开关)列出的原生布局直接读取，无需安装状态。命令、受支持的 MCP 和 hooks 挂载在各 Agent 作用域。hooks 归一化使用私有运行时临时文件，不改写项目设置。同名时，项目技能优先于已安装的用户套件技能，自建面板技能优先级低于套件技能。条目被遮蔽时可通过改名解决。

未登记的用户 checkout 不会因为存在于磁盘上就自动参与运行，需要显式收编和安装。没有文件监听；项目发现快照缓存五秒。

## 运行时与安全边界

MCP 详情仅为失败的托管服务或残留挂载显示重试；当前后端支持时才显示 OAuth 重新授权。重试检查所有托管服务但保留凭据。重新授权需确认清除授权记录及可能中断服务的影响。未保存配置时禁用连接操作；结果以刷新后的状态为准，不将接口成功当作连接成功。缺少凭据时应先补齐凭据。

MCP SDK 安全升级后，OAuth 凭据必须保留授权服务器的 `issuer`。缺少 issuer 的旧记录继续保存在存储中，但不会发送；下次连接需要重新注册和登录。绑定一个 issuer 的凭据不会发送给另一个 issuer。仅对可信 MCP 服务完成交互登录。

### MCP 配置

在 **MCP 服务**中配置服务、凭据、覆盖、授权和重试。套件详情仅用于只读预览。

**MCP 增强**设置（`mcpEnhanced`，默认 `true`）选择内置桥接，支持 stdio、Streamable HTTP / OAuth 和旧式 SSE。关闭后使用宿主客户端兼容后端，该接入方式不提供 OAuth 或 SSE。切换会重新挂载服务。

使用 `"env": { "FOO_TOKEN": "${FOO_TOKEN}" }` 这样的引用。缺失引用时阻止启动并显示 `needs-credentials`。宿主凭据只写不读，不会将字面 token 写入套件状态或 override JSON。只读的启动环境值需要修改后重启 DSH。

agent-plugins v1 的便携 `mcp.json` 使用严格 schema 校验；无 schema 的原生文件按各方言合同解析。`.mcp.json` 支持常见兼容形式：顶层 server map、`http` / `local` transport 别名、省略 type 时通过 `command` 推断，以及 `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${NAME:-default}` 占位符。无效服务会诊断并跳过，不会带着部分配置启动。

### Hooks 与 LSP

Hooks 使用桥接映射支持的 command-hook 子集，接入 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、SubagentStart、SubagentStop。这不代表完整兼容 Claude Code 运行时。

LSP 的启用套件声明和直接配置的服务使用同一挂载生命周期。缺少宿主包、可执行程序或声明无效时会展示诊断。能够预览声明不代表服务已经运行。

### 校验与执行

来源获取和清单扫描不能证明第三方代码可信。安装处于启用状态的套件可能启动服务或注册可执行 hooks，请先检查内容。

Git 获取通过 `execFile` 执行，不经过 shell；刷新使用 shallow fetch/reset。指向 `.sources/` 之外的本地目录源永不删除；`.sources/<id>` 下的 checkout——无论收编还是自克隆——只在删除该源并勾选「同时删除市场目录」时被移除。压缩包默认仅 HTTPS、256 MiB 上限、受保护的解压，可选 SHA-256 校验。便携路径在解析 symlink 后也必须留在套件根目录。无效清单和挂载失败以诊断形式展示。

漏洞报告请遵循[安全政策](../../SECURITY.md)。

### 体验反馈

`feedbackEnabled` 默认 `true`。宿主提供 tools 和 SettingsForms 时，启用面向模型的 `report_market_issue` 工具。有 `GITHUB_TOKEN` 或 `GH_TOKEN` 时，提交会在本插件 GitHub 仓库创建 issue；否则保存到 `data/feedback/`。两次提交间隔至少 60 秒。在插件配置卡片中关闭该设置即可注销工具。

工作区 Tab 共用持久化的卡片/列表偏好，搜索与筛选按资源独立。新增、刷新统一位于页头。MCP 新增入口校验 JSON 服务配置，写入 `~/.dsh/agent-plugins/data/mcp-servers.json`，再通过插件自己的 bridge 挂载；非法配置和重名服务会被拒绝。宿主自行管理的 MCP 服务仍只读观察。

### Agent 详情编辑

统一编辑器提供提示词、Skill、MCP 三个页签。提示词和 Skill 的修改保存为个人配置，不直接写受管源。MCP 表单保留未知 JSON 字段并拒绝未完成的值；移除关联保留共享定义，插件 MCP 成员归来源所有。旧市场、服务、LSP 和用户面板通用写路由已停止注册；Agent 操作通过认证 Host Fetch 路由处理。

旧插件连接覆盖保留原文件供恢复，仅启停生效。运行状态以 `PLUGIN_MCP_OVERRIDE_RETIRED` 标明保留路径。个人 MCP 配置、凭据引用、OAuth 和有序释放继续生效。

## 格式细节与开发

### 操作遮罩

视觉遮罩延迟 200ms 出现，出现后至少展示 400ms；结束时保留 100ms 缓冲，衔接连续请求。操作锁立即生效，短请求在视觉遮罩出现前完成，不再闪烁。

工作区请求、凭据修改和设置修改共用 `withBusyOperation`（`src/client/ui/busy-operation.ts`）。操作还包含刷新时应包裹完整流程；嵌套计数确保全部操作结束才撤掉遮罩。唯一的 `BusyOverlay` 挂载在 body 下，跟随当前窗口边界，设置 inert，阻止背景点击和键盘操作，并在结束后恢复焦点。提示每 3.2 秒轮换，尊重减少动态效果设置。来源进度、模型目录后台加载和 LSP 自动轮询不显示遮罩。遮罩不占列表行，也不虚构百分比进度。

一个来源可以包含多种布局方言。套件清单与 Marketplace 目录索引遵循[同一布局优先级](../../README.zh.md#布局识别优先级)。清单选择第一个存在的文件，无效时给出诊断，不会尝试低优先级清单。索引扫描采用第一个能产出套件的索引，并按支持的规则补充发现；无效或空索引允许继续尝试后续候选。根 `marketplace.json` 是最后的共享回退。远程引用卡片不能直接安装，需要先添加对应仓库为来源。

`schemas/1.0.0/` 的 schema 内置自 [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)，校验时不在线下载。领域用语和开发检查见[领域词汇](../../CONTEXT.md)与[贡献指南](../../CONTRIBUTING.md)。

下载区域手动选择以宿主保存的设置为准，成功后无需关闭重开设置；失败时显示错误并保留原选择。仅自动模式使用语言解析后的线路查询结果。

私有 GitHub 套件可使用显式 archive 来源，例如 `https://api.github.com/repos/OWNER/REPO/zipball/REF`。桌面管理员在启动环境提供 `DSH_AGENT_MANAGE_GITHUB_TOKEN`，授权只发送给首次 HTTPS GitHub API 请求，不发送到重定向目标，也不写入来源配置。下载失败保留已安装内容。

### 原生资源

工作区上下文、选中身份、参考读取与计算来源见[原生资源](native-resources.zh.md)。
