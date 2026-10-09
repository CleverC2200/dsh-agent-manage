# Agent Note: Current settings surface only

Status: implemented

## Problem

A second market page guessed an older host's sidebar and conversation DOM. Its capability flag, event, layout mode and selectors kept two UI owners alive even though the isolated project now supports only its registered current core baseline.

## Decision

The client contributes one PluginWorkspace through settings.section and its configuration card through settings.plugin.item. Cross-plugin injection is required. A host missing the required UI primitives is explicitly unsupported; it does not receive a DOM page fallback. The page-mode modules, detection event, page-only props and CSS are removed.

## Alternatives considered

**Keep the guarded fallback.** Rejected by the user's current-baseline-only support decision; guarding the old path does not remove its ownership and maintenance cost.

**Build a new standalone market shell.** Rejected because the current host already owns the required settings slots. It would replace the removed adapter with another UI owner.

## Consequences

The six workspace tabs, resource actions, bilingual labels, credentials and configuration lifecycle remain on their current interfaces. Older hosts are no longer supported. This change does not remove marketplace dialects, MCP transports or user data.

The active workspace-tabs note remains valid: its one-section/six-tab decision is unchanged. No active note owning the old page fallback was found; the engineering refactor plan is updated to describe the actual single path.
