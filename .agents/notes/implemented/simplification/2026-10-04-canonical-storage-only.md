# Agent Note: Canonical storage startup without runtime conversion

Status: implemented

## Problem

Activation moved entries from retired storage roots and imported an old MCP backend file before exposing current providers. Startup therefore performed an upgrade with user-owned files as its input. The isolated official-host refactor requires current interfaces and preserves original user data; normal activation is not authorization to relocate or reinterpret old storage.

## Decision

Manage resolves only the current `$DSH_HOME/agent-plugins` root and its `data` directory. `apply` rejects the presence of retired `userRoot` or `dataRoot` configuration with `MANAGE_STORAGE_UPGRADE_REQUIRED` before runtime effects. It checks the five current directories (`DSH_HOME`, plugin root, `data`, `user`, `.sources`) with `lstat`, rejecting symbolic links and propagating errors other than missing paths. This check does not create directories or visit retired trees.

The runtime migration implementations and old backend `settings.json` reader are removed. The current settings schema and standard MCP mount/transport remain. Existing original files are neither read, moved nor deleted by an upgrade path at activation; necessary conversion requires a separate authorized task.

This partially supersedes the storage activation portion of [workspace user panels](../feature/2026-09-06-workspace-tabs-user-panels.md). The canonical location, authored Markdown, install state and external/project source ownership remain that note's decision.

## Alternatives considered

**Keep automatic consolidation and import.** Retired startup handled malformed state, conflicts and checkout ownership together to avoid partial moves. Those protections do not grant permission to perform the move. Keeping that implementation behind an option would preserve the runtime compatibility layer the current refactor retires.

**Delete old files or clear storage for startup.** This would erase the user's recovery input and violate the existing ownership rule. Original data stays at its original path.

## Consequences

Fresh canonical profiles activate without reading old roots. Profiles still carrying retired root keys fail explicitly until their configuration is adjusted or a separate upgrade is authorized. Existing current settings still choose and remount the MCP backend. Public `apply` tests verify refusal before mounts and preservation of data behind each protected directory link; existing apply/backend tests cover normal startup and current settings.
