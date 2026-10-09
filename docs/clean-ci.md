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

### Optional static Web product / 可选 Web 静态产物

The default SDK-only preparation and verification remain unchanged. A source Web launch also needs the real `apps/web/dist/index.html` and its assets. Cold jobs opt in to the same preparation module with `--prepare --with-web`; it completes the SDK stages, then runs the fixed Core's original `corepack pnpm run build:web` (`pnpm --filter @deepseek-ai/dsh-web-frontend run build`). / 默认 SDK-only 行为保持。源码 Web 启动另需真实 index 与资产；冷 job 用同一模块的 prepare + with-web，先准备 SDK，再执行固定 Core 原 build:web。

```sh
node scripts/prepare-official-sdk.mjs --prepare --with-web \
  --source https://github.com/deepseek-ai/deepseek-harness.git \
  --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-gea-plugin --receipt /absolute/job-root/sdk-web.json
```

For an already-prepared owned Core, `--prepare-web` runs only that static build: no installation, tsc or tsdown repetition. The writing checks still require the independent ownership marker, physical checkout, fixed commit/lock and Node/pnpm toolchain. / 已准备且归本 job 的 Core 用 prepare-web，只执行静态构建，不重复安装或 SDK 编译；仍核归属标记、物理路径、固定提交/锁及工具链。

```sh
node scripts/prepare-official-sdk.mjs --prepare-web \
  --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-gea-plugin --receipt /absolute/job-root/sdk-web.json
node scripts/prepare-official-sdk.mjs --with-web \
  --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-gea-plugin --receipt /absolute/job-root/sdk-web-verified.json
```

The exported interface is `prepareOfficialSDK({ core, consumer, source, withWeb: true })` for cold preparation, `prepareOfficialWeb({ core, consumer })` for the Web-only stage, and `verifyOfficialSDK({ core, consumer, withWeb: true })` for read-only verification. The result retains the SDK artifacts and adds `web` with the build command, source hashes and produced-file hashes. An owned clone's local Git metadata stores that inventory; missing index, linked entry assets, inventory files or changed bytes are rejected. Static preparation checks that the consumer's SDK artifact hashes stayed unchanged. It does not start a server, desktop or Native process, contact GEA, install or upload a package. / 回执保留 SDK 摘要并追加 web 来源和逐产物摘要；清单存独立克隆的本地 Git 元数据。缺入口、入口引用资产、清单产物或字节变化均拒绝，静态构建前后 SDK 摘要须相同。不启动服务或客户端、不联系 GEA、不安装或上传包。

The inventory verifies the produced static files, not browser execution or an arbitrary JavaScript dependency graph. Remote Ubuntu/Windows execution still needs separate receipts. / 清单核实际静态文件，不称浏览器执行或任意 JS 依赖图证明；远端 Ubuntu/Windows 仍需另有回执。

### Optional flock test dependency / 可选 flock 测试依赖

Real Core Session writer-lock tests require the declared host flock addon. Cold Ubuntu jobs may add `--with-flock` to `--prepare` (alongside `--with-web` if needed). An already-owned prepared Core uses `--prepare-flock`; this runs only the original `corepack pnpm run build:native-system`, whose fixed script is `tsx native/system/scripts/build.ts --host-addon-only`. It does not repeat SDK/Web builds or installation. / 真实 Core Session writer 锁测试需本机声明的 flock addon。冷 Ubuntu job 可显式 with-flock；已有独立 prepared Core 用 prepare-flock，只执行原 host-addon-only 脚本，不重复 SDK/Web/安装。

```sh
node scripts/prepare-official-sdk.mjs --prepare-flock --with-web \
  --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-agent-workbench --receipt /absolute/job-root/sdk-flock.json
node scripts/prepare-official-sdk.mjs --with-web --with-flock \
  --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-agent-workbench --receipt /absolute/job-root/sdk-flock-verified.json
```

The public functions are `prepareOfficialSDK({ core, consumer, source, withFlock: true, withWeb: true })`, `prepareOfficialFlock(options)` and `verifyOfficialSDK({ core, consumer, withFlock: true })`. SDK-only remains the default. The opt-in receipt adds `flock`: the matching platform/libc, Node-API 8 declaration and output path from Core's `prebuilds.json`, original C/build/metadata hashes, compiler and Node header provenance, output hash and successful addon loading with a callable `tryLock`. SDK targets and any prepared Web inventory must stay unchanged. / 公开函数集中维护同一规则，默认仍仅 SDK。flock 回执核 Core 原 prebuilds 声明、平台/libc、Node-API8、源/工具/头文件来源、产物hash及真实可加载 tryLock；原SDK和已准备Web摘要须保持。

