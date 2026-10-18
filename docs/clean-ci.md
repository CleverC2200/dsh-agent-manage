# Fixed SDK and clean CI / 固定 SDK 与干净 CI

`quality:ci` uses the existing Manage SDK preparation module, admits the frozen three-repository input, installs with the committed consumer lock, then runs independent static, planned ordinary/capability and build checks. Uncommitted local development continues to use `check:refactor`. / `quality:ci` 复用已有 SDK 准备模块，核冻结三仓输入，按消费者已提交锁安装，再分别运行静态检查、计划选中的普通与能力测试及构建。未提交的本地开发继续使用 `check:refactor`。

The quality workflow accepts pushes to `main` and the exact `codex/quality-ci-maintenance-20261010` branch, and keeps PR `opened`, `synchronize` and `reopened` events. When a PR has merge conflicts, the maintenance candidate uses the same complete push quality gates. A workflow trigger or local configuration contract pass does not prove actual hosted quality success. / 质量工作流接受 `main` 和精确 `codex/quality-ci-maintenance-20261010` 分支的 push，保留 PR 的 `opened`、`synchronize` 和 `reopened` 事件。PR 存在合并冲突时，维护候选使用同一套完整 push 质量门禁。工作流触发或本地配置合同通过不表示实际 hosted 质量通过。

## Registered source / 登记来源

The adjacent GEA [supported Core registry](../../dsh-gea-plugin/scripts/supported-cores.json) owns the registered sources, including the two original official CI heads and the explicit private security candidate, versions, original lock hashes and exact toolchains. Manage does not maintain another Core version table. CI reads the two original official quality and Windows archives axes from that registry; private security preparation requires its explicit registered head. / 相邻 GEA 登记表持有登记来源，包括两版原官方 CI Core 和显式私有安全候选的提交、版本、原锁哈希和精确工具链。Manage 不另建版本表，CI 从同一表生成两版原官方质量和 Windows 归档矩阵；私有安全来源须显式指定登记 head。

Use this independent layout for cold preparation. / 冷准备使用独立目录：

```text
job-root/
  source/official-core/ # observed full-history source
  official-latest-standard/ # independently owned SDK output
  candidate-input.json
  candidate/
    dsh-agent-workbench/
    dsh-agent-manage/
    dsh-gea-plugin/
```

```sh
node scripts/run-quality-ci.mjs --phase quality --input /absolute/job-root/candidate-input.json \
  --prepare-sdk --core-source /absolute/job-root/source/official-core \
  --final-group-sha256 <candidate-input-original-byte-sha256>
```

`scripts/write-ci-input.mjs --matrix` emits only the registered original Core axes. The shared Workbench `scripts/write-hosted-group.mjs` writes candidate inputs and source-kind receipts after peer resolution. / 本仓 matrix 命令只输出登记的原 Core 轴；peer 解析后由 Workbench 公共 writer 写入候选输入与来源回执。

`candidate-input.json` binds `core` to an explicit registered head and `repositories` to the three real `{repo,path,head}` inputs. Manage's own head is the actual PR or push SHA; ordinary push/PR peer refs come from the committed three-repository `scripts/quality-peer-baseline.json`, with only the own role replaced by the actual event. The shared Workbench reader admits the complete tuple. Dispatch requires all three explicit immutable heads and is the only joint-group result. Full histories, clean sources and committed locks are required. / 输入的 `core` 显式绑定登记 head，`repositories` 绑定真实三仓路径和提交。本仓绑定实际 PR 或 push SHA，普通 push/PR 从已提交的三仓 baseline 读取 peer，仅本仓替换为实际事件提交，由 Workbench 公共 reader 核完整组合。dispatch 必须显式提供三个不可变提交，只有该路径声明联合组合结果。要求完整历史、干净源码和已提交锁。

