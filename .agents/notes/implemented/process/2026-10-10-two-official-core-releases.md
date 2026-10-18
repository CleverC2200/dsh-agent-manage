# Agent Note: Two registered official Core releases

Status: implemented

## Problem

Ordinary installation must accept the same Manage tarball on the registered official rc.2 and alpha.1 releases. Loosening peers alone cannot prove resources, defaults, complete presets or browser behavior.

## Decision

DSH runtime peers accept exactly `0.2.0-rc.2 || 0.2.1-alpha.1`. Cordis, Schemastery and Include accept the exact versions declared by those two Core manifests. Development dependency paths retain one SDK layout. Clean CI prepares the explicitly selected registered Core before consumer installation; the GEA supported-Core registry owns accepted heads, original lock hashes and toolchains. [Clean CI](../../../../docs/clean-ci.md) records the shared SDK interface and separate quality/security results.

Manage quality requires the SDK module's real host flock preparation and verification for official Session writer locks. Archives and audit keep their narrower inputs. The original forecast Session test installs an independent temporary copy of the complete tracked sales suite with its fixed source hashes rather than a repository outside the runner checkout. Its Skill path assertion distinguishes the installed original source from the bundled provider.

Required static quality includes the package identity's Node behavior tests independently of affected Vitest selection. Hosted quality revalidates the frozen group and complete SDK identity/byte receipt after collecting consumer checks, allowing a valid SDK cache save even when a consumer check fails. Quality remains failed in that case. Only main pushes produce optional package-download caches, capped at 512 MiB and 50,000 entries without following links; inspection and upload each have a one-minute limit. PRs restore these caches. Required and compatibility artifacts both include capability reports. Cache policy does not relax original-lock, source or toolchain admission.

Resource and Skill publication use the shared registry and provider interfaces. Standard composition reads the active Host's `readDocument('standard')`, including its disabled rows and user configuration, rather than transplanting another release's declaration. No production version branch or copied SDK is added.

`DSH_CORE_CHECKOUT` selects the official input for the existing capability lanes. Host fixture imports and static SDK imports resolve the same package exports; the browser lane reads that Core's source mapping and redirects existing relative official-source references to the same Core. The native Loader and real Session still run; local completion and controlled business adapters keep their existing offline scope.

This partially supersedes the single-release runtime peer decision in [One registered official SDK](2026-10-04-one-official-sdk.md). Its single selected development SDK layout, current exports, removed client-runtime metadata and existing module ownership remain.

The browser fixture uses the official `createConversationStore` and mounts the selected `DefaultConversationViews`. The shared string draft input gives rc.2 its declared persisted format; the real mount owns rc.2 hydration and both releases' persistence. Preparation-time typing uses the real input's `setDraft`, so conflict and cancellation still exercise resident input state. Tests retain each official Host's own developer-tools visibility and time-context declaration rather than require alpha-only behavior from rc.2.

## Alternatives considered

**Relax peers without executing both official inputs.** This would accept packages without proving the required behavior.

**Add version branches or copy an SDK into Manage.** The consumed resource and preset interfaces are common to both releases. Extra runtime state and a second SDK instance would weaken the existing ownership.

**Save only after every consumer check passes, or upload unbounded download stores from PRs.** The former repeats valid SDK compilation after unrelated failures. The latter adds upload work to each candidate without a size ceiling. A separately revalidated SDK and bounded main-only download producer retain the existing independent preparation and trust boundaries.

## Consequences

The complete capability check runs separately for each selected Core, preserving that Host's standard tools, commands, compaction, pruning and child Agent behavior. Source and offline checks do not prove ordinary PluginManager installation, Native, external business or model execution. The delivery reception owns fresh empty-profile observations for the same tarball on both releases.
