# Agent Note: Official Workbench entry and client style lifetime

Status: implemented

## Problem

The resource workspace was reachable only through Settings, while shared colors depended on CSS copied into a customized host. The emitted client bundle installed its style during module evaluation, so plugin disposal could not release that resource.

## Decision

`src/client/index.ts` contributes the existing `PluginWorkspace` to the official `main` key `agent-plugin-workspace`. Workbench discovers the public slot registration; its page registration carries only a localized title, released with the injected context. The Settings section and settings card retain their existing behavior and resource owners.

The module-loader banner supplies CSS text to the apply effect. Manage installs and removes its own style in that lifetime and consumes Workbench's plugin-owned `--workbench-*` resource. Theme state and font size remain official DSH properties. No host stylesheet, Core implementation or persistent user data is modified.

## Alternatives considered

**A second page catalog or sidebar implementation** duplicates the official registration facts. The public main slot is sufficient for discoverability.

**Keeping module-load style insertion** makes the style outlive its owner. Publishing the text to the existing apply effect makes setup and release reviewable together.

## Consequences

This partially updates the entry placement in [workspace tabs](../feature/2026-09-06-workspace-tabs-user-panels.md), preserving its one workspace and six tabs decision. It updates the resource provider described by [market affordances](../feature/2026-09-02-market-card-platform-affordances.md): Workbench now supplies plugin CSS instead of a modified ui-theme build. Catalog, install state, MCP transport and business resource ownership stay with their existing modules.

The entry test exercises public contributions, title release and style release. Typecheck and client build verify the candidate; live same-host display is separately recorded by specification 41.
