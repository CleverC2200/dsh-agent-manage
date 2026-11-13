# Manage 当前开发

已有任务先核自己的冻结输入、实际 HEAD 与未提交改动；新任务以登记 GitHub 仓库当前 main 建立自有源码输入。根同名历史克隆和稳定运行环境都不代表最新主线。

工具链、scripts、exports、依赖和锁以 [package.json](../package.json)、[pnpm-lock.yaml](../pnpm-lock.yaml) 和配置为准。本机准备、影响计划与构建复用读相邻 GEA 的[开发构建入口](../../dsh-gea-plugin/docs/development-builds.md)。修改前直接定位所属源码与已有测试。

| 功能                  | 源码入口                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 发现、格式与来源      | [catalog](../src/catalog/)                                                                                             |
| 目录编排              | [application](../src/application/)                                                                                     |
| 资源挂载、选用与释放  | [runtime](../src/runtime/)                                                                                             |
| 客户端                | [client](../src/client/)                                                                                               |
| 库存、APS、MPS 纯计算 | [inventory-compute](../src/inventory-compute/)、[aps-compute](../src/aps-compute/)、[mps-compute](../src/mps-compute/) |

`check:comments` 默认检查全仓自有 JS/TS、HTML/SVG 及内嵌脚本和样式、CSS、JSONC、YAML、Python、Shell、PowerShell、NSIS、SQL、Java、TOML、CMD 与行式配置；工作流的 Shell/PowerShell `run` 脚本一并检查。字符串、Prompt、Python docstring 和 heredoc 数据保留。解析失败拒绝通过；Shell 等格式使用固定版本词法器，不代表执行验收。`--base <完整提交>` 或显式文件只用于局部反馈，CI 和静态门禁默认执行全仓检查。`source-comments.json` 登记第三方、生成物、fixture 与历史证据来源；收到的业务原件复用现有 `SOURCE.json` 文件清单与摘要核对，已改写的资源继续按自有源码检查；`--report <路径>` 输出完整排除与违规清单。工具指令先消除依赖，许可证按分发要求保全。

Workbench 不在同级时，`DSH_WORKBENCH_CHECKOUT` 指向本票登记的只读工具源码。普通静态检查不需要启动客户端；只有本次验收涉及 SDK、安装或运行时，才按[干净 CI](clean-ci.md)与现有输入协议准备。当前 Core 范围由 GEA 的 `scripts/ci-core-policy.json` 与支持清单负责，历史 Note 的版本不作为配置。

代码、配置与行为测试持有实现规则；仅在判断某项代码无法表达的取舍时查对应决定。旧日期报告及[历史资料](historical-material.md)只用于追溯，不作为当前命令、权限或验收结论。

## Remaining acceptance and documentation scope / 未完成验收与文档范围

[Native resource selection](guides/native-resources.md) and [中文](guides/native-resources.zh.md) own the user and API contract. Package exports and source declarations show capabilities; they do not prove installed reception, current identity, row grants or production data. Dealer, Personal and company full-chain source have governed-read declarations; their original live/interface/data/Native acceptance remains open. The company full-chain proposed Note retains the missing raw-capture manifest boundary and customer/model gates. / 原生资源说明持有用户与 API 合同。导出与源码声明不证明安装接收、当前身份、行权限或正式数据。经销商、个人与公司全链源码已有受控读取声明，原真实接口、数据和 Native 条件仍未关闭；公司全链 proposed Note 保留原 raw capture 未进入旧 manifest 的缺口，以及客户与模型边界。

[Historical material](historical-material.md) classifies old design plans, release/research/promotion records and original ADR observations. They remain available for rationale and failed evidence; current actions follow the linked owner and task registration. / 历史导航分类旧设计计划、发行/研究/推广记录与原 ADR 观察，保留理由与失败证据，当前操作沿对应 owner 和本票登记。

The company full-chain `capability.json` routing summary still mentions customer inventory, while its rules, tables and `SOURCE.json` limit the current resource to company reads. Follow that explicit boundary; the business declaration needs a separate source correction. / 公司全链 capability.json 的路由摘要仍含客户库存，但 rules、tables 与 SOURCE.json 明确仅公司读取。按明确边界处理，业务声明须在后续源码任务校正。

The forecast [original ontology](../business-resources/sinian-demand-forecast/references/sales-ontology-v2.md) remains pending business review. Its [forecast conflict register](../business-resources/sinian-demand-forecast/references/rules-and-conflicts.md) and [input contract](../business-resources/sinian-demand-forecast/references/data-contract.md) preserve the month, candidate, seasonal and price gaps. They do not resolve every planning rule: section 1.7 warehouse subgroup counts differ from their listed members, section 3.14 leaves exact 33/103-day thresholds unclassified, and section 5.7 retains 70%/56% product-structure alternatives. Confirm the applicable source/master data and rule before using those branches; do not infer units, granted fields, live interfaces or execution authority from the ontology's system-routing descriptions.

预测原字典仍待业务审核；预测冲突表和输入合同保留月份、候选、节令与价格缺口，并未裁决全部计划规则。第1.7节仓库分组数量与列举成员不齐，第3.14节的33/103天边界未分类，第5.7节保留产品结构70%/56%两套口径。使用相关分支前确认适用来源、主数据与规则，不从字典系统路由推单位、获准字段、实时接口或执行授权。
