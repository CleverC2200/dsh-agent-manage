# Agent Note: 公司全链真实读取接收

Status: proposed

## 问题

已接收模拟页不能验证当前公司数据或Consumer授权。整体恢复旧查询入口会带回pool默认入口、独立channel和Workbench计算副本。

## 方案

公司切片使用当前GEA页面grant和公开access/SQL通道。Workbench持有固定公司查询、完整分页、取消和Session范围内临时事实。Manage持有源行归一化、数量与速度规则及现有公开计算。GEA保持唯一身份与Consumer授权，并以Host生命周期的固定额度计物理SQL请求，包括分页和续期后再次请求。

公司与客户单位分开，本切片没有客户查询或客户拒绝后的兜底读取。取消、范围/身份/Session变化及刷新撤下事实和收窄引用。UI意图可恢复，历史事实显式重新读取。当前300个目录名额保持298个结构条目、刷新及一个趋势引用。缺日期保持断线，订单历史保留目标月。

## 当前源码范围

公司查询声明、范围内归一化与公开计算已在当前源码 checkout 接入。本提案保留下述验收条件；源码接线不是当前身份、行权限、客户数据或模型回执。[模拟接收](../../implemented/feature/2026-10-07-full-chain-mock-reception.zh.md)的运行时模拟模式已在源码中部分替代，单位、null/zero、fixture 来源及目录语义仍有效。

## 其它方案

**保留运行时mock分支**不能证明真实数据，会混合演示与真实来源。历史46/47包与本地fixture保留原模拟接收。

**整体恢复旧服务器adapter**会重新引入pool归属、第二channel及重复计算。只选择已登记固定查询与映射输入。

**统计UI动作或发出后看日志**不能约束分页、续期或取消后的已发请求。Host在每次物理SQL前检查，额度0在凭据前拒绝。

## 验收条件

当前reader、Manage计算和GEA传输经公开合同验证。捕获公司输入与原绑定JSON汇总一致。范围、完整分页、可选字段缺失、取消、迟到和预算有可观察证明。受审普通包、安全开窗与当前身份/范围成立后才实际验收，源码或synthetic fixture不关闭原14/15。

## 风险

原raw capture未直接进入旧阶段manifest。新有界样本核SHA并关联原未变选择脚本和对照结果，不声称当前数据库相同。客户与模型分别守门。

本方案接收后替代[模拟接收决定](../../implemented/feature/2026-10-07-full-chain-mock-reception.zh.md)的当前运行模式，保留其单位、null/零、fixture权限边界和目录规则。[计算归属](../../implemented/architecture/2026-10-07-inventory-calculation-ownership.zh.md)继续有效。
