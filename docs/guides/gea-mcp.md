# GEA MCP after login

Load the updated `dsh-gea-plugin` and `dsh-agent-manage` in the same Cordis service scope. The market automatically waits for GEA login, creates an authorized gateway business session through GEA, then connects to `/ai/gateway/mcp/proxy/mcp` and discovers tools under `mcp__gea-gateway__…`.

The default Consumer is `AGENT` with the GEA deployment's `analysisAgentCode`. Only that Agent's granted tools are visible. To use another **already registered** Consumer, configure the market plugin:

```yaml
geaMcp:
  consumerType: CLIENT_APP
  consumerCode: your-registered-client-code
```

Set `geaMcp: false` to disable this integration. Omitting it enables automatic integration when the GEA service exists; absence of GEA does not block the market.

GEA keeps login and delegation tokens in memory. The market receives a restricted fetch capability, never the login token. It does not save this connection to `mcp.json`, headers, or credentials settings. MCP SDK owns initialize, transport session headers, tool discovery and calls; GEA injects business authorization into `params._meta`, leaving `arguments` unchanged. Tool calls remain subject to host confirmation and GEA server checks.

Logout, environment change, login expiration detected by GEA, or either plugin's teardown cancels old work and removes tools. A late login-generation response cannot remount tools. Failed discovery emits a credential-free diagnostic; re-login after resolving the Consumer authorization or transport failure. There is no blind session recreation, reconnect or business-call replay. Host conversations share the mount's login-generation business session.

Local tests cover contract and lifecycle behavior; target-environment deployment, actual Consumer grants and business operations require separate live acceptance.

Sources: [MCP contract](https://gea.synear.cn/docs/integration/contracts/mcp-tool-schema), [business-session contract](https://gea.synear.cn/docs/integration/contracts/session-context).

For local acceptance, verify the profile actually loads the rebuilt market entry: an older installed package will not gain this feature just because the checkout was built. Observed gateway entries show discovered tools and an informational ownership hint; their configuration is not editable in the market.

GEA MCP calls and model-visible tools are restricted to the local DSH `gea-readonly` preset (the demand forecast entry). Set `geaMcp.agentPreset` alongside the Consumer fields to choose another local preset. Consumer authorization and local preset selection are separate boundaries. Other presets and calls without an Agent are denied; login refreshes, live agents, new agents and empty-session preset switches retain this boundary. Agents inheriting the same preset also inherit access. The host MCP status remains visible for diagnostics. Hosts without `agents` or `agentPresets` do not mount this integration.

The same preset boundary also covers the legacy `gea_sales_plan_read` tool, keeping the standard preset free of GEA business-query capabilities.
