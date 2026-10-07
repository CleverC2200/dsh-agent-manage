# 库存计算合同

Manage 拥有 `src/inventory-compute`。package 的 `./inventory-compute/*` 提供用于页面编译装配的 `source` 条件，以及包调用者使用的 JavaScript 与类型声明。此接口不增加工具、模型路由或 HTTP 入口。

| 公开模块 | 输入与结果 |
| --- | --- |
| dealer-order | 客户、SKU、已核提货点和政策有效期决定可用政策。订单行返回数量与可空金额。 |
| dealer-dashboard | 已收窄的 Cube 行返回原覆盖、汇总、去重、货龄与业务规则结果。Workbench 保留读取、客户授权、查询上限和分页。 |
| dealer-overview-facts、dealer-recommendation、dealer-status-filters | 保留原来源优先级、覆盖、临期、季节排除、补货数量与业务状态。 |
| personal、personal-sources、daily-report | 来源值返回加权货龄、已知/部分合计、固定货龄分段、来源风险与库存对象。 |
| full-chain-workspace-service、full-chain-category-structure、full-chain-customer-metrics、full-chain-types | 输入事实、筛选、固定时间与已收窄范围返回原公司/客户指标和趋势。传入范围本身不授予权限。 |

Workbench 直接引用这些公开模块。构建从声明的 `source` 导出解析源码，并在 `build-inputs.json` 记录实际消费的全部 Manage 源码、配置及 package 元数据 hash。计算随页面编译，浏览器不导入 Host runtime。Workbench 继续持有固定输入加载、来源权限裁切、页面状态、分页、取消、引用和快照生命周期。数据授权仍归 GEA。

固定 Git golden、现有个人库存货龄/部分输入和全链测试继续提供独立预期。个人库存原日报与首批 AQKC 日报在来源选取和风险截断上采用不同规则，本次迁移不替换首批规则版本。计算模块不验证真实业务授权。
