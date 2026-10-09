# Agent Note: Native Manage configuration

Status: implemented

## Problem

完整 Manage 启动仍调用已退出的 `settings.register/get/watch`。固定 Core 通过 Loader Config 提供 SettingsForms，因此旧调用失败，设置卡消失，运行开关未接线。客户端还绑定历史命名空间，而非实际发行的 Loader 条目标识。

## Decision

Manage 导出包含 `mcpEnhanced`、`downloadRegion`、`feedbackEnabled` 和 `scanProjectLayouts` 的 volatile Config schema，校验规则和默认值与普通市场 schema 共用。SettingsForms 投影实际条目；发行设置卡绑定 `dsh-agent-manage`，翻译命名空间仍为 `dsh-agent-plugins-market`。

运行读取沿用 Config 引用。既有后端写入口通过 SettingsForms.update 修改自己的条目。Loader volatile 更新只在后端或项目布局变化时请求现有合并重协调。反馈工具通过已注入的 tools context 注册，其观察器与工具随该 context 一起释放。SettingsForms.configure 设置自定义卡片呈现策略。不注册独立命名空间，不保留兼容 adapter 或第二份设置存储。

实际 Loader 解析、实时编辑、替换和重启均保留普通 `geaMcp`、`sources` 和 `git` 配置。旧 `userRoot` 与 `dataRoot` override 仍在写标准 Manage 存储前拒绝。历史命名空间的值不自动导入；一次性转换由另行授权的运行采用负责。

本记录仅就设置命名空间保留决定部分替代[包身份](../feature/2026-09-12-fork-package-identity.zh.md)。包、仓库、API、用户数据与历史身份继续沿用原记录范围。[工作区与用户面板](../feature/2026-09-06-workspace-tabs-user-panels.zh.md)继续持有工作区布局和反馈行为，本记录持有原生设置 Interface。[选中资源](../feature/2026-10-04-selected-business-resources.zh.md)继续持有冷启动恢复。

## Alternatives considered

**保留旧注册并记录失败。** 实际完整 Host 会失去设置卡和运行开关，日志不能完成该功能。

**保留旧命名空间回退。** 这会增加另一份持久设置的运行解释规则。已接受架构只使用当前 Loader/SettingsForms Interface。

## Consequences

独立离线 Host 测试覆盖 describe/update/replace/mutate、真实 loopback 后端 GET/POST、反馈工具开关、重启、默认恢复及资源保留。测试在模块导入前设置临时 home，并保留启动诊断。原 register/watch stub 测试退出。没有修改模型、业务 transport、用户 profile、远端状态或 Native 安装；运行采用及旧数据转换保持独立。
