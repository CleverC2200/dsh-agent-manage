<!-- collaboration-record
{"kind":"change","id":"CHANGE-20261030-dsh-agent-manage-mps-calculation","date":"2026-10-30","title":"MPS大类需求纯计算","module":"MPS","status":"已验证待发布"}
-->

# MPS大类需求纯计算

新增公开纯函数computeMpsCategoryDemand：期初前4至前2月、纠偏前3至前1月，三年全国大类等权系数、两法均值与计划达成率，以及年度分月环比延展。只计算，不读取数据或写业务。

保留现有MPS拆分函数与资源接收合同，缺值、缺年和零分母继续返回空；不恢复旧40/40/20权重。

纯计算10项、类型检查、资源接收及开发Mac两口径实际页面和导出对账通过。人工调整与正式保存仍未接入。

本轮仅发布插件 0.6.3-company.40，Core与桌面壳未修改。版本、源码与锁经PR进入main后才构建发布；尚未发布。发布技能为本机local_draft，没有已登记团队维护源，不声称团队技能已同步。完整主线SHA、候选、CI与最终发布身份由PR及发行回执绑定。
