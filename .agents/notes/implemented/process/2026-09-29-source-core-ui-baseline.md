# Agent Note: Source core UI baseline for plugin splitting

Status: implemented

English | [中文](2026-09-29-source-core-ui-baseline.zh.md)

## Problem

The previous UI development dependency exported older icon names than the isolated target Core. Rendering tests must consume the same UI library as the target runtime.

## Decision

The UI primitives development dependency links to the fixed official Core checkout declared by [one registered official SDK](2026-10-04-one-official-sdk.md). That note owns the current SDK and peer input; this note retains the Regular icon and React deduplication reasons. Client components use its Regular icon exports, runtime peers declare the selected DSH version, and Vitest deduplicates React across the link. The workspace records the core commit separately; this is a local development configuration, not a registry release.

## Alternatives considered

**Mock the missing icons in tests.** That would hide a real runtime compatibility problem instead of testing the target library.

**Grant a runtime version exemption.** An exemption cannot establish that removed exports still work. The client is adapted and rendered against the selected library.

## Consequences

The sibling core must be installed and built before this development setup can be used. Existing catalog and login ownership remain unchanged; this decision does not supersede the GEA MCP login-owner decision. The full local suite verifies the updated rendering and existing resource behavior.
