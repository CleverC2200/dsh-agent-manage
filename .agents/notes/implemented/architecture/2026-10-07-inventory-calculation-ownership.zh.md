# Agent Note: 库存计算归属

Status: implemented

## Problem

本批经销商政策/指标、个人库存与全链业务计算仍在 Workbench 执行，但规格 46 把纯计算归属 Manage。只补资源声明没有解决归属缺口。

## Decision

`src/inventory-compute` 是本批单一实现。公开 `./inventory-compute/*` 同时支持源码装配和编译包消费。Workbench 通过该接口调用，读取、授权校验、取消、UI 意图和快照继续归 Workbench 与 GEA。输入/配置 hash 覆盖 Manage 实际消费文件。固定原算法预期保持不变。

本决定部分替代[全链模拟接收](../../implemented/feature/2026-10-07-full-chain-mock-reception.zh.md)中计算归属的说明。原资源声明、mock 范围与查询上限仍适用。现行资源归属与预测说明仍管理各自接口，本次不增加资源目录、工具或授权状态。

## Alternatives considered

**用 Workbench 包装保留计算。** 这会继续维持错误归属并让规则维护分散。

**新增 Host 工具或 HTTP 路由。** 确定性页面计算不需要另一执行路径或模型调用。编译装配保留页面生命周期与取消行为。

**用首批 AQKC 日报替换个人库存日报。** 二者来源选取与风险截断不同，会改变本次迁移之外的固定业务规则。

## Consequences

Manage 的类型、lint、格式和架构门禁覆盖算法。浏览器装配消费公开源码条件并记录 hash。此处只证明输入固定时的行为，不关闭原真实验收票或 Native 条件。为满足 Manage lint，删除原未使用的全链局部 `orderDemand` 和经销商 `metricLabels`。个人库存未使用的 `dailyReportTransport` 模式选择器已删除，不把 Session/旧传输路由公开为计算能力。这些语句没有当前结果消费者。全链输入获取移到 Workbench，公开计算只接数据与计算请求，不接 adapter。
