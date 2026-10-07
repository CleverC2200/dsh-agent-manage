# Agent note：接收模拟业务资源

Status: implemented

客户库存、订单工作台和订单履约原型保留原页面标识及本地交互。Manage持有原Prompt、Skill和空MCP能力声明；Workbench组装页面与资源文件，GEA只登记view范围的页面grant并拒绝mock的SQL。选用资源复用官方Core Session流程，不发送模型请求。

本决定补充[业务资源归属](../architecture/2026-10-01-business-resource-ownership.zh.md)，不新增资源登记、凭据存储或Consumer授权。筛选和分页归当前页面与Session；订单报告临时演示任务保留原重置规则。

区域页也保留已有 `gea-regional-plan` 页面标识和原 `plan-regional` Prompt、Skill及空MCP声明。当前作者持有原模型、可见筛选目录和模拟上下文。日期、模块、提报维度与未保存节奏编辑按同一Core Session恢复，派生上下文在恢复后重新自报。资源选用和撤回沿现有Manage owner；不恢复旧conversation适配。
