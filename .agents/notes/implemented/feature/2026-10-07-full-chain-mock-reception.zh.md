# Agent Note: 全链分布模拟接收

Status: implemented

## 问题

固定分布候选需要接入当前统一页面与资源接口，本批没有新增真实数据授权。

## 决定

Manage将`inventory-qll`声明为固定mock，tables和MCP能力为空。Workbench拥有恢复的业务计算、本地固定输入、UI意图和当前Session页面引用。现有Consumer标识只表示模块，不授予查询能力。

## 其它方案

默认真实查询会在打开页面时超出本批范围。第二资源或Session权威会重复当前归属。历史真实查询源码由原Git对象保留，后续按单独授权接收。

## 影响

原公司与客户单位、null与零值规则保留。模拟行筛选只证明本地行为；真实客户数据、行权限和原14整票仍未完成。本决定收窄[资源归属说明](../architecture/2026-09-29-workbench-business-resources.zh.md)中的当前分布模式，原说明继续拥有资源装配与清理合同。
