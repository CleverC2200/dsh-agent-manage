<!-- collaboration-record
{
  "kind": "change",
  "id": "CHANGE-20261105-ontime-suite-dsh-agent-manage",
  "date": "2026-11-05",
  "title": "配套三插件发行版本",
  "module": "插件发布",
  "status": "待发布"
}
-->

# 配套三插件发行版本

本次只更新发行版本，无新增业务逻辑。

版本 0.6.3-company.53 → 0.6.3-company.54；基线 98abae0f7abdedc0308d246aea38a4897787e05e。版本生成器及受影响单测、GitHub Required CI、固定主线构建和发布预检分别留证。未删除既有能力或缩小已有兼容范围；未发现需新增的缺陷记录。本记录为发版准备，尚未上传频道、验证安装或发布 GitHub Release。

采用用户分发的 dsh-plugin-release 1.3.0，已按安装包清单校验全部 24 个文件；未登记团队维护源，不声明团队技能已同步。发行目标为已登记 GitHub 仓库及 synear-gea 的 test/stable 插件频道；不构建桌面客户端。
