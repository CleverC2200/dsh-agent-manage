# Agent Note: 经销商固定输入接收

Status: implemented

## Problem

原经销商候选打开页面即读取真实数据，超出下一批已授权的本地输入范围。

## Decision

原接收以登记本地模拟输入保留经销商规则和完整分页接口。当前 `inventory-dealer/capability.json` 与 `mcp.json` 在原 Consumer 下声明十表及 `governed-sql-read`，源码扩展替代仅模拟声明；固定输入继续作为离线证据。[接收记录](../../../../docs/adr/2026-10-07-dealer-mock-reception.zh.md)区分原范围与未完成验收。

## Alternatives considered

**保留自动真实读取**超出本批数据授权。

**替换成样例页**会丢失本批要求保留的健康、覆盖和建议计算。

## Consequences

原模拟回执只证明固定本地输入，当前读取声明不证明 transport、身份、行权限或正式数据。原票16真实授权与验收仍未关闭。
