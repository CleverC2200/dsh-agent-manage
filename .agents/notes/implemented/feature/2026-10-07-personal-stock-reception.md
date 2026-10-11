# Agent Note: Personal stock mock reception

Status: implemented

## Problem

The retained personal stock candidate has useful monitoring and feedback behavior, but its readers would issue real queries when the page opens. Batch46 authorizes fixed mock reception only.

## Decision

The original reception published the personal resource identity with an explicit mock evidence rule. Current `inventory-personal/capability.json` and `mcp.json` declare nine tables and `governed-sql-read` under the independent Consumer. This source extension replaces the mock-only declaration, while fixed inputs remain offline regression evidence. Workbench owns the page and fixed input; Core owns the actual Session and unsent conversation draft. The page keeps unsent feedback fields through the existing scoped view state and appends text through the public Core edit event.

## Alternatives considered

**Restore live readers.** This would exceed the authorized data scope, so the original mock reception artifact contained no real reader.

**Send the conversation action.** That action queues a model Task. The feedback button inserts plain unsent text instead.

## Consequences

Default entry visibility remains unchanged. Mock values and simulated denial do not close the original ticket26 real authorization or Native conditions. Historical candidates and failed evidence remain available. The active-note audit found no existing owner of this personal reception decision.
