<!-- collaboration-record
{
  "kind": "change",
  "id": "CHANGE-20261112-mps-release",
  "date": "2026-11-12",
  "title": "MPS修复与提速插件发行 0.6.3-company.65",
  "module": "主生产计划(MPS)",
  "status": "已发布待验收"
}
-->

# MPS 修复与提速发行

整合已验收的 MPS 需求推导、库存目标、合法中转路径与 ODM 默认到货计算。调拨和件吨查询建立索引，减少重复扫描，未知输入继续保留待补。

- 对比基线：`7d44bb8956036efb22254b7d7f791fb1dd6306d4`，目标版本 `0.6.3-company.65`。
- 已整合当前 GitHub 主线，保留主线新增的菜单、更新与业务资源修复；本轮未发现候选删除文件或有意取消旧修复。
- 验证：本轮93项 MPS 计算测试通过；开发窗口结果与同一实际输入的计算回放一致。
- 发布技能：本机 dsh-plugin-release 1.3.1，local_draft，未声明为团队同步版本。
- 发布状态：已发布至测试、正式插件频道；GitHub Release 已发布并读回。原源码标签与归档保持固定。
- 业务边界：本轮不补造源数据，不将未知数量改成0；源码、构建、安装接收与完整排产验收分别记录。

## 2026-11-12 发行回填

- 修复版本与固定来源：`0.6.3-company.65`，`f8c9450eff964e7f2201d6a49b25e6c0b50b06eb`。
- [GitHub Release](https://github.com/CleverC2200/dsh-agent-manage/releases/tag/v0.6.3-company.65)，包含 TGZ、release JSON 的固定下载地址、大小与摘要。
- 合并后 [主线 CI](https://github.com/CleverC2200/dsh-agent-manage/actions/runs/43141483710) 通过；本轮三包正式构建、发布预检、官方隔离安装与 Host/client 入口图观察通过。
- 测试频道 revision 108→109，正式频道 revision 100→101，均通过生产 reader 的 check 与三包匿名 download 校验。
- 归档 SHA-256：`0898fcaaf44149b293bf9c0c789446f273729f69ed42fa1d8b0deb4a4c08a527`。
- 本轮未构建桌面安装包，未升级用户正式设备。MPS 真实取数与提速验收复用本轮授权开发 profile 证据；源数据待补仍输出异常，完整排产未验收。
