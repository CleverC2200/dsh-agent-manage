# 思念食品需求预测（0.1.4）

可通过 dsh-agent-manage 安装的需求预测资源套件。依据用户提供的《销售计划领域本体与术语字典 V2》，保留其整体“待业务审核”状态。默认用业务语言交付预测结论、注意事项和待确认项；系统字段、公式过程和核对证据只在需要时附后。

| 资源 | 名称 | 职责 |
| --- | --- | --- |
| Agent | sinian-demand-forecaster | 串联范围、预测、复核，继承父模型 |
| Skill | sinian-forecast-scope | 实体消歧、可售与候选核对 |
| Skill | sinian-demand-baseline | 常规公式计算、新品/节令分支 |
| Skill | sinian-forecast-review | 风险、覆盖与离线评测口径 |
| Skill | sinian-demand-dialogue | GEA 对话、易读金额与范围核对 |
| Command | forecast-demand | 接收完整任务并引导角色委派 |

## 使用

刷新company-agent-suites来源，安装并启用本套件。在角色目录取准确ID；命令页/聊天斜杠菜单选择forecast-demand，或要求模型使用上述角色/Skills。
例如：“预测2026年10月豫南某客户各SKU拉货数量，单位件，数据截至9月12日；先核对输入口径，最终只生成草案。”提供真实数据文件和口径确认后才能生成真实数值。
角色不自动绑定独立技能/MCP，脚本运行需要宿主提供文件读取和Python执行能力；没有工具时报告限制，不编造结果。生产使用应在宿主配置实际工具白名单。

## 交付边界

- [原文字典](references/sales-ontology-v2.md)原样存档；[来源记录](references/source-provenance.json)含SHA-256。原文引用的其他资料未单独核验。
- [规则与冲突](references/rules-and-conflicts.md)保留月份、SKU权重、节令、价格等未决项；不能当作已批准制度。
- [数据约定](references/data-contract.md)是本地计算接口设计，不是已实现业务API。可用同页命令运行mock样例。
- 计算脚本仅实现§5.5基线；不实现自动候选收缩、节令融合、价格查询、完整回测引擎或真实MCP。
- 新品无历史、短保品、缺失增长规划和零分母不会被补成虚假预测。没有实际数据时仅交付缺口。
- Skill覆盖相关分析流程，不代表其全部数值步骤已自动化；新品/节令和候选收缩需要业务补齐算法。

## 验证

仓库根执行 `python3 -m unittest discover -s tests -v`。测试使用合成数据，仅证明算术与降级分支，不代表业务验收。mock样例的常规行预测1=1500件、预测2=1260件；新品阻断、节令仅基线。
业务验收还需实际数据、未决规则裁决、宿主角色调用与回执。

[English](README.md)
