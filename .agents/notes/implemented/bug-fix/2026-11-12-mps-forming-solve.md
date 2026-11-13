# Agent Note: MPS forming constraints in the actual solve

Status: implemented

## Problem

Manual forming resources and approved monthly shares reached the reference workflow but were filtered out of the actual plan. Resource configuration could therefore appear complete while forming capacity never limited production.

## Decision

Partially superseded by the [tunnel-only correction](2026-11-13-mps-tunnel-default.md). Forming is not a prerequisite for the current business; the explicit-configuration consumption path below is retained.

The [MPS calculation contract](../../../../docs/design/mps-compute.md) owns the joint solve. Candidate tunnels and approved forming shares consume capacities for the same physical production. A continuous linear solver preserves common fulfillment and permits alternative tunnels; fixed forming shares remain business inputs. Missing forming assignments isolate affected positive production requirements. Zero production and external ODM remain independent of internal forming resources.

## Alternatives considered

Adding both resource kinds as interchangeable supply increases capacity incorrectly. Trimming a tunnel-only solution afterward can waste available alternatives and does not preserve joint fairness. Inferring machine capacity or shares would invent business data.

## Consequences

`javascript-lp-solver` is pinned as the browser-safe LP implementation. Workbench owns configuration, assembly, issue CSV and resource usage display. Manage performs pure calculation without IO or business writes. Existing evaluation versions and source facts remain unchanged. Fixture checks prove coupled bottlenecks and transfers; real machine feasibility requires actual machine data and approved monthly shares.
