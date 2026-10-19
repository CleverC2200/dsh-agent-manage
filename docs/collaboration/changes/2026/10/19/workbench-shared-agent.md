# 个人模式选用共用 Workbench 工具来源

现有 Agent 配置页可创建独立模式并选择 GEA Workbench 来源。该来源不发布额外业务预设；各模式的提示词、Skill、工具启停和原生会话仍独立保存。Manage 保留 GEA 受控桥，个人模式的 Cube 与知识查询通过共用 workbench Consumer 执行，审批与业务写入保留在原业务 Agent。

固定候选 3009e053 的真实 Core 四项用例、资源配置二十项回归及完整类型检查通过。GEA 0.0.167-workbench.2 与 Manage 0.6.3-company.21.workbench.1 已通过当前 DSH 安装和同模式新旧会话知识问答验收。历史会话 ID、权限失败与生成完成度限制由 GEA 处理。本次冻结 GEA 与最新 Workbench 输入供原 required CI 核验，不修改门禁。

相对最新 main a6fc5793 没有文件、功能或历史回归测试删除，没有发现旧修复回退。源码审查和原生配置保全均有本票本地回执；远端 CI 及合并另行读回。不修改 Core、后端、账户权限、凭据、用户会话或正式发行频道。仅提交、合并登记的隔离 GitHub 目标，不据本机发布技能副本执行正式发布。
