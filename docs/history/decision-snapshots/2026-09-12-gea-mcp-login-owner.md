# GEA MCP login ownership / GEA MCP 登录归属

Status: accepted / 已接受

The GEA plugin owns user authentication and gateway business sessions. The market consumes a versioned in-process fetch capability and owns MCP transport and tool registration. This keeps login credentials out of persistent marketplace configuration and separates optional GEA integration from ordinary suite reconciliation.

GEA 插件拥有用户认证和网关业务会话；市场插件消费版本化的进程内 fetch 能力，负责 MCP 传输和工具注册。这样可避免登录凭证进入市场持久化配置，并让可选 GEA 集成独立于普通 suite 协调。

Decision, alternatives and lifecycle consequences: [Agent Note](../../.agents/notes/implemented/feature/2026-09-12-gea-login-mcp.md) / [中文决策记录](../../.agents/notes/implemented/feature/2026-09-12-gea-login-mcp.zh.md).

GEA MCP calls and model-visible tools are restricted to the local DSH `gea-readonly` preset (the demand forecast entry). Set `geaMcp.agentPreset` alongside the Consumer fields to choose another local preset. Consumer authorization and local preset selection are separate boundaries. Other presets and calls without an Agent are denied; login refreshes, live agents, new agents and empty-session preset switches retain this boundary. Agents inheriting the same preset also inherit access. The host MCP status remains visible for diagnostics. Hosts without `agents` or `agentPresets` do not mount this integration.
