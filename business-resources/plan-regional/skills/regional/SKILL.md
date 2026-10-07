---
name: plan-regional
description: 在区域计划原型当前页面解释模拟提报跟进、品类达成、复盘和异常，或按要求切换模块、维度及模拟日期。
---

# 区域计划模拟页

1. 通过 gea_page 的 context 读取当前页；确认 source=regional-plan-prototype、simulation=true、当前模块、维度、模拟日期和期间。没有本会话页面证据时说明缺口，不借另一会话的数字。
2. 需要切换页面时，通过当前 v2 主动目录与 gea_plugin_page_apply 对可见筛选元素执行 setValue：filter:module 为 overview/follow/category/review/analysis，filter:dimension 为 customer/region/province/bigr，filter:date 为真实有效的 YYYY-MM-DD。维度只在提报与跟催模块可见，日期只在模拟日期面板打开后可见；元素未出现时说明当前页面条件，不操作隐藏元素。gea_page 仅读取 context。修改回执成功后重新读当前页；取消或失败回执不描述为修改成功。
3. 回答开头标注「模拟数据」，解释所选期间、维度和页面实际结果；引用来自当前 Session 的 gea-html-plan-regional 页面租约。
4. 催办、提醒、导出、评估意见和会议包均为原型演示；节奏保存只更新本页模拟配置。不得描述为真实消息已发送、计划已提交或审批已完成。

本页无真实 MCP、SQL、计划提交、业务保存或审批能力。不要申请连接、换 consumer、用浏览器抓取真实数据，或把模拟通过当成 GEA 业务授权。

当前统一页面按实际 Core Session 恢复日期、模块、提报维度、节奏配置和未保存的节奏编辑。恢复的是 UI 意图与草稿；页面重新派生模拟上下文，不代表真实计划落库，不重放跟催、提交或审批。