The public [SDK module](../scripts/prepare-official-sdk.mjs) retains `prepareOfficialSDK(options)` and `verifyOfficialSDK(options)`. `options` includes `core`, `consumer`, and selected `coreHead`; `source` is needed for a new owned clone. `verifyOfficialSource(core, {coreHead})` verifies source without requiring outputs. An omitted `coreHead` reads the current private security adaptation from the adjacent GEA `scripts/current-core.json`, then selects its exact head, lock and toolchain from the single supported registry. CI binds the two original official axes explicitly from its input. / SDK 模块保留原公开准备与核验函数，选项增加 `coreHead`。只读 source 核验不要求产物。未传 head 时从相邻 GEA 的 current-core.json 读取现行私有安全 adaptation，再由同一登记表核其精确提交、锁与工具链。CI 从输入显式绑定两版原官方轴。

```sh
node scripts/prepare-official-sdk.mjs --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-agent-manage --core-head <registered-head> \
  --receipt /absolute/job-root/sdk-verified.json
```

SDK preparation clones only Git source, marks its independent ownership and rejects an existing unowned or symlinked destination. Checkout preserves committed line endings, including Windows and owned Core clones. Wrong head, changed original lock, dirty source, wrong toolchain or missing output fails. Quality consumers install only after SDK preparation, with `--frozen-lockfile --ignore-scripts --prefer-offline`; prepare/prepack package behavior is unchanged. Read-only verification may use an existing registered SDK. / SDK 准备只克隆 Git 源码并登记独立归属，拒绝已有无归属目录和链接写入。Windows 和自有 Core 克隆保留已提交的换行字节。错误 head、原锁变化、脏源码、工具链错误或缺产物均失败。质量消费者在 SDK 就绪后冻结安装并关闭隐式脚本，既有 prepare/prepack 行为保持。只读核验可使用已登记 SDK。

Workbench and GEA consume the same SDK module with their own consumer paths. Optional `withWeb` / `withFlock`, and the existing `prepareOfficialWeb` / `prepareOfficialFlock` interfaces retain their original source and artifact receipts. Windows archives do not request Web or flock. / Workbench 和 GEA 用自己的 consumer 路径复用同一模块。已有 Web/flock 可选准备接口及源码、产物回执保持。Windows 归档不请求 Web 或 flock。

Manage's quality phase requires the real host flock addon for the official Session writer-lock tests. It passes `withFlock: true` to the existing SDK prepare/verify interface; archives and audit do not request flock. The original forecast Session baseline installs an independent temporary copy of the independently frozen original `tests/fixtures/company-forecast-original` suite and verifies all file hashes against its provenance receipt. Its Skill path assertion still distinguishes the installed original source from the bundled provider, without an external company-agent-suites checkout. / Manage 质量阶段的官方 Session writer-lock 测试要求真实宿主 flock addon，通过已有 SDK 准备和核验接口传入 `withFlock: true`；归档与审计不要求 flock。原预测 Session 基线在独立临时目录安装独立冻结的原公司套件 `tests/fixtures/company-forecast-original`，并按 provenance 回执核验全部文件哈希。Skill 路径断言仍区分已安装原始源与包内 provider，不依赖外部 company-agent-suites checkout。

The selected Core's Git-tracked package names determine which full SDK mappings apply. Absent package aliases are listed with their original paths and reasons in `notApplicable`; actual registered packages must retain matching paths, all declared outputs and hashes. The quality typecheck still rejects any real consumer import of an unavailable package. / 所选 Core 的 Git 已跟踪 package.name 决定全量 SDK 映射的适用范围。缺包 alias 及原路径、原因写入 `notApplicable`；真实登记包仍要求匹配路径、完整声明产物和哈希。质量阶段的类型检查继续拒绝消费者对缺包的真实引用。

## Gates and receipts / 门禁与回执

`check:refactor` includes `check:knowledge`, the actual historical missing-reference negative test, SDK/quality CLI rejection tests and the existing type, lint, format, contract, architecture and capability checks. Quality installs each peer with its own committed lock and disabled scripts: Workbench uses its exact npm toolchain, GEA its declared pnpm. Workbench's public declarations are tracked inputs and are read without rebuilding its library. Peer installation does not prove complete peer quality. The same `quality:ci` command runs locally and on hosted runners. / 综合门禁包含知识检查、真实历史缺引用反例、SDK/quality CLI 拒错测试，以及既有类型、lint、格式、合同、架构和能力检查。质量阶段按各 peer 原锁和工具链关闭脚本安装，读取 Workbench 已 tracked 的公开声明，不重建其 lib。peer 安装不表示完整 peer 质量通过。本地与 hosted runner 使用同一 quality 命令。

