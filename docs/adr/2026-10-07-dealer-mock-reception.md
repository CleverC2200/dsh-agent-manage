# Dealer mock reception

The next inventory batch preserves the dealer rules from Workbench 67674ec and resource content from Manage aa5dc746. The current installed declaration uses the same consumer identity, an explicit mock flag, empty data tables and empty MCP capabilities. The page loads its registered local fixture through the original complete-paging interface. It never requests Host SQL or creates a model task.

Page visibility, resource selection and resource enablement use their existing owners independently. View recovery stores authored filters and local unsubmitted drafts under the current Core Session; query facts are read again. Moving to real data requires the original ticket 16 authorization and acceptance conditions.
