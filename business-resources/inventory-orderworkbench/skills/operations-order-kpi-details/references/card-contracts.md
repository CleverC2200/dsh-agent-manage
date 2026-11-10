# 当前指标调用约定

六指标（作废率、改单率、订单满足率、准交率、货龄占比、可发货天数/周转天数）统一使用 gea_order_kpi。该工具与本地看板共用查询、计算和口径合同；不需要先打开页面。其他订单、库存和业务知识问题继续按相关 Skill 使用已授权 Cube 和知识库，不强行转成卡片指标。

口径只由已安装代码返回。调用 gea_order_kpi，view=contract 读取定义及版本，view=summary 读取同口径数值，view=details 读取已发布明细。参数为 metric、start、endExclusive、base、view、page；卡片核对附 expectedVersion。不在此文档复制公式、SQL、字段映射或目标阈值。兼容入口 gea_order_amendment、gea_order_ontime 仍执行同一共享运行时。
