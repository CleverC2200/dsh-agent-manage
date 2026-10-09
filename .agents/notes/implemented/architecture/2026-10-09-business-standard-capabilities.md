# Agent Note: Business roles retain official standard capabilities

Status: implemented

## Problem

Selected business resources published a persona and Skill tool only. GEA then applied a business allow list to every tool, counted general tools against business allowances and hid all tools when an allowance ran out. A business role therefore lost the standard tools and compaction even when its business authorization was valid.

## Decision

Manage publishes every selected business prompt through `composeStandardPreset`, appending its persona and declared extra plugins to the active official standard document. Standard persona options, runtime context, disabled expressions, commands and isolated compaction groups stay intact. The standard already provides the Skill tool; business resources do not register it again. Resource identity validation, selected-id recovery, cancellation and release ownership retain their existing rules.

The ordinary Manage bundle sets the official registry `config.default` to `auto-negotiation`. Core’s user `selectedDefault` retains precedence. Removing the bundle removes this configuration layer and restores Core’s `standard` default when no user choice exists; a saved company choice remains saved and receives Core’s existing missing-preset diagnostic. This applies to the official bundle switch, not an independently disabled low-level Host entry. No user preference, existing Session or draft is rewritten.

`BusinessResourceDefinition.presetName` and `description` are trusted optional Agent catalog metadata. Prompt discovery and the official preset registry display the same values. Without explicit catalog metadata they use the trusted execution profile label and one shared generated description. Page titles remain owned by Workbench.

GEA restricts only undeclared `gea_` tools. Its execution guard enforces the declared set even before a model pre-step. Business call and evidence allowances count only GEA tool executions; general Core and optional plugin tools retain their own policies. Result/evidence transformations apply to GEA and the existing local forecast calculator, preserving official general tool results. A withdrawn resource can still block the entire business Session. Consumer routes, identity epochs, cancellation and business effect limits remain GEA responsibilities.

The common fixed-Core test Host now includes the real attachment, storage, query, connection, Session controller and schedule providers. This makes all thirty currently enabled standard tools available and lets actual child creation apply the official schedule deny policy. The previous twenty-five-tool test Host did not activate schedule or image reading.

## Alternatives considered

**Add a standard tool allow list to GEA.** Rejected because it would duplicate Core capability selection and drift as plugins or user settings change.

**Register a second Skill tool beside standard.** Rejected because the official scoped tool name already exists and duplicated registration would fail or create separate ownership.

**Remove all business gates to expose standard.** Rejected because resource state, Consumer routes and current identity remain necessary at execution time.

## Consequences

The base inventory role keeps its stable Session id and original Consumer/cross-Consumer declarations. Its catalog name is `基地库存Agent`; business page naming is independent. Tests execute real official Session, compaction, filesystem, Plan and child interfaces with actual GEA Business/tool hooks. The public Workbench resource selection lane also uses the official InputHub with a separate actual Core/GEA Host process; the returned selection drives the Session preset and requested workspace, and existing drafts remain intact. Only completion and the external gateway use deterministic local adapters. This is source/offline evidence, not adoption into a user runtime or production authorization.

This changes the composition detail of [selected native resources](../feature/2026-10-04-selected-business-resources.md). That note still owns resource lifecycle, selected identity recovery and the official Skill provider.

Sales and APS retain `gea-readonly` and `gea-html-inventory-apsplan`. GEA projects their trusted Agent names and descriptions into Manage while page labels stay separate. APS retains Consumer `aps`, its declared `sales_forecast` cross-Consumer and three package Skills. Sales retains its online read tool, four declared installed-source Skills and Consumer `sales_forecast`. Each role is tested through actual Session, compaction, Consumer rejection and child inheritance. The optional sales readonly validation remains a Host execution gate: a permitted online read succeeds while submit and approve effects are rejected before transport. Catalog metadata does not install missing Skills or enable hidden pages.
