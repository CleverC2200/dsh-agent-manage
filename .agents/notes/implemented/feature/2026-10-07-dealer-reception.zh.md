# Agent Note: 经销商固定输入接收

Status: implemented

## Problem

原经销商候选打开页面即读取真实数据，超出下一批已授权的本地输入范围。

## Decision

页面保留原规则与完整分页接口，数据来自登记的本地模拟输入。Manage保持原Consumer标识，发布明确标记mock的资源，见[接收记录](../../../../docs/adr/2026-10-07-dealer-mock-reception.zh.md)。

## Alternatives considered

**保留自动真实读取**超出本批数据授权。

**替换成样例页**会丢失本批要求保留的健康、覆盖和建议计算。

## Consequences

当前本地结果可在零业务查询的条件下验证。原票16真实授权与验收仍未关闭。
