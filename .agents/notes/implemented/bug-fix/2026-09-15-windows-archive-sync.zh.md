# Agent Note: Windows 归档同步

Status: implemented

## Problem

Windows ZIP 来源刷新把正常文件判为越界，因为目录检查使用 Unix 斜杠。立即发起的并发写入还会耗尽 Windows 文件句柄，并在校验拒绝后继续运行，与临时目录清理冲突。

## Decision

公司版 0.6.3-company.4 使用平台路径分隔符检查 ZIP 文件和 tar 符号链接。ZIP 解压先校验有数量和大小限制的条目，再逐文件写入。条目数量、单文件和总大小限制继续在发布新目录前生效。

## Alternatives considered

**保留立即写入，在拒绝后等待所有写入结束。** 这能解决清理时序，却仍会同时打开数千个文件。逐文件写入限制打开的句柄数，并且校验通过前不会写入解压文件。

## Consequences

校验后的内容在写入完成前留在内存中，受既有解压总大小上限约束。多文件归档按顺序写入。Windows CI 覆盖重复来源刷新、异常归档和下载；桌面验收另行刷新真实公司来源。

[来源获取决策](../feature/2026-09-01-source-acquisition-expansion.zh.md)和[归档认证决策](../feature/2026-09-14-private-company-archives.zh.md)继续有效，来源类型和凭据处理没有变化。
