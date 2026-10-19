---
name: prototype-html
display_name: 交互式HTML原型生成
display_name_en: Interactive HTML Prototype Generator
description: >
  生成交互式HTML产品原型的专家技能。通常承接 requirement-analysis 技能的需求分析结果，
  将分析结论转化为可交互的HTML原型页面。当用户需要创建产品原型、UI界面原型、
  可交互的HTML演示页面、产品功能展示页面，或提到"原型"、"prototype"、
  "产品界面"、"UI原型"、"交互原型"、"演示页面"等时使用。
description_zh: 生成交互式HTML产品原型的专家技能。通常承接 requirement-analysis 技能的需求分析结果，将分析结论转化为可交互的HTML原型页面。当用户需要创建产品原型、UI界面原型、可交互的HTML演示页面、产品功能展示页面时使用。
description_en: Expert skill for generating interactive HTML product prototypes. Usually consumes the output of the requirement-analysis skill and turns the analysis into interactive HTML prototype pages. Use when the user needs to create product prototypes, UI prototypes, interactive HTML demos, or feature showcase pages.
version: 1.0.0
---

# 交互式HTML产品原型生成

根据用户要求结合AI助手输出的结果，生成完整的、可直接运行的单文件HTML产品原型。

## 核心工作流程

### 第一步：接收需求输入

优先从当前对话上下文中获取需求分析结果（如已完成 requirement-analysis 的分析），也可接收用户直接提供的需求描述、PRD文档或功能清单。确认输入内容包含足够的页面结构和功能细节信息。

### 第二步：拆解原型页面清单

根据需求输入，分析并列出需要设计的所有原型页面，每个页面需标注：
- 页面名称
- 核心功能点（2-4个关键交互）
- 建议的布局模式（参见下方"布局模式"章节）
- 页面间的导航关系

以编号列表的形式呈现给用户，等待确认。

### 第三步：用户确认页面清单

将拆解结果展示给用户，确认：
- 是否有遗漏的页面
- 是否有需要合并或拆分的页面
- 优先级顺序（先设计哪个页面）

**必须等用户确认后才进入设计阶段。**

### 第四步：逐页设计原型

按用户确认的顺序，逐个页面进行设计。每个页面：
1. 规划界面元素与右侧说明文档的对应关系
2. 选择2-4个最重要的元素建立连线标注
3. 生成完整的单文件HTML代码
4. 将HTML文件输出供用户预览
5. 如用户有修改意见，即时调整后重新输出

### 第五步：整体验证

所有页面设计完成后，检查：
- 页面间的导航链接是否正确
- 所有连线位置是否准确
- 交互效果是否完整
- 响应式在不同屏幕尺寸下是否正常

## 布局模式

根据页面类型选择合适的布局模式：

**模式A：左右分栏布局（默认）**
适用于大多数B端后台管理页面、功能操作类页面。左侧展示产品界面，右侧展示功能说明，通过SVG连线关联。具体比例和连线规则见下方"布局规范"。

**模式B：全宽布局**
适用于数据可视化大屏、仪表盘总览等需要全屏展示的内容。不显示右侧说明区，改为在关键数据区域添加浮动标注气泡（tooltip风格），悬停时展开说明。

**模式C：上下分栏布局**
适用于移动端H5页面、流程向导类页面。上方为操作区，下方为说明区，无需连线，改用编号锚点对应。

当用户未指定布局模式时，默认使用模式A。如果需求中包含大屏展示或纯移动端场景，应主动建议使用对应模式并告知用户。

## 布局规范（严格执行）

### 整体结构

- **左右分栏布局**
  - 左侧：占页面宽度的80%-85%，展示产品主体界面内容
  - 右侧：占页面宽度的15%-20%，展示对应功能的详细说明文档
- **分隔线**：左右两栏之间有清晰的垂直分隔线
- **滚动同步**：左右两栏各自独立滚动，互不影响

### 连线功能（必须严格执行）

使用SVG技术绘制连线，确保连线清晰可见且不遮挡内容。

**连线规则：**
- 选择左侧界面中2-4个重要元素增加连线指向右侧对应的功能说明
- 连线的**起始点**必须精确连接到左侧元素的右侧边缘中点
- 连线的**结束点**必须精确连接到右侧对应说明文字的左侧边缘中点
- 连线采用平滑的贝塞尔曲线，避免生硬的直角转弯
- 连线线条粗细为 2px

