# Fixed SDK and clean CI / 固定 SDK 与干净 CI

`quality:ci` uses the existing Manage SDK preparation module, admits the frozen three-repository input, installs with the committed consumer lock, then runs `check:refactor`, full `test` and `build`. Uncommitted local development continues to use `check:refactor`. / `quality:ci` 复用已有 SDK 准备模块，核冻结三仓输入，按消费者已提交锁安装，再运行综合门禁、完整测试和构建。未提交的本地开发继续使用 `check:refactor`。

## Registered source / 登记来源

The adjacent GEA [supported Core registry](../../dsh-gea-plugin/scripts/supported-cores.json) owns both accepted heads, versions, original lock hashes and exact toolchains. Manage does not maintain another Core version table. CI reads its quality and Windows archives matrix from that registry. / 相邻 GEA 登记表持有两版 Core 的提交、版本、原锁哈希和精确工具链。Manage 不另建版本表，CI 从同一表生成质量和 Windows 归档矩阵。

Use this independent layout for cold preparation. / 冷准备使用独立目录：

```text
job-root/
  official-latest-standard/
  candidate-input.json
  candidate/
    dsh-agent-workbench/
    dsh-agent-manage/
    dsh-gea-plugin/
```

```sh
node scripts/run-quality-ci.mjs --phase quality --input /absolute/job-root/candidate-input.json \
  --prepare-sdk --core-source https://github.com/deepseek-ai/deepseek-harness.git
```

`candidate-input.json` binds `core` to an explicit registered head and `repositories` to the three real `{repo,path,head}` inputs. Manage's own head is the actual PR or push SHA; peer refs are fixed in the workflow and input writer. Full histories, clean sources and committed locks are required. / 输入的 `core` 显式绑定登记 head，`repositories` 绑定真实三仓路径和提交。本仓绑定实际 PR 或 push SHA，peer 引用固定在 workflow 和输入 writer 中。要求完整历史、干净源码和已提交锁。

The public [SDK module](../scripts/prepare-official-sdk.mjs) retains `prepareOfficialSDK(options)` and `verifyOfficialSDK(options)`. `options` includes `core`, `consumer`, and selected `coreHead`; `source` is needed for a new owned clone. `verifyOfficialSource(core, {coreHead})` verifies source without requiring outputs. The omitted `coreHead` keeps the previous alpha default for existing callers; CI must bind it explicitly from its input. / SDK 模块保留原公开准备与核验函数，选项增加 `coreHead`。只读 source 核验不要求产物。未传 head 的既有调用保持 alpha 缺省，CI 必须从输入显式绑定。

```sh
node scripts/prepare-official-sdk.mjs --core /absolute/job-root/official-latest-standard \
  --consumer /absolute/job-root/candidate/dsh-agent-manage --core-head <registered-head> \
  --receipt /absolute/job-root/sdk-verified.json
```

Preparation clones only Git source, marks its independent ownership and rejects an existing unowned or symlinked destination. Wrong head, changed original lock, dirty source, wrong toolchain or missing output fails. Consumers install only after SDK preparation, with `--frozen-lockfile --ignore-scripts --prefer-offline`; prepare/prepack package behavior is unchanged. Read-only verification may use an existing registered SDK. / 准备只克隆 Git 源码并登记独立归属，拒绝已有无归属目录和链接写入。错误 head、原锁变化、脏源码、工具链错误或缺产物均失败。消费者在 SDK 就绪后冻结安装并关闭隐式脚本，既有 prepare/prepack 行为保持。只读核验可使用已登记 SDK。

Workbench and GEA consume the same SDK module with their own consumer paths. Optional `withWeb` / `withFlock`, and the existing `prepareOfficialWeb` / `prepareOfficialFlock` interfaces retain their original source and artifact receipts. Windows archives do not request Web or flock. / Workbench 和 GEA 用自己的 consumer 路径复用同一模块。已有 Web/flock 可选准备接口及源码、产物回执保持。Windows 归档不请求 Web 或 flock。

