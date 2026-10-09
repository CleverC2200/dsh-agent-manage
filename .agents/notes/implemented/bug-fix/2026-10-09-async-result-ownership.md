# Agent Note: Asynchronous result and release ownership

Status: implemented

## Problem

An invalidated market request could publish an obsolete result, or silently start another request after the latest request failed. Market rendering also started HTTP and busy leases. Failed preset disposal discarded the information needed for retry. A save from a previous user-panel kind could refresh the old list into the current panel.

## Decision

`market-resource` owns cache generations and the current generation promise. Invalidating removes the old generation from the cache and in-flight ownership. Obsolete callers follow the current generation result, including a settled failure, without an automatic retry. `readOverview` only reads a snapshot; `MarketSection` starts loading in its committed effect.

`BusinessResources` retains mounted disposers, versions and resource entries when Core release fails. A changed preset cannot replace an unresolved old mount. Explicit owner release and whole-plugin disposal use the existing operation queue; each successful release removes its entry, while failed release remains retryable. The existing selection rollback reports release failure and retains the disposer for explicit cleanup.

Workspace user panels have keys for skills, commands and agents. `UserPanelSurface` also owns a lifetime per kind, so direct kind changes and unmounts revoke old mutation continuations before they start a refresh or publish an error or busy update. Current-kind refreshes keep their existing latest-result ordering.

This extends [business resource cleanup ownership](../architecture/2026-10-01-business-resource-ownership.md), whose original file cleanup and metadata decisions remain unchanged. It partially updates the panel operation lifetime in [workspace tabs and user panels](../feature/2026-09-06-workspace-tabs-user-panels.md); shared UI, Markdown storage, routing and resource ownership continue to apply. No active note is fully superseded.

## Alternatives considered

**Returning only a cached overview for obsolete requests.** A failed current generation has no cached value. Calling `loadOverview` then silently retries and hides that failure, so the resource keeps the settled generation promise.

**Removing ownership before disposal.** A rejected Host release would leave a mounted preset without a retry handle and allow a later owner to overwrite it.

**Only keying workspace panels.** This protects their displayed state but still lets an unmounted save start an obsolete HTTP refresh, and does not cover direct kind changes. The component revokes those continuations as well.

## Consequences

Offline tests use the real resource, React and API modules, with fixtures only at HTTP and the Core preset adapter. They cover both completion orders, the latest generation failure, render without HTTP or busy leases, failed release and explicit retry, replacement rejection, rollback, and partial or concurrent cleanup. They do not establish Native display, live authorization, model execution, or a production release.
