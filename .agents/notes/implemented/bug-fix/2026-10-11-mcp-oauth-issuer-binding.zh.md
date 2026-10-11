# Agent Note: 将持久 MCP OAuth 凭据绑定到 issuer

Status: implemented

## Problem

配置的 MCP 服务可能声明另一个授权服务器。复用未记录原 issuer 的客户端密钥或刷新令牌，可能向该服务器泄露凭据。仅升级 SDK 无法确定旧凭据记录的来源。

## Decision

本地 OAuth provider 仅在客户端信息或令牌记录各自具有非空字符串 issuer 时提供该记录。MCP SDK 统一处理 issuer 比较、注册和令牌交换。保存操作保留包含 issuer 的完整 SDK 对象。旧记录仍保存在存储中，重新交互授权后才能确定 issuer 并复用凭据。

安全依赖更新针对现有依赖图中的受影响版本。精确的传递依赖覆盖保持其他 major 不变。文档站的缓存依赖版本超出通告列出的受影响范围，但原 max-stale 行为仍可复现。当前静态 Astro 图片加载器只返回图片字节、过期时间和校验标记，不提供共享的认证响应缓存。这次依赖更新不证明一般共享缓存用法安全。

既有 [GEA 登录集成决定](../feature/2026-09-12-gea-login-mcp.zh.md) 继续有效。它负责 GEA 持有的网关能力，不负责这里的独立 MCP OAuth 凭据流程。没有其他有效 Note 持有 issuer 绑定决定，因此没有被替代的 Note。

## Alternatives considered

**只升级 SDK。** 旧记录缺少 issuer 时，无法确定哪个授权服务器有权接收凭据，因此不采用。

**将新声明的 issuer 写到旧记录。** MCP 服务的发现结果无法证明已有密钥的来源，因此不采用。删除记录也会无必要地丢失可恢复的用户数据。

**升级整个依赖图。** 会给本次安全修复增加无关版本变更，因此不采用。生成的锁和冻结安装保留现有包管理器协议。

## Consequences

旧 MCP 授权需要重新认证。原存储记录保留，具有 issuer 的授权继续在匹配服务器上刷新。真实 SDK auth 回归测试覆盖同 issuer 刷新、issuer 变更发现、旧记录重新授权及无效 issuer 字段。本决定不新增 GEA 身份权威，也不改变业务授权。
