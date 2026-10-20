# Agent Note: Development dependency and build management

Status: implemented

## Problem

Repeated preparation rebuilt valid dependencies and duplicated task outputs while local free space was exhausted. Manage lacked the native environment entry already used by the other repositories.

## Decision

The sibling GEA [development entry](../../../../../dsh-gea-plugin/docs/development-builds.md) owns shared admission, validated reuse and output reports. Manage keeps its pinned manager and lock. Its explicit build wrapper preserves host/client compilation and joins capacity admission. Frozen preparation skips the implicit prepare build. Valid official SDK artifact reuse also skips installation; cold preparation remains in an owned Core checkout.

This extends the [registered SDK decision](2026-10-04-one-official-sdk.md) only for preparation and output ownership. Its read-only consumer input, runtime peer and module boundaries remain. The [dual Core decision](2026-10-10-two-official-core-releases.md) continues to own release compatibility.

## Alternatives considered

**Share writable node_modules or lib across tasks.** Concurrent edits and linked package paths make that unsafe. Content stores and verified artifacts remain reusable.

**Migrate all locks and runtime packaging together.** That would change unrelated installation contracts; the current managers stay pinned.

**Add a global scheduler or automatic cleanup.** Native actions and a small local admission record cover these entrypoints. Unknown or active output and user data need explicit reader review.

## Consequences

Insufficient capacity refuses work before installation, compilation or package writes. Reports retain provenance and protect isolated validation user data. Admission does not reserve operating-system quota. Dependency reuse checks metadata and direct manifests; it does not certify every transitive installed byte. CI, installed reception and production acceptance remain separate.
