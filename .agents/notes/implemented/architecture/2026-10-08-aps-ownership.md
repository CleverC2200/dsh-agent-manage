# Agent Note: APS calculation and analysis ownership

Status: implemented

## Problem

The original APS candidate kept business calculation in Workbench and analysis Skill copies in GEA. Receiving that arrangement would preserve duplicate ownership.

## Decision

Manage owns the original pure calculation through `aps-compute/*` public exports and the original analysis Skills in `business-resources/aps-analysis`. Workbench imports these exports, presents the existing PC page and owns its scoped UI state. GEA owns identity and governed execution. Selection validates the capability's explicit Skill and Consumer references against the owning prompt before mounting it. References never grant business permission.

## Alternatives considered

**Restoring the whole old candidate.** This would replace current 46 interfaces and preserve obsolete ownership. Only the fixed required source is restored.

**Leaving calculation and Skill copies with their old owners.** This would make one rule have several maintainers. The page imports the public Manage module and GEA no longer registers a duplicate analysis provider.

## Consequences

The original eight runtime calculation and dimension modules retain their canonical runtime AST. Original 50 literal test bodies remain unchanged and consume the public export. Type-only annotations and a dead unused variable are adjusted for current Manage standards. Mock reception is compiled explicitly, has no SQL capability and preserves missing values. Actual Native and business authorization remain separate acceptance stages. No active APS ownership note existed in this checkout; the historical 17 note belongs to its fixed source evidence.
