# Agent Note: Current settings surface only

Status: implemented

## Problem

第二个市场页面通过猜测旧宿主的侧栏和会话 DOM 挂载。能力标志、事件、布局模式和选择器让两个 UI 负责人同时存在，但隔离项目现在仅支持登记的当前核心基线。

## Decision

客户端只通过 settings.section 提供一个 PluginWorkspace，并通过 settings.plugin.item 提供配置卡。跨插件注入是必需接口。缺少所需 UI primitives 的宿主明确不受支持，不挂载 DOM 页面回退。page-mode 模块、检测事件、页面专用属性和 CSS 已删除。

## Alternatives considered

**保留有条件的回退。** 用户已明确只支持当前基线；给旧路径加条件不会消除它的状态负责人和维护成本，因此否决。

**重新建立独立市场外壳。** 当前宿主已经拥有所需 settings 槽位，独立外壳只会把已删除的适配换成另一个 UI 负责人，因此否决。

## Consequences

六个工作区页签、资源操作、双语文案、凭据与配置生命周期保留在当前接口。旧宿主不再受支持。本改动不删除市场资源方言、MCP 传输或用户数据。

现有 workspace-tabs 决策记录仍有效：一个设置区入口、六个页签的决定未变。没有发现单独负责旧页面回退的活跃记录；工程重构计划已改为实际的唯一新路径。
