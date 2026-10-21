# Agent Note: One registered official SDK

Status: implemented

## Problem

Development dependencies and type paths previously described different DSH releases, and the browser metadata still named a removed client-runtime module.

## Decision

Both host and client consume the fixed official standard packages registered for the task, with matching peer declarations. Current exports generate the path map; retired invariant subpaths are not carried forward. The removed client-runtime metadata is gone. Catalog, resource publication, original body/reference reading, pure calculator and MCP ownership stay in the existing modules.

The [UI baseline decision](2026-09-29-source-core-ui-baseline.md) retains its Regular icon and React deduplication rationale. This decision partially supersedes only its SDK/version selection facts.

## Alternatives considered

**Keep old published SDKs behind a type-only override.** This would let imports and validation disagree about the actual runtime target. **Add aliases or another compatibility layer.** At this original decision, the project supported one registered current runtime release and had no caller requiring that extra layer. The later dual-release decision supersedes that runtime scope while using the same public interfaces.

## Consequences

The standard official input must be available read-only before development checks. Source checks and full gates do not prove real latest-client behavior. No SDK/Core source or build is modified by this plugin, and no user state is copied. Existing resource owner/cancellation and Consumer separation remain.

[Two registered official Core releases](2026-10-10-two-official-core-releases.md) partially supersedes the single-release runtime peer decision. The registered alpha.1 development SDK and existing module ownership remain.

[Development build management](2026-10-20-development-build-management.md) extends local preparation and capacity admission; the consumer SDK remains read-only.
