# Agent Note: Business roles retain official standard capabilities

Status: implemented

## Problem

Selected business resources published a persona and Skill tool only. GEA then applied a business allow list to every tool, counted general tools against business allowances and hid all tools when an allowance ran out. A business role therefore lost the standard tools and compaction even when its business authorization was valid.

## Decision

Manage publishes every selected business prompt through `composeStandardPreset`, appending its persona and declared extra plugins to the active official standard document. Standard persona options, runtime context, disabled expressions, commands and isolated compaction groups stay intact. The standard already provides the Skill tool; business resources do not register it again. Resource identity validation, selected-id recovery, cancellation and release ownership retain their existing rules.

`BusinessResourceDefinition.presetName` and `description` are trusted optional Agent catalog metadata. Prompt discovery and the official preset registry display the same values. Without explicit catalog metadata they use the trusted execution profile label and one shared generated description. Page titles remain owned by Workbench.

GEA restricts only undeclared `gea_` tools. Its execution guard enforces the declared set even before a model pre-step. Business call and evidence allowances count only GEA tool executions; general Core and optional plugin tools retain their own policies. Result/evidence transformations apply to GEA and the existing local forecast calculator, preserving official general tool results. A withdrawn resource can still block the entire business Session. Consumer routes, identity epochs, cancellation and business effect limits remain GEA responsibilities.

The common fixed-Core test Host now includes the real attachment, storage, query, connection, Session controller and schedule providers. This makes all thirty currently enabled standard tools available and lets actual child creation apply the official schedule deny policy. The previous twenty-five-tool test Host did not activate schedule or image reading.

## Alternatives considered

**Add a standard tool allow list to GEA.** Rejected because it would duplicate Core capability selection and drift as plugins or user settings change.

**Register a second Skill tool beside standard.** Rejected because the official scoped tool name already exists and duplicated registration would fail or create separate ownership.

**Remove all business gates to expose standard.** Rejected because resource state, Consumer routes and current identity remain necessary at execution time.

## Consequences

The base inventory role keeps its stable Session id and original Consumer/cross-Consumer declarations. Its catalog name is `基地库存Agent`; business page naming is independent. Tests execute real official Session, compaction, filesystem, Plan and child interfaces with actual GEA Business/tool hooks. Only completion and the external gateway use deterministic local adapters. This is source/offline evidence, not adoption into a user runtime or production authorization.

This changes the composition detail of [selected native resources](../feature/2026-10-04-selected-business-resources.md). That note still owns resource lifecycle, selected identity recovery and the official Skill provider.
