# Agent Note: Current Agent lifecycle only

Status: implemented

## Problem

The runtime subscribes to both current Agent creation and an obsolete host startup event.

## Decision

Project effects initialize through asynchronous `agent/created` and release through `agent/disposed`. The old event listener and its widened host type are removed. Existing Agents still receive project effects at mount.

## Alternatives considered

Keeping two event families retains a host version the isolated project no longer supports.

## Consequences

Commands still finish before the first model request. Tests retain initialization waiting and effect disposal. Marketplace layouts, MCP transports and persistent user data keep their domain behavior.