After admission and SDK/dependency preparation succeed, quality independently collects static, planned ordinary/capability and build checks in `quality-checks.json`. One failure does not prevent later independent checks; any failed, cancelled or missing execution keeps the command nonzero. Admission or preparation failure stops immediately. / 输入、SDK 与依赖准备通过后，质量阶段独立收集静态检查、普通测试、能力测试和构建结果到 `quality-checks.json`。一项失败仍继续后续独立检查；失败、取消或缺执行均保持总体非零。输入或准备失败立即停止。

The required static command runs the package-version Node regressions through `test:ci-inputs`, including generated-stamp consistency, immutable compiled Host/client identity and public exports. The runner explicitly declares `test:knowledge` and `test:ci-inputs` as always-run scripts to the shared selector; their Node tests execute through the static command. Tests derive the current version from the package manifest; an ordinary version bump does not require a separate release-number assertion. / 必需静态命令通过 `test:ci-inputs` 执行包版本 Node 行为回归，覆盖生成标记一致性、Host/client 编译身份不可变性及公开导出。runner 向共享选择器明确声明 `test:knowledge` 和 `test:ci-inputs` 是每次必跑的脚本，其 Node 测试通过静态命令执行。当前版本来自包清单，正常升版无需另行维护发行号断言。

After collecting consumer checks, hosted quality rechecks the frozen group and the full SDK artifact receipt before emitting `sdk-cache-ready`. A downstream test failure remains blocking but does not discard an independently verified SDK. Cache save retains its one-minute timeout and non-blocking failure policy. The SDK verifier's optional `withArtifactReceipt` requires the builder/Core/lock/Node/platform identity and complete produced-byte inventory; ordinary callers retain their existing interface defaults. / hosted quality 收集消费者检查后，重新核验冻结组合和完整 SDK 产物回执，再输出 `sdk-cache-ready`。下游测试失败仍阻断质量，但不丢弃独立验证通过的 SDK。缓存保存继续使用一分钟超时和失败不阻断策略。SDK verifier 的可选 `withArtifactReceipt` 要求 builder、Core、锁、Node、平台身份及完整产物字节清单；普通调用方保留原默认接口行为。

Only a `main` push with a freshly verified SDK may produce package-download caches. PRs and manual compatibility runs restore them. Restore and save use the same fixed Corepack, pnpm content/index and npm `_cacache` path output, including currently absent paths, to retain the same cache version before and after installation. The optional producer skips the entire save if the fixed set exceeds 512 MiB or 50,000 inspected entries, or contains links; pnpm project links and npm execution trees are excluded from that set. Inspection and upload each have a one-minute timeout; neither changes installation locks nor removes cache files. Both required quality and compatibility retain `quality-capabilities/` with their input and plan. / 仅 `main` push 在 SDK 重新核验后生产包下载缓存，PR 与手动兼容检查只恢复。恢复与保存共用一份固定的 Corepack、pnpm 内容及索引、npm `_cacache` 路径输出，保留当前不存在的路径，确保安装前后的缓存版本一致。固定集合超过 512 MiB、总检查项数超过 50,000 或含链接时，跳过整次可选保存；pnpm 项目链接及 npm 执行目录不进入该集合。检查与上传分别限时一分钟，不修改安装锁或删除缓存文件。必需 quality 与 compatibility 均随输入和计划保留 `quality-capabilities/`。

