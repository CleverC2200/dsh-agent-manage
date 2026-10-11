# Agent Note: 业务资源元数据与清理失败归属

Status: implemented

## Problem

Manage 已解析 Skill 后，GEA 又解析一次，多行 YAML 说明得到不同结果。资源销毁将所有读取失败当作用户编辑，即使无法确认清理结果也释放归属。

## Decision

当前发布使用 `BusinessResources` 与目录 Skill 解析器。[已选原生资源](../feature/2026-10-04-selected-business-resources.zh.md)取代文件挂载，[异步释放归属](../bug-fix/2026-10-09-async-result-ownership.zh.md)负责失败的 Core preset 释放。当前没有写入或清理源 Skill 文件的 `loadBusinessResources` 挂载。

## 原文件挂载决定

`loadBusinessResources` 从既有目录解析器返回 `skillName` 和 `skillDescription`。清理保留 ENOENT 与后续编辑，其他读取失败明确报告，并保留归属。修复文件后，同一清理函数可完成释放。

## Alternatives considered

**修补第二套解析器**仍保留两个规则来源，后续 YAML 变动需要两处同步。

**吞错或自动放弃归属**无法区分用户主动修改与未知清理结果，还允许下一次挂载覆盖未解决状态。

## Consequences

当前 catalog parser 向原生发布提供 Skill 元数据。原文件挂载的清理失败会阻止重挂载，直到成功清理或隔离进程重启；该历史行为不授予绕过归属的权限。本记录描述隔离项目的本地实现，不代表生产发布。

[异步结果与释放归属](../bug-fix/2026-10-09-async-result-ownership.zh.md)把此规则扩展到 `BusinessResources` 的 Core preset 释放；原文件清理理由作为历史保留，当前元数据继续使用同一解析器。
