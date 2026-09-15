# Agent Note: Discover GEA MCP through the login owner

Status: implemented

## Problem

The market cannot discover authorized GEA tools from a transport URL alone. GEA login is process-local in a separate plugin, and MCP transport sessions do not authorize business calls.

## Decision

The optional `geaMcp` service v1 exposes login observation and an in-process transport capability. The GEA plugin owns creation of a business session and injection of complete trusted `params._meta`; the market owns the MCP SDK connection and tool registration. Both plugins must be loaded in the same Cordis scope. The default Consumer is the GEA plugin's configured analysis Agent; an explicit registered AGENT or CLIENT_APP Consumer can override it. No new registered Consumer is invented.

Logout, environment change, expiration observed by the login owner and plugin disposal abort old requests. Reconciliation serializes mount disposal and rejects late discovery. The gateway is never persisted as a suite or direct MCP configuration. Ordinary marketplace features do not require GEA.

## Alternatives considered

**Persist a direct MCP URL and login token.** Rejected because the gateway requires business-session metadata, and persisted credentials would outlive the login that owns them.

**Let the market inspect GEA login internals.** Rejected because it couples repositories to private state and exposes system credentials outside their owner. A fetch capability keeps the credential inside GEA.

## Consequences

Only tools granted to the selected Consumer are discovered. All host conversations using this mount share its login-generation gateway business session; it does not represent a separate gateway conversation per DSH conversation. Authentication/session failures require a new login cycle; there is no automatic session recreation or tool replay. Existing bridge behavior preserves server-side authorization and host confirmation handling. This does not claim production acceptance.

No active Agent Note previously covered GEA login integration; no supersession is required.

## Runtime acceptance

A live profile initially loaded an older installed market package rather than this checkout. The profile patch disables that entry and inserts the local build; GEA login survives this hot reload. The gateway registered five tools and a read-only September 2026 query completed through the actual host tool runtime. This verifies that profile, not npm publication.

Observed services do not expose the market-owned configuration editor. Their detail panel shows an informational ownership hint and the discovered tools, avoiding a request to an API that cannot resolve their configuration.

GEA MCP calls and model-visible tools are restricted to the local DSH `gea-readonly` preset (the demand forecast entry). Set `geaMcp.agentPreset` alongside the Consumer fields to choose another local preset. Consumer authorization and local preset selection are separate boundaries. Other presets and calls without an Agent are denied; login refreshes, live agents, new agents and empty-session preset switches retain this boundary. Agents inheriting the same preset also inherit access. The host MCP status remains visible for diagnostics. Hosts without `agents` or `agentPresets` do not mount this integration.

The same preset boundary also covers the legacy `gea_sales_plan_read` tool, keeping the standard preset free of GEA business-query capabilities.
