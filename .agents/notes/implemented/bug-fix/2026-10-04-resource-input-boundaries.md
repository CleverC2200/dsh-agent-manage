# Agent Note: Resource selection limits and per-Skill metadata isolation

Status: implemented

## Problem

The resource selection Fetch route inherited the host's much larger transport limit. A valid resource id padded with more than 64KiB of whitespace still reached selection. Strict YAML parsing also occurred outside each packaged Skill's error boundary, allowing one malformed header to remove every healthy resource from the provider.

## Decision

The route uses streaming Fetch input and counts bytes before parsing or selecting, sharing the 64KiB policy with existing node:http mutation routes. Oversized bodies return 413, including chunked input; the host's global limit is unchanged.

A single Skill metadata decision performs strict YAML parsing, identity normalization and disabled handling. Both listing and body lookup catch errors at the resource unit, record a named diagnostic and fail closed. Lookup cancellation continues to throw, and owner/generation checks still reject unloaded resources.

## Alternatives considered

**Relying on the host cap or Content-Length** does not enforce the repository's smaller mutation boundary and misses chunked or incorrectly declared lengths.

**Catching at provider scope** hides healthy Skills. **Separate list/get parsers** allow a cached candidate to bypass the same validation used for discovery.

## Consequences

The [selected business resources](../feature/2026-10-04-selected-business-resources.md) interface remains unchanged. Request allocation is bounded locally; original resource files and persona/Skill text are not rewritten. Public route tests cover padded and chunked bodies, the exact bound, and selection suppression. Provider tests cover malformed plus healthy units, changed cached-body metadata and cancellation.
