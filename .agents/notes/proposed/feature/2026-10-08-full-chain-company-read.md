# Agent Note: Full-chain company read reception

Status: proposed

## Problem

The accepted mock page cannot validate current company data or Consumer authorization. Restoring the old query entry wholesale would reintroduce its pool default, separate channel, and Workbench calculation ownership.

## Proposal

The company slice uses the current GEA page grant and public access/SQL channel. Workbench owns fixed company queries, complete paging, cancellation, and Session-scoped transient facts. Manage owns source-row normalization, quantity and velocity rules, and the existing public calculator. GEA retains the sole identity and Consumer authority, with a fixed Host-lifetime physical SQL allowance including pages and renewed-delegation retries.

Company and customer units remain separate. This slice has no customer queries or fallback after customer refusal. Current facts and narrowed references expire on cancellation, range/identity/Session changes, and refresh. UI intent can restore; historical facts require a new explicit read. The existing 300-entry catalog allocation remains 298 structure entries, refresh, and one trend reference. Null periods remain gaps; order history retains its target month.

## Alternatives considered

**Keeping runtime mock branches** cannot prove real data and would mix demo and live provenance. Historical 46/47 packages and local test fixtures preserve the mock acceptance.

**Restoring the old server adapter as a whole** would bring pool ownership, a second channel, and duplicated calculation back into the current runtime. Only registered fixed query/mapping inputs are selected.

**Counting UI actions or logging after dispatch** cannot constrain page amplification, retries, or cancelled transmissions. The Host checks the allowance before each physical SQL request; zero blocks before credentials.

## Acceptance criteria

The current reader, Manage calculation, and GEA transport are exercised through public contracts. Captured company inputs match the unchanged bound original JSON summary. Scope, complete paging, optional missing fields, cancellation, late replies, and budgets retain observable proofs. Reviewed ordinary packages, safe startup and current identity/range validation precede live acceptance; source or synthetic fixtures alone do not close tickets14/15.

## Risks

The old raw capture was not directly listed in its original stage hash manifest. The new bounded sample is hashed and tied to the unchanged original selector and comparison, without claiming current database equality. Customer data and models remain independently gated.

This proposal supersedes the current runtime mode of the [mock reception decision](../../implemented/feature/2026-10-07-full-chain-mock-reception.md) when accepted, while retaining its unit, null/zero, fixture-authority and catalog semantics. [Calculation ownership](../../implemented/architecture/2026-10-07-inventory-calculation-ownership.md) remains authoritative.
