# Agent Note: Discover GEA MCP through the login owner

Status: implemented

## Problem

The market cannot discover authorized GEA tools from a transport URL alone. GEA login is process-local in a separate plugin, and MCP transport sessions do not authorize business calls.

## Decision

GEA Host remains the only login, credential and Consumer authority. The current v2 discovery and dispatch contract is documented in [GEA Cube-New MCP](../../../../docs/guides/gea-mcp.md); [selected business resources](2026-10-04-selected-business-resources.md#trusted-cube-references) owns trusted personal Agent references.

Manage publishes the server schemas and scoped tools; GEA resolves the actual Core Session's enabled business source or trusted Cube reference. User configuration cannot select a Consumer, gateway or login token. A personal reference exposes Cube inspect/query and the [knowledge catalog/ask methods](2026-10-15-gea-knowledge-tools.md) under the same Consumer and server grants, with source/identity revocation and child tool-filter intersections. The earlier optional v1 transport service and single `gea-readonly` configuration are retired.

Logout, environment change, expiration and owner disposal abort old calls and reject late results. Gateway credentials are never persisted as external MCP configuration. Ordinary personal Agent configuration does not require GEA.

## Alternatives considered

**Persist a direct MCP URL and login token.** Rejected because the gateway requires business-session metadata, and persisted credentials would outlive the login that owns them.

**Let the market inspect GEA login internals.** Rejected because it couples repositories to private state and exposes system credentials outside their owner. A fetch capability keeps the credential inside GEA.

## Consequences

Source discovery, native publication, model-visible schemas and real business success remain separate evidence. This Note retains the login-ownership rationale; the linked v2 and personal-reference contracts supersede its original transport and single-preset choices. [The original ADR](../../../../docs/history/decision-snapshots/2026-09-12-gea-mcp-login-owner.md) preserves the earlier input.

## Runtime acceptance (2026-09-12)

A live profile initially loaded an older installed market package rather than this checkout. The profile patch disables that entry and inserts the local build; GEA login survives this hot reload. The gateway registered five tools and a read-only September 2026 query completed through the actual host tool runtime. This verifies that profile, not npm publication.
