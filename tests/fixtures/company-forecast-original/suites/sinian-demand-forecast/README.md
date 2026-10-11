# Sinian demand forecast (0.1.4)

An installable dsh-agent-manage resource suite based on the user-supplied sales ontology V2. The source remains pending business review. Default delivery uses business language for the outcome, concerns and required confirmations; system fields, calculation steps and audit evidence are on request.

| Resource | Name | Purpose |
| --- | --- | --- |
| Agent | sinian-demand-forecaster | Coordinate scope, calculation and review; inherit the parent model |
| Skill | sinian-forecast-scope | Resolve entities, sellable scope and candidate evidence |
| Skill | sinian-demand-baseline | Calculate conventional baselines and handle unsupported branches |
| Skill | sinian-forecast-review | Review risk, coverage and offline evaluation definitions |
| Skill | sinian-demand-dialogue | Guide GEA dialogue, readable amounts and scope checks |
| Command | forecast-demand | Pass a complete task to the actual catalog role ID |

Refresh the company-agent-suites source, install and enable this suite. Supply a target month, customer/SKU scope, units, cutoff, data files and rule confirmations. Without evidence, the result is a gap report. The business instructions and original source are in Chinese; the role responds in the user's language.

The role does not automatically bind isolated skills or MCP servers. The host needs file access and Python execution for the calculator. Configure real tool allowlists for production use; prompt instructions are not authorization enforcement.

The original document is preserved in references/sales-ontology-v2.md with SHA-256 provenance. Its cited underlying documents have not been independently verified. The conflict register preserves unresolved month mapping, candidate weighting, seasonal adjustment and pricing rules.

The input contract is a proposed local calculation format, not a deployed API. The Python standard-library calculator implements only section 5.5 baselines. It has no candidate-ranking engine, seasonal fusion, price lookup, full backtesting engine or live MCP. New products, short-shelf products, missing growth plans and zero denominators are not replaced by fabricated values. Other analytical steps remain guided workflows until evidence and algorithms are supplied.

Run `python3 -m unittest discover -s tests -v` from the repository root. Synthetic examples yield conventional forecasts of 1500 and 1260 units; the new-product row is blocked and the seasonal row remains partial. Tests prove arithmetic and degradation behavior, not business acceptance. Live data, business decisions and real DSH invocation remain to be validated.

[简体中文](README.zh.md)
