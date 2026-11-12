# Manage 开发入口

先核本次任务登记的 checkout、HEAD 与未提交改动。工具链、命令、锁与公开导出从 [package.json](package.json) 读取，工程检查见[当前开发](docs/current-development.md)，术语见 [CONTEXT.md](CONTEXT.md)。

Manage 管 Agent、Prompt、Skill、MCP/LSP 资源及库存、APS、MPS 纯计算。catalog 不依赖 runtime/client；application 编排目录，runtime 挂载和释放宿主资源；计算只消费已收窄输入。模块依赖由 `.dependency-cruiser.cjs` 检查。

页面与页面/Session 关联归 Workbench，Session/草稿归 Core，身份、凭据与业务授权归 GEA Host。保留取消、未知结果、失败释放与重试语义；资源存在或界面可见不授予业务权限。

代码用命名、类型、结构和必要行为测试表达规则，自有源码、脚本与测试不写注释。业务 Prompt/Skill 与运行时文案保持原含义；工具指令先消除依赖，许可证来源按原分发要求保全。实现细节只维护在代码中，不要求每个非平凡改动另写 Agent Note；代码无法表达且仍影响判断的决定才维护其唯一记录。

`check:comments` 默认阻断全仓自有代码注释，支持范围和资产来源见 `source-comments.json` 与[本地开发](docs/current-development.md)。第三方、生成物、业务资源、fixture 与历史证据按真实来源保留。

在插件拆分项目中构建或调试前，读项目根 `docs/agents/dependency-preparation.md`，复用已准备环境，不共享可写 node_modules 或构建输出。生成的 lib/client 不手改。

仅修改本任务工作区。GitLab source、正式 OSS/npm/频道、正式客户端与用户数据保持保护；远端写入按本次有效授权执行。源码、离线检查、实际安装和业务验收分别留证，历史验收不证明当前状态。`CLAUDE.md` 链接本文件。
