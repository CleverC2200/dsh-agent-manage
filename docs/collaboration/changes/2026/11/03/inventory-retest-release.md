<!-- collaboration-record
{
  "kind": "change",
  "id": "CHANGE-20261103-inventory-retest-release",
  "date": "2026-11-03",
  "title": "Verify historical inventory before refusing comparisons",
  "module": "Inventory",
  "status": "已验证待发布"
}
-->

# Verify historical inventory before refusing comparisons

Base inventory and orchestration resources now inspect the published historical catalog and authorization before refusing a historical comparison. Both periods must use the same source, scope and units. A current page snapshot does not prove historical data is absent. Missing movement or fulfillment evidence still prevents unsupported ratios.

Candidate version: 0.6.3-company.49. Source changes are prepared on a task branch from the fetched GitHub mainline; generated artifacts and private database evidence are not included in this source record. This is not yet a published release.

Prior repairs retained: customer downstream-order fulfillment uses its existing shipped-order pool; unavailable evidence is not converted to zero; authorization refusals do not trigger a source bypass. No product/API/file deletion or new business write workflow is part of this change. The transfer-source correction and missing-target turnover behavior follow the confirmed inventory requirements; old monthly transfer totals remain plan fields.

Validation: affected source, query, presentation, package-version and compatibility checks run before the PR is merged. The final release records bind the actual merged source, package digests, channel revision and verification boundaries. Existing unresolved business reconciliations are not marked complete by packaging.

Release workflow: dsh-plugin-release 1.3.0, locally distributed bundle; no registered team-maintenance source. The plugin suite uses the existing GitHub/OSS destinations. Desktop packaging is outside this release.
