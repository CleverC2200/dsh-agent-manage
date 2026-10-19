---
name: inventory-policy
description: 基地库存 Agent 的跨技能规范层。涉及指标口径与算法解释、排名与筛选、数据取数、数据边界与目标版本、证据状态与行动边界、输出格式与输出前自检时加载。
---

# 基地库存规范与口径 Skill（inventory-policy）

## 定位

跨技能公共层。口径、取数契约、数据边界、证据与行动边界、输出规范**只在本 Skill 内定义一份**，其他 Skill 不重复、也不引用 Skill 之外的目录。

## 何时加载

| 触发场景 | 读取 |
|---|---|
| 任何取数之前 | `rules/data-access-contract.md` |
| 指标口径解释、"怎么算"、排名与筛选、引导生成 | `rules/metric-catalog.md` |
| 涉及目标版本、数据时间与数据完整性 | `rules/data-boundary.md` |
| 输出原因线索、风险判断、建议与人工确认边界 | `rules/evidence-and-action-boundary.md` |
| 生成任何回答之前 | `rules/output-guide.md`（含输出前自检清单、英文动词替换表、行动建议角色分工） |

## 规则文件

| 文件 | 内容 |
|---|---|
| `rules/metric-catalog.md` | 指标定义与公式、上卷与汇总铁律、支持与不支持问题、引导白名单、同义词映射、分仓口径对照、指标与数据来源映射 |
| `rules/data-access-contract.md` | 两个只读 MCP 工具的分工、cube 查询契约（先看说明书再查数）、取数六步、权限、失败降级、溯源要求 |
| `rules/data-boundary.md` | 必标信息、目标版本取值规则、数据缺失处理、数据质量分级 |
| `rules/evidence-and-action-boundary.md` | 证据状态四档、AI 可与不可、P1/P2 边界、建议与执行区分、业务判断边界 |
| `rules/output-guide.md` | 语言、数字、结构、时间锚定、引用、引导写法、行动建议角色分工、风险提示、输出前自检 |

## 优先级

固化规则包 V2.2 > 本 Skill 的口径文件 > 业务分析师指标表。冲突时以固化规则包为准，并在回答中提示冲突来源。

## 不在包内

输出校验脚本（`output_lint.py`）由开发侧维护，不随 Skill 包交付。
