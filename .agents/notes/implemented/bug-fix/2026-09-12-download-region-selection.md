# Agent Note: Saved download region owns the selection

Status: implemented

## Problem

The settings card saves a manual region but its initial backend probe keeps highlighting the old region. Repeated clicks appear ineffective until the card remounts.

## Decision

Explicit saved global/china settings own the selected segment; only auto uses the effective-region probe. Buttons expose aria-pressed. Failed writes keep the saved selection and show the existing error. The backend routing contract is unchanged.

## Alternatives considered

**Refresh the probe after each write.** An older or delayed response could still override the saved selection and adds a network dependency to displaying a confirmed choice.

**Close and reopen settings.** This refreshes the probe but leaves normal switching broken.

## Consequences

Component tests exercise bidirectional switching against an unchanged initial probe and failed-write retry. The active-note supersession check found no owner of this selection rule; runtime reconciliation scheduling remains unchanged.
