# Agent Note: Read linked MCP resources

Status: implemented

## Decision

Expose an explicit same-server resource reader when the MCP handshake advertises resources. Project text resources into recorded model-visible results. The reader shares connection disposal, timeout and caller cancellation; it does not treat a URI as an HTTP endpoint.

## Rationale

Link-only tool results previously left the model without a way to obtain their content. Explicit reads avoid unbounded automatic traversal, unexpected downloads and hidden model context. Binary content stays explicit rather than being decoded as text. Existing image-admission decisions remain unchanged. No active note owns resource reading; this extends content projection without superseding existing transport or image notes.

## Validation

Bridge regressions cover resource capability discovery, exact URI forwarding, text projection and disposer cleanup.
