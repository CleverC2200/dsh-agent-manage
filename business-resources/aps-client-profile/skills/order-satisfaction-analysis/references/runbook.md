# 复跑步骤与脚本职责

## 环境与边界

解压后根目录为 `order-satisfaction-analysis/`，入口是SKILL.md。脚本只用Node内置模块，建议Node 18或更高；合成自检不需要数据库、Python、Playwright或网络。真实取数由当前环境中已授权的MCP完成。包里不包含账号、Token、私有报告数据或本机绝对路径。

主提示词负责工具接入和知识库路由；本Skill负责指标映射、数据处理、模板绑定与验收。WeKnora中的说明用于确认定义；Cube/SQL来源用于读数。当前MCP没有SQL能力时，`query-plan.json`中的SQL仅用于表达取数意图，不能作为Cube query参数直接发送。先inspect语义模型，再把实际返回成员显式映射到物理字段语义；不能猜成员名。

## 从原始查询到报告

以下路径均为例子，任务目录由本次会话创建，不放进Skill自身目录。命令在Skill根目录执行。

```text
node scripts/self-check.cjs
node scripts/guided-report.cjs init <任务目录>
node scripts/make-query-plan.cjs <任务目录>/scope.json <任务目录>/query-plan.json
```

`scope.json`示例：`{"period":"2026-09","schema":"ai_db","scope":"全国月度范围","filters":{}}`。月份来自本次任务。用户指定组织范围时分别设置对应来源的可核验字段，例如 `filters.orders.region_code`；销售/生产不能凭名字相似自动套用同字段。把跨源范围对应关系记入work-order检查记录。禁止将某来源的全国值当选中组织值。

1. 读取 `source-to-report-map.md`，按知识库确认指标定义和单位。保存引用，不把历史50/50权重、ST单位解释或计划字段版本当作已批准现行规则。
2. inspect表/模型和字段，按query-plan查orders全量、sales销售口径、mapping基地口径、production、schedule。stock/transfer等按任务核查适用性；不以MES没匹配结束排程检查。
3. 保存每页完整返回和分页终止/同范围行数证据，文件不得互相覆盖。保留hasMore、offset、字段元数据、查询身份、刷新时间。能用 `query-evidence.cjs` 校对的工具返回按其协议检查。
4. 复制 `source-bundle.example.json` 为任务manifest。替换文件路径、rowsPath、实际字段映射、期间、模型、粒度、完整性计数引用和单位状态。例子不含业务数据，不能直接当作完成查询。
5. 执行以下准备和绑定检查。报错先修源范围/映射/字段，不能在HTML里补常量。

```text
node scripts/prepare-source-bundle.cjs <任务目录>/source-bundle.json <任务目录>/report-data.json
node scripts/audit-bindings.cjs <任务目录>/report-data.json <任务目录>/binding-audit.json
node scripts/guided-report.cjs packet <任务目录>/report-data.json <任务目录>
```

原始页已是旧报告契约时可直接沿用合规report-data；单一来源的通用扁平适配仍可用 `prepare-report-data.cjs`。本次跨订单/销售/映射/生产/排程的复跑优先使用 `prepare-source-bundle.cjs`，不再重写临时构造器。

6. 更新任务单各项实际状态、证据和绑定。分类使用orders的同一证据，但范围另记outqty>0；category对应mapping证据；schedule绑定 `scheduleSupplyRows`。`pending`是尚未执行，不能改成`empty_scope`蒙混过关；真正不支持需保留元数据/错误证据与停止理由。
7. 审阅分析卡，按全量问题写 `conclusion.sections`。至少清楚覆盖总体数量与分类边界、需求侧重点对象、生产执行/排程事实及机制、未解释部分、可执行核查行动；不限固定章节数，也不能只列“人员/设备”标签。排程无原因原文时不补标签。正文不受当前点击品类或Top10限制。
8. 生成前运行guided check；处理errors；有缺口则说明缺口。旧证据卡不能自动沿用到新输入。

```text
node scripts/guided-report.cjs check <任务目录>/report-data.json <任务目录>
node scripts/guided-report.cjs build <任务目录>/report-data.json <任务目录> <新输出目录>
```

`generate-report.cjs`是底层渲染器，不替代check/证据卡/综合结论。对新source-bundle输入它会检查binding-audit；只有结构通过仍不能宣称业务结论已验证。

## 脚本各自做什么

| 脚本/组件 | 输入 → 输出 | 使用时点 |
|---|---|---|
| make-query-plan.cjs | 期间/业务过滤 → SQL意图和COUNT查询清单 | inspect后检查字段与范围，再由MCP执行 |
| query-evidence.cjs | 完整工具返回 → 查询身份与分页审计 | 保存原始页后 |
| prepare-source-bundle.cjs | 原始页manifest → 全国指标、分类审计、跨表分组、需求/生产树、源行与排程数据 | 本次数据整理主入口 |
| prepare-report-data.cjs | 显式单源映射 → 旧报告契约树 | 兼容其他合规扁平数据，不与主入口重复累计 |
| supply-scope.js | 所选订单SKU集合＋排程记录 → 同范围分组/单位/匹配状态 | 所有品类/基地共用；无品类名称特判 |
| audit-bindings.cjs | report-data → 卡片/维度/SKU/源行勾稽和逐对象供给覆盖 | 准备后、生成前 |
| audit-report-data.cjs | report-data → 结构、证据与范围警告 | 生成器和guided自动调用 |
| guided-report.cjs | 任务单、数据、分析卡 → 检查/带证据交付 | 管理init/status/packet/check/build |
| business-conclusion.cjs | 全量事实与人工审阅卡 → 结论检查及兜底章节 | 综合分析；不能只用兜底代替模型分析 |
| generate-report.cjs | 报告契约＋模板 → HTML/Markdown/规范化JSON/构建哈希 | 统一渲染，不接数据库 |
| interactive-runtime.js | 选择状态 → 当前对象卡片/列表/供给来源 | 所有对象共用 |
| template-components.js | 当前对象数据 → 模板四卡/六卡、行内跨列面板 | 禁止在操作列嵌入长表 |
| production-reasons.js / production-reason-dictionary.js | MES理由原文 → 原因汇总/细分类/源行 | 有原文才打标；不编排程原因 |
| source-data-view.js | 全量源记录 → 筛选/排序/分页/导出 | 审计入口，不能替代业务下钻 |
| report-responsive.js / report-controls.js | 共享布局/控件行为 | 保持桌面、窄屏和下钻可见区域 |
| conclusion-report.js | 全量结论 → 第四模块 | 延迟渲染，不受当前选择影响 |
| self-check.cjs | 隔离合成数据 → 脚本/组件PASS或失败 | 打包后及运行前；不代表真实取数或视觉验收 |

