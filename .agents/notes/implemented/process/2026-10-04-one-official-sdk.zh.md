# Agent Note: 唯一登记的官方SDK

Status: implemented

## Problem

开发依赖与类型路径曾描述不同DSH版本，浏览器metadata还声明已移除client-runtime module。

## Decision

Host和Client都消费固定官方5badb150标准包的真实开发依赖与匹配peer。当前exports生成类型map，不沿用已撤invariant子路径。旧client-runtime metadata退出。Catalog、原资源发布/正文参考读取、纯计算和MCP归属保持现有module。

[UI 基线决定](2026-09-29-source-core-ui-baseline.zh.md)继续保留 Regular 图标与 React 去重理由。本决定只部分替代其 SDK/版本选择事实。

## Alternatives considered

**保旧npmSDK只覆盖类型。** 这样真实import与验证目标会不一致。**添加alias或兼容层。** 本项目只支持一个登记的当前release，没有需要额外层的真实caller。

## Consequences

Host 与 Client 只读消费已准备的官方标准输入。开发工具 `sdk:prepare` 可克隆固定 Core 源码，在准备任务独立持有的 checkout 中构建 SDK；原始与共享 Core checkout、symlink 和无归属目录仍受保护。[干净 CI 合同](../../../../docs/clean-ci.md)说明固定源码、原锁、归属标记与可选准备阶段。源码门禁与完整测试不代表最新版实际客户端行为，不复制用户状态；资源 owner/取消和 Consumer 隔离保持。
