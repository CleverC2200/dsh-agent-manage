# Agent Note: Refresh private company suites without Git

Status: implemented

## Problem

A packaged desktop must refresh the private company suite source without a developer Git installation or credentials embedded in a source URL.

## Decision

Use an explicit archive source with the GitHub API zipball URL. The acquisition layer reads a caller-owned `DSH_AGENT_MANAGE_GITHUB_TOKEN` from the runtime environment and passes it only to the initial HTTPS GitHub API request. Redirects never carry Authorization. The token is not part of source state, manifests or archives. Zip extraction remains in-process with existing limits and traversal checks. The existing atomic directory swap preserves the last usable suite content when refresh fails.

## Alternatives considered

Bundling Git or cloning a developer checkout would add runtime dependencies and blur source ownership. Putting a token in the source URL would persist credentials. Both are rejected for the company desktop path; ordinary Git and local sources remain available.

## Consequences

Administrators provision per-user read access outside the business UI. Missing access reports a download failure without deleting installed content. A resource archive digest identifies suite content independently of the Agent Manage runtime version. Installing a suite does not create role-based security isolation.

This extends [source acquisition](2026-09-01-source-acquisition-expansion.md) and does not supersede its ownership or extraction decisions. Existing active acquisition and GEA MCP notes were checked; no contradictory decision was found.
