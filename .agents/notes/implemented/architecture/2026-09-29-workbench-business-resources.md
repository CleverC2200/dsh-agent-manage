# Agent Note: Workbench business resources

Status: implemented

## Problem

Migrating a business page must not leave its persona and Skill owned by the data-access plugin, or introduce a second capability inventory.

## Decision

Agent Manage owns inventory-fc and inventory-aqkc resources and exports a runtime loader for an assembled workbench resource. The existing page/capability declarations remain the identity source. Its `prompt.json` also lists `pageAgents`: installed presets allowed to interpret this page, including the page's own preset. This list does not grant cross-Consumer access. GEA validates the page Consumer and effect, then checks each selected preset, its Session and its separate Gateway Consumer grant. [Selected native resources](../feature/2026-10-04-selected-business-resources.md) supersedes the former filesystem mount with Manage's official Skill Provider and preset publication. Package containment and interpreter/Consumer separation remain owned here. Credentials and execution remain in GEA.

## Alternatives considered

A new business registry would duplicate the existing capability registry. Treating `pageAgents` as `crossConsumers` would widen query authority merely to offer another interpreter. Arbitrary external paths would weaken the assembled resource boundary. These options are avoided: references stay inside the resource after realpath resolution, and retired resource manifests are rejected rather than adapted.

## Consequences

The workbench build requires the sibling Agent Manage resources. Native Skill discovery and source paths remain available. [Business resource cleanup](2026-10-01-business-resource-ownership.md) preserves metadata and unresolved file cleanup ownership. Official preset release retains failed handles under [async result ownership](../bug-fix/2026-10-09-async-result-ownership.md). The page can use distinct Sessions for branch-stock and full-chain Agents while the page's SQL still uses its original Consumer. Validation uses local fixtures and cannot establish live business authorization. The GEA MCP login-owner ADR remains applicable and unchanged.
