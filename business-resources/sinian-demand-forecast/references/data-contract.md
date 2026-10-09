# 本套件输入约定（工程设计，不是现有 API）

当前没有业务数据或真实 MCP。JSON 由用户提供文件或后续已授权只读适配器整理，字段名不是 DMS/GEA/CUBE 已验证字段。对象为客户×SKU×目标月的拉货/发货数量基线，不能直接用于终端动销。

## 文件头

| 字段 | 约束 |
| --- | --- |
| schema_version | 整数1 |
| data_mode | provided/mock/live；仅为调用方声明，脚本不验证来源真实性 |
| snapshot_at | 带时区ISO时间，位于base_month；本月已拉货量截止此刻 |
| base_month / target_month | YYYY-MM，目标为基准的下一个自然月 |
| prior_base_month / prior_target_month | 对应月份减一年，历史量为完整自然月 |
| period_mapping_confirmation | 本次月份解释确认记录/证据引用，不得填“已确认”冒充业务裁决 |
| candidate_policy_confirmation | 候选范围/算法确认依据；脚本不做权限或候选收缩校验 |
| records | 非空数组，每个客户×SKU仅一条；同SKU不同单位也不能重复 |

脚本验证字符串存在及月序，不验证确认者身份或文件真实性；Agent 必须核对证据。历史/规划数据在 cutoff 之后才出现的，不得用于该时点回测。

## 每行

| 字段 | 含义 |
| --- | --- |
| customer_id / sku_id / unit / source_ref | 非空字符串，编码不能变成数字；同一行所有量必须同单位，source_ref指向可追溯输入及期间 |
| eligible | true=已核定本次候选，false=排除，null/缺失=阻断；不是脚本授予权限 |
| exclusion_reason | eligible=false时必填 |
| product_kind | regular/new/short_shelf；new和short_shelf不使用此计算器 |
| seasonal | 必填布尔；true仅生成partial基线，不输出最终预测 |
| quality_issues | 必填字符串数组；有问题则partial，无证据不填写“已核对无问题” |
| base_plan_qty | 本月计划量（非负）；若含纠偏，输入已经正确按节点继承的计划 |
| base_actual_to_cutoff_qty | 本月截至snapshot已拉货数量（非负） |
| prior_base_actual_qty | 去年基准月完整拉货数量，必须大于0 |
| prior_target_actual_qty | 去年目标月完整拉货数量（非负，真实零可以用） |
| target_yoy_growth / target_mom_growth | 目标同比/环比规划，小数，≥−1；必须有规划依据，null不补零 |
| weights | 可选，完整对象如{"yoy":0.5,"mom":0.5}，各非负、总和1；不填采用原文默认 |

退货/负订单应先确认净额/毛额口径，不取绝对值或静默截成0。脚本拒绝负数量、布尔数值和非有限数。多源、多币种或混合单位由上游明确归一，脚本不会猜换算系数。

## 执行

在套件根目录运行（Python 3，标准库，无第三方依赖）：

```sh
python3 skills/sinian-demand-baseline/scripts/calculate_baseline.py skills/sinian-demand-baseline/examples/mock-input.json
```

安装位置由技能提供器返回；从 Skill 目录运行时使用 `python3 scripts/calculate_baseline.py examples/mock-input.json`。实际数据只读本地输入，不要将真实客户数据或凭据提交到资源仓库。

样例完全虚构：常规行 E=1000，预测1=1500，预测2=1260；新品行blocked；节令行partial（仅基线）。这些不是思念实际预测，也没有代表当前业务认可此月份解释。

## 输出

artifact_status=draft、business_review=pending；source_verified_by_calculator=false。逐行包含来源、输入、中间值、预测1、预测2、推荐基线、final_forecast、amount=null、问题及状态。
calculated 只表示该行公式可计算，不能解释为业务审核完成。partial/blocked/excluded 的 final_forecast 为 null。覆盖统计只针对输入行，完整候选池覆盖仍为unknown，不自动求跨单位总量。

退出码2表示文件/整体约定不合法；行级阻断仍返回完整报告、退出码0，调用方必须检查coverage和每行status，不能把退出码0当成全部成功。

未来只读数据需求：主数据与可售范围、客户组织、历史发货、当前计划/拉货、增长规划、价格、库存/货龄、政策和节令日历。接口名、鉴权、字段映射、分页完整性、截止时间及客户权限需另行确认；本文件不是 MCP 注册清单。
