# Agent Note: Fork package identity

Status: implemented

## Problem

仓库已归属 CleverC2200/dsh-agent-manage，但包配置、安装文档与反馈目标仍指向上游，可能让安装或反馈落到错误项目。

## Decision

包名、Cordis bundle 和服务端/客户端导出身份统一为 dsh-agent-manage；仓库、维护者与反馈目标指向 CleverC2200/dsh-agent-manage。文档使用 GitHub 安装来源，不假定新 npm 包已发布。文档站配置更新为 fork 的目标地址，不代表已经部署。

已有设置命名空间、UI 标识、API 与数据路径保留兼容。旧包替换需先移除旧 profile 插件条目，避免双重加载。历史发布、版权和外部 schema 来源保持原始身份。

## Alternatives considered

**只改 repository 字段。** 包身份和实际反馈目标仍会落在上游，因此不足以修复当前问题。

**全量替换所有旧名称。** 会改变持久化设置和数据标识，并误写历史证据，因此不采用。

## Consequences

新包发布权限、GitHub Pages 部署和实际宿主替换尚未验收；本次不发布。此决策仅更新反馈工具的仓库归属，既有 workspace-tabs-user-panels 决策中的设置开关、注册和本地回退机制保持不变。
