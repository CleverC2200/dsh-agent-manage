# Agent Note: Source core UI baseline for plugin splitting

Status: implemented

## Problem

The isolated migration workspace targets DSH 0.2.0-rc.1 while the previous UI development dependency exports older icon names. Rendering tests must consume the same UI library as the target runtime.

## Decision

The UI primitives development dependency links to the sibling core checkout. Client components use its Regular icon exports, runtime peers declare the selected DSH version, and Vitest deduplicates React across the link. The workspace records the core commit separately; this is a local development configuration, not a registry release.

## Alternatives considered

**Mock the missing icons in tests.** That would hide a real runtime compatibility problem instead of testing the target library.

**Grant a runtime version exemption.** An exemption cannot establish that removed exports still work. The client is adapted and rendered against the selected library.

## Consequences

The sibling core must be installed and built before this development setup can be used. Existing catalog and login ownership remain unchanged; this decision does not supersede the GEA MCP login-owner decision. The full local suite verifies the updated rendering and existing resource behavior.
