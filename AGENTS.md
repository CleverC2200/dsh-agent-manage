# Agent Manage 开发导航

`dsh-agent-manage` 管理 Agent、Prompt、Skill、MCP/LSP 资源及库存、APS 的纯计算。Workbench 拥有业务页面与官方 Session 的关联，Core 持有 Session 和用户草稿，GEA Host 统一持有业务身份、凭据与授权。

先读[当前开发入口](docs/current-development.md)，核本项目登记的 checkout、固定官方输入和检查范围。术语沿用 [CONTEXT.md](CONTEXT.md)。改资源接口时读[原生资源选用决定](.agents/notes/implemented/feature/2026-10-04-selected-business-resources.md)；改计算时读[库存合同](docs/design/inventory-compute.md)及[APS 归属](.agents/notes/implemented/architecture/2026-10-08-aps-ownership.md)。

## 修改和验证

- 工具链、命令、锁、公开导出分别查询 [package.json](package.json)、[pnpm-lock.yaml](pnpm-lock.yaml) 和构建配置。`check:refactor` 是现有综合门禁；当前引用用 `check:knowledge` 核验。按改动运行适用测试，完整 CI 与远端保护以实际回执为准。
- catalog 集中维护发现、格式、元数据和既有 checkout 操作，不依赖 runtime/client；application 持有目录编排，runtime 持有宿主挂载与释放。`inventory-compute` 和 `aps-compute` 只接收已收窄输入，不读 Session、网络或授予业务权限。客户端通过 contracts 与公开接口消费资源。
- 无效 manifest、MCP/LSP 声明明确诊断并拒绝不完整挂载。保留 owner、取消、未知失败和清理重试的语义，避免第二份状态规则。
- 改配置、路由、schema 或公共合同，同步对应文档与有用途的 JSDoc。界面文案用 locales 的中英文对应键，README 双语一并更新。
- 非平凡决定按 [Agent Note 规则](.agents/notes/README.md) 更新其当前 owner；新增 Note 先核 supersession。部分替代保留未替代理由并双向引用，archived 原件保持冻结。
- 依赖变化说明理由并保留 frozen-lockfile 安装协议。生成的 lib/client 产物不手改，工作树不共享 node_modules 或可写输出。

## 隔离范围

本 checkout 只用于插件拆分隔离开发。当前 tgz、用户存储与宿主持久会话协议保持。GitLab source、正式 OSS/频道、正式客户端目录和业务写入不在本项目授权内。远端写入仅按本次明确授权的隔离目标执行。

历史 release-please/npm、公司发行和旧工程计划保留为上游或历史资料；阅读它们不授予发布、上传或桌面运行权限。涉及后续发行时先核该任务的确切目标与有效授权，再按适用发行规则操作。

`CLAUDE.md` 链接本文件；修改本文件即可。

## 规则与执行机制

| 规则 | 执行机制 |
| --- | --- |
| 固定 Core、原锁、工具链与冷 runner 输入 | `sdk:verify` / `sdk:prepare`、`test:ci-inputs` 和双版 quality/archives workflow，共用 GEA `supported-cores.json` |
| 当前导航与历史缺文档反例 | `check:refactor` 串接 `check:knowledge` 与 `test:knowledge` |
| 普通空 Home 必须发现原销售 Skill 及其完整引用资产；新任务默认智能编排并保留用户显式选择 | `check:capabilities` 的 standard-skill lane 运行 `bundled-sales-skills.test.ts` 和 `manage-bundle-default.test.ts`；已有 quality workflow 同时运行 `check:refactor` 和 `test` |

该检查证明受控源码行为。实际三包安装及官方 Loader 接收仍由 GEA 的普通交付接收入口负责，不能用离线通过替代。
