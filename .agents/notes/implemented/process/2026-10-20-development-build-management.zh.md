# Agent Note: 开发依赖与构建管理

Status: implemented

## Problem

重复准备重装有效依赖、复制任务产物，导致本机空间耗尽。Manage 缺少另外两仓已有的原生环境入口。

## Decision

相邻 GEA 的[开发入口](../../../../../dsh-gea-plugin/docs/development-builds.md)持有共享准入、核验复用和输出报告。Manage 保留固定管理器与锁。显式构建 wrapper 保留 Host/client 编译并接入容量准入。冻结准备关闭隐式 prepare 构建；只有官方 SDK 依赖回执有效才跳过安装；仅命中编译产物时仍在 owner 独立 Core checkout 准备依赖。

本决定仅扩展[登记 SDK 决定](2026-10-04-one-official-sdk.zh.md)的准备和输出归属；消费者只读输入、运行 peer 和模块边界保留。[双 Core 决定](2026-10-10-two-official-core-releases.zh.md)继续持有版本兼容范围。

## Alternatives considered

**跨任务共享可写 node_modules 或 lib。** 并发修改和本地链接路径使其不安全；内容缓存和经核验产物可复用。

**同时迁移所有锁与运行时打包。** 这会改变本轮无关的安装合同，现有管理器继续固定。

**新增全局调度或自动清理。** 原生动作和小型本机准入记录已覆盖这些入口；未知、在途产物和用户资料需要明确核读者。

## Consequences

容量不足会在安装、编译或写包前拒绝。报告保留来源并保护隔离验证用户数据。准入不保留操作系统配额。依赖复用核元数据和直接依赖 manifest，不证明每个传递依赖字节完整。CI、安装接收和正式业务验收分别留证。
