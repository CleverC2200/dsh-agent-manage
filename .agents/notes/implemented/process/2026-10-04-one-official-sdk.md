# Agent Note: One registered official SDK

Status: implemented

## Problem

Development dependencies and type paths previously described different DSH releases, and the browser metadata still named a removed client-runtime module.

## Decision

Both host and client consume the real fixed official 5badb150 standard packages, with matching peer declarations. Current exports generate the path map; retired invariant subpaths are not carried forward. The removed client-runtime metadata is gone. Catalog, resource publication, original body/reference reading, pure calculator and MCP ownership stay in the existing modules.

The [UI baseline decision](2026-09-29-source-core-ui-baseline.md) retains its Regular icon and React deduplication rationale. This decision partially supersedes only its SDK/version selection facts.

## Alternatives considered

**Keep old published SDKs behind a type-only override.** This would let imports and validation disagree about the actual runtime target. **Add aliases or another compatibility layer.** The project supports one registered current release and has no caller requiring that extra layer.

## Consequences

Host and client consume the prepared standard official input read-only. The developer `sdk:prepare` tool can clone the fixed Core source and build its SDK in an independent checkout owned by that preparation job; the original and shared Core checkouts, symlinks and unowned directories remain protected. The [clean CI contract](../../../../docs/clean-ci.md) describes the fixed source, original lock, ownership marker and optional preparation stages. Source checks and full gates do not prove real latest-client behavior, and no user state is copied. Existing resource owner/cancellation and Consumer separation remain.
