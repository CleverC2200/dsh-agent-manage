# 分仓页面的 Agent 能力选择

组装后的 `business-resources/inventory-fc/prompt.json` 持有 `pageAgents` 列表。它列的是预设 ID，不是 Consumer 授权：

```json
"pageAgents": ["gea-html-inventory-fc", "gea-html-inventory-qll"]
```

装载器要求列表非空、去重、最多四个库存预设，且包含 `gea-html-inventory-fc`。工作台为每个选项保留独立 Session；已有或显式传入的 Session 实际预设不在名单内时拒绝绑定。

GEA 只展示已安装、与 Agent 资料匹配且当前登录可打开对应网关 Consumer 的能力。打开分仓页还需校验页面自己的 `branch-inventory` Consumer。页面 SQL 始终使用页面 Consumer；选择全链 Agent 不会给其数据工具增加 `branch-inventory` 权限。登录、租户或环境变化会使旧页面引用失效，也不能用新身份重开旧 Session。

本地 DSH Web 与网关 fixture 已验证这些规则；真实 GEA 授权和业务数据另需目标环境验收。
