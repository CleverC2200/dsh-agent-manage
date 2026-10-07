# Agent Note: Dealer reception with fixed local input

Status: implemented

## Problem

The saved dealer candidate reads live data on page open, outside the next batch's authorized local-input scope.

## Decision

The dealer page keeps its original rules and complete-paging interface with a local registered fixture. Manage keeps its original consumer identity and publishes the explicitly mock resource described in [the reception record](../../../../docs/adr/2026-10-07-dealer-mock-reception.md).

## Alternatives considered

**Keeping automatic live reads** exceeds the batch's data authorization.

**Replacing the page with a sample** removes the original health, coverage and recommendation behavior required for reception.

## Consequences

Current local results can be verified without business queries. Original ticket 16 real authorization and acceptance remain open.
