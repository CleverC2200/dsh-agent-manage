# Agent Note: Received mock business resources

Status: implemented

## Problem

客户库存、订单工作台和订单履约已有原型页面与原Agent资源。只有静态页面而没有业务资源声明时，用户无法在页面的Session中选用这些Prompt和Skill。接收原型需要保留原模拟交互和资源原文。

## Decision

原型保留原页面标识及本地交互。Manage持有原Prompt、Skill和空MCP能力声明；Workbench组装页面与资源文件，GEA只登记view范围的页面grant并拒绝mock的SQL。选用资源复用官方Core Session流程，不发送模型请求。

本决定补充[已选原生业务资源](2026-10-04-selected-business-resources.zh.md)，沿用其资源选用和归属契约，不取代该决定。筛选和分页归当前页面与Session；订单报告临时演示任务保留原重置规则。

## Alternatives considered

**保留当前静态页面，不补业务资源声明。** 页面仍可展示，但原Prompt和Skill无法通过当前资源选用与Session流程使用，不能满足接收已有业务资源的要求。

**重新建立独立业务插件。** 这会重新拆出页面与资源owner，与已确认的Workbench、Manage、GEA职责冲突。本项目要求原型进入共享装配。

## Consequences

共享装配保留原资源正文与页面交互，不新增资源登记、凭据存储或Consumer授权。Workbench装配依赖相邻Manage的资源文件。页面操作意图可在当前Session恢复，本地报告任务在重新打开页面时重置。页面仍是模拟原型，本次接收不增加业务查询、任务派发或模型请求；本地检查不代替Native或业务授权验收。

现有静态MPS页通过同一装配接收 `business-resources/inventory-mps`，保留原Prompt、Skill和consumer标识，当前MCP能力为空。作者步骤在React提交后发布数据，卸载时移除。界面意图、调整输入和未发送文字归当前Session，模拟派生结果重新计算，不存业务库。资源来源摘要保留历史声明。
