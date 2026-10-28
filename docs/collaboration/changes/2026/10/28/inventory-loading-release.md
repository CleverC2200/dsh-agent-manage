<!-- collaboration-record
{"kind":"change","id":"CHANGE-20261028-inventory-loading-release-manage","date":"2026-10-28","title":"库存插件组配套 Manage company.35","module":"插件发行","status":"准备中"}
-->

# 库存插件组配套版本

为 Workbench 0.1.36、GEA 0.0.197 的固定三包构建准备 Manage 0.6.3-company.35。company.34 的重新构建受 CSS 标识路径影响，归档字节不同；为避免替换同版本包分配新版本，业务实现、Prompt 和 Skill 原样保留。

仅修改版本、自动生成的编译标识和本记录，无删除或旧修复回退。沿用 company.34 源码回归，本轮补核版本与发行组合。必要 CI 通过并合入主线后才发布；采用用户指定的 dsh-plugin-release 1.1.0，本机来源为 local_draft。不构建桌面、不升级 Core、不做手工三插件联合启动检查。尚未发布或验收客户端。
