# Agent Note: GEA knowledge tools on the governed MCP bridge

Status: implemented

## Problem

The existing GEA bridge publishes only Cube methods. Users need authorized knowledge discovery and question answering without a second identity or an obsolete knowledge fallback.

## Decision

Manage publishes the server schemas for weknora_list_knowledge_bases and weknora_ask through the existing GEA MCP service, alongside Cube methods. GEA selects the Consumer from the calling Core Session and owns credentials, source qualification, answer validation and cancellation. Manage retains its existing login publication, preset scope and ordered release behavior.

The [Chinese execution contract](../../../../../dsh-gea-plugin/docs/knowledge-mcp.md) owns knowledge arguments, results and failure behavior. This note extends the bridge tool contract; it does not supersede the selected-resource identity or MCP resource-reader decisions.

## Alternatives considered

**A separate knowledge MCP connection.** It would duplicate login publication and credential lifetime. The existing bridge provides the required registration and calling Session interface.

**A wrapper with a fixed knowledge library.** It would preserve a stale directory and hide per-user and per-Consumer grants. The two server tools retain dynamic discovery and their original schemas.

## Consequences

Knowledge and Cube share registration, while GEA keeps their result contracts separate. Knowledge tools do not require a configured Cube MCP endpoint. Personal Agents still require an enabled trusted source association to resolve their Consumer. Existing business Session selection, stale-call rejection and login disposal remain necessary. Source and fixture verification do not establish real grants, content migration, installation or business acceptance.
