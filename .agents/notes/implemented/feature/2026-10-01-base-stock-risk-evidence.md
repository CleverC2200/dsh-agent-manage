# Agent Note: Base stock risk evidence

Status: implemented

## Problem

The migrated page already calculates stock, order and age judgments, but its interpreter receives rounded insight prose without exact quantities, ranking coverage or business snapshots. Recomputing risks in persona text would create a second rule owner.

## Decision

Workbench publishes the existing deterministic engine result through `parts.inventoryInsight.evidence`, with exact metrics, top objects, coverage, missing inputs and separate target/inventory/order sources. The same query-state effect withdraws evidence while the current range is loading, empty or failed. Manage's inventory-aqkc Skill reads that evidence and current SKU filters; GEA retains identity and controlled execution.

This complements the existing [business resource ownership](../architecture/2026-09-29-workbench-business-resources.md) decision and does not supersede its loading or authority contract.

## Alternatives considered

**Recompute in prompts.** This would duplicate classification and ranking logic and could invent values absent from the authorized result.

**Publish more prose only.** Rounded prose cannot substantiate exact quantities or distinguish an incomplete ranking from a complete one.

## Consequences

The resource remains read-only and adds no tools or Consumers. Low target stock, actual order shortage, current age stock and future new age risk remain separate. Long SKU arrays retain truncation metadata; their pages cannot replace complete-engine aggregation. Fixed captured Host inputs verify original classifications and numeric values. Mock failure checks and real Page/Agent evidence have distinct acceptance roles.
