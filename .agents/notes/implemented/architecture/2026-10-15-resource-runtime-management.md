# Agent Note: Resource runtime management owns operations and mounts

Status: implemented

## Problem

Catalog held runtime configuration and status state while the plugin entry separately scheduled mounts, listened for credentials and connected callbacks in both directions. Backend selection and OAuth reauthorization depended on callers remembering which registry to rebuild.

## Decision

`Catalog.runtime` is the `RuntimeManagement` interface for MCP/LSP configuration, redaction, status, backend selection, reauthorization, reconciliation and disposal. Routes and project MCP mounts use that interface directly. Catalog no longer forwards those operations or exposes runtime setters.

Catalog keeps discovery, source acquisition, install state, coherent snapshots and the shared mutation queue. A runtime write enters that queue, validates and persists its configuration, invalidates the Catalog snapshot, awaits existing resource refreshes, then reconciles mounts before publishing Catalog listeners. `Catalog.changePanelResources` keeps its established pipeline. Runtime management consumes Catalog's selected suites; it does not parse layout dialects or keep another install state.

Host composition supplies lazy settings, credential deletion and tool observations once. Credential bursts share the current mount pass and one fresh follow-up. Disposal stops credential events and their timer, lets each of the four real surface adapters settle and release independently, so local cleanup does not wait for MCP. `RuntimeReconciler` retains per-surface ordering and failure containment; MCP, LSP, command and Hook adapters retain their distinct host contracts.

MCP fingerprints include the selected backend. An unchanged configuration therefore rebuilds when its backend changes, with unsupported transports reported by the real backend adapter. A forced OAuth rebuild remains pending when old-mount release fails, so explicit retry can finish cleanup before recreating the owned mount. OAuth record addressing still uses the shared `mcpAuthRecordKey`; no credential format or saved record changes.

GEA schema publication uses the GEA-owned identity signal. Same-identity resource refreshes prepare discovery before replacing current schemas, while identity changes retire the previous generation first. Refresh listeners return their queue to Core's serial `agent/created` event. For an assembly already in progress, a public tool provider captures its publication revision; the `system-prompt/assemble` waterfall awaits readiness and asks Core to reassemble only if that revision changed. Core retains scope, PTC mode and tool order. Cancelled assemblies do not wait for a provider that ignores cancellation.

Personal Agent MCP configuration adds an `AgentMcp` membership module beside `UserAgents`. It stores shared connection identities and per-Agent associations, and delegates all service configuration, credentials and transport lifecycle to `Catalog.runtime`. Host-derived import roots are saved separately from editable server JSON and reused by validation and mount-time placeholder expansion. HTTP callers cannot supply these roots or claim plugin ownership.

The ordinary authenticated Agent routes expose inline configuration and association operations. A Core `composedPreset` check and current membership control both schema restrictions and dispatch guards, including already-running Sessions. Unknown personal MCP namespaces fail closed. Removing an association keeps the shared definition. Plugin MCP configuration rejects direct edits, while its enabled override remains supported. Bridge state is read from the existing supervisor, so successful zero-tool discovery still reports connected. Controlled local HTTP tests exercise real initialization, discovery, cancellation, Session scope and restart; installed-client and business acceptance remain separate.

Personal MCP configuration derives its schema from the bundled validator, retaining known-field checks while allowing extension fields and external command/cwd paths. Portable plugin declarations keep their strict schema and containment rules. The supervisor reports pending, cancelled and failed browser authorization separately from connection success. Pending authorization releases startup readiness so Agent configuration can return; cancelling closes the loopback leg, and abandoned providers reject late credential writes. Reauthorization still deletes the existing host grant record and remounts that same owned connection.

## Alternatives considered

**Keep Catalog operation delegates and setter callbacks.** This would preserve the extra interface and require the entry to assemble the same ordering rules again. All current callers instead move to `Catalog.runtime` in this change.

**Introduce vertical feature modules.** Discovery, installed resources and runtime snapshots still share Catalog's data source. As [ADR-0001](../../../../docs/adr/0001-catalog-centered-modular-refactor.md) requires, this remains one package and one Catalog center, with a runtime operations module under `application`.

**Wait only at `agent/pre-step`.** Core captures tool schemas before that hook, so waiting there would still send the first request with its old assembly. Publication revision checks use the earlier public assembly contract instead.

## Consequences

Runtime configuration, status, credential events and mount lifecycle now share one owner. Host services remain lazy because Cordis can provision them after Manage. Existing persisted user configuration, source checkouts, runtime ownership and failed-release handles remain intact.

This extends [runtime scheduling](2026-09-08-runtime-reconciliation-scheduling.md); its per-surface concurrency decision and [installed resources](2026-10-14-installed-panel-resources.md) remain in force. The GEA service must project its existing `identitySignal()` alongside the current v2 contract; it does not expose credentials or add another identity owner.

Behavior tests cover HTTP OAuth reauthorization and exact mount ownership, configuration redaction, backend remounts, cleanup retry, credential bursts during slow startup and release ordering through the public runtime interface. They establish local source behavior against the selected SDK, not installed Native, real model, business, CI or release acceptance.

[中文](2026-10-15-resource-runtime-management.zh.md)
