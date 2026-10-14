# Agent Note: Bind persisted MCP OAuth credentials to their issuer

Status: implemented

## Problem

A configured MCP server can advertise a different authorization server. Reusing a stored client secret or refresh token without its original issuer can disclose it to that server. Updating the SDK alone does not identify the issuer of older credential records.

## Decision

The local OAuth provider exposes stored client information and tokens only when each record has a nonempty string issuer. The MCP SDK owns issuer comparison, registration and token exchange. Save operations preserve the full SDK objects, including issuer. Older records remain stored; a fresh interactive authorization establishes their issuer before reuse.

The OAuth module owns the existing grant key through `mcpAuthRecordKey(serverName)`. Provider reads/writes and the host reauthorization action share that key, including its server-name folding. Reauthorization still deletes the grant and rebuilds the owning mount so its cached credentials are released. The key and stored grant format remain unchanged; no record migration runs.

Security dependency updates target the vulnerable versions in the existing graph. Exact transitive overrides leave unrelated major lines unchanged. The docs-site cache dependency is outside the reported affected range, but the original max-stale behavior still reproduces. The current static Astro image loader only returns image bytes, expiry and validators, and does not serve a shared authenticated response cache. This dependency update does not certify general shared-cache use safe.

The existing [GEA login integration decision](../feature/2026-09-12-gea-login-mcp.md) remains active. It covers the GEA-owned gateway capability, not this standalone MCP OAuth credential flow. No active note owns the issuer binding decision, so none is superseded.

## Alternatives considered

**Upgrade only the SDK.** Rejected because a legacy record without issuer cannot establish which authorization server may receive its credentials.

**Assign the newly advertised issuer to old records.** Rejected because discovery from the MCP server does not prove the origin of existing secrets. Deleting the records would also discard recoverable user data unnecessarily.

**Update the whole dependency graph.** Rejected because that adds unrelated version changes to this security repair. Generated locks and frozen installs retain the existing package-manager protocol.

## Consequences

Older MCP grants require reauthorization. Existing stored records survive; grants with an issuer continue to refresh on the matching server. Real SDK auth regression tests cover matching issuer refresh, changed issuer discovery, legacy reauthorization and malformed issuer fields. This decision adds no GEA identity authority and does not change business authorization.

The host-entry regression exercises provider reads, reauthorization and mount ownership together. It preserves lazy credential-service lookup, rejects an unavailable service without rebuilding the mount, and verifies that resetting one grant leaves another server's grant and mount intact.
