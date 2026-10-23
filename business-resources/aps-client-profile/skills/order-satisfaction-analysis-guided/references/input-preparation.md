# 输入准备与执行效率

用于首次接入、模型变化或数据集适配，不要求每次从零编写取数脚本。分析选择仍由本期问题决定，生成器不会替模型撰写根因。

## 先确认可用输入

- 先核对本轮模型、成员、范围、单位及分页机制，保留查询结果文件。已核验且未变更的信息可复用，不机械重复inspect。知识库返回COMPLETED但答案是输出上限/错误且无有效内容时，不算取得口径；缩小问题后仍无结果则说明限制，其他独立分析继续。
- 为计划分析保留足够的事实粒度：生产需要时保留日期、基地、SKU、理由及可用产线/生产单。只有月度聚合时按月描述，不能再推断发生天数或伪造日记录。并非所有任务都要取得全部事件字段。
- 品类映射需核验，缺失保持待映射节点；基地直接下接SKU时不能仍标成基地×品类。销售的初始、纠偏独立，准确率采用正式非加性规则，不平均SKU比例，也不借缺货订单子集补公式。
- 跨期对照记录双方期间；某个入口没返回不等于整个企业无数据。不能拿另一个月份或另一口径填本期指标。

## 复用适配器

已有合规report-data.json可直接使用。对于扁平查询结果，可用`prepare-report-data.cjs`完成分页文件合并、显式字段映射和层级组装；不替代元数据核验，也不查询系统。

```text
node scripts/prepare-report-data.cjs <适配清单.json> <新的report-data.json>
```

清单提供`report`骨架（scope、metric等）或`template`骨架文件；`datasets`每项包括：

- `kind`：production或demand；需求另设`view`为base或category。
- `files`：查询结果页路径；`rowsPath`：页内记录数组路径，不填表示文件本身为数组。
- `fields`：报告字段到已核验源字段的映射，例如`{"base":"factory_name","category":"category_name","sku":"material_code","date":"production_date","line":"line_code","order":"order_no","reason":"deviation_reason","planned":"plan_qty","actual":"actual_qty","gap":"published_gap"}`。字段名仅为接口示例，不能当作真实Cube成员。
- `grain`：映射后的唯一粒度字段数组，如base、date、sku、order、line、reason；与实际查询粒度匹配，重复页会报错，不能用丢行去重掩盖。
- `unit:"件"`、`additive:true`：仅在数量单位和可加性核验后声明；未知数值保留null。准确率不在本适配器聚合，继续用正式查询与salesReporting绑定。
- `complete`：分页完整性已验证才填true；`id, model, period, retrievedAt`记录来源。缺失维度不自动填父级或按比例分配。
- 生产默认汇总提供的gap；仅明确确认需要净差复核时设置`gapAggregation:"net-positive-v1"`，生成各层非负净差。原始记录的gap不另行推导，分组正差与净差分别表达。不能用此参数替代正式指标定义。
- 可选`categoryMap`为SKU→品类映射，须同时声明`categoryMapVerified:true`。同目标的多页放在同一files数组，避免覆盖。

适配后标`analysisReview=REVIEW_REQUIRED`，表示事实更新后需审阅正文，而不是缺少自动生成的“标准原因”。模型审阅本期conclusion后可将其状态更新为REVIEWED，记录依据；不因为测试通过就自动标已审阅。

## 环境与分层验收

任务开始时可运行`report-environment.cjs`检查Node与jsdom；优先调用宿主的依赖发现工具并设置已有模块绝对路径。检测支持DOM_TEST_MODULE、工作目录.report-environment.json、工作目录与NODE_PATH。依赖不可用时记录DOM未执行，不在业务任务中循环安装/修链。

```text
node scripts/report-environment.cjs <工作目录/.report-environment.json>
node scripts/audit-report-data.cjs <report-data.json> <审计输出.json>
node scripts/generate-report.cjs <report-data.json> <输出目录>
```

生成器附带data-contract-audit.json与build-manifest.json，分别说明输入结构/覆盖风险和实际源码哈希。结构错误默认停止生成；需要保留问题供评审时显式scope.draft=true，页面标为草稿，不能作为正式通过。普通缺数/粒度不足标待复核，不一律停止其他分析。

开发版另运行专项回归；测试分别报告算法fixture、结构/交互、数据契约和人工业务复核，浏览器验收另记。生成器不按章节数量、固定对象或原因词汇给“分析深度”打分。业务复核看结论是否与本期数据、期间、粒度及证据状态一致。
