# Agent Note: 读取关联 MCP 资源

Status: implemented

## Problem

工具结果只提供链接时，模型缺少通过同一连接明确读取内容的方法。

## Decision

MCP 握手声明 resources 时提供同服务资源读取器。文本投影为写入记录的模型可见结果。读取共享连接销毁、超时与调用方取消，不把 URI 当作 HTTP 地址。

## Alternatives considered

**自动遍历，或把资源 URI 当作 HTTP 地址。** 明确的同服务读取避免无界遍历、意外下载和隐藏的模型上下文。二进制保持明确的非文本结果，不强行解码。现有图像准入决定不变；该决定扩展内容投影，不替代传输或图像记录。

## Consequences

文本保持明确工具结果，二进制保持非文本；取消、超时与销毁归原连接。

## Testing

桥的回归覆盖资源能力发现、准确 URI 转发、文本投影和 disposer 清理。
