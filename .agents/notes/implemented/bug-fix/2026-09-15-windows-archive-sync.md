# Agent Note: Windows archive synchronization

Status: implemented

## Problem

Windows ZIP source refresh rejected normal files because containment checks used a Unix slash. Eager writes also exhausted Windows file handles and continued after validation rejection, racing temporary-directory cleanup.

## Decision

Company 0.6.3-company.4 uses the platform path separator for ZIP entry and tar symlink containment. ZIP extraction validates bounded entries before writing files sequentially. Entry count, per-file and total byte limits remain enforced before checkout publication.

## Alternatives considered

**Keep eager writes and await them after rejection.** This would drain cleanup correctly but still open thousands of files simultaneously. Sequential writes bound open handles and prevent any extraction write before validation succeeds.

## Consequences

Validated bytes remain buffered until writing completes, bounded by the existing extracted-size cap. Archives with many files write sequentially. Windows CI covers repeated source refresh, malformed archives and downloads; desktop validation separately refreshes the live company source.

The [source acquisition decision](../feature/2026-09-01-source-acquisition-expansion.md) and [archive authentication decision](../feature/2026-09-14-private-company-archives.md) remain active: source kinds and credential handling are unchanged.