The standalone `check:capabilities` keeps the complete capability acceptance. Ordinary quality passes the same `quality-test-plan.json` to `check-preset-capabilities.mjs --plan`; it partitions the selected files into the existing standard-skill, client and GEA configurations. The ordinary batch uses `vitest.ci-unit.config.ts`, so each selected file runs in its owning batch once. The workflow retains capability reports beside the plan in `quality-capabilities/`; a plan without capability files records `not-applicable` with its selection evidence. `scripts/preset-test-lanes.mjs` remains the owner of capability files, exact case counts and Host helper ownership. Missing reports, missing/extra files or cases, failed/skipped/unknown cases and child failures reject the result. Host helper edits and their transitive implementation changes select the client owner through the shared plan. Both quality and capability entrypoints reject unowned helpers left in the direct file set; helpers execute only in their client's real subprocess. / 独立 `check:capabilities` 保留完整能力验收。普通 quality 将同一份 `quality-test-plan.json` 交给能力入口，按选中文件使用既有 standard-skill、client 与 GEA 配置。普通批次使用 ci-unit 配置，每个选中文件只在所属批次执行一次。workflow 将能力报告随计划保存在 quality-capabilities/；没有选中能力文件时，回执绑定计划并明确记录不适用。能力文件、精确用例数与 Host helper 归属集中在 preset-test-lanes.mjs；缺报告、缺失或额外的文件及用例，以及失败、跳过、未知状态和子进程失败均拒绝。Host helper 本身及其传递实现变化均由共享计划选中所属 client；quality 与能力入口都拒绝仍留在直接文件集合的 helper，helper 只在该 client 的真实子进程中执行。

Windows `--phase archives` preserves the original source-acquisition, zip-bomb and private-archive tests. The shared `readFinalGroup` and `verifyOfficialSource` still admit fixed SHA, original lock, clean source and exact toolchain. When preparation is requested, only an owned Core source checkout is prepared for the original package-link layout; Core is not installed or compiled. Vitest reads source package manifests, and Manage installs from its own frozen lock. SDK artifact checks and SDK cache path/restore/save work apply to quality, whose public SDK contract stays unchanged. Loader settings schemas are separate from the backend probe, so a Catalog without a runtime Host does not load Core modules. macOS results do not prove hosted Windows or Linux execution. / Windows 保留原三个归档测试。共享 readFinalGroup 与 verifyOfficialSource 仍核固定 SHA、原锁、干净源码和精确工具链。请求准备时，仅准备原相对包链接所需的独立 Core 源码，不安装或编译 Core；Vitest 读取源码包清单，Manage 仍按本仓冻结锁安装。归档不核 SDK 产物，也不生成或恢复、保存 SDK 缓存；普通 quality 保留原完整 SDK 合同。Loader 设置 schema 与后端 probe 分开，无 runtime Host 的 Catalog 不载入 Core 模块。本机结果不证明 hosted Windows/Linux 已执行。

Fork PRs are rejected before private checkout. Private peers require a separately configured contents-read `PLUGIN_SPLIT_READ_TOKEN`; personal high-permission tokens are not appropriate. Missing credentials or inaccessible fixed peers block execution. Checkout does not persist credentials. / fork PR 在私有检出前拒绝。私有 peer 要求独立配置的 contents-read 凭据；个人高权限 token 不适用于此用途。缺凭据或固定提交不可达阻断执行，checkout 不保存凭据。

The final `candidate-quality` accepts only successful scope and every registered quality/archives matrix entry. Failure, missing results, cancellation and skipped execution fail the aggregate. Every candidate quality, archives, audit and verify-input invocation must pass `--final-group-sha256 <original-byte-hash>` and a local observed registered Core source; the shared Workbench reader rechecks the original bytes before effects. / 最终质量聚合仅接受 scope 和每一项登记 quality/archives 矩阵成功。失败、缺结果、取消和跳过不能通过。每次候选 quality、archives、audit 和 verify-input 都须显式传原字节哈希与本地登记 Core 源，Workbench 共享 reader 在产生效果前复核。

## Security coverage / 安全覆盖

`security-audit` is separate from `candidate-quality`. Its `--phase audit` verifies selected fixed Core source, original lock and toolchain, installs the consumer with the frozen lock and disabled scripts, then runs `pnpm audit --audit-level high --json`. Audit does not need unrelated SDK outputs. High/critical vulnerabilities, tool errors and registry errors remain nonzero; raw logs are uploaded even after failure. / 安全审计和质量聚合分别记录。审计核固定 Core 源码、原锁和工具链，冻结安装消费者后运行原漏洞审计，不要求无关 SDK 产物。高严重度漏洞、工具及 registry 错误保留非零退出，失败原日志仍上传。

