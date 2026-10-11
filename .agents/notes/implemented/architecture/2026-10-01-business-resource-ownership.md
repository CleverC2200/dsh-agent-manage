# Agent Note: Business resource metadata and failed cleanup

Status: implemented

## Problem

GEA reparsed Skill frontmatter after Manage had already parsed it, so YAML block descriptions produced different metadata. Resource disposal treated all read failures as user edits and released its owner claim even when cleanup could not be confirmed.

## Decision

Current publication uses `BusinessResources` and the catalog Skill parser. [Selected native resources](../feature/2026-10-04-selected-business-resources.md) replaces the filesystem mount, and [async release ownership](../bug-fix/2026-10-09-async-result-ownership.md) owns failed Core preset disposal. No current `loadBusinessResources` file mount writes or cleans source Skill files.

## Original file-mount decision

`loadBusinessResources` returns `skillName` and `skillDescription` from the existing catalog parser. Disposal preserves ENOENT and later edits, but reports other read failures without releasing the owner claim. The same disposer can complete after the file is repaired.

## Alternatives considered

**Repairing the second parser** retains two sources of metadata rules and leaves future YAML changes split across owners.

**Ignoring read failures or automatically dropping ownership** loses the distinction between a deliberate edit and an unknown cleanup result, and permits another mount to overwrite unresolved state.

## Consequences

The current catalog parser supplies Skill metadata to native publication. The original file-mount cleanup could block remounting until cleanup succeeded or the isolated process restarted; that historical behavior did not grant permission to bypass ownership. This is local isolated implementation, not production release.

[Async result and release ownership](../bug-fix/2026-10-09-async-result-ownership.md) extends this rule to Core preset releases in `BusinessResources`; the original file-cleanup rationale remains historical, while metadata continues to use the shared parser.
