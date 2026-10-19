# Agent Note: Customer inventory governed read

Status: implemented

## Problem

The received customer-inventory page used embedded sample rows and an empty capability declaration. Replacing those rows with a database client in the page would expose credentials, bypass GEA identity and grants, and duplicate the governed SQL path already used by live inventory pages.

## Decision

Workbench keeps the received React/Arco layout and reads the latest snapshot of `agents_scm_cust_jxc_ai_daliy_d` plus delivery-address membership from `agents_dim_dealer_data_d` through the shared `gea-html-v2` SQL channel. Manage declares both tables and `governed-sql-read` for consumer `customer-inventory-preview`; GEA Host remains the sole owner of identity, credentials, row/column authorization and execution.

The first mapping publishes source inventory quantity and amount, 30-day sales, normal inventory and zero-sales SKU count. Turnover and normal ratio are page derivations; targets must come from existing dealer-side results and remain unknown when unavailable, rather than being recomputed from 20-day sales. Region and province use the inventory source; delivery cities are parsed as a multi-valued customer membership from the dealer address JSON. A single selected city shows whole inventory for related customers and city totals must not be added across cities. Structure score, large-date/expiry, shortage and owner stay unknown. Missing customer fields stay unknown, while summaries add available values and expose missing/abnormal customer counts. Negative book balances are preserved; negative aggregate balances do not produce a valid turnover. The retained freshness card uses a positive-stock weighted normal ratio with explicit customer coverage, not verified batch expiry. No missing field falls back to samples.

This note partially supersedes the customer-inventory portion of [received mock business resources](2026-10-07-received-mock-business-resources.md). Its decisions for the order workbench, order fulfillment and other received prototypes remain current.

## Alternatives considered

**Connect the HTML directly to Doris.** This would place credentials and authorization decisions in Workbench, contrary to the established GEA Host boundary.

**Continue using samples until every card has a source.** This hides which facts are live and permits stale demonstration values to be mistaken for current inventory.

**Infer unsupported risk fields from similar columns.** Names such as normal inventory do not prove large-date, expiry or shortage semantics, so those values remain unknown until a governed source and business definition are confirmed.

## Consequences

Source and mapping tests can verify fixed SQL, units, derivations and null preservation without credentials. A source checkout does not prove live availability: installation, the test-environment resource binding, the consumer grant and an original `inspect_cube_model`/SQL receipt remain external acceptance evidence. The existing consumer code is retained to avoid inventing a formal identity; GEA must authorize that exact code or an approved replacement must update every declaration together.
