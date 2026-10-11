# Domain glossary

## Catalog source

A configured Git repository or local directory from which suites are read. A source identifies where content comes from; it does not describe the manifest format used by that content.

## Plugin layout dialect

An on-disk manifest and directory convention used by a source, such as agent-plugins v1, Claude Code, Codex, Cursor, Kimi, universal, or a manifest-less skill collection.

## Suite

A normalized installable plugin unit discovered from a catalog source. A suite has an identity, metadata, supported runtime surfaces, and an installation state.

## Runtime surface

A capability a suite can provide to the harness, such as skills, MCP servers, hooks, commands, agents, or LSP definitions. A runtime surface is distinct from the layout dialect that describes it.

## Install state

The user-owned record that says whether a suite is installed and enabled, together with its installation metadata. Discovery content and install state are separate facts.

## User and project dimensions

The user dimension applies across sessions. The project dimension applies to a workspace project. The two dimensions can use the same layout dialects but have different ownership and precedence rules.

## Business resource

An original business Prompt, Skill and capability declaration owned by Manage. Native selection publishes it through Core's public preset/Skill interfaces; the original source body remains with its owner. A business resource is separate from a Workbench page and from GEA authorization.

## Selected resource identity

The persisted identity of a selected business resource, used to recover its native declaration. It is not resource prose, a Session draft, a credential or an authorization receipt.

## Page interpreter

An explicitly declared Agent identity allowed to interpret a business page. Manage validates resource ownership and enablement; Workbench associates the page with an official Core Session. Interpretation and analysis initiation do not grant business submission or writes.

## Consumer

The Consumer identifier whose grants GEA Host checks for governed access, distinct from the current business user subject, tenant/environment and local Agent preset. A local preset, enabled Agent or visible page does not grant Consumer permissions. Login and credentials belong to GEA Host.
