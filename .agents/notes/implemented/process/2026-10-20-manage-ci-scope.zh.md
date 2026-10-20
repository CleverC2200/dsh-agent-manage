# Agent Note: Manage CI scope

Status: implemented

## Problem

CI 路由回归反复复制并解析完整仓库，即使用例只验证真实策略的一条路由规则。已禁用的上游 npm 与 Pages 工作流仍留在可执行目录，而当前交付已归 GEA。

## Decision

策略路由夹具读取真实策略，发现当前测试文件名。实际脚本消费者和传递 Host 回归保留完整源码快照。断言、测试池与生产选择器保持。

上游 npm 与 Pages 工作流按原字节移入[历史目录](../../../../docs/history/upstream-workflows/README.md)。质量、兼容性和 CodeQL 工作流继续执行，当前插件交付归 GEA。

本决定替代[发版版本模式](2026-09-10-release-version-modes.zh.md)中的可执行发行入口，原版本选择原因保留为历史。

## Alternatives considered

**删除慢的选择断言。** 这些断言仍保护当前策略和执行归属，缩小夹具即可保留它们。

**把旧工作流继续禁用在原位。** 它们不服务当前交付，历史目录已能保留原件。

## Consequences

路由夹具不再解析无关实现，完整快照仍覆盖真实导入传播。本次不减少业务、资源或 Session 测试，不改变源码准入、SDK 完整性、适用平台和安全门禁或发布授权。[干净 CI](../../../../docs/clean-ci.md)持有当前入口。
