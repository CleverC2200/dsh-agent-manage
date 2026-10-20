# Agent Note: 唯一登记的官方SDK

Status: implemented

## Problem

开发依赖与类型路径曾描述不同DSH版本，浏览器metadata还声明已移除client-runtime module。

## Decision

Host和Client都消费本票登记的固定官方标准包的真实开发依赖与匹配peer。当前exports生成类型map，不沿用已撤invariant子路径。旧client-runtime metadata退出。Catalog、原资源发布/正文参考读取、纯计算和MCP归属保持现有module。

[UI 基线决定](2026-09-29-source-core-ui-baseline.zh.md)继续保留 Regular 图标与 React 去重理由。本决定只部分替代其 SDK/版本选择事实。

## Alternatives considered

**保旧npmSDK只覆盖类型。** 这样真实import与验证目标会不一致。**添加alias或兼容层。** 原决定时本项目只有一个登记的运行 release，没有需要额外层的真实 caller。后续两版决定替代该运行范围，继续使用相同公开接口。

## Consequences

开发检查前须有只读的官方标准输入。源码门禁与完整测试不代表最新版实际客户端行为。插件不修改/构建SDK或Core，不复制用户状态；资源owner/取消和Consumer隔离保持。

[两版已登记的官方 Core](2026-10-10-two-official-core-releases.zh.md)部分替代单版运行 peer 决定。已登记的 alpha.1 开发 SDK 和既有 module 归属保持。

[开发构建管理](2026-10-20-development-build-management.zh.md)扩展本机准备与容量准入，消费者 SDK 继续只读。
