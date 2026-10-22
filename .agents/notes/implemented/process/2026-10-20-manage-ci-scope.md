# Agent Note: Manage CI scope

Status: implemented

## Problem

CI routing regressions repeatedly snapshot and parse the complete repository even when the assertion only concerns a production policy rule. Disabled upstream npm and Pages workflows also remain visible as executable configuration despite current delivery belonging to GEA.

## Decision

Policy routing fixtures load the real policy and discover current test filenames. Actual script-consumer and transitive Host regressions retain complete authored-source snapshots. The assertions, test pool and production selector remain unchanged.

Upstream npm and Pages workflows move byte-for-byte to [historical source](../../../../docs/history/upstream-workflows/README.md). Current quality and compatibility workflows remain executable. GEA owns current package delivery.

The user's explicit removal request retires CodeQL from source, joint and compatibility workflows, including its weekly schedule, applicability outputs and final-gate inputs. Historical scans, alerts and failures remain available. Other security checks retain their existing applicability and failure handling.

This supersedes the executable release entry in [Release version modes](2026-09-10-release-version-modes.md). Its original version-selection rationale remains historical.

## Alternatives considered

**Remove slow selection assertions.** These still protect current policy and execution ownership. Narrowing their fixtures preserves those assertions.

**Keep upstream workflows disabled in place.** They add an obsolete executable entry without serving current delivery. History retains the original definitions.

**Retain CodeQL with result reuse.** This preserves source dataflow analysis while reducing repeated scans, but does not satisfy the user's decision to remove this check.

## Consequences

Routing fixtures no longer reparse unrelated implementation code. Complete snapshots still cover actual import propagation. CodeQL's source dataflow coverage is removed together with its scan cost. Production business, resource and Session tests, source admission, SDK integrity, applicable platform and dependency-security gates, and release authorization retain their existing behavior. [Clean CI](../../../../docs/clean-ci.md) owns the current entry points.
