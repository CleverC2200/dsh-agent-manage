# Fixed SDK and clean CI / 固定 SDK 与干净 CI

Manage's `quality:ci` prepares or verifies an independent fixed Core SDK, admits the frozen three-repository input, installs with the existing lock, then runs the original `check:refactor`, full `test` and `build`. `check:refactor` remains available for ordinary uncommitted development; clean admission applies to a frozen CI candidate. / quality:ci 准备或核独立固定 Core SDK、冻结三仓输入，按原锁安装，再跑原综合门禁、完整测试和构建。普通未提交开发仍用 check:refactor，干净输入要求只作用于冻结 CI 候选。

The SDK implementation is [prepare-official-sdk](../scripts/prepare-official-sdk.mjs). Workbench and GEA may call the same CLI with their own consumer checkout. It reads the consumer's official type map and verifies concrete exported JS and declarations. Peer paths are checked separately by frozen candidate admission. / SDK 模块可供 Workbench/GEA 用自己的 consumer checkout 调用，核官方类型映射与具体 JS/声明目标；peer 路径由冻结输入检查单独核验。

## Prepare and check / 准备与检查

Use an independent directory with this layout. Do not build into the shared read-only SDK symlink. / 使用独立目录，不往共享只读 SDK 链接构建。

```text
job-root/
  official-latest-standard/
  candidate-input.json
  candidate/
    dsh-agent-workbench/
    dsh-agent-manage/
    dsh-gea-plugin/
```

The Core source is fixed to commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc` and its original lock SHA-256 `2893d71a9ef07d2d72d47b2199e581b9e8d90638a15ee151908eebf69dfc637c`. Node 24 runs Core's declared pnpm@11.7.0 and Manage's pnpm@11.17.0. The source can be the official public Git URL or an existing read-only local Git checkout. Only Git source is cloned, never node_modules/lib. / 固定 Core 提交和原锁，两个仓各用自己的精确工具链；仅克隆 Git 源码，不复制依赖或产物。

From the admitted Manage checkout: / 在已登记的 Manage checkout 调用：

```sh
node scripts/run-quality-ci.mjs --phase quality --input /absolute/job-root/candidate-input.json \
  --prepare-sdk --core-source https://github.com/deepseek-ai/deepseek-harness.git
```

Preparation creates its own Core checkout and local ownership marker. An existing checkout without that marker, a symlink, dirty source, wrong Core/lock or missing output is rejected. Reuse the prepared independent directory by omitting `--prepare-sdk`. SDK-only verification can save per-target hashes: / 准备入口创建自己的 Core checkout 和本地归属标记。无标记、共享链接、脏源码、错 Core/锁或缺产物均拒绝。复用已准备的独立目录时省略 prepare-sdk；单独 SDK 核验可存目标哈希：

```sh
node scripts/prepare-official-sdk.mjs --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-agent-manage --receipt /absolute/job-root/sdk.json
```

The implementation runs the official host tsc/tsdown and client tsc/tsdown SDK stages, including Typert generation and package-local bundles. It omits the desktop bundle appended to the official host script, native-system build, installers, uploads and runtime startup. All outputs and dependencies belong to this job. / 沿官方 host/client 的 tsc/tsdown SDK 阶段生成 Typert 和包产物，省去 desktop bundle、native-system 构建、安装包、上传和启动；输出与依赖归本 job。

The frozen input JSON uses ticket 01's existing `core` and `repositories: [{repo, path, head}]` interface. Workbench and GEA refs are explicit in [write-ci-input](../scripts/write-ci-input.mjs) and the workflow, while Manage uses the actual PR head or push SHA. Full Git history and credential persistence disabled are required. All three checkouts must be clean; package locks must match their commits. / 输入沿票01公开格式，peer 固定来源明确，Manage 绑定实际事件 SHA，三仓必须干净且锁与提交相符。

## Platforms and rejection / 平台与拒绝

The [workflow](../.github/workflows/quality.yml) uses hosted Ubuntu for quality/audit and hosted Windows for `--phase archives`. Archives retain source-acquisition, zip-bomb and private-archive tests. The same local command supports both platforms; local macOS evidence does not prove either hosted platform. / workflow 使用 hosted Ubuntu 和 Windows，归档保留原三个测试；本机 macOS 证据不代替 hosted 平台回执。

Fork PRs are rejected before private peer checkout or SDK preparation. Private peer checkout requires a separately configured contents-read `PLUGIN_SPLIT_READ_TOKEN`, and the exact peer commits must be available remotely. No credential or remote write is created by this change. The final aggregate accepts only successful scope and all matrix gates. Failure, missing SDK/tool, cancellation and skipped jobs cannot produce a pass. / fork、缺 peer 只读凭据、提交不可达、缺 SDK/工具、取消或跳过都不能形成通过；本改动不创建凭据或远端写入。

## Security coverage / 安全检查范围

Current private-repository Dependency review is unavailable. `--phase audit` runs `pnpm audit --audit-level high --json` on prepared dependencies, including development dependencies, without ignores, fix or registry-error bypass. High/critical findings and registry/tool failures remain red and the raw result is retained. This checks known dependency vulnerabilities; it does not replace PR dependency diff, license policy or a complete audit of linked Core's own dependency tree. / audit 核已知漏洞，保留高严重度和工具失败，不自动升级/忽略；不称为 PR 依赖差异、许可证政策或整个 Core 闭包审计。

CodeQL service upload remains **not covered**, based on the original private-repository configuration failure. Its explicit workflow-dispatch diagnostic fails rather than claiming a successful analysis. Type/lint/architecture/tests are not equivalent security scanning. / CodeQL 上传仍未覆盖，显式诊断失败；类型、lint、架构和测试不是等价安全分析。

Sources: [pnpm audit](https://pnpm.io/cli/audit), [Dependency review availability](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), [Code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning). Actual remote trigger, Windows execution, security-service coverage and required-check enforcement require their own receipts. / 真实远端触发、Windows、服务覆盖和 required-check 阻合入分别留证。

Existing tgz delivery, prepare/prepack consumption, calculation rules, user storage and official persisted Sessions are unchanged. / 原 tgz、prepare/prepack 消费、计算口径、用户存储与持久 Session 保持。
