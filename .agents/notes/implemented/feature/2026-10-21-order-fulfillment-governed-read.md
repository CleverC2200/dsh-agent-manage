# Agent Note: Order fulfillment governed read

Status: implemented

## Problem

The received fulfillment resources described only mock data. The user supplied a complete prompt and seven Skills, designated Consumer order01, and requested the permission-scoped dashboard described by the live fulfillment specification.

## Decision

Manage retains the original prompt bytes, Skill business rules and semantic reference with source and packaged hashes. The runtime profile and Skill installation notices declare order01 governed read and the actual unresolved metrics. Page, profile, capability and MCP declarations agree; GEA Host remains the only business identity, credential and delegation owner. Workbench uses its existing installed named-query configuration and owned page SQL channel. Gateway enforces current-user row and column grants; no browser role table, new Consumer fallback, direct database path or business write is introduced.

This partially supersedes [received mock business resources](2026-10-07-received-mock-business-resources.md) for current fulfillment execution only. That note still owns the immutable mock baselines, other received prototypes and shared resource assembly. [Selected native business resources](2026-10-04-selected-business-resources.md) continues to own discovery, selection and lifecycle; none of those mechanisms change.

The Workbench implementation and field-level gaps are documented in its `docs/order-fulfillment-data.md`. Source orders, matched tracking and inventory are distinct facts, not a fabricated complete fulfillment ledger. Missing valid-execution mappings, demand exclusions, due-delivery denominators, source snapshots or allocation evidence keep official metrics unknown. Quantities with repeated source keys are not added blindly. Default today uses Shanghai time and explicitly filters source creation date, because the requested expected-delivery date is absent. External Feishu/OMS/WMS/TMS automation stays unavailable.

## Alternatives considered

**Treat the database account as user authorization.** It proves source access only and cannot replace order01 Gateway grants.

**Use client role labels to select full datasets.** It creates an alternate authorization authority and risks exposing unauthorized rows and fields.

**Fill missing fields from the prototype or infer official metrics.** It hides source and definition gaps, including conflicting formulas in the supplied document.

## Consequences

Source checks validate resources, named queries, permission metadata and cancellation. Source SQL replay does not establish published Gateway resources, real-user grants, official Loader reception or business acceptance. Existing Sessions and drafts remain Core-owned; changing Consumer does not rewrite persisted Sessions or grant cross-Consumer access. No remote writes or installed-client changes are part of this local implementation.
