# Agent Note: 仅使用当前 Agent 生命周期

Status: implemented

## Problem

项目运行时同时监听当前 Agent 创建事件和已不支持的宿主启动事件。

## Decision

项目表面通过异步 `agent/created` 初始化，通过 `agent/disposed` 释放；删除旧事件及扩宽的宿主类型。装载时仍给已存在的 Agent 挂载项目能力。

## Alternatives considered

保留双事件家族会继续支持本隔离项目已取消的旧宿主。

## Consequences

项目命令在首次模型请求前完成初始化。测试保留等待初始化和挂载释放验证。市场布局、MCP 传输及持久用户数据的业务行为不变。
