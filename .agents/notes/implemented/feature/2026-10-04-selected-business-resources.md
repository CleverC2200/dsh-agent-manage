# Agent Note: Selected native business resources

Status: implemented

## Problem

Durable Sessions retain preset identities after restart, while package resource definitions have an in-process lifetime. Filesystem copies and fallback personas would split resource ownership.

## Decision

Manage owns one resource interface and the official Skill Provider for enabled package resources. Catalog continues to own Suite source and installed/enabled facts. A live package registers private file references through its effect; browser requests select stable resource identities and carry their absolute native workspace context, never resource-file paths or Consumer overrides. Inventory contains summaries. Prompt bodies load when selected or when their enabled package owner opts into `publishPreset`; Skill bodies still load on selection. Source files and user drafts are never overwritten.

Skill and Prompt selection both confirm the official registry resolution is not broken before committing a selected identity. A failed Skill activation uses the existing preset disposer for rollback, including an already retained mount; failed release keeps its handle for explicit retry. Restoring a broken selected Skill rejects loading and leaves the original recovery index unchanged.

A selected persona is published through the official preset registry. Native Sessions keep preset identities across restarts, while registry definitions are in memory, so Manage persists selected resource identities only and restores those definitions when their owner registers. Page release does not unregister a definition needed by a durable Session; owner unload releases its own in-process declarations and leaves the recovery index. Missing or disabled sources fail explicitly and never fall back to another persona.

This replaces the older business-resources filesystem mount. This supersedes the filesystem mount and compatibility decisions in [2026-09-29 business resource ownership](../architecture/2026-09-29-workbench-business-resources.md); package containment, distinct page interpreter choices and GEA execution ownership remain. Skill root substitutions of existing marketplace dialects remain their existing semantics; packaged business bodies preserve their original prose.

The public discovery route requires an absolute `cwd` query, and selection requires `{ id, cwd }`. Both pass the same workspace to the existing resource/Skill interfaces. Missing or relative context fails with `INVALID_AGENT_RESOURCE_WORKSPACE`; there is no runtime fallback to a different project. Workbench uses this same native workspace for the new Session. The existing request-size boundary and owner/cancellation protections remain.

Manage also owns `skill_reference_read` and the pure §5.5 `forecast_compute` capability in the existing runtime. The official Skill registry remains the only catalog/body loader. References use the current model-invocable Skill, its explicit relative Markdown link, host filesystem permissions, UTF-8/size/paging limits and caller cancellation; a withdrawn or changed owner cannot return a stale read. The calculator requires the caller's installed/enabled `sinian-demand-baseline` in the same workspace, preserves the original decimal algorithm and reports its input hash/version and actual user-input provenance separately from source/business authorization. There is no independent resource provider, fallback directory, runtime plugin package or Consumer authority.

GEA keeps execution identity and actual business data/evidence protection. Its former Skill body/reference loader, pack/load state and pure calculator are removed after the current callers use Manage and the official loader. Original Skill/persona prose is not rewritten. Manage ships the complete fixed `company-agent-suites/suites/sinian-demand-forecast` snapshot under `business-resources/sinian-demand-forecast`, including its four original sales Skills, references, baseline script and example. The existing package Skill Provider registers both APS analysis and sales Skills at default startup; the GEA sales profile keeps its existing identity and authorization. `SOURCE.json` records the source commit, file hashes and absent source license declaration. Ordinary installation does not depend on external Home copies. Local checks cover the unchanged fourteen reference scenarios, missing decimal data, source provenance, linked-reference visibility and revoked owners; live installation and Consumer/model acceptance belong to the integrated runtime.

Resource summaries and selection results expose the selected profile's validated page interpreter list. Manage filters this list against current resource owners on every read, including after an owner withdraws. Workbench owns the chooser and official Session navigation. GEA keeps preset and Consumer authorization. The selected-identity recovery index keeps its existing format.

The `forecast-source` export shares the same pure input and baseline checks with GEA. GEA binds saved calculation evidence to the current execution, Session and subject. A baseline content or visibility change invalidates that evidence. The calculator remains in Manage.

The stable `agent-resource-skill` preset consumes [the standard composition interface](../../../../docs/design/standard-preset-composition.md). Its plugin declaration is the active official standard document, including disabled rows and user configuration. The standard Skill discovery provider and loader remain single contributions; selection only returns the Skill name and does not publish a business profile. The registry description explains this purpose. Resource summaries project each Skill's own description, and Workbench displays that projection in its existing resource list.

Production Core Session tests check final tools, commands, automatic and manual compaction, continuation and selected-identity recovery. The preset integration lane checks the actual GEA hooks and unprofiled business rejection. The separate client lane uses the official InputHub with independent Host-process receipts for selected resources and real Sessions; its wire adapter supplies the public Session/workspace faces. It checks empty drafts, existing text, cancellation, re-entry and previous drafts without loading Host libraries into the browser source graph. These offline observations do not prove Native installation or external model/business execution.

Business prompt composition now follows [Business standard capabilities](../architecture/2026-10-09-business-standard-capabilities.md). That decision owns the complete standard declaration, trusted Agent metadata and the separation of general capabilities from business budgets. This note continues to own resource selection, provider lifecycle and recovery.

Full Manage cold-start recovery awaits its existing StandardPreset initialization fiber before reading the selected-resource index. It waits locally, without polling, a fallback preset or a new readiness authority. The public app-boot can return before an injected resource child finishes, so the offline fixture waits for actual `agentResources` publication and verifies the Connection Fetch route. Normal, module-import-gated and clean starts preserve the selected preset, package Skill, final tools/commands/compaction, workspace and prior durable Session; real module failure leaves resources unavailable and retains startup diagnostics.

