<!-- collaboration-record
{
  "kind": "change",
  "id": "CHANGE-20261028-customer-plan-upload-manage",
  "date": "2026-10-28",
  "title": "客户库存计划表 Agent 规则发行升版",
  "module": "插件发行",
  "status": "准备中"
}
-->

# 客户库存计划表 Agent 规则发行准备

将已合并的 #95 纳入新发行版本 0.6.3-company.34，避免覆盖已经发布的 0.6.3-company.33。仅修改版本及对应生成标识，不改变业务实现、权限、会话或用户数据，无删除或历史修复回退。本轮使用用户提供的 dsh-plugin-release 1.0.0 分发包；没有登记新的团队 Skill 维护源，不声明团队同步完成。

版本经 PR 合入 main 后才能固定源码构建，执行三包交付、发布预检及固定 OSS 对象上传。当前仅授权完成包上传，不推进频道；签名配置缺失，客户端检查更新和设备安装仍待验证。不构建桌面客户端，不升级 Core，不向 GitLab 或 npm 发布。当前尚未上传。
