# Inventory calculation contract

Manage owns `src/inventory-compute`. Its package exports `./inventory-compute/*` with a `source` condition for compile-time page assembly and the emitted JavaScript and declarations for package callers. No tool, model route or HTTP endpoint is added.

| Public module | Input and result |
| --- | --- |
| dealer-order | Customer, SKU, verified pickup and policy periods determine applicable policies. Order rows produce quantity and nullable amount. |
| dealer-dashboard | Already-scoped Cube rows produce original coverage, summaries, deduplication, aging and business-rule results. Workbench retains reads, customer authorization, limits and pagination. |
| dealer-overview-facts, dealer-recommendation, dealer-status-filters | Original source preference, coverage, expiry, seasonal exclusions, replenishment quantities and business statuses. |
| personal, personal-sources, daily-report | Source values produce weighted age, known/partial totals, fixed age bands, source-specific risks and inventory objects. |
| full-chain-workspace-service, full-chain-category-structure, full-chain-customer-metrics, full-chain-types | Supplied facts, filters, captured dates and trusted scope produce the original company/customer metrics and trends. Supplied scope does not establish authorization. |
| full-chain-source-rows | Original company SQL rows normalize into domain facts, retaining quantity, nullable source fields, daily velocity and zero-age batch rules. It performs no IO or authorization. |

Workbench imports these public modules directly. Its build resolves the declared `source` export and records every consumed Manage source/configuration hash plus package metadata in `build-inputs.json`. Results are bundled into the page; the browser does not import a host runtime. Workbench continues to own fixture loading, source permission cropping, page state, pagination, cancellation, references and snapshot lifetime. GEA remains the data authorization owner.

Fixed Git golden checks and existing Personal age/partial and full-chain tests remain the independent expectations. Personal's original daily-report variant differs from the first-batch AQKC report in source selection and risk truncation; this migration does not replace that first-batch rule version. The calculation modules do not verify real business grants.