## Alternatives considered

The [business resource decision](../architecture/2026-09-29-workbench-business-resources.md#alternatives-considered) records why a second registry and arbitrary external paths were rejected. Its filesystem mount is replaced by official publication; package containment and Consumer separation remain.

Package owners may declare `publishPreset` to publish validated business presets on installation/activation for official roster discovery. Publication does not change Sessions, user defaults or selected-resources.json, and grants no Consumer access. Preview owners do not opt in. Invalid prompts retain resource diagnostics while healthy prompts publish; owner unload still releases its declarations.

## Consequences

Selected identities recover definitions without rewriting Session data or business resource bodies. Missing owners fail explicitly; failed release remains retryable. Native installation and business/model acceptance require their own receipts.

## Personal Agent configurations

Complete personal Agents use `UserAgents`, separately from catalog roles and selected business identities. Its single configuration/publication interface serializes writes into `user-agents.json`, validates external inputs, and publishes enabled configurations with a stable `user-agent-<id>` registry identity through standard composition. Name edits retain identity; registration and resolution are distinct from durable save. Publication failure retains an editable configuration, a diagnostic and, when available, the last usable declaration. Host startup registers saved enabled definitions; availability is audited after Loader activation settles. Existing Core generations retain live Session revisions.

The shared main/settings Agent page replaces the six-tab workspace entry. Authenticated Host Fetch routes provide list, save, enable and selection. Selecting is explicit and does not change the default or an existing Session. Workbench owns the public `startAgent` action and native workspace/Session navigation. Per-Agent Skill composition is described below. External MCP and source import retain their own modules; trusted Cube references follow the contract below.

## Personal Agent Skill scope

`UserAgents` persists each Agent's Skill references and personal bodies with its configuration. A reference keeps the winning provider and optional source path; publication and reads reject a missing or changed source. Personal overrides keep that reference's resource base and never write its managed source. `dsh-agent-manage/user-agent-skills` contributes through the official preset scope. It resolves the existing global providers, permits selected enabled references, and masks unselected or disabled global Skills with both invocation policies disabled. Standard preset declarations remain intact, including native scoped resources. Core retains old revision scopes for existing Sessions.

The Skill tab uses the authenticated Agent configuration routes for catalog, body and save operations. Cancel discards only local edits; save failures keep the form. Unmounting aborts reads and ignores late results. Source selection, scoped catalog and tool dispatch are covered through production Core Sessions; this does not establish installed-client or external-model acceptance.

## Personal Agent retirement and recovery

Disabling withdraws the preset from the Core selection roster without changing the host default, Sessions or drafts. Deletion writes `deletedAt` and `enabled: false` into the same personal configuration; its stable ID, prompt and dependency references remain recoverable. Deleted records reject save, capability edits, enable and select operations until explicit restore. Restore only clears deletion and leaves the configuration disabled. The configuration page offers recovery, dependency checks and a return to the Agent list for an explicit new conversation. An unavailable default is diagnosed without editing the host setting.

`UserAgents.watch` signals committed configuration/lifecycle changes. Consumers read this same configuration and reconcile their capabilities; listeners are not awaited inside the write queue and must schedule their reads without throwing. This is configuration lifecycle, not Session or authorization ownership. A source that is still missing after restore blocks publication and cold recovery; restore never recreates its authorization.

The fixed official Core can retain a revision for live Sessions but has no separate selectable flag or durable historical revision registration. Withdrawal therefore makes cold recovery fail explicitly until the user restores and enables the retained configuration and its dependencies. Recovery then composes that retained current configuration, including when Core reuses a persisted blank Session. It does not promise reconstruction of an older revision after edits. A future exact revision contract needs a Core-owned durable revision/availability interface; Manage must not add a Session sidecar, replace the preset with standard or modify protected Core. Tests exercise authenticated configuration operations, real Core persistence/restart and the official client draft input. Installed-client and external-model acceptance remain separate.


## Trusted Cube references

Only GEA Host registration may mark an installed BusinessResources entry as Cube-capable. `cubeSource` reads current availability, Consumer and the owner's revocable signal without scanning Skill catalogs. Its browser catalog contains only source identity, name, enable intent and availability. Plugin membership is fixed; only the Cube enable switch is writable. An explicit copy produces personal prompt text and allowed Skill/Cube references, with no business profile, cross-Consumer routes or page actions.

Personal configurations persist at most one `{ sourceRef, enabled }` Cube reference. The official preset mounts an isolated `userAgentCube` declaration; Core's public `serviceFor(actualAgent, ...)` resolves the revision actually retained by that Session and inherited by its children. UserAgents applies current enable/delete/reference revocation and signals through its existing lifecycle watch. Prompt or Skill edits keep the prior Session reference; removing or disabling it aborts old grants, and re-adding it never revives those grants.

GEA alone resolves the source owner and Consumer against current identity. Cube discovery and dispatch use that same resolution before and after awaits; identity, association and owner signals cancel in-flight calls and reject late results even if the replacement Consumer is identical. The v2 bridge retains server schemas and first-request publication readiness. Schema masks refresh on lifecycle/source changes as well as tool changes. Personal references grant only the two Cube methods and preserve Core tool-filter intersections; they never install a business profile. Source/Core tests do not establish installed-client or real business acceptance.
