# Agent Note: MPS tunnel-only inputs do not require forming machines

Status: implemented

## Problem

An optional configuration path was promoted into a prerequisite for every internal production option. The user confirms that the current business does not use forming machines. Adding machines to common fixtures concealed the regression instead of testing that business input.

## Decision

The [calculation contract](../../../../docs/design/mps-compute.md) accepts the current tunnel-only business input. Absent forming configuration creates neither an additional resource requirement nor a request to supply machines or shares. The actual solve, reference workflow, page diagnostics and assistant resources use that same boundary. Pure single-resource options reuse the existing fair allocator.

This partially supersedes the [forming solve decision](2026-11-12-mps-forming-solve.md). Its global prerequisite is withdrawn. Existing explicit configurations and their coupled consumption remain supported so that correcting the default does not discard user configuration. That retained path does not establish a forming requirement for the current business.

## Alternatives considered

Filling fictitious capacities or shares would hide the incorrect prerequisite and invent business data. Deleting existing explicit configurations would lose user inputs. Changing only the final issue label would leave production blocked and the reference workflow inconsistent.

## Consequences

Common fixtures represent tunnel-only production. Explicit forming cases remain separate. The regression must reject forming-related missing-data demands when no forming configuration is used and must preserve tunnel capacity limits, inventory balance and transfer conservation. Original evaluations and source facts remain unchanged. Source checks, development-window acceptance and formal publication remain separate stages.
