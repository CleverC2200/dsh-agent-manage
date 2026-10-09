# Agent Note: 个人库存模拟接收

Status: implemented

## Problem

个人库存候选有可保留的日监控和反馈行为，但打开原页会发真实查询。本批46只授权固定模拟接收。

## Decision

Manage按原身份声明个人资源，并写明模拟证据规则。Workbench持有页面和固定输入；Core持有真实Session与未发送对话草稿。页面通过现有按Session分隔的view state保存未提交反馈字段，再通过Core公开编辑事件追加文字。

## Alternatives considered

**恢复真实reader。** 这会扩大已授权数据范围，所以当前接收产物没有真实reader。

**发送conversation动作。** 原动作会排入模型Task。反馈按钮因此只插入未发送文字。

## Consequences

默认入口可见性保持。模拟值和模拟拒权不关闭原26真实授权与Native条件。历史候选和失败证据保留。现有活动说明中没有相同个人接收决策的owner。
