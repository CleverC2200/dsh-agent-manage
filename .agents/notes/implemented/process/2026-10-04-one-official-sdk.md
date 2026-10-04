# Agent Note: One registered official SDK

Status: implemented

## Problem

Development dependencies and type paths previously described different DSH releases, and the browser metadata still named a removed client-runtime module.

## Decision

Both host and client consume the real fixed official 5badb150 standard packages, with matching peer declarations. Current exports generate the path map; retired invariant subpaths are not carried forward. The removed client-runtime metadata is gone. Catalog, resource publication, original body/reference reading, pure calculator and MCP ownership stay in the existing modules.

## Alternatives considered

**Keep old published SDKs behind a type-only override.** This would let imports and validation disagree about the actual runtime target. **Add aliases or another compatibility layer.** The project supports one registered current release and has no caller requiring that extra layer.

## Consequences

The standard official input must be available read-only before development checks. Source checks and full gates do not prove real latest-client behavior. No SDK/Core source or build is modified by this plugin, and no user state is copied. Existing resource owner/cancellation and Consumer separation remain.
