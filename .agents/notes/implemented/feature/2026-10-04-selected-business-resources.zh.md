# Agent Note: 已选原生业务资源

Status: implemented

Manage 持有唯一的资源interface与已启用包资源的官方Skill Provider。Catalog继续持有Suite源、安装与启用事实。当前包在自己的effect下登记私有文件引用；浏览器选用稳定资源标识并传入原生工作区绝对路径上下文，不传资源文件路径或Consumer覆盖。目录只返回轻量摘要，正文只在选用时装载。原文件与用户草稿不覆盖。

所选persona通过官方preset registry发布。持久Session保留preset标识；Manage只持久化已选标识，并在owner登记时恢复定义。页面释放不撤销持久Session需要的定义；owner退出释放自己的进程内声明，恢复索引保留。未安装或已禁用资源明确失败，不回退另一persona。

公开发现路由要求绝对路径cwd query，选用要求{id,cwd}。两者向现有资源/Skill interface传入同一个原生工作区；Workbench新Session也使用该工作区。缺失或相对路径以INVALID_AGENT_RESOURCE_WORKSPACE失败，不在运行时回退另一项目。请求大小边界、owner与取消保护保持。

本决定取代[2026-09-29业务资源归属](../architecture/2026-09-29-workbench-business-resources.zh.md)中的文件系统mount和兼容路径；包内路径约束、独立页面解释器选择与GEA受控执行归属仍保持。既有市场dialect的Skill根替换语义保留，业务包正文原文保真。

Manage 的现有 runtime 同时持有 `skill_reference_read` 与纯 §5.5 `forecast_compute` 能力。官方 Skill registry 是唯一目录与正文加载入口。参考读取核当前可由模型调用的 Skill、正文明确相对链接、宿主文件系统权限、UTF-8/大小/分页与调用者取消；owner 撤销或变化后不返回旧正文。计算沿同工作区核已安装启用的 `sinian-demand-baseline`，保持原十进制算法，并把输入 hash/版本及实际完整用户输入来源与业务授权分开报告。不新增 provider、备用目录、独立运行插件包或 Consumer 权威。

GEA 保留执行身份与真实业务数据/证据保护，其旧 Skill 正文/参考 loader、工具包/加载状态和纯计算在当前调用者接上 Manage 与官方 loader 后退出。原 Skill/persona 源不复制改写。离线检查覆盖不变的十四组参考算法、缺十进制数据、来源核对、参考可见性及 owner 撤销；真实安装及 Consumer/model 验收归同组运行。

资源摘要和选用结果返回已选 profile 验证过的页面解释器列表。Manage 每次读取都按当前资源 owner 过滤，owner 卸载后也不返回旧选项。工作台负责选择器和官方 Session 导航。GEA 继续负责预设与 Consumer 授权。已选资源身份的恢复索引保持原格式。

`forecast-source` 导出让 GEA 使用同一套纯输入与 baseline 校验。GEA 将已保存的计算证据绑定到当前执行、Session 和 subject。baseline 正文或可见性变化使旧证据失效。计算实现仍归 Manage。

稳定预设 `agent-resource-skill` 使用[标准组合接口](../../../../docs/design/standard-preset-composition.md)。插件声明来自当前官方 standard 文档，保留禁用项和用户配置。官方 Skill 发现与加载工具各保留一份；资源选择只返回 Skill 名称，不发布业务 profile。注册目录的描述说明这个用途。资源摘要投影各 Skill 原有描述，Workbench 在现有资源列表显示该投影。

真实 Core Session 测试核对最终工具、命令、自动与手动压缩、继续执行和选中身份恢复。预设集成入口经过实际 GEA hooks 并核对无业务 profile 的执行拒绝。独立客户端入口使用官方 InputHub，并通过独立 Host process 的回执提供所选资源和真实 Session；它的 wire adapter 提供公开 Session/工作区接口。测试覆盖空草稿、已有文字、取消、重进与旧草稿，不将 Host 编译库装入浏览器源码图。这些离线观察不证明 Native 安装或外部模型、业务执行。
