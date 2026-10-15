# GEA Cube-New MCP

GEA Host 保留登录、凭据和业务授权。Manage 在当前登录代际中直接注册 `inspect_cube_model`、`query_business_data` 的服务端 Schema，公开名称为 `mcp__gea-gateway__inspect_cube_model`、`mcp__gea-gateway__query_business_data`。`geaMcp: false` 可关闭集成；不再通过 Manage 配置或模型参数选择 Consumer。

每次调用由 GEA 根据真实 Core Session 的已安装启用业务预设确定 Consumer。销售、库存等业务模式分别使用自己的身份，普通编程预设或无 Agent 的调用不可借用默认身份。切换业务预设、环境或账号后，旧调用不能向新上下文返回结果。

模型先用 `inspect_cube_model` 按业务关键词或实际模型查看说明，读取 View 的当前 `aliasMember`，再按原 Schema 调用 `query_business_data`。一次调用只查询一个底层模型；`action=query`、`response_mode=inline_complete`。Host 用原业务和传输会话读取结果制品，核原文摘要、具名数据集、行数及分页；不会改用旧 Cube、任意 SQL 或存储地址。模型接口仍只有两个方法。

服务端授权与模型成员发布均以真实回执为准。`DATA_QUERY_MEMBER_NOT_PUBLISHED` 保留原码并停止本轮查询，不能把它当作参数格式错误反复修改重试。工具可发现、说明可见和真实业务查询成功分别验收。

退出、切账号及切环境时先取消旧调用再释放工具；新的登录代际重新发现。取消、拒权或发现失败不自动重建业务会话。旧 `gea_gateway_catalog`、`gea_cube_query`、`gea_module_mcp` 已退场；历史 Session、草稿和证据保留。

GEA 通过 `geaMcp.identitySignal()` 投影当前身份代际。同身份资源刷新先准备新结果，期间保留现有 Schema。Core 的串行创建事件与公开提示组装 interface 等待 Schema 发布，覆盖业务首轮请求。身份变化先取消旧调用并退役其 Schema，再重新发现；资源刷新不重建业务 Session。

个人 Agent 可选择一个可信的已安装 Cube 引用。Host 沿实际 Core 预设 revision 反查 owner 与 Consumer，沿同一 Consumer 发布上述两项 Cube 工具及 `weknora_list_knowledge_bases`、`weknora_ask`，执行仍以当前服务端授权为准；不授予业务 profile、写入或页面动作。缺失、停用、删除或撤销的来源不能回退到其他 Consumer。见[可信引用](../../.agents/notes/implemented/feature/2026-10-04-selected-business-resources.zh.md#可信-cube-引用)。
