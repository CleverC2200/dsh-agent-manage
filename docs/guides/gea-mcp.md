# GEA Cube-New MCP

GEA Host owns login, credentials and business authorization. Manage registers the server input schemas for `inspect_cube_model` and `query_business_data` under `mcp__gea-gateway__inspect_cube_model` and `mcp__gea-gateway__query_business_data`. Set `geaMcp: false` to disable integration. Manage configuration and model arguments do not choose a Consumer.

GEA derives the Consumer from the calling Core Session's installed, enabled business preset. Sales and inventory modes retain their own identities. Unprofiled or agentless calls cannot borrow the default Consumer. Old calls cannot publish into a changed preset, environment or login.

Inspect the actual model or View, use its current `aliasMember`, and submit the original server query schema. Each call targets one underlying model with `action=query` and `response_mode=inline_complete`. Host reads the returned artifact in the original business and transport sessions and verifies its raw digest, dataset names, rows and pagination. It does not fall back to old Cube, SQL or storage URLs. Only two methods are model-facing.

Tool discovery, model visibility and business query success are separate acceptance results. Preserve `DATA_QUERY_MEMBER_NOT_PUBLISHED` and stop the current query turn; it requires server publication checks, not parameter retries.

Logout and identity changes cancel old calls before retiring their tools. New login generations rediscover. Failed discovery does not recreate business sessions automatically. The old `gea_gateway_catalog`, `gea_cube_query` and `gea_module_mcp` wrappers are retired. Durable Sessions, drafts and historical evidence remain.

GEA projects its current identity through `geaMcp.identitySignal()`. Manage keeps current schemas while preparing a resource refresh under the same identity. Core's serial creation event and public prompt assembly interface wait for publication, including the first business request. A changed identity cancels old calls and retires its schemas before discovery; a refresh does not recreate the business Session.
