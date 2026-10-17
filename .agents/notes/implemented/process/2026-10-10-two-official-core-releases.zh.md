# Agent Note: 两版已登记的官方 Core

Status: implemented

## Problem

普通安装必须让同一份 Manage tarball 同时用于已登记的官方 rc.2 和 alpha.1。仅放宽 peer 不能证明资源、默认选择、完整预设或浏览器行为。

## Decision

DSH 运行 peer 精确接受 `0.2.0-rc.2 || 0.2.1-alpha.1`。Cordis、Schemastery 和 Include 精确接受这两版 Core manifest 声明的版本。开发依赖路径保持单一 SDK 布局。干净 CI 在消费者安装前准备显式选择的登记 Core；GEA supported-Core 登记表持有受支持 head、原锁哈希和工具链。[干净 CI](../../../../docs/clean-ci.md) 记录共享 SDK 接口及分开的质量、安全结果。

Manage 质量阶段要求 SDK 模块准备并核验真实宿主 flock，用于官方 Session writer lock。归档和审计保留各自较窄的输入要求。原预测 Session 测试在独立临时目录安装已跟踪的完整销售套件，并核对固定源哈希，不依赖 runner checkout 外的仓库。Skill 路径断言区分已安装原始源与包内 provider。

CI 使用 host 构建的类型校验，避免对相同 host 项目再做一次无输出编译。client 打包不校验类型，因此 CI 单独检查该项目。构建前的版本戳校验防止生成器掩盖过期源码。独立检查保持完整，命令合同见[干净 CI](../../../../docs/clean-ci.md#gates-and-receipts--门禁与回执)。

资源与 Skill 发布使用两版共同的 registry 和 provider 接口。Standard 组合读取当前 Host 的 `readDocument('standard')`，包括禁用行和用户配置，不移植另一版的声明。生产路径不增加版本分支或复制的 SDK。

`DSH_CORE_CHECKOUT` 为既有能力验证 lane 选择官方输入。Host fixture 和静态 SDK 导入解析同一批公开 exports；浏览器 lane 读取该 Core 的源码映射，并将既有相对官方源码引用导向同一 Core。Native Loader 与真实 Session 继续执行，本地 completion 和受控业务 adapter 保持原有离线范围。

本决定部分替代[唯一登记的官方 SDK](2026-10-04-one-official-sdk.zh.md)中的单版运行 peer 决定。其单一所选开发 SDK 布局、现行 exports、已移除的 client-runtime metadata 和既有 module 归属保持。

浏览器 fixture 使用官方 `createConversationStore`，并挂载所选 `DefaultConversationViews`。共用的字符串草稿输入符合 rc.2 的已声明持久化格式，真实挂载负责 rc.2 的草稿恢复和两版持久化。准备期间的用户打字调用真实输入的 `setDraft`，冲突与取消仍验证常驻输入状态。测试保留各官方 Host 自己的开发工具可见性和时间上下文声明，不要求 rc.2 提供 alpha 独有行为。

## Alternatives considered

**只放宽 peer，不执行两版官方输入。** 这样会接受包，却不能证明要求的行为。

**增加版本分支或将 SDK 复制到 Manage。** 当前消费的资源与预设接口已在两版共用。额外运行状态和第二个 SDK 实例会削弱现有职责归属。

**删除完整的独立类型检查。** 本地检查必须能在构建前独立运行。去重由现有 CI 编排承担，无须可复用通过凭证或跳过开关。

## Consequences

完整能力检查分别对每个所选 Core 执行，保留该 Host 的 standard 工具、命令、压缩、裁剪和子 Agent 行为。源码和离线检查不证明普通 PluginManager 安装、Native、外部业务或模型执行。交付接收负责同一 tarball 在两版全新空 profile 中的实际观察。