**交互效果：**
- 当鼠标悬停在左侧元素上时，对应的连线加粗并高亮显示
- 当鼠标悬停在右侧说明文字上时，对应的连线和左侧元素也会高亮显示

**连线标注：**
- 每条连线旁边添加小的数字编号，与右侧说明的编号对应

## 响应式设计规范

### PC端
- 保持上述左右分栏布局

### 手机端
- 自动切换为上下布局
- 上方展示产品主体界面，下方展示功能说明
- 连线功能自动隐藏
- 在每个元素下方直接显示简短说明
- 提供"切换视图"按钮，允许用户在"仅界面"和"界面+说明"之间切换

## 技术栈要求

1. **纯前端实现**：使用纯HTML、CSS和原生JavaScript，不依赖任何外部框架
2. **样式**：使用Tailwind CSS v3，通过CDN引入
3. **图标**：使用Font Awesome图标库，通过CDN引入
4. **代码结构**：
   - HTML结构语义化，使用适当的标签
   - CSS样式内联在`<style>`标签中
   - JavaScript代码内联在`<script>`标签中
   - 所有代码整合在一个HTML文件中，无需外部资源

## 样式与视觉规范

### 配色方案
- 如果用户指定了色系则用用户指定的色系，否则用下面默认的色系
- **主色调**：蓝色 `#165DFF`
- **辅助色**：浅灰色 `#F5F7FA`、深灰色 `#333333`
- **强调色**：绿色 `#00B42A`（成功状态）、红色 `#F53F3F`（错误状态）

### 其他样式要求
- 右侧的功能说明区要用琥珀色系，跟左侧内容区区分开！
- **字体**：系统默认无衬线字体
- **间距**：以 8px 为基本单位，保持一致的间距系统
- **阴影**：适当使用轻微阴影增强层次感
- **整体风格**：简洁、现代、专业的产品原型风格

## 输出要求

1. 输出完整的HTML文件代码
2. 代码开头添加简短说明，介绍原型的功能和使用方法
3. 确保所有连线的起始和指向位置完全正确
4. 确保在不同屏幕尺寸下都能正常显示和交互

## 注意事项

- 连线计算必须在DOM渲染完成后执行，使用 `DOMContentLoaded` 和 `resize` 事件重新计算
- 确保SVG的 `pointer-events-none` 不会阻挡下方元素的交互
- 移动端切换视图时，必须使用 `opacity` + `visibility` 配合 CSS `transition` 实现平滑过渡动画，**禁止使用 `display:none` 切换**（因为 display 属性无法过渡，会导致画面突变）
- 所有元素ID和数据属性命名要清晰，便于连线脚本定位
- 切换视图时需要支持平滑过渡动画

### ⚠️ 连线错位高频陷阱 — 必须严格遵守

**现象**：页面滚动后，SVG 标注线偏移到错误位置（元素框和线条不匹配）。

**根因**：`getBoundingClientRect()` 返回的是**视口相对坐标**，但如果 SVG 使用了 `position: absolute` 并放在容器内，SVG 的原点（0,0）是容器在文档中的位置，而不是视口左上角。滚动后容器位置改变，视口坐标和 SVG 坐标空间出现偏差。

**标准解法**（模式A/B通用）：

```javascript
// ❌ 错误做法
#svg-lines { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
// 计算时减 containerRect 偏移 → 滚动后坐标错位

// ✅ 正确做法
#svg-lines { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }
// 计算时直接使用 getBoundingClientRect() 的原始视口坐标，不加/不减任何偏移

function computeLines() {
  const vw = window.innerWidth, vh = window.innerHeight;
  svg.setAttribute('width', vw);
  svg.setAttribute('height', vh);
  
  // 直接用视口坐标
  const startX = targetRect.right;  // ✓ 不用减 containerRect.left
  const startY = targetRect.top + targetRect.height / 2;  // ✓ 不用减 containerRect.top
  const endX = itemRect.left;
  const endY = itemRect.top + itemRect.height / 2;
}
```

**不可遗漏的 3 个配套：**
1. SVG 必须在事件绑定前就存在于 DOM 中（推荐写在 HTML 里，不要 JS 动态创建）
2. `resize` + `scroll` 事件都要重新计算连线（用 debounce，100-200ms）
3. SVG 必须设置 `pointer-events: none`，防止遮挡下方按钮和链接的点击

## 参考内容

- 生成的HTML文件要参考 [assets/example.html](assets/example.html)
