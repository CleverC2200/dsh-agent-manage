# Agent Note: MPS seven-step calculation ownership

Status: implemented

## Problem

The MPS prototype keeps separate simulation inputs for later steps. Connecting real reads to that execution would mix evaluation versions and allow simulated totals to appear in business output.

## Decision

Manage owns the browser-safe MPS calculation module, described in [the calculation contract](../../../../docs/design/mps-compute.md). Workbench supplies the current evaluation draft, source read state, source relations and matching shipment snapshot. Every downstream view and export consumes the same result. GEA retains identity and controlled named reads.

This partially supersedes the MPS execution portion of [received mock business resources](../feature/2026-10-07-received-mock-business-resources.md). The original resource provenance and other prototype reception decisions remain there.

## Alternatives considered

**Keep the old prototype calculations.** Their separate static inputs and weighted algorithm do not represent the approved two-share split or the current source records.

**Wait for every table before connecting steps.** Missing model and inventory sources would block independent reads and known calculations. Nullable results retain each missing dependency while available values continue through the workflow.

## Consequences

Local constraints and effective category/share adjustments remain supplied draft inputs. The module returns system values, effective values and rejected-adjustment reasons; persistence stays with the caller. Confirmed calendar-day safety inventory and signed inventory rollover produce unconstrained required-production references. Explicit weights, unique tunnel/forming resources, monthly days and allocation shares support resource load and gap evaluation. Legacy capacity candidates remain separate; repeated SKU capacities are not added. Missing sources preserve null values and incomplete evaluation scope. Formal saving, executable scheduling, transfer/outsourcing decisions and client acceptance remain separate work.
