# Manage 工程规则入口

从 [AGENTS](../../AGENTS.md) 进入本票范围与模块约束，固定 SDK、工具链和检查协议见 [当前开发](../current-development.md)。API 依据是任务登记的官方 SDK 类型与公开导出，不使用未登记的全局安装。

| 修改内容 | 权威规则 |
|---|---|
| catalog、application、runtime、contracts 与 client 分层 | [贡献规则](../../CONTRIBUTING.md#change-guidelines--改动规范)、依赖边界配置与现行 ADR |
| 格式方言、资源安装状态与挂载 | [领域词汇](../../CONTEXT.md)、相关 Agent Note、schema 与行为测试 |
| 凭据、输入约束与投影 | [输入与生命周期规则](../../CONTRIBUTING.md#input-and-lifetime-rules--输入与生命周期)、贡献规则中的安全与输入要求 |
| 包入口、SDK peer 和构建 | package.json、锁、构建配置及当前开发说明 |
| 验证与双语维护 | 贡献规则和 [Agent Note 规则](../../.agents/notes/README.md) |
| Git、提交与后续发行 | 贡献规则的提交类型；远端目标与发行范围按本票有效授权 |

原规范按原字节保存在 [历史规范](../history/agent-guidance-before-20261010/dsh-plugin-development-standard.md)。其中旧 CLI、私有 API、壳层回退、脚手架和操作批准流程属于原输入，不作为当前执行协议。现行业务资源、用户数据、权限、取消和释放语义继续按当前 owner 合同维护。
