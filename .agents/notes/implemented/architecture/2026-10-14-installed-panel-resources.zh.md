# Agent Note: 已安装面板资源的读取与变更

Status: implemented

## Problem

读取一个已安装资源会加载全部用户资源和完整市场总览。安装事实来自第二次目录观察，写入后还依赖路由另行通知运行时。

## Decision

`Catalog.readInstalledSuites` 捕获同一份安装状态，只扫描选中的已安装来源。`PanelResources` 先解析已安装资源身份，再读取对应正文；用户名称直接交给用户存储。停用的安装项继续显示其禁用状态。

资源写入由 `Catalog.changePanelResources` 与目录变更串行执行。成功后使发现缓存失效，并等待运行时通知。路由只解析和委托，校验失败不通知。真实路径校验、外部源只读及 manifest 内联资源保护仍由资源 module 维护。

## Alternatives considered

再缓存一份市场投影会重复安装状态与失效规则。让路由继续通知，则每个新调用者都必须记住写入次序。现有 Catalog 已持有安装事实和变更流程，无需增加第二份状态。

## Consequences

单项读取不探测无关市场 checkout，也不加载无关资源正文。已安装资源继续复用既有有界发现缓存，不新增缓存或持久格式。写入后若运行时通知失败，仍在文件已改变后报告失败，保持原语义。本源码决定不证明客户端装载或业务验收。

[English](2026-10-14-installed-panel-resources.md)

PanelResources 现直接拒绝插件源更新与删除。[Agent 配置入口](../feature/2026-10-04-selected-business-resources.zh.md#已退役的配置入口)替代原受管源写策略，已安装资源读取与个人资源串行写入保留。
