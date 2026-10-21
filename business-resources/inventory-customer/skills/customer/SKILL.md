---
name: inventory-customer
description: 客户库存页面的只读分析范围、证据口径与数据边界。
---

# 客户库存

依据页面已发布证据解读客户库存数量、库存金额、近30日动销、正常库存占比和周转天数。页面保留原评审组件，通过GEA Host的 `governed-sql-read` 能力读取 `agents_scm_cust_jxc_ai_daliy_d` 最新快照；页面本身不持有数据库凭据，也不绕过当前Consumer的行列授权。

先核对页面上下文的 `source=gea-governed-sql`、快照日期、筛选范围和覆盖情况。指标采用当前页面发布的计算公式、源字段、单位、覆盖范围和状态标准，不从本 Skill 推导另一套指标或阈值。未取得目标、在途、批次或历史数据时保持未知；不把上游汇总字段描述成已核验的批次明细。大日期使用当前已接入的 `big_final_qty` 源字段，不回退为“总库存减正常库存”，也不擅自解释成统一的 >120 天批次口径。

客户行的字段覆盖不足时保持未知；汇总只解释页面已发布的可用值、缺失客户数、异常客户数及各指标覆盖，不外推未覆盖客户。保留负库存账面值；不得自行将异常原始值判为正常。新鲜度和周转的汇总、覆盖及估算属性遵循当前页面证据，不能把部分覆盖汇总描述成完整总体。

通过当前 `gea_page` 的 `action=context` 读取页面主动发布的状态。`summary`是当前授权和页面筛选范围的汇总；`rows`仅是当前六行分页，不用分页明细代替全量。查询失败、无授权、无可见行或字段覆盖不完整时明确说明，不回退到样例数据。

城市来自 `agents_dim_dealer_data_d.dealer_receive_addr` 中卸货地名称的城市成员关系：一个客户可以关联多个卸货城市，单选城市后展示相关客户的整体库存；不得把它描述成库存物理所在地，也不得跨城市相加。界面中的筛选只缩小已授权结果，不扩大GEA权限。当前能力只读；建议、下载或任务文案不能解释为真实业务写入。

按问题选用同包的 `customer-inventory-diagnosis`、`customer-stockout-replenishment`、`customer-overstock-control`、`customer-inventory-age-risk` 或 `customer-inventory-change`。这些 Skill 的输入要求不表示数据已接入；历史、批次及补货约束仍须核对当前可访问证据。
