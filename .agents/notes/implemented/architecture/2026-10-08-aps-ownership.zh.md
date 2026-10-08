# Agent Note: APS计算与分析归属

Status: implemented

## Problem

原APS候选把业务计算放在Workbench，并在GEA保存分析Skill。直接接收会继续维持重复归属。

## Decision

Manage通过`aps-compute/*`公开导出维护原纯计算，原分析Skill在`business-resources/aps-analysis`只有一份来源。Workbench消费该导出，呈现原PC页面并持有当前范围的界面状态。GEA持有身份与受控执行。选用时先校验capability的显式Skill、Consumer引用与所属prompt一致，再挂载。引用不授予业务权限。

## Alternatives considered

**整树恢复旧候选。** 这会覆盖当前46接口并保留过时归属，因此只取固定来源中必要源码。

**计算与Skill仍由旧owner保存。** 同一规则会继续有多个维护者。页面改用公开Manage模块，GEA删除重复分析provider。

## Consequences

原八个计算与维度模块的规范化运行时AST保持一致。原50个字面预期用例正文不变，并消费公开导出。类型标注及原未用变量按当前Manage标准调整。模拟接收必须显式编译，未装载SQL能力并保留缺失值。实际Native与业务授权属于后续独立验收。本checkout没有现存APS归属note；17历史note仍保留在固定来源证据中。
