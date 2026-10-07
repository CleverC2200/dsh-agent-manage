# Agent note: Received mock business resources

Status: implemented

The customer, order report and fulfillment prototypes keep their existing page identifiers and local interactions. Manage owns the original personas, Skills and empty MCP capability declarations. Workbench assembles the pages and resource files; GEA mounts view-only page grants and rejects SQL for mocks. Selecting a resource uses the existing official Core Session flow without a model request.

This complements [business resource ownership](../architecture/2026-10-01-business-resource-ownership.md). It adds no second resource registry, credential store or Consumer grant. UI filters and pagination belong to the current page and Session; transient local report tasks retain their original reset policy.
