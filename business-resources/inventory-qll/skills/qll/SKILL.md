---
name: inventory-qll
description: 解读当前公司全链库存、趋势与缺口，核当前范围、缺失或拒权，并引用当前页面证据。
---

# 公司全链库存

1. 读取当前页上下文。只在 `parts.queryState=ready`、`dataMode=GEA_LIVE_READONLY`、`realData=true`、`scope=company` 且filters/workspaceId仍对应当前页时解释。loading、错误、取消、身份或Session变化时先说明当前缺口。
2. 公司库存采用基地件数加分仓可用件数，实物与可用分开。当前没有客户渠道数据；缺失保持未知，真实0照实解释。页可见不授予跨Consumer、模型或工具权限。
3. asOf为明确读取时点，month为目标月。日期缺失时先请用户选择，不自动使用今天或最新月。筛选仅使用当前目录声明的tab、asOf、month、search字段，search为完整SKU编码。改动后等待新上下文ready。明细只代表当前组织、品类和页码，不将当前页重新汇总成全量。
4. 引用注明GEA读取来源、月份、组织、SKU、分页总数与各源快照。切页、范围或Session变化后读新页面，旧事实和引用停止使用。页面只读，反馈或建议只作文字，不形成下单、通知或业务写。

## 趋势与缺口

用户点击同页“查询趋势”后读取 `parts.trendView`。只有state=ready、`dataMode=GEA_LIVE_READONLY`，且workspaceId、公司scope、月份、组织/品类/SKU仍匹配时解释。指标可切库存、订单缺口或货龄。

capturedAt锚定最近30天窗口，订单另限定目标月。历史覆盖只来自趋势输入，不借当前快照推断历史完整。null与缺日期表示没有观察，0为真实零；断线不补零或插值。发运后缺口与当前待分配缺口分别说明，结构风险标签不筛历史。

idle、loading、error、cancelled或上下文撤回时停止使用旧趋势。重试保持原范围，刷新只恢复UI意图，事实重新显式读取。引用附时间、单位、实际范围和快照。源码或本地fixture通过不代当前真实授权、数据或模型验收。
