# Agent Note: Fork package identity

Status: implemented

## Problem

The repository belongs to CleverC2200/dsh-agent-manage, while package metadata, installation instructions and feedback still target the upstream project.

## Decision

The package, Cordis bundle and server/client exported identities use dsh-agent-manage. Repository, ownership and feedback target CleverC2200/dsh-agent-manage. Instructions use GitHub installation without assuming a new npm publication. The docs-site configuration targets the fork; deployment is not implied.

Existing settings namespaces, UI identifiers, API and data paths stay compatible. Replacing the old package requires removing its profile entry first to avoid duplicate loading. Historical releases, copyright and external schema provenance retain their original identities.

## Alternatives considered

**Change repository metadata only.** The package identity and actual feedback destination would still belong to upstream, leaving the problem unresolved.

**Replace every old name.** This would change persistent settings and data identifiers and rewrite historical evidence, so it is rejected.

## Consequences

New-package publishing permissions, GitHub Pages deployment and live host replacement remain unverified; this change does not publish. This decision updates only feedback repository ownership; the existing workspace-tabs-user-panels decision still owns its settings gate, registration and local fallback.
