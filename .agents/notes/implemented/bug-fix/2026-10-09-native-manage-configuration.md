# Agent Note: Native Manage configuration

Status: implemented

## Problem

Full Manage startup called the retired `settings.register/get/watch` interface. The fixed Core provides SettingsForms over Loader Config, so the call failed, hid the configuration card and left runtime switches disconnected. The client also bound the historical namespace instead of the shipped Loader entry id.

## Decision

Manage exports a Config schema with volatile `mcpEnhanced`, `downloadRegion`, `feedbackEnabled` and `scanProjectLayouts` fields. Their validation rules and defaults share the plain market schema. SettingsForms projects the actual entry; the shipped card binds `dsh-agent-manage`, while its locale namespace remains `dsh-agent-plugins-market`.

Runtime readers use the Config references. The existing backend writer uses SettingsForms.update with its owning entry id. Loader volatile updates request the existing coalesced reconciliation only for backend or project-layout changes. Feedback enablement registers through the injected tools context; that context releases its watcher and tool together. SettingsForms.configure supplies the custom-card presentation policy. There is no registered namespace, compatibility adapter or second settings store.

Ordinary `geaMcp`, `sources` and `git` configuration survives actual Loader parsing, live edits, replacement and restart. Retired `userRoot` and `dataRoot` overrides still fail before canonical Manage storage writes. Old namespace values are not automatically imported. A separately authorized one-time conversion belongs to runtime adoption.

This partially supersedes [fork package identity](../feature/2026-09-12-fork-package-identity.md) only for the retained settings namespace. Package, repository, API, user data and historical identities retain that note's scope. [Workspace tabs and user panels](../feature/2026-09-06-workspace-tabs-user-panels.md) still owns workspace layout and feedback behavior; this note owns the native settings Interface. [Selected resources](../feature/2026-10-04-selected-business-resources.md) continues to own cold-start recovery.

## Alternatives considered

**Keep the old registration and log its failure.** Actual full-Host startup loses the card and runtime controls, so logging does not deliver the feature.

**Retain an old-namespace fallback.** This adds another runtime interpretation of persisted configuration. The accepted architecture uses only the current Loader/SettingsForms Interface.

## Consequences

Independent offline Host tests cover describe/update/replace/mutate, actual loopback backend GET/POST, feedback tool enablement, restart, default reset and resource preservation. They set temporary homes before module import and retain startup diagnostics. The old register/watch stub test is retired. No model, business transport, user profile, remote state or Native installation is changed; runtime adoption and any old-data conversion remain separate.