## Gates and receipts / 门禁与回执

`check:refactor` includes `check:knowledge`, the actual historical missing-reference negative test, SDK/quality CLI rejection tests and the existing type, lint, format, contract, architecture and capability checks. Quality installs each peer with its own committed lock and disabled scripts: Workbench uses its exact npm toolchain, GEA its declared pnpm. Workbench's public declarations are tracked inputs and are read without rebuilding its library. Peer installation does not prove complete peer quality. The same `quality:ci` command runs locally and on hosted runners. / 综合门禁包含知识检查、真实历史缺引用反例、SDK/quality CLI 拒错测试，以及既有类型、lint、格式、合同、架构和能力检查。质量阶段按各 peer 原锁和工具链关闭脚本安装，读取 Workbench 已 tracked 的公开声明，不重建其 lib。peer 安装不表示完整 peer 质量通过。本地与 hosted runner 使用同一 quality 命令。

Windows `--phase archives` preserves the original source-acquisition, zip-bomb and private-archive tests and loads the current Vitest configuration after selected Core preparation. macOS results do not prove hosted Windows or Linux execution. / Windows 保留原三个归档测试，在所选 Core 准备后加载当前 Vitest 配置。本机结果不证明 hosted Windows/Linux 已执行。

Fork PRs are rejected before private checkout. Private peers require a separately configured contents-read `PLUGIN_SPLIT_READ_TOKEN`; personal high-permission tokens are not appropriate. Missing credentials or inaccessible fixed peers block execution. Checkout does not persist credentials. / fork PR 在私有检出前拒绝。私有 peer 要求独立配置的 contents-read 凭据；个人高权限 token 不适用于此用途。缺凭据或固定提交不可达阻断执行，checkout 不保存凭据。

The final `candidate-quality` accepts only successful scope and every registered quality/archives matrix entry. Failure, missing results, cancellation and skipped execution fail the aggregate. Frozen final groups may additionally pass `--final-group-sha256 <original-byte-hash>`; the shared Workbench reader rechecks the original bytes before effects. / 最终质量聚合仅接受 scope 和每一项登记 quality/archives 矩阵成功。失败、缺结果、取消和跳过不能通过。显式最终组可另传原字节哈希，Workbench 共享 reader 在产生效果前复核。

## Security coverage / 安全覆盖

`security-audit` is separate from `candidate-quality`. Its `--phase audit` verifies selected fixed Core source, original lock and toolchain, installs the consumer with the frozen lock and disabled scripts, then runs `pnpm audit --audit-level high --json`. Audit does not need unrelated SDK outputs. High/critical vulnerabilities, tool errors and registry errors remain nonzero; raw logs are uploaded even after failure. / 安全审计和质量聚合分别记录。审计核固定 Core 源码、原锁和工具链，冻结安装消费者后运行原漏洞审计，不要求无关 SDK 产物。高严重度漏洞、工具及 registry 错误保留非零退出，失败原日志仍上传。

This covers known vulnerabilities in the consumer lock, including development dependencies. It does not establish dependency-diff, license-policy or linked Core's full dependency-closure coverage. The current private repository's CodeQL upload is blocked by disabled code scanning; the original CodeQL workflow and failure stay visible. A green quality result does not mean security coverage or full CI is green. / 此审计覆盖消费者锁内已知漏洞及开发依赖，依赖差异、许可证及 linked Core 完整安全闭包仍未证明。当前私有仓库 CodeQL 因未启用 code scanning 阻断，原 workflow 和失败保持可见。质量通过不表示安全覆盖或完整 CI 通过。

Source tests, remote CI, Windows, Native, real business/model behavior and repository protection need their own evidence. No SDK preparation or quality command grants production release or business write permission. / 源码测试、远端 CI、Windows、Native、真实业务/模型和仓库保护分别留证。SDK 准备与质量命令不授予正式发行或业务写入权限。
