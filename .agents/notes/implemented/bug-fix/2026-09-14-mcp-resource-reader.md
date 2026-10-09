# Agent Note: Read linked MCP resources

Status: implemented

## Problem

Link-only tool results left the model without an explicit same-connection way to read their content.

## Decision

Expose an explicit same-server resource reader when the MCP handshake advertises resources. Project text resources into recorded model-visible results. The reader shares connection disposal, timeout and caller cancellation; it does not treat a URI as an HTTP endpoint.

## Alternatives considered

**Automatic traversal or treating resource URIs as HTTP endpoints.** Explicit same-server reads avoid unbounded traversal, unexpected downloads and hidden model context. Binary content stays explicit rather than being decoded as text. Existing image-admission decisions remain unchanged. No active note owns resource reading; this extends content projection without superseding existing transport or image notes.

## Consequences

Text content remains an explicit tool result. Binary content remains non-text; cancellation, timeout and disposer ownership stay with the original connection.

## Testing

Bridge regressions cover resource capability discovery, exact URI forwarding, text projection and disposer cleanup.
