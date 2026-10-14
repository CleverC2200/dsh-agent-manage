# Agent Note: Installed panel resource reads and mutations

Status: implemented

## Problem

Reading one installed resource loaded every user resource and the full market overview. Installation facts came from a second catalog observation, while routes separately remembered to notify runtime mounts after writes.

## Decision

`Catalog.readInstalledSuites` captures one install state and scans only its selected sources. `PanelResources` resolves an installed identity before reading its body; user names go directly to the user store. Disabled installs remain visible with their disabled state.

Resource writes pass through `Catalog.changePanelResources`, which serializes them with catalog mutations, invalidates discovery after success and awaits runtime notification. Routes only parse and delegate. Failed validation does not notify. Existing realpath checks, external-source read-only rules and manifest-backed resource protection remain in the resource module.

## Alternatives considered

Caching a second market projection would duplicate installation state and invalidation. Keeping route-owned notification would require every future caller to remember the same sequence. Neither is needed when the existing catalog owns install facts and the change pipeline.

## Consequences

Single-resource reads do not probe unrelated market checkouts or load unrelated resource bodies. Installed resources still use the existing bounded discovery cache; no second cache or persisted format is introduced. A write whose runtime notification fails still reports that failure after the file change, as before. This source decision does not establish installed-client or business acceptance.

[中文](2026-10-14-installed-panel-resources.zh.md)
