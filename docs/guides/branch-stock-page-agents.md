# Branch stock page Agent choices

The assembled `business-resources/inventory-fc/prompt.json` owns the `pageAgents` list. It contains preset IDs, not Consumer grants:

```json
"pageAgents": ["gea-html-inventory-fc", "gea-html-inventory-qll"]
```

The loader requires a nonempty, unique list of at most four inventory presets that includes `gea-html-inventory-fc`. The workbench keeps one Session per choice and refuses a saved or explicit Session whose actual preset is outside this list.

After Manage validates a selected prompt's `pageAgents`, `GET /api/agent-manage/resources?cwd=...` and `POST /api/agent-manage/resources/select` return an optional `interpreters` array. Manage filters the declared choices against current registered and enabled resource owners and excludes owners with recorded load errors. Before the profile has been selected and validated, its summary omits this field. Withdrawal removes the owner's choice from subsequent summaries and selection results. The Workbench chooser and GEA authorization remain separate consumers of these identities. The public selection response includes the allowed choices and keeps the resource profile private.

GEA offers a choice only when the preset is installed, matches its Agent profile and the current login can open that preset's Gateway Consumer. Opening the branch page also checks its `branch-inventory` Consumer. Page SQL remains under that page Consumer; choosing the full-chain Agent does not add `branch-inventory` to its data tools. A login, tenant or environment change invalidates old page references and cannot reopen the old Session under the new identity.

These rules are checked in local DSH Web and Gateway fixtures. Actual GEA grants and business data require separate target-environment acceptance.
