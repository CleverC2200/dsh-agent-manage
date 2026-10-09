# Agent Note: 当前 Agent 知识与引用检查

Status: implemented

## Problem

默认 Agent 入口仍使用旧市场包身份，并用历史发行和 SDK 假设指导隔离工作。活跃记录还将已退场监听与资源发布写成当前实现。

## Decision

AGENTS 指向 current-development，定位当前职责和固定输入。命令、版本与导出归 package 配置。Manage 声明当前引用并调用 Workbench 的 check-agent-knowledge CLI，不另实现检查引擎。历史设计/发行/研究和归档仍作为明确历史参考。

现行 Note 更新实现事实并指向当前 owner。部分替代保留独特理由；SDK/图标、工作区、项目生命周期和业务资源仍各归既有记录。当前公司源码接收不升级为真实验收。

## Alternatives considered

**按年龄或数量删除旧记录。** 会丢失仍有用的存储、取消、包归属与单位理由。

**每仓复制命令表和独立检查器。** 命令事实已有 package owner，一个开发期检查器避免规则冲突。本仓只声明活跃输入并消费同一接口。

## Consequences

检查器只核本地引用和声明命令/路径；正文事实与决定范围仍需审查。归档 outgoing links 不读取或修复。引用检查、AST/公开导出对照及适用契约/架构测试不证明 CI、已准备 SDK 产物或真实业务授权。
