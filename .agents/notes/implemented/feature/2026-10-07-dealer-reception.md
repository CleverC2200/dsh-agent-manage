# Agent Note: Dealer reception with fixed local input

Status: implemented

## Problem

The saved dealer candidate reads live data on page open, outside the next batch's authorized local-input scope.

## Decision

The original reception retained the dealer rules and complete-paging interface with a registered local fixture. Current `inventory-dealer/capability.json` and `mcp.json` declare ten tables and `governed-sql-read` under the original Consumer. This source extension replaces the mock-only declaration, while fixed fixtures remain offline evidence. [The reception record](../../../../docs/adr/2026-10-07-dealer-mock-reception.md) distinguishes original scope and outstanding acceptance.

## Alternatives considered

**Keeping automatic live reads** exceeds the batch's data authorization.

**Replacing the page with a sample** removes the original health, coverage and recommendation behavior required for reception.

## Consequences

The original mock receipt proves only its fixed local input. Current read declarations do not prove transport, identity, row grants or production data. Original ticket 16 real authorization and acceptance remain open.
