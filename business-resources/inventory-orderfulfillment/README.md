# 订单履约 Agent / Order fulfillment Agent

用户提示词原文保存在 [agent-prompt.md](agent-prompt.md)，原始与包内摘要见 [SOURCE.json](SOURCE.json)。运行提示词保留原文并追加当前安装能力边界。七个领域 Skill 与语义参考完整交付，相对路径转为可读取的 Markdown 链接。

当前 Consumer 为 `order01`，MCP 为 `governed-sql-read`。Workbench 的相邻命名查询配置通过当前页面通道交给 GEA Host；Host/Gateway 持有身份、委托、行列授权与凭据。拒权、缺列、空值、零与未接入分别处理，不直连数据库回退。

正式指标与当前字段缺口见 Workbench `docs/order-fulfillment-data.md`。飞书卡片、回调、提醒调度及 OMS/WMS/TMS 写入未接入。提示词是业务规范，不授予工具或业务权限。

The original prompt bytes and provenance remain intact. The order01 Consumer supports governed read only through the current Host identity. Workbench packages the complete Skill tree and adjacent named-query config. Gateway enforces row and column grants; browser filters only narrow scope. Unavailable metrics remain unknown; external automation is not installed.
