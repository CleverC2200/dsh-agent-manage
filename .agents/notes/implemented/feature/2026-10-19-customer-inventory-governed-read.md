# Agent Note: Customer inventory governed read

Status: implemented

## Problem

The received customer-inventory page used embedded sample rows and an empty capability declaration. Replacing those rows with a database client in the page would expose credentials, bypass GEA identity and grants, and duplicate the governed SQL path already used by live inventory pages.

## Decision

Workbench keeps the received React/Arco layout and reads the latest snapshot of `agents_scm_cust_jxc_ai_daliy_d` plus delivery-address membership from `agents_dim_dealer_data_d` through the shared `gea-html-v2` SQL channel. Manage declares both tables and `governed-sql-read` for consumer `customer_inventory`; GEA Host remains the sole owner of identity, credentials, row/column authorization and execution.

The first mapping publishes source inventory quantity and amount, 30-day sales, normal inventory and zero-sales SKU count. Turnover and normal ratio are page derivations; targets must come from existing dealer-side results and remain unknown when unavailable, rather than being recomputed from 20-day sales. Region and province use the inventory source; delivery cities are parsed as a multi-valued customer membership from the dealer address JSON. A single selected city shows whole inventory for related customers and city totals must not be added across cities. Structure score, large-date/expiry, shortage and owner stay unknown. Missing customer fields stay unknown, while summaries add available values and expose missing/abnormal customer counts. Negative book balances are preserved; negative aggregate balances do not produce a valid turnover. The retained freshness card uses a positive-stock weighted normal ratio with explicit customer coverage, not verified batch expiry. No missing field falls back to samples.

This note partially supersedes the customer-inventory portion of [received mock business resources](2026-10-07-received-mock-business-resources.md). Its decisions for the order workbench, order fulfillment and other received prototypes remain current.

## Alternatives considered

**Connect the HTML directly to Doris.** This would place credentials and authorization decisions in Workbench, contrary to the established GEA Host boundary.

**Continue using samples until every card has a source.** This hides which facts are live and permits stale demonstration values to be mistaken for current inventory.

**Infer unsupported risk fields from similar columns.** Names such as normal inventory do not prove large-date, expiry or shortage semantics, so those values remain unknown until a governed source and business definition are confirmed.

## Consequences

The packaged customer persona retains the supplied customer Agent prompt and five task Skills without changing their business text. The existing inventory-customer Skill remains the page-evidence bridge and defers formulas and thresholds to current published page evidence, including big_final_qty rather than a total-minus-normal estimate. Prompt and capability Skill identities match the ordered Workbench manifest paths so GEA can publish all six Skills through the existing package provider. No new query, write tool, Consumer grant or historical/batch source is implied. Installed-client and real-model acceptance remain separate from resource loading tests.

Workbench mounts the empty six-card/table layout before connection or querying. Connection, Agent/data denial, unavailable resources, expired sessions and query failures remain explicit display states, not empty-success evidence. The bounded loading flow clears old rows and cancels reads on identity/session changes; the HTML includes a static no-data shell if scripts cannot execute. These presentation safeguards do not change GEA authorization or metric formulas.

Source and mapping tests can verify fixed SQL, units, derivations and null preservation without credentials. A source checkout does not prove live availability: installation, the environment resource binding, the consumer grant and an original SQL receipt remain external acceptance evidence. The user confirmed the formal Consumer `customer_inventory`; page, Prompt, MCP and capability declarations use that exact code together. The page/resource ID stays `inventory-customer`. GEA accepts underscores in Consumer codes without relaxing page IDs or granting access; the Gateway still authorizes the current user and data resources.