The original PR `dependency-review` job separately checks dependency changes and remains independently failing when private-repository features are unavailable. Its coverage is distinct from the consumer audit and quality aggregate. / 原 PR 依赖差异审查 job 单独保留；私有仓库能力不可用时保持独立失败，其覆盖与消费者漏洞审计及质量聚合分别记录。

This covers known vulnerabilities in the consumer lock, including development dependencies. It does not establish dependency-diff, license-policy or linked Core's full dependency-closure coverage. The current private repository's CodeQL upload is blocked by disabled code scanning; the original CodeQL workflow and failure stay visible. A green quality result does not mean security coverage or full CI is green. / 此审计覆盖消费者锁内已知漏洞及开发依赖，依赖差异、许可证及 linked Core 完整安全闭包仍未证明。历史私有仓 CodeQL 阻断证据保留；当前公开仓扫描须以本次精确提交结果核验。质量通过不表示安全覆盖或完整 CI 通过。

Source tests, remote CI, Windows, Native, real business/model behavior and repository protection need their own evidence. No SDK preparation or quality command grants production release or business write permission. / 源码测试、远端 CI、Windows、Native、真实业务/模型和仓库保护分别留证。SDK 准备与质量命令不授予正式发行或业务写入权限。

Ordinary source-event receipts retain `sourceKind` and the committed baseline byte hash; they do not combine independent push/PR runs into a joint pass. Missing, changed or incomplete baseline data is rejected before peer checkout. The same CLI admission applies locally and on GitHub. / 普通 source-event 回执保留来源分类与已提交 baseline 字节哈希，不能将独立 push/PR 结果拼成联合通过。缺失、变化或不完整 baseline 在 peer 检出前拒绝。本地与 GitHub 使用同一 CLI 入场。

The registered personal repository denies upstream release-please, npm and Pages jobs at job scope. Their upstream definitions remain available for the upstream repository. Quality artifact uploads remain enabled. / 登记个人仓在 job 层拒绝上游 release-please、npm 和 Pages 发布，上游定义保留，质量证据上传继续执行。

GitHub 不再执行无条件全量普通测试。当前必需检查、受影响选择、缓存与失败汇总统一见[当前 CI 规则](../../dsh-agent-workbench/docs/ci-required-and-affected.md)，本页的 SDK、Windows 与安全检查约束继续适用。

Workbench's registered `static/regional/` and `static/category/` resources select Manage's `business-resources` contract; `static/mps/` selects its MPS resource-reception contract. An edit to Manage's own test-selection policy additionally selects both real consumer contracts, while other configuration changes retain their existing selection. Unregistered static resource directories still reject the plan. Selection does not prove page rendering or installed resource reception. / Workbench 已登记的 regional/category 静态资源映到 Manage 的业务资源合同，mps 映到 MPS 资源接收合同；仅 Manage 自身测试策略编辑额外选中这两个真实消费者合同，其他配置变动保持原选择。未登记静态资源目录仍拒绝计划；测试选择不证明页面渲染或已安装资源接收。

## Frozen business repair exception

The user authorized merging the 2026-10-14 business repair group without full tests. The `business-profile` lane is limited to the reviewed product commits declared in `scripts/business-profile-ci.mjs`, plus the listed CI and evidence files. It validates all three actual source checkouts against those commits. A different product source rejects this lane; other PR branches keep the normal gates. Same-tree main and explicit main dispatch can use the targeted lane. The existing final aggregate still rejects failed, cancelled, skipped or missing jobs, and branch protection is unchanged.

Targeted checks retain static gates and builds. Workbench runs the new-conversation/inventory/company/version cases and the sidebar browser file. Manage runs business resources, raw MCP scope, bundled tools and the real Core business-admission file; existing Windows archive and security lanes remain. GEA runs reasoning, history, identity/budgets, Cube-New, HTTP errors and plugin-update regressions. This is source acceptance, not real model, business, Native or release acceptance. The separate CI optimization and new query direct-return work are excluded.

CI 的冻结来源与历史阶段例外由同组 Workbench 的 `scripts/ci-source-policy.mjs` 维护。此仓 adapter 必须收到实际 Workbench 绝对路径；workflow 先取得固定源码，再选择原有 lane。冻结 baseline、own event 与完整 tuple 校验保持原合同。