Preparation requires the owned physical checkout, fixed source/lock/toolchain, existing `cc` (`musl-gcc` for Linux musl) and the development headers beside the running Node installation. Missing headers/compiler/addon or unsupported platform is a failure; the Core script's unsupported-host exit0 is not accepted as preparation. Read-only verification checks the produced artifact and loadability without requiring a compiler on the consumer. Windows archives do not request this stage. / 准备要求归属、物理路径、固定输入及已有编译器/Node开发头文件；缺输入或不支持平台明确拒绝，不能以原脚本exit0充准备成功。只读消费者核产物与可加载性，不要求其再配编译器；Windows归档不请求此stage。

This is a private POSIX Node-API dependency for offline kernel-lock tests, not a Native client, Landlock executable, complete native build, installer, server or release. It installs no global tool and does not replace the real held-writer test with a mock. Linux/Windows execution and Native acceptance still require separate evidence. / 这是离线真实内核锁测试的私有 Node-API 依赖，不是客户端、Landlock、全native、安装器、服务或发行；不安装全局工具、不mock真实writer锁。Linux/Windows实际执行和Native验收仍分别留证。

The frozen input JSON uses ticket 01's existing `core` and `repositories: [{repo, path, head}]` interface. Workbench and GEA refs are explicit in [write-ci-input](../scripts/write-ci-input.mjs) and the workflow, while Manage uses the actual PR head or push SHA. Full Git history and credential persistence disabled are required. All three checkouts must be clean; package locks must match their commits. / 输入沿票01公开格式，peer 固定来源明确，Manage 绑定实际事件 SHA，三仓必须干净且锁与提交相符。

## Platforms and rejection / 平台与拒绝

The [workflow](../.github/workflows/quality.yml) uses hosted Ubuntu for quality/audit and hosted Windows for `--phase archives`. Archives retain source-acquisition, zip-bomb and private-archive tests. The same local command supports both platforms; local macOS evidence does not prove either hosted platform. / workflow 使用 hosted Ubuntu 和 Windows，归档保留原三个测试；本机 macOS 证据不代替 hosted 平台回执。

Fork PRs are rejected before private peer checkout or SDK preparation. Private peer checkout requires a separately configured contents-read `PLUGIN_SPLIT_READ_TOKEN`, and the exact peer commits must be available remotely. No credential or remote write is created by this change. The final aggregate accepts only successful scope and all matrix gates. Failure, missing SDK/tool, cancellation and skipped jobs cannot produce a pass. / fork、缺 peer 只读凭据、提交不可达、缺 SDK/工具、取消或跳过都不能形成通过；本改动不创建凭据或远端写入。

## Security coverage / 安全检查范围

Current private-repository Dependency review is unavailable. `--phase audit` runs `pnpm audit --audit-level high --json` on prepared dependencies, including development dependencies, without ignores, fix or registry-error bypass. High/critical findings and registry/tool failures remain red and the raw result is retained. This checks known dependency vulnerabilities; it does not replace PR dependency diff, license policy or a complete audit of linked Core's own dependency tree. / audit 核已知漏洞，保留高严重度和工具失败，不自动升级/忽略；不称为 PR 依赖差异、许可证政策或整个 Core 闭包审计。

CodeQL service upload remains **not covered**, based on the original private-repository configuration failure. Its explicit workflow-dispatch diagnostic fails rather than claiming a successful analysis. Type/lint/architecture/tests are not equivalent security scanning. / CodeQL 上传仍未覆盖，显式诊断失败；类型、lint、架构和测试不是等价安全分析。

Sources: [pnpm audit](https://pnpm.io/cli/audit), [Dependency review availability](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), [Code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning). Actual remote trigger, Windows execution, security-service coverage and required-check enforcement require their own receipts. / 真实远端触发、Windows、服务覆盖和 required-check 阻合入分别留证。

Existing tgz delivery, prepare/prepack consumption, calculation rules, user storage and official persisted Sessions are unchanged. / 原 tgz、prepare/prepack 消费、计算口径、用户存储与持久 Session 保持。

## Portable fixed test inputs / 可移植固定测试输入

The official Session forecast regression uses the original company forecast suite at commit `374a0ab62eee184d3edb3a99e594836ee685534f`, byte-preserved under `tests/fixtures/company-forecast-original` with source/hash provenance. The original source declares no license file; no license is inferred. These private test-only files are excluded from the published package. Neither the Prompt/Skill nor original source is edited or executed as business instructions. / 官方 Session 预测回归用原公司 suite 的固定字节副本，来源与逐文件哈希保存。原源树未声明许可文件，不推定许可。fixture 仅作私有测试输入，不进入发行资源，也不执行业务指令。

Markdown crash coverage renders the existing frozen real-layout skill corpus through the public MarkdownText interface and asserts no body crashes. It requires actual corpus entries and no longer skips on a personal installed-skill directory. Missing baseline/corpus input remains a failure. / Markdown 崩溃回归通过原公开 interface 渲染既有固定真实布局的 Skill 文本，要求实际语料且所有条目无异常；缺输入保持失败，不再依赖个人安装目录。
