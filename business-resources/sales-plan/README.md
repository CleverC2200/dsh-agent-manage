# 原销售计划配置源

在 Agent 配置页的“配置来源”中选择随包的 `bundled-sales-plan`，导入“销售计划助手”。导入保留完整主提示词与 `sales-plan-qa`，创建个人 Agent；随后在该 Agent 的 MCP 页显式选择已启用的销售计划 Cube 来源。GEA 登录、来源和业务权限仍需有效。

这里只附带用户提供的问数 Skill。主提示词中提及的提报建议、草稿调整、审批预审核和版本对比 Skill 尚未提供，不视为已经配置。问数不提供审批结论或业务写入；缺少实时过程、知识或页面能力时按原规则说明缺口。

当前主提示词来自用户的 `Downloads/主提示词-V2优化版.md`。包内去除文档标题和代码围栏，保留围栏中的完整提示词，并添加 Agent 发现元数据。问数 Skill 及五份模板、V1 备份来自 `Downloads/skills/sales-plan-qa/`；模板与备份逐字节保留。

接入只调整模板路径的 Markdown 链接，并在问数 Skill 中保留当前 GEA 身份边界与原 [Cube 查询约定](skills/sales-plan-qa/references/cube-query.md)。服务端 Schema 负责实际工具参数、容量和授权；模板不增加工具或业务写入能力。原始输入文件保持原位。

首次发现不导入 Agent、不绑定 Cube、不改默认选择。重复导入保留已有个人定制；后续来源变化走配置来源的显式同步与冲突处理。已有个人 Agent 不自动覆盖，原 `gea-readonly`、四个销售预测 Skill、用户 Session 与草稿保持。
