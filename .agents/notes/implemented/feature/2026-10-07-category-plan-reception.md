# Agent Note: Category plan resource reception

Status: implemented

## Problem

The installed category prototype retained its author UI but lacked its previously declared Agent resource.

## Decision

Manage retains the original `category-plan` Prompt, Skill and empty MCP declaration. Workbench assembles them in the existing static category package, with the original package, page and Consumer identifiers. This complements [business resource ownership](../architecture/2026-10-01-business-resource-ownership.md); it supersedes no active ownership decision.

## Alternatives considered

**Restore the former page bridge and conversation preset.** The current page owner and official Core Session already provide those responsibilities. Restoring them would add a second path.

**Keep the original reset wording.** The current UI already restores unfinished text and view intent. The Skill describes this behavior while keeping temporary simulated tasks distinct from persisted business actions.

## Consequences

Author state supplies simulated context and visible elements through the existing channel. UI intent belongs to the actual Session. Selecting this resource sends no model request; mock data remains outside real business execution. Source contracts and iframe checks do not establish Native grant acceptance.
