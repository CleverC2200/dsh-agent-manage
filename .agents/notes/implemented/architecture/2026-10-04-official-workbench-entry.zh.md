# Agent Note: 官方 Workbench 入口与客户端样式生命周期

Status: implemented

## Problem

已有资源工作区只能从设置区进入，共享颜色依赖复制到定制宿主的 CSS。客户端构建在模块求值时插入样式，插件卸载不能释放它。

## Decision

`src/client/index.ts` 把已有 `PluginWorkspace` 贡献到官方 `main` 的 `agent-plugin-workspace`。Workbench 以公开槽位注册发现页面，页面登记只携带本地化标题，并随注入上下文释放。设置区工作区和配置卡保留原行为及资源归属。

模块加载包装只提供 CSS 正文；Manage 在 `apply` effect 中安装和删除自己的样式，消费 Workbench 插件持有的 `--workbench-*`。主题状态和字号仍属官方 DSH，不修改宿主样式、Core 实现或用户持久数据。

## Alternatives considered

**第二份页面目录或侧栏实现**重复官方注册事实，已有 main 槽位足以发现页面。

**保留模块加载时插入样式**会使资源超过插件生命周期。把正文交给已有 apply effect，可同时检查安装和释放。

## Consequences

本决定部分更新[工作区标签](../feature/2026-09-06-workspace-tabs-user-panels.zh.md)中的入口位置，保留一个工作区与六个标签的决定；更新[市场交互](../feature/2026-09-02-market-card-platform-affordances.zh.md)中共享资源的提供方，从定制 ui-theme 构建改为 Workbench 插件 CSS。Catalog、安装启用、MCP transport 与业务资源仍由已有 module 管理。

入口测试验证公开贡献、标题和样式释放。类型检查与客户端构建验证代码候选；同一实际宿主显示由规格41另记证据。