开发版保留旧回归与模板同步工具；运行版不携带历史报告、临时取数脚本和不再使用的plan-order-components。新的运行脚本及其依赖自动进入打包清单，`runtime-package.json`保存哈希。

## 运行后验收

按 `acceptance-checklist.md` 逐项检查。当前环境无法使用浏览器时，保留 `visualBrowser:NOT_RUN` 和待人工验证路径，不写“浏览器通过”。工具拒绝某页面访问后不使用其他方式绕过。交付HTML、Markdown、JSON、原始查询证据、binding-audit、acceptance和构建清单；目标环境是否实跑单独记录。

## 取数通道、落盘与常见返工（2026-10 补丁）

以下六条来自 2026 年 9 月全量复跑的实测耗时，目的是把可避免的返工前置掉。

### 1. 大结果一律走"转存 + 脚本提取"，不要逐行进上下文

`query_business_data` 在结果较大时会把完整返回写入临时文件并在响应里提示 `Full formatted result stored at: <路径>`。该文件是完整 JSON，可直接解析，**不要**手工抄写、也不要为了"少一点"而缩小 `limit` 后当成全量。

固定做法：

```text
node scripts/ingest-mcp-result.cjs <返回JSON或转存文件> --list          # 看数据集名、行数、totalRowCount、hasMorePages、告警
node scripts/ingest-mcp-result.cjs <返回JSON> <数据集名> <输出文件> <字段映射.json> --period 2026-09
```

- 脚本会打印行数、源分页元数据、数值合计与 sha256，可直接写进任务单 `bindings` 与 `checks`。
- `hasMorePages=true` 时脚本默认拒绝落盘（历史上曾把 Top30 当全量）；确需部分数据时显式加 `--allow-partial` 并把任务标为 `partial`。
- 字段映射缺失会直接报错并列出缺的成员，避免用未查字段填空。

### 2. 先探粒度，再取数

取大页前先用 `limit:1` + `total:true` 取目标维度组合的 `totalRowCount`，确认要取多少组、是否需要拆页。这一步通常 10 秒内完成，可避免取错粒度后重取。

### 3. 业务粒度只用编码维度，名称仅作显示

同一物料编码可能因名称变体被拆成多组（9 月实测：编码维度 13,462 组，加入物料名称后 14,634 组）。因此：

- `uniqueGrain` 与 `grain` 一律按编码维度声明（基地、大区编码、省区编码、物料编码）；
- 名称字段只用于展示，不进入唯一粒度；
- 需要名称时单独取一次映射或用 `material_name` 但不参与分组。

### 4. 已知冲突分支按最小取证，不必全粒度重取

`2026-09-source-reconciliation.md` 已记录源分类字段与发布缺货量纲不勾稽（约 831 倍）。这类**已知冲突**分支的正确取证是：

1. 全国级取 1 行源分类值留证；
2. 正缺货源行（`outqty>0`）按业务粒度逐组复算两类参考；
3. 在 `classificationAudit` 记录源值、复算值、缺值与未覆盖差额。

不需要把源分类字段按全粒度再拉一遍。

### 5. `packet` 不会静默覆盖已有证据卡

`guided-report.cjs packet` 在 `analysis-cards.json` 已存在时会保留原文件（保护审阅结果），并把新包写到 `analysis-cards.new.json`，同时输出 `existingCardsFingerprint: MATCH|STALE`：

- `STALE` 表示 report-data 已变更，现有审阅结论失效；
- 处理：确认后删除 `analysis-cards.json`，或加 `--force` 重置，然后重新审阅。

### 6. 校验器的隐性约定（曾导致多轮返工）

- `work-order.json` 与证据卡中的 `querySummary`、`boundary`、`interpretation`、`action`、`acceptance` **不要包含“汇总”“全部…SKU”等字样**：`present()` 会把它们判定为占位表述并报“未填写”。
- 任务状态不能留 `pending`（会被判为“尚未判断适用性”）；未执行但已判断不适用的分支用 `unsupported` 并写停止理由与恢复条件。
- `build` 已改为进程内渲染（不再起子进程）；若沙箱仍禁止子进程，错误信息会直接给出等价命令序列。
- `self-check.cjs` 在受限沙箱下会把子进程检查标为 `SKIPPED_SANDBOX`，其余检查照常执行，不再整体失败。

### 7. 渲染体积

`report-data.normalized.json` 默认写紧凑 JSON（此前美化缩进会多写约一倍体积）。需要人工阅读时用 `REPORT_JSON_PRETTY=1`。HTML 体积由明细数据量决定：若单份 HTML 超过约 30MB，应在交付说明中提示打开耗时，并以 Markdown 作为主要阅读格式，不要用"减少明细"来换体积。
