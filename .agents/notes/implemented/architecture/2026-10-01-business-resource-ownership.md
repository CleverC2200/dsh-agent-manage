# Agent Note: Business resource metadata and failed cleanup

Status: implemented

## Problem

GEA reparsed Skill frontmatter after Manage had already parsed it, so YAML block descriptions produced different metadata. Resource disposal treated all read failures as user edits and released its owner claim even when cleanup could not be confirmed.

## Decision

`loadBusinessResources` returns `skillName` and `skillDescription` from the existing catalog parser. Disposal preserves ENOENT and later edits, but reports other read failures without releasing the owner claim. The same disposer can complete after the file is repaired.

## Alternatives considered

**Repairing the second parser** retains two sources of metadata rules and leaves future YAML changes split across owners.

**Ignoring read failures or automatically dropping ownership** loses the distinction between a deliberate edit and an unknown cleanup result, and permits another mount to overwrite unresolved state.

## Consequences

GEA consumes parsed metadata. A failed cleanup can block remounting until cleanup succeeds or the isolated process is restarted; it does not automatically bypass ownership. This is local isolated implementation, not production release.
