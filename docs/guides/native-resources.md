# Native resource selection and business composition

English | [中文](native-resources.zh.md)

## Discovery and selection

`GET /api/agent-manage/resources?cwd=...` returns lightweight installed/enabled prompt and human-invocable Skill summaries for the explicit absolute native workspace. `POST /api/agent-manage/resources/select` accepts only `{ "id": "...", "cwd": "/absolute/workspace" }` and publishes the selected original resource through the official native preset/Skill interfaces. Discovery, body selection and the new Workbench Session use the same current native workspace (or the explicitly configured workspace before a Session exists) and stages `/skill-name` without sending a model request. Missing installed Skills are reported separately from Consumer authorization. `selected-resources.json` stores only selected identities for restart recovery; it contains no resource prose or credentials.

Resource selection accepts same-origin POST JSON up to 64KiB, counted from the stream before selection. Oversized buffered or chunked bodies return 413. Malformed packaged Skill metadata is diagnosed at that Skill and skipped; healthy resources remain available, and cancellation propagates.

Manage provides `skill_reference_read` for local relative references explicitly linked by a currently visible model-invocable Skill. It uses the host filesystem's read permissions, caller workspace/scope/cancellation and strict UTF-8, size and line paging limits, and revalidates the installed owner before returning. MCP resources still use the server's resource reader.

## Reference reads and calculations

The pure `forecast_compute` capability uses the installed/enabled `sinian-demand-baseline` visible in that caller workspace. It preserves §5.5's exact decimal algorithm, missing-data branches and draft/no-write semantics. Its result includes algorithm version, exact input SHA-256 and whether complete JSON originated in an actual user message. This provenance does not verify business sources or grant Consumer authorization; model-supplied `data_mode` alone is never source proof.

After Manage validates a selected prompt's `pageAgents`, resource summaries and selection results include the optional `interpreters` array. It contains allowed page interpreter identities whose resource owners remain registered, enabled and free of a recorded load error. Workbench uses these identities to choose an official Session preset. GEA checks the selected preset and required Consumer permissions.

The public `dsh-agent-manage/forecast-source` export provides the calculator version, canonical input hash, user-message input check and current baseline fingerprint used by `forecast_compute`. GEA consumes these functions in its existing per-identity Session evidence store. Manage keeps the decimal calculation and source checks. GEA keeps business authorization.

## Business resource composition

The following describes this checkout’s source declarations. Installed runtime, live identity, grants, source rows and model behavior require separate receipts. Resource selection and page visibility do not grant business writes.

Customer stock, order report and order fulfillment resources are retained in `business-resources/inventory-customer`, `inventory-orderworkbench` and `inventory-orderfulfillment`. Their original personas and Skills describe mock data only. The Workbench assembles them into existing page packages; selecting them prepares an official Core Session without a model request. Their MCP capability list is empty and GEA rejects business SQL.

The existing regional prototype uses the original `plan-regional` resource in `business-resources/plan-regional`. Workbench assembles it into the current `gea-regional-plan` page; Manage publishes the original persona and Skill through native resource selection. Its MCP capability list is empty and GEA grants only view access. UI draft recovery does not save a business plan.

The original category plan resource remains in `business-resources/category-plan`. Workbench assembles it into `lib/static/category` with the original `category-plan`, `plan-region-category` and `category-plan-prototype` identifiers. Its Skill distinguishes Session UI intent and unfinished text from temporary simulated tasks; the MCP capability list remains empty.

MPS resources in `business-resources/inventory-mps` retain the original mock persona, Skill and view-only declarations. The Workbench assembles them into the existing static MPS page. The Skill reads only the mounted step; UI intent and unfinished text restore in the current Session, while derived mock results never enter a business store. The historical `governed-sql-read` declaration is recorded in `SOURCE.json`; current MCP capabilities are empty.

The inventory-dealer package retains the original rules and declares reads of ten registered tables through the public GEA governed SQL channel. Its original consumer ID is preserved and its MCP capability is governed-sql-read. Page visibility and resource enablement remain independent. The 201-row fixture is used only for offline verification. Suggestions and order checks remain local drafts; they do not submit replenishment orders. Actual production interface and data validation remain pending.

The full-chain resources in `business-resources/inventory-qll` declare seven company read-only tables and `governed-sql-read`. Workbench uses the current GEA grant and public SQL channel; Manage owns original source-row normalization, quantity/velocity rules and the same public calculator. Customer reads are not enabled. Source reception and local fixtures do not prove current identity, data or row permissions.

The same resource explains company inventory, order gaps and aging trends from current scoped GEA results. Workbench owns reads, paging and Session-bound transient facts; Manage owns original calculation. Missing periods remain null, and source/fixture reception does not prove live identity, row permissions or model acceptance.

The personal stock resource in `business-resources/inventory-personal` retains the monitoring, priority items and feedback field vocabulary. Its independent Consumer declares reads of nine registered tables through the public GEA governed SQL channel, with the `governed-sql-read` capability. Fixed inputs are used only for offline regression; actual production interface and data validation remain pending. The page remains hidden by default. Feedback fields restore in their Session; the page draft action appends unsent plain text through the Core public edit event, preserving resident text and reference chips without queuing a model Task.

## Public calculation exports

Inventory pure calculations are available through `dsh-agent-manage/inventory-compute/*`. Dealer policy, coverage and replenishment, full-chain metrics, and Personal inventory reports accept already-scoped inputs and return results without reads, Session access or business authorization. Workbench bundles this public source export when assembling its pages. See [the calculation contract](../design/inventory-compute.md).

APS uses the public `aps-compute/*` source and runtime exports. Its original prediction and problem-analysis Skills and references have one source under `business-resources/aps-analysis`. `BusinessResources` validates declared resource references at selection; these references do not grant GEA business permission.

DMS mock reception resources live only in `business-resources/inventory-dms`. `src/inventory-compute/dms-mock-packets.ts` owns the supplied-input quantity, three-decimal formatting and M/Z packet-key calculation. Workbench owns the page-local simulator and reuses its existing sales workflow projection. No DMS credential, SQL capability or write MCP is included.

Skill resource Sessions use the active official standard preset, retaining general tools and compaction. The existing resource list displays each Skill description; selecting a Skill does not grant a business Consumer.

