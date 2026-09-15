# Agent Note: 无需 Git 刷新私有公司套件

Status: implemented

## 问题

桌面交付需要刷新私有公司套件，不能依赖开发机 Git，也不能将凭据写进来源 URL。

## 决定

将 GitHub API zipball 地址作为显式 archive 来源。获取层从运行环境读取当前用户的 `DSH_AGENT_MANAGE_GITHUB_TOKEN`，仅交给首次 HTTPS GitHub API 请求；重定向不携带 Authorization。令牌不进入来源状态、清单或压缩包。ZIP 使用现有进程内解压、容量与路径检查。刷新失败时，现有原子目录替换机制保留上一份可用内容。

## 考虑过的替代方案

内置 Git 或使用开发者 checkout 会增加运行依赖并混淆目录所有权。把令牌放进 URL 会持久化凭据。公司桌面路径不采用这两者，普通 Git 与本地来源功能保留。

## 影响

管理员在业务界面之外配置各用户的读取授权。缺少授权会报告下载错误，不删除已安装内容。来源压缩包摘要标识资源内容，与 Agent Manage 运行时版本分别记录。安装套件不构成角色安全隔离。

本决定扩展[来源获取](2026-09-01-source-acquisition-expansion.zh.md)，不替代其中的所有权与解压决策。已核对现有来源获取与 GEA MCP 活跃说明，没有冲突决定。
