# Agent Note: APS calculation and analysis ownership

Status: implemented

## Problem

The original APS candidate kept business calculation in Workbench and analysis Skill copies in GEA. Receiving that arrangement would preserve duplicate ownership.

## Decision

Manage owns the original pure calculation through `aps-compute/*` public exports and the original analysis Skills in `business-resources/aps-analysis`. Workbench imports these exports, presents the existing PC page and owns its scoped UI state. GEA owns identity and governed execution. Selection validates the capability's explicit Skill and Consumer references against the owning prompt before mounting it. References never grant business permission.

## Alternatives considered

**Restoring the whole old candidate.** This would replace current 46 interfaces and preserve obsolete ownership. Only the fixed required source is restored.

**Leaving calculation and Skill copies with their old owners.** This would make one rule have several maintainers. The page imports the public Manage module and GEA no longer registers a duplicate analysis provider.

## Consequences

Calculation and dimension modules remain owned by Manage. The original 50 literal test bodies remain unchanged and consume the public export. `production-output` accepts the explicit `MES_QUANTITY` contract through `metrics`: it sums same-period planned and actual quantities before division, rejects duplicate or incomplete facts, and reports coverage as returned MES lines. Legacy future schedules still do not produce an attainment rate. Workbench owns the configured source read and factory-name normalization; neither module grants permission. Type-only annotations and a dead unused variable follow current Manage standards. Mock reception is compiled explicitly, has no SQL capability and preserves missing values. Actual Native and business authorization remain separate acceptance stages. The historical 17 note belongs to its fixed source evidence.

`classified-stock` supplies a display-only sum for explicitly classified inventory groups, with matched and unresolved group counts. It never changes the strict scoped metrics used for health, ratios or comparisons; Workbench labels partial observations and suppresses their comparisons. Live hierarchy choices are projected from returned dimensions instead of the demo taxonomy.

Page briefings label daily-source shipment sums as period shipments when start and end differ; single-day reads retain their daily label. Internal metric keys and quantity calculations remain unchanged.

`stockCoverageObservation` consumes optional SQL aggregates matched at base-SKU grain before product grouping. It exposes quantities, demand, covered/total counts and days for display only; incomplete aggregates, failed sources and zero denominators remain unknown. Strict full-scope metrics, health and period comparisons are unchanged.

`budget-performance` computes display-only observations for same-month customer-SKU intersections with complete budget and untaxed income. Annual observations average usable monthly rates and expose usable/expected months. Company budgets are never allocated to bases or organizations; missing, duplicate and denied facts stay unknown. Observations never feed full-scope metrics, health or period comparisons.

## Configured zero-fill policy (2026-10-20)

At the user's request, configured APS snapshots opt into `missingValuePolicy: 'zero'`. SQL coalesces numeric inputs before deviations and sums each quantity independently; Manage treats returned null numeric values as zero without suppressing the total because a completeness counter is nonzero. Production uses all independent planned/actual totals, and budget uses independent income/budget totals rather than matched-key observations. This policy supersedes the strict completeness rules above for configured APS metrics only; legacy inputs without the flag retain those rules. Zero denominators, non-finite values, loading, failed or denied queries and unsupported date windows remain unavailable. Dimensions and source identities are not zero-filled or allocated; scoped totals include only records assigned to that scope. Workbench disables partial-observation fallback under this policy and labels missing numeric values as zero.

## Immutable metric snapshot reuse (2026-10-29)

`createMetricReader` reuses scoped results per immutable period snapshot through weak keys. A newly arriving comparison period does not rescan unchanged current rows. Each reader owns its comparison object; refresh and identity changes supply new snapshots or null, never a date-only global cache. Public `metricValues` remains uncached. Workbench continues to own lazy list rendering and paging; business formulas and governed SQL are unchanged.

## Cross-matrix quantity alignment (2026-10-30)

`matrixCellsFromData` groups only returned base/category records. Inventory uses inventory quantity regardless of unrelated demand completeness; shippable days uses the shippable source's available quantity divided by summed planned daily demand. An explicitly failed shippable source cannot fall back to stock. Production now consumes the same `productionOutputMetric` MES quantity contract as the headline. `sumMetricQuantity` owns the common strict/configured-zero aggregation used by headline and dimensional quantities; invalid formats, failed sources and zero denominators remain unavailable. Unknown dimension assignments are not invented or allocated. Empty matrix analysis stays within the selected metric and does not substitute company-wide conclusions.

Workbench owns stable axes from returned dimensions, dynamic column sizing, risk colors, neutral inventory observations and source snapshot labels. It does not fill absent combinations with zero or use mock classifications. Production risk thresholds remain the existing >99% / >95% rules and shippable thresholds remain the existing 8–12 day healthy interval, excluding boundaries.
