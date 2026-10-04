# Agent Note: 已选原生业务资源

Status: implemented

Manage 持有唯一的资源interface与已启用包资源的官方Skill Provider。Catalog继续持有Suite源、安装与启用事实。当前包在自己的effect下登记私有文件引用；浏览器选用稳定资源标识并传入原生工作区绝对路径上下文，不传资源文件路径或Consumer覆盖。目录只返回轻量摘要，正文只在选用时装载。原文件与用户草稿不覆盖。

所选persona通过官方preset registry发布。持久Session保留preset标识；Manage只持久化已选标识，并在owner登记时恢复定义。页面释放不撤销持久Session需要的定义；owner退出释放自己的进程内声明，恢复索引保留。未安装或已禁用资源明确失败，不回退另一persona。

公开发现路由要求绝对路径cwd query，选用要求{id,cwd}。两者向现有资源/Skill interface传入同一个原生工作区；Workbench新Session也使用该工作区。缺失或相对路径以INVALID_AGENT_RESOURCE_WORKSPACE失败，不在运行时回退另一项目。请求大小边界、owner与取消保护保持。

本决定取代[2026-09-29业务资源归属](../architecture/2026-09-29-workbench-business-resources.zh.md)中的文件系统mount和兼容路径；包内路径约束、独立页面解释器选择与GEA受控执行归属仍保持。既有市场dialect的Skill根替换语义保留，业务包正文原文保真。

Manage 的现有 runtime 同时持有 `skill_reference_read` 与纯 §5.5 `forecast_compute` 能力。官方 Skill registry 是唯一目录与正文加载入口。参考读取核当前可由模型调用的 Skill、正文明确相对链接、宿主文件系统权限、UTF-8/大小/分页与调用者取消；owner 撤销或变化后不返回旧正文。计算沿同工作区核已安装启用的 `sinian-demand-baseline`，保持原十进制算法，并把输入 hash/版本及实际完整用户输入来源与业务授权分开报告。不新增 provider、备用目录、独立运行插件包或 Consumer 权威。

GEA 保留执行身份与真实业务数据/证据保护，其旧 Skill 正文/参考 loader、工具包/加载状态和纯计算在当前调用者接上 Manage 与官方 loader 后退出。原 Skill/persona 源不复制改写。离线检查覆盖不变的十四组参考算法、缺十进制数据、来源核对、参考可见性及 owner 撤销；真实安装及 Consumer/model 验收归同组运行。
