# 产销协同客户端自定义资源 / APS client customization

2026-10-23 从运行客户端 `gea-html-inventory-apsplan` 的当前自定义配置接收。 `prompt.md` 保存实际生效的自定义提示词；`profile.json` 保存 Skill 引用及启停状态。按用户确认移除 4 个停用 Skill，仅保留 3 个启用 Skill 的完整目录。 `SOURCE.json` 记录逐文件 SHA256，Skill 正文、模板、引用及脚本保留接收字节。

这是客户端自定义资源的可迁移快照，不是新的运行时配置格式，也不会自动覆盖已发布默认提示词、挂载 Skill 或修改用户会话。恢复时通过现有 Agent/Skill 导入编辑功能使用这些目录，并按 `profile.json` 恢复提示词和启停状态。不复制客户端绝对路径、目录 UUID、登录凭据、历史会话或其他历史版本。默认资源继续由 `../inventory-apsplan` 与 `../aps-analysis` 维护；主线较新的业务口径修订没有被客户端旧副本覆盖。

Captured from the active APS business-resource customization on 2026-10-23. This portable snapshot preserves the prompt and the three enabled Skill directories after removal of the four disabled Skills at the user's request. It is not an automatically mounted preset or a new runtime configuration schema. Restore through the existing Agent/Skill import and edit flow, using `profile.json` for the original enabled states. The source manifest verifies every received asset; no credentials, machine-specific storage identities or conversation history are included. Repository defaults remain independently maintained and retain their newer business-rule changes.

## 验证边界与已知问题

文件清单、逐文件 SHA256 和 3 个 Skill 的启用状态已校验。 `order-satisfaction-analysis/scripts/self-check.cjs` 的语法检查通过，但两个合成数据自检失败：`Supply.reference is not a function`。这是接收时客户端原版本已有的问题，本快照保留原始字节，不将资源同步视为运行验收。本次未运行真实 Cube/知识库查询、浏览器报告验收或客户端业务回放。
