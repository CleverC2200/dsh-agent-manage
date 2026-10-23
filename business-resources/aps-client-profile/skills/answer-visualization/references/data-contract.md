# ANSWER_DATA 数据契约

## 顶层结构

输入必须是 UTF-8 JSON 对象：

```json
{
  "meta": {},
  "summary": {},
  "kpis": [],
  "sections": [],
  "evidence": [],
  "actions": []
}
```

## 基本字段

### `meta`

必填字段：

- `title`：回答标题；
- `question`：用户原问题或准确转述；
- `scope`：组织、客户、品类或其他分析范围；
- `period`：统计期间；
- `cutoff`：数据截止时间；
- `mode`：如“快速查询”或“深度分析”；
- `version`：数据或回答版本；
- `dataState`：数据状态。正式数据已核实时可留空；有缺口时写清限制。

### `summary`

```json
{
  "status": "severe",
  "headline": "一句核心结论",
  "text": "结论解释和当前证据边界",
  "signals": [
    {"label": "最大风险", "value": "对象名称", "note": "补充说明"}
  ]
}
```

`signals` 建议 1–3 条。`status` 可用 `healthy`、`warning`、`severe`、`info`。

### `kpis`

```json
{
  "label": "订单满足率",
  "value": "92.86%",
  "target": "目标 ≥95%",
  "delta": "较上周 -1.24 pct",
  "status": "severe",
  "achievement": "未达",
  "risk": "严重"
}
```

- `achievement` 只使用 `达标`、`未达`、`无目标`。
- `risk` 只使用 `健康`、`预警`、`严重`。
- 两者含义不同，必须分别判断。

## `sections` 通用字段

```json
{
  "id": "comparison",
  "type": "bar",
  "layout": "full",
  "collapsed": false,
  "title": "基地满足率对比",
  "kicker": "主图 · 对象比较",
  "unit": "%",
  "insight": "西南基地为最低对象。",
  "data": {}
}
```

- `id`：页面内唯一的英文标识；
- `layout`：`full` 或 `half`；
- `collapsed`：明细或补充分析可设为 `true`；
- `unit`：必须与数据实际单位一致；
- `insight`：只写当前数据支持的读图结论。

## 图表数据结构

### 横向柱状图 `bar`

```json
{
  "labels": ["华东", "西南"],
  "values": [96.42, 88.91],
  "statuses": ["healthy", "severe"]
}
```

`statuses` 可省略；提供后会同时显示风险状态文字和浅色柱形。

### 折线图 `line`

```json
{
  "labels": ["W40", "W41"],
  "series": [
    {"name": "全国", "color": "#ed999e", "values": [94.1, 92.86]},
    {"name": "目标", "color": "#c9ced7", "values": [95, 95]}
  ]
}
```

缺失点使用 `null`，不得补造。主趋势线和参考线使用可视化规范中的浅色。

### 堆叠柱状图 `stacked`

```json
{
  "labels": ["华东", "西南"],
  "series": [
    {"name": "水饺", "color": "#f4cdcf", "values": [0.4, 2.9]},
    {"name": "其他", "color": "#d9dde3", "values": [0.5, 1.9]}
  ]
}
```

系列必须单位一致；各部分能够与总量勾稽。

### 热力图 `heatmap`

```json
{
  "columns": ["水饺", "汤圆"],
  "rows": [
    {"label": "华东", "cells": ["healthy", "warning"]},
    {"label": "西南", "cells": ["severe", "warning"]}
  ]
}
```

状态只使用 `healthy`、`warning`、`severe`、`info`。

### 散点图 `scatter`

```json
{
  "xLabel": "可发货天数（天）",
  "yLabel": "满足率（%）",
  "points": [
    {"label": "华东", "x": 9.1, "y": 96.42, "status": "healthy"}
  ]
}
```

散点关系不能直接表述为因果关系。

### 瀑布图 `waterfall`

```json
{
  "startLabel": "上周",
  "start": 94.1,
  "items": [
    {"label": "需求变化", "delta": -0.42}
  ],
  "endLabel": "本周",
  "end": 93.68
}
```

仅用于可以相加且互斥的贡献项，并检查起点、增减项和终点勾稽。

### 表格 `table`

```json
{
  "columns": [
    {"key": "object", "label": "对象"},
    {"key": "value", "label": "数值", "align": "num"}
  ],
  "rows": [
    {"object": "西南基地", "value": "88.91%"}
  ]
}
```

需要精确查数、字段较多或文本较长时使用表格，并通常设置 `collapsed: true`。

## 证据与建议

`evidence`：

```json
{"source": "Cube", "status": "info", "text": "已取得的数据", "limit": "当前限制"}
```

`actions`：

```json
{"owner": "计划管理", "status": "warning", "text": "建议动作", "meta": "触发条件或证据要求"}
```

待验证原因只能形成核查建议；没有真实执行回执时，不得把建议写成已完成动作。

