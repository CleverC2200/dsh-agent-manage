# 登录后自动接入 GEA MCP

将更新后的 `dsh-gea-plugin` 与 `dsh-agent-manage` 加载到同一 Cordis 服务作用域。市场插件自动等待 GEA 登录，经 GEA 创建获授权的网关业务会话，然后连接 `/ai/gateway/mcp/proxy/mcp`，以 `mcp__gea-gateway__…` 名称注册发现的工具。

默认 Consumer 为 `AGENT`，编码取 GEA 部署的 `analysisAgentCode`，仅可见该 Agent 获授权的工具。使用其他**已注册** Consumer 时，在市场插件配置中设置：

```yaml
geaMcp:
  consumerType: CLIENT_APP
  consumerCode: your-registered-client-code
```

设置 `geaMcp: false` 可关闭集成。省略配置时，有 GEA 服务便自动接入；缺少 GEA 不阻断其他市场功能。

GEA 将登录和委托凭证保留在内存中。市场插件只接收受控 fetch 能力，不获取系统登录凭证，也不把连接写入 `mcp.json`、headers 或凭证设置。MCP SDK 负责初始化、传输会话头、工具发现与调用；GEA 将业务授权注入 `params._meta`，保持 `arguments` 不变。工具执行仍受宿主确认和 GEA 服务端校验约束。

退出登录、切换环境、GEA 检测到登录过期，或任一插件卸载，都会取消旧请求并移除工具。晚到的旧登录响应不能重新挂载工具。发现失败会输出不含凭证的诊断；解决 Consumer 授权或传输问题后重新登录。不会盲目重复建会话、重连或重放业务调用。宿主对话共享当前登录代际的网关业务会话。

本地测试覆盖契约和生命周期；目标环境部署、真实 Consumer 权限及业务操作仍需独立实测验收。

依据：[MCP 契约](https://gea.synear.cn/docs/integration/contracts/mcp-tool-schema)、[业务会话契约](https://gea.synear.cn/docs/integration/contracts/session-context)。

本地验收前应核对实例实际加载的是重建后的市场入口；仅构建工作区不会更新实例中已安装的旧包。观测到的网关条目展示工具和中性的归属说明，不在市场中编辑连接配置。

GEA MCP 的工具可见性及调用仅限本地 DSH `gea-readonly` 预设（需求预测入口）。可在 Consumer 字段旁通过 `geaMcp.agentPreset` 指定其他本地预设；服务端 Consumer 授权与本地预设限制是两个独立边界。其他预设及不携带 Agent 的调用均被拒绝；登录刷新、已有和新建 Agent、空会话切换预设均维持此限制。继承相同预设的子 Agent 同样拥有访问权。宿主 MCP 状态页仍保留连接信息用于诊断。宿主缺少 `agents` 或 `agentPresets` 服务时不挂载此集成。

同一预设限制也覆盖旧的 `gea_sales_plan_read` 工具，标准预设不获得 GEA 业务查询能力。
