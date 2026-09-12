# dsh-agent-manage 与 DSH Plugin Hub 对比

核查日期：2026-09-12。方法：GitHub 当前提交、README、包配置与核心源码静态对照；未安装或运行两者，不代表真实宿主验收通过。

## 结论

两者都有市场界面，但管理对象不同。dsh-agent-manage 是外部 Agent 插件生态的适配与运行时注入层；Plugin Hub 是 DSH 插件包的发现、安装和维护界面。建议保留前者核心，借鉴后者的安装任务体验；是否让 Hub 分发前者，需要单独验证发布包和宿主兼容性。

## 比较基线

| 项目                         | 提交                                       | package 名称 / 版本              |
| ---------------------------- | ------------------------------------------ | -------------------------------- |
| CleverC2200/dsh-agent-manage | `66d2ea22b2fbd9e1c49e805ecc7eb4808a946ade` | `dsh-agent-plugins-market@0.6.2` |
| dshplugin/dsh-plugin-hub     | `641b71666fd20cf9b0226106c879e60c33e0df26` | `dsh-plugin@1.4.2`               |

来源：[Agent 包配置](https://github.com/CleverC2200/dsh-agent-manage/blob/66d2ea22b2fbd9e1c49e805ecc7eb4808a946ade/package.json)、[Hub 包配置](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/package.json)。版本数字不代表两者成熟度排名。

## 功能与架构

| 维度     | dsh-agent-manage                                                | DSH Plugin Hub                                                 |
| -------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| 管理对象 | marketplace source、suite 和各类能力组件                        | DSH 插件包及 profile 安装状态                                  |
| 来源     | Git 市场仓库、本地目录、多种 manifest 布局                      | api.dsh-plugin.org 目录，自定义 npm/GitHub/DSH 命令入口        |
| 主要能力 | skills、commands、agents、MCP、hooks、LSP 的发现与适配          | 分类搜索、更新提示、安装卸载、进度取消、通知日志、代理及诊断   |
| 实际执行 | 解析外部声明并接入 DSH 会话服务                                 | 服务端调用 DSH CLI 修改 profile；另有全局 npm 安装通道         |
| 兼容边界 | 不同方言、hooks 事件、项目 LSP、Codex connectors 等存在明确限制 | 安装成功、入口存在、宿主加载和业务可用仍是不同阶段             |
| 分层     | application/catalog/contracts/model/runtime/client              | client/server；服务端有 routes、profile、install queue、loader |

证据：[Agent 能力矩阵与限制](https://github.com/CleverC2200/dsh-agent-manage/blob/66d2ea22b2fbd9e1c49e805ecc7eb4808a946ade/README.zh.md)、[Agent 分层约定](https://github.com/CleverC2200/dsh-agent-manage/blob/66d2ea22b2fbd9e1c49e805ecc7eb4808a946ade/AGENTS.md)、[Hub routes](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/http/routes.ts)、[Hub task queue](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/install/task-queue.ts)。

## 借鉴建议

1. 优先参考 Hub 的后台任务、取消、失败反馈、通知历史、网络诊断与待重启提示，让安装结果可解释。
2. 保留 Agent 项目的方言解析、组件状态及宿主能力边界；Hub 的包管理流程不能直接替代这些适配层。
3. 可以探索“Hub 分发适配器，适配器管理外部 suites”的关系。此项是架构建议，未确认当前目录是否收录、发布包是否可直接安装，也未验证两者同时运行。
4. Hub 会针对特定 pnpm 构建阻断错误写入 allowBuilds 并重试。此行为涉及构建脚本执行范围，不宜直接作为通用自动恢复策略照搬。

证据：[Hub task queue 的 runPluginMutation](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/install/task-queue.ts#L592)、[Hub settings](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/settings.ts)。

## 需要分清的事实

- Agent 仓库 Git origin 已指向 CleverC2200/dsh-agent-manage，但 package.repository 仍为 Sivan757/dsh-agent-plugins-market，包名也保留原名。这可能是保留上游发布身份，不能仅凭仓库改名就认定需要改包名；独立发布前应明确发布归属。
- Hub README 的“仅浏览器端注入、无宿主服务依赖”与当前服务端入口不一致：apply 注入 webServer 并挂载真实安装路由。判断部署条件应以当前源码为准。
- Hub 的收录数量、verified/人工验证是其目录方的声明，本次没有逐插件核验，不能视为独立安全或运行验收。
- CodeGraph 无法提供本次两仓库的有效图谱查询，使用源码检索；本次未运行测试或真实安装。

证据：[Agent package.repository](https://github.com/CleverC2200/dsh-agent-manage/blob/66d2ea22b2fbd9e1c49e805ecc7eb4808a946ade/package.json#L61)、[Hub 服务端入口](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/index.ts)、[Hub README](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/README.md)。

## 更新策略专项

Hub 当前策略是提示后覆盖重装，没有后台自动升级。

| 环节         | 实际机制                                                             | 限制                                                                            |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 检查触发     | 页面加载、手动刷新、切换语言重新获取目录；Hub 自身另取版本 API       | 未见周期版本轮询，短时重试不等于定时检查                                        |
| 普通插件提示 | 目录 version 与安装时保存的 version 不相等；缺版本时比较仓库更新时间 | 不是 semver 大小比较，也不是实际安装 commit 比较；缺记录不提示                  |
| 自身提示     | API version 与构建 PLUGIN_VERSION 比较                               | 若 publishedAt 可解析，等待 24 小时 30 分钟；缺失或无效不阻断；普通插件无此门槛 |
| 确认         | 点击更新后弹窗确认，再入后台队列                                     | 不自动安装                                                                      |
| 目标选择     | Git 仓库尝试反查 npm 包，未命中保留 Git                              | repository 链接使用子串匹配，不是严格仓库身份验证                               |
| 执行         | npm 使用 dsh plugin add 包@latest；Git 走 add 覆盖                   | 不锁定提示的版本或 commit，检查与执行可能漂移                                   |
| 生效         | profile 升级成功登记待重启，由用户选择立即或稍后                     | CLI 成功不等于重新加载成功                                                      |
| 失败         | 部分 pnpm 构建错误写 allowBuilds 后重试；入口缺失标失败              | 未见旧版本备份或事务回滚；入口失败不会恢复旧包                                  |

证据：[检测逻辑](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/client/hooks/useCatalog.ts#L198)、[普通插件版本比较](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/client/logic/installed.ts#L94)、[安装时记录](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/profile/installed-versions.ts)、[npm 反查](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/install/npm-resolve.ts#L55)、[执行与失败处理](https://github.com/dshplugin/dsh-plugin-hub/blob/641b71666fd20cf9b0226106c879e60c33e0df26/src/server/services/install/task-queue.ts#L326)。

针对本项目的建议（尚未实现）：检查时固定目标版本/commit 和来源；用户确认同一目标后安装；保存旧版本及配置；重启后检查挂载与核心能力；验收通过才记录更新成功，失败能恢复旧版本。分别管理本管理器自身更新与它管理的 suites 更新，不能把二者的版本信号混用。

后续命名修复：当前工作区已将包名和反馈目标改为 dsh-agent-manage / CleverC2200；上表基线描述的是原始提交，保留为对比证据。新包未发布，运行时保留旧设置命名空间以兼容已有配置。
