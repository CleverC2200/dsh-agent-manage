# Agent Note: Received mock business resources

Status: implemented

The MPS execution portion is partially superseded by [MPS seven-step calculation ownership](../architecture/2026-10-22-mps-seven-step-calculation.md). Its governed reads and shared local calculation replace the earlier mock execution; original provenance and the other received resources remain covered here.

The customer-inventory portion is partially superseded by [customer inventory governed read](2026-10-19-customer-inventory-governed-read.md). The decisions below remain current for the order workbench, order fulfillment and other received prototypes.

The fulfillment execution portion is partially superseded by [order fulfillment governed read](2026-10-21-order-fulfillment-governed-read.md). Its order01 source reads replace the current mock-only execution; the retained original mock baseline, other prototypes and shared assembly remain here.

## Problem

The customer, order report and fulfillment prototypes have existing pages and original Agent resources. Static pages without business resource declarations do not let users select those personas and Skills in the page's Session. Receiving the existing prototypes must preserve their mock interactions and resource text.

## Decision

The prototypes keep their existing page identifiers and local interactions. Manage owns the original personas, Skills and empty MCP capability declarations. Workbench assembles the pages and resource files; GEA mounts view-only page grants and rejects SQL for mocks. Selecting a resource uses the existing official Core Session flow without a model request.

This complements [selected native business resources](2026-10-04-selected-business-resources.md). It uses the same resource selection and ownership contract and does not supersede that decision. UI filters and pagination belong to the current page and Session; transient local report tasks retain their original reset policy.

The fulfillment resource includes the received complete Agent prompt, seven domain Skills and their semantic reference. SOURCE.json records original and packaged hashes; agent-prompt.md preserves the prompt bytes. Relative references become explicit Markdown links for the existing reference reader, and installed-capability boundaries are appended without granting tools. The original prompt bytes and mock source baseline remain. Current order01 execution belongs to the superseding fulfillment note; automation prose does not implement Feishu reminders or OMS/WMS/TMS writes. Workbench manifest order matches prompt Skill order.

## Alternatives considered

**Keep the current static pages without business resource declarations.** This preserves page display but leaves the original personas and Skills unavailable through the current resource selection and Session flow. It does not satisfy reception of the existing business resources.

**Recreate independent business plugins.** This restores separate page and resource owners and conflicts with the approved Workbench, Manage and GEA responsibilities. The project requires the existing prototypes to use the shared assembly.

The regional page also keeps its existing `gea-regional-plan` identifier and original `plan-regional` persona, Skill and empty MCP declaration. The current author owns its model, visible filter catalog and simulation context. Its UI intent and unfinished rhythm edits restore within the same Core Session; derived context is published after restoration. Resource selection and withdrawal use the existing Manage owner. No old conversation adapter is installed.

## Consequences

The original resource text and page interactions remain available through the shared assembly, with no second resource registry, credential store or Consumer grant. Workbench assembly requires the sibling Manage resource files. Page intent can restore in its current Session, while local report tasks reset when the page is reopened. The pages remain mocks: this reception adds no business query, task dispatch or model request, and local checks do not establish Native or business authorization acceptance.

The existing static MPS page receives `business-resources/inventory-mps` through the same assembly. It retains its original persona, Skill and consumer identity with empty current MCP capabilities. Its authored step data is published after React commits and removed when that step unmounts. UI intent, adjustment input and unfinished text belong to the current Session; derived mock results are recomputed and never stored in a business database. Historical source declarations remain recorded in the resource provenance.
