# 原销售计划配置源

在 Agent 配置页的“配置来源”中选择随包的 `bundled-sales-plan`，导入“销售计划助手”。导入保留完整主提示词与 `sales-plan-qa`，创建个人 Agent；随后在该 Agent 的 MCP 页显式选择已启用的销售计划 Cube 来源。GEA 登录、来源和业务权限仍需有效。

这里只附带用户提供的问数 Skill。主提示词中提及的提报建议、草稿调整、审批预审核和版本对比 Skill 尚未提供，不视为已经配置。问数不提供审批结论或业务写入；缺少实时过程、知识或页面能力时按原规则说明缺口。

原始输入来自用户的 `Downloads/主提示词-测试版（粘贴用）.txt`、`Downloads/skills/sales-plan-qa/SKILL.md` 及其 `references/cube-query.md`，输入文件保持原位。迁入包内时仅作以下接线调整：

- 主提示词增加 Agent 卡片元数据，身份说明补充个人 Agent 的可信 Cube 引用。正文业务规则保持。
- Skill 的身份段改为真实 Session、可信 Cube 来源与当前 GEA 授权合同，明确引用不附带页面动作和写入。
- Cube 查询约定原样保留。工具名、参数、行数与字节限制继续使用实际授权 Schema。

首次发现不导入 Agent、不绑定 Cube、不改默认选择。重复导入保留已有个人定制；后续来源变化走配置来源的显式同步与冲突处理。原 `gea-readonly`、四个销售预测 Skill、用户 Session 与草稿不迁写。
