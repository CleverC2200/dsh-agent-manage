# Agent Note: Workbench business resources

Status: implemented

## Problem

Migrating a business page must not leave its persona and Skill owned by the data-access plugin, or introduce a second capability inventory.

## Decision

Agent Manage owns inventory-fc resources and exports a runtime loader for an assembled workbench resource. The existing page/capability declarations remain the identity source. GEA validates their Consumer and effect, then calls the loader's mount operation to publish the Skill through existing native filesystem roots and installs the loaded persona in its existing profile map. Credentials and execution remain in GEA.

## Alternatives considered

A new business registry would duplicate the existing capability registry. Arbitrary external paths would weaken the assembled resource boundary. Both are avoided: references must stay inside the resource after realpath resolution. Legacy bundles continue on their old path.

## Consequences

The workbench build requires the sibling Agent Manage resources. Native Skill discovery and source paths remain available. Cleanup restores previous file contents only when the mounted content is still present. Validation uses local fixtures and cannot establish live business authorization. The active-note audit found no existing owner of this split-resource decision; the GEA MCP login-owner ADR remains applicable and unchanged.
