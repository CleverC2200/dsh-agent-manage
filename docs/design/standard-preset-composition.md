# Standard preset composition

Manage registers the original `auto-negotiation` identity (智能编排) beside the official `standard`, `minimal`, and other declarations. Its plugins come from the active official registry document; no separate tool list or preset directory is maintained.

`dsh-agent-manage/standard-preset` exports `composeStandardPreset(registry, metadata, additions?)`. Pass the host `agentPresets` service and public `PresetDefinition` metadata. The returned definition contains the complete current standard plugin tree. The official Loader YAML schema preserves disabled expressions, plugin configuration and isolated groups. Missing standard declarations, invalid rows and conflicting plugin names or entry IDs reject instead of producing a reduced preset.

Optional `personaPrefix` appends company instructions to the minimal company system sentence. Composition clears the original suffix and runtime context. Optional `plugins` appends additional rows; conflicts are checked recursively. Group containers may repeat, while their plugin names and entry IDs must remain distinct. Callers own `agentPresets.register(definition)` and its disposal function. Existing mounted Sessions retain their registry revision.

The ordinary Manage bundle sets the official `agent-preset-registry.config.default` to `auto-negotiation`. Bundle removal withdraws this layer and exposes Core’s `standard` default. This scope is the official bundle switch, not an independently disabled low-level Host entry. A user's official settings selection (`selectedDefault`) retains precedence. Changing it affects new Sessions and does not rewrite an existing Session or browser draft. A saved explicit choice remains unchanged when the bundle is removed; choosing a now-absent company preset produces Core’s existing missing-preset diagnostic.

The capability lanes use the selected official Core production Loader, registry, Session, commands, compaction and JSONL persistence with temporary profiles and a local completion adapter. The official InputHub runs in its own client source process; a separate production Host process supplies the actual settings-save and restart receipt. This keeps both Core module graphs internally consistent.

The single-repository `test` runs Host and client preservation lanes. Cross-plugin hooks run explicitly with `test:preset-integration`. Set `DSH_GEA_CHECKOUT` and `DSH_WORKBENCH_CHECKOUT` to the recorded inputs; defaults are the sibling repositories in an integration checkout. Missing inputs fail with `PRESET_INTEGRATION_INPUT_REQUIRED`. No ticket worktree path is embedded in the tests. A completed integration must rerun this lane against its final three-repository manifest.

[The dual official Core decision](../../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.md) and [中文](../../.agents/notes/implemented/process/2026-10-10-two-official-core-releases.zh.md) own runtime peer support and the `DSH_CORE_CHECKOUT` input. This contract uses the active Host's standard declaration; source or offline checks do not establish fresh installation, Native, business or model acceptance.

智能编排的默认主提示词来自 `business-resources/orchestration/prompt.md`。它通过与其他插件 Agent 相同的 BusinessResources 目录发布，`auto-negotiation` 是“Agent 预设”与“Agent 配置”共用的唯一身份。配置页可编辑提示词、管理 Skill 和启停；个性化配置沿用已有持久化与版本发布，已有 Session 保留原版本，用户默认选择不因编辑或启停而改变。两个入口共享名称与说明，原生预设排序保留。默认继承通用 Skill，业务 Skill 按自身声明发布；显式定制 Skill 列表后，新会话按该列表发布。资源范围沿用[原生资源决定](../../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.md#personal-agent-skill-scope)。

`waitForStandard` 等待官方标准声明；`registerOrchestration` 向现有资源 owner 注册智能编排。Manage 在该 owner 创建后注册，资源面板与直接预设入口不各自维护一份提示词或配置。受控资源的 Markdown 提示词直接作为正文读取，既有 JSON 业务策略继续按原身份合同校验。

随包的产销协同诊断、基地库存诊断与交互式 HTML 三个 Skill 仍采用原附件正文及引用资产，通过已有 Skill 快照机制供配置与会话使用。两个诊断 Skill 的主提示词分流按实际用途对应；页面 Skill 的示例沿原目录读取。目录引用按真实路径匹配，使符号链接目录下的 Skill 配置保持生效。其他业务资源保持原归属。
