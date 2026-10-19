# Agent Note: Inventory calculation ownership

Status: implemented

## Problem

The current batch ran dealer policy/metric and Personal/full-chain business calculations inside Workbench, despite specification 46 assigning pure calculation ownership to Manage. Resource declarations alone did not resolve this ownership gap.

## Decision

`src/inventory-compute` is the single implementation for this batch. Public `./inventory-compute/*` exports support source assembly and emitted package consumption. Workbench imports that interface; readers, authorization checks, cancellation, UI intent and snapshots remain in Workbench and GEA. Input/configuration hashes include Manage's consumed files. Fixed original algorithm expectations remain unchanged.

This partially supersedes the calculation-ownership statement in [full-chain mock reception](../../implemented/feature/2026-10-07-full-chain-mock-reception.md). Its resource declaration, mock-only scope and query limits continue to apply. The active business-resource ownership and forecast notes still apply to their own interfaces; no replacement resource catalog, tool or authorization state is introduced.

## Alternatives considered

**Leave calculations behind a Workbench wrapper.** This retains the wrong owner and duplicates the rule maintenance cost.

**Call a new host tool or HTTP route.** These deterministic page calculations do not need another execution path or model call. Compile-time assembly preserves the existing page lifetime and cancellation behavior.

**Replace Personal's report with first-batch AQKC's variant.** Their source selection and risk truncation differ. This would change a fixed business rule beyond this migration.

## Consequences

Manage type, lint, format and architecture gates now cover the algorithms. Browser assembly uses the public source condition and records hashes. Only deterministic supplied-input behavior is proved here; this does not close original live tickets or Native acceptance. Unused full-chain `orderDemand` and dealer `metricLabels` are removed for Manage lint. The unused Personal `dailyReportTransport` mode selector is removed rather than publishing Session/legacy transport routing as a calculation. These statements have no current result consumer. Full-chain input retrieval moves to Workbench; its public calculator accepts data and a calculation request without an adapter.

DMS mock reception extends this same ownership decision. Manage owns supplied-input quantity validation and M/Z packet calculation; Workbench keeps its page-local simulator, original workflow projection and scoped selector intent. Mock receipts and completion state are never promoted to restored business authority. No new host execution interface is added.

Base inventory source adaptation follows this boundary through `covered-stock-comparison`: supplied inventory/target pairs produce covered gaps; inventory/target/demand intersections produce both turnover ratios on the same cohort. Coverage counts accompany the values. Workbench labels partial observations and retains unknown complete-scope risk; Manage neither supplies missing facts nor establishes authorization.
