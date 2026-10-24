# 产销协同默认资源 / APS defaults

安装默认提示词来自 #84 保存的 RTGO 客户端提示词，附加主线已发布的当前缺货受控工具规则。默认启用 plan-operations-weekly-report、answer-visualization、order-satisfaction-analysis；完整目录由 Workbench 的 syncAgentResources 打入页面包，GEA execution-policy 与页面 manifest 必须使用相同清单。

这三个目录保留批准快照的原始内容；订单满足率仅补充 scripts/package.json 的 CommonJS 边界和对应 runtime-package.json 哈希，避免安装包 type=module 环境下 Supply.reference 导出丢失。原 skills/aps 仅保留为历史业务规则来源，不注册为默认 Skill。

新安装或未保存个人覆盖的现有安装自动使用新默认值；已有显式自定义提示词、Skill 列表及禁用状态继续由 selected-resources.json 优先保存，不在升级时覆盖。需要替换个人配置时通过 Agent 编辑器显式导入上述默认资源；历史会话遵循 Core 已绑定的预设版本，新建会话验证当前默认值。

三仓需一起构建并安装：Manage 提供资源，Workbench 提供完整页面包，GEA 提供匹配的执行清单。只合并或更新一个仓库不构成安装生效证据。

The installed persona uses the approved RTGO snapshot plus the current governed shortage rules. The three complete Skill directories are copied by Workbench and declared by GEA. Existing explicit personal overrides and disabled choices remain authoritative; upgrades never replace them silently. New sessions use the currently published preset. Build and install the matching Manage, Workbench and GEA changes together.

Verification separates resource mounting and portable synthetic script checks from live Cube queries and business acceptance.
