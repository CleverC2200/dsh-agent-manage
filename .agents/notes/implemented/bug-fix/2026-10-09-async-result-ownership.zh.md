# Agent Note: 异步结果与释放归属

Status: implemented

## Problem

市场请求失效后仍可能发布旧结果，或在最新请求失败后静默启动另一次请求。市场渲染也会启动 HTTP 和 busy 租约。preset 释放失败会丢失重试所需的信息。旧用户面板 kind 的保存完成后，可能把旧列表刷新进当前面板。

## Decision

`market-resource` 拥有缓存代际和当前代 Promise。失效时撤销旧代的缓存与在途归属。旧调用者等待当前代结果，包括已完成的失败，不自动重试。`readOverview` 只读快照；`MarketSection` 在提交后的 effect 启动读取。

Core 释放失败时，`BusinessResources` 保留 mounted disposer、版本和资源条目。变化后的 preset 不能覆盖尚未成功释放的旧挂载。显式 owner 释放与全插件 dispose 沿用现有操作队列；每次成功释放撤销对应条目，失败释放仍可重试。现有选择回滚报告释放失败，并保留 disposer 供显式清理。

工作台 skills、commands、agents 用户面板使用各自的 key。`UserPanelSurface` 同时拥有每个 kind 的有效期，直接变更 kind 或卸载后，旧 mutation 的后续逻辑不能再启动刷新，也不能发布错误或 busy 更新。当前 kind 的刷新继续沿用既有的最新结果序号规则。

本记录扩展[业务资源清理归属](../architecture/2026-10-01-business-resource-ownership.zh.md)，其原文件清理与元数据决定不变。它部分更新[工作区标签与用户面板](../feature/2026-09-06-workspace-tabs-user-panels.zh.md)中的面板操作有效期；共享 UI、Markdown 存储、路由与资源归属继续适用。没有完整替代任何活动 Note。

## Alternatives considered

**旧请求只返回缓存。** 当前代失败时没有缓存。此时调用 `loadOverview` 会静默重试并掩盖失败，因此资源保留当前代已完成的 Promise。

**先撤销归属再释放。** Host 释放拒绝后，挂载仍在，但重试句柄已经丢失；后续 owner 也可能覆盖该挂载。

**只给工作台面板加 key。** 它能保护当前显示状态，但卸载后的保存仍会发起旧 HTTP 刷新，也不能覆盖直接变更 kind 的调用。组件同时撤销这些后续动作。

## Consequences

离线测试使用真实资源、React 与 API 模块，只在 HTTP 与 Core preset adapter 使用 fixture。它们覆盖两种完成顺序、当前代失败、无 HTTP 或 busy 租约的渲染、释放失败与显式重试、替换拒绝、回滚以及部分和并发清理。这些验证不证明 Native 展示、真实授权、模型执行或生产发行。
