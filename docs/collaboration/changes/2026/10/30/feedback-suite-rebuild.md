<!-- collaboration-record
{"kind":"change","id":"CHANGE-20261030-feedback-suite-rebuild","date":"2026-10-30","title":"反馈修复整组发行重建","module":"构建发布","status":"待发布"}
-->

# Manage发行重建

当前main业务逻辑保持不变。配合Workbench和GEA反馈修复重建客户端时，Manage客户端CSS模块标识随构建路径改变，归档字节与已发布company.38不同，因此升为company.39，不覆盖旧包。

沿固定Core、原锁和既有生产打包协议完成构建与整组兼容核验。包版本生成器及实际编译检查先执行；最终候选CI、三包交付、频道下载及客户端安装验证分别留证。没有新增计算规则、资源能力或数据迁移。
