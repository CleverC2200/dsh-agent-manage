# Agent Note: 标准存储启动与运行时转换退出

Status: implemented

## Problem

激活原先在提供当前资源前搬移旧存储条目，并导入旧 MCP 后端文件，因而把用户拥有的文件当作启动升级输入。本次隔离官方宿主重构使用当前接口并保留原用户数据；普通激活不是搬移或重新解释旧存储的授权。

## Decision

Manage 只解析当前 `$DSH_HOME/agent-plugins` 根及其 `data` 目录。`apply` 在运行时副作用前，以 `MANAGE_STORAGE_UPGRADE_REQUIRED` 拒绝包含旧 `userRoot` 或 `dataRoot` 的配置。当前五个目录（DSH_HOME、插件根、data、user、.sources）通过 `lstat` 核对，拒绝符号链接；只有路径不存在可以继续，其他错误原样抛出。该检查不创建目录，也不访问旧树。

运行时迁移实现和旧后端 `settings.json` 读取器已删除；当前设置 schema 与标准 MCP 挂载及 transport 保留。激活中的升级路径不读取、搬移或删除原文件；必要转换需要另行授权任务。

本决定部分取代[工作区用户面板](../feature/2026-09-06-workspace-tabs-user-panels.zh.md)中的存储激活迁移部分。标准目录、自建 Markdown、安装状态，以及外部和项目 source 的归属继续沿用该笔记。

## Alternatives considered

**保留自动合并和导入。** 原启动把格式错误、冲突和 checkout 归属一起保护，避免部分搬移；这些保护并不授予搬移权限。增加选项保留实现仍会延续本轮要求退出的运行时兼容层。

**删除旧文件或清空存储以便启动。** 这会丢失用户的恢复输入并违反已有归属规则。原数据留在原路径。

## Consequences

新的标准 profile 不读取旧根即可激活。仍包含旧根配置的 profile 明确失败，直到调整配置或单独授权升级。现有当前设置仍可选择 MCP 后端并重挂载。公开 `apply` 测试验证挂载前拒绝及五个受保护目录链接后的原数据保留；已有 apply/backend 测试覆盖标准启动和当前设置。
