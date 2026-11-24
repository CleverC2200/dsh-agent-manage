const fs = require('node:fs');
const path = require('node:path');
const { read, save, hash, defaults, format, delta, status } = require('./report-core.cjs');
const escape = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const labels = { healthy: '达标', warning: '预警', severe: '严重', info: '口径待确认' };
function generate(data) {
  if (data.schemaVersion !== 1 || !data.meta?.title || !data.meta?.cutoff || !data.meta?.week || !data.meta?.month)
    throw Error('REPORT_META_REQUIRED');
  const metrics = defaults.map(m => ({ ...m, ...(data.definitions || []).find(d => d.id === m.id) }));
  for (const m of metrics) if (!['%', '天'].includes(m.unit)) throw Error('UNSUPPORTED_METRIC_UNIT');
  const metricById = Object.fromEntries(metrics.map(m => [m.id, m]));
  const entries = {};
  const gaps = [...(data.gaps || [])];
  const groups = data.groups || {};
  const edges = new Map();
  for (const r of data.relations || []) {
    if (r.fromScope === 'actions' || edges.has(r.fromScope)) throw Error('INVALID_DETAIL_RELATION');
    if (!r.on?.length) throw Error('DETAIL_JOIN_KEYS_REQUIRED');
    edges.set(r.fromScope, r.toScope);
  }
  for (const start of edges.keys()) {
    const visited = new Set();
    let scope = start;
    while (edges.has(scope)) {
      if (visited.has(scope)) throw Error('CYCLIC_DETAIL_RELATION');
      visited.add(scope); scope = edges.get(scope);
    }
  }
  const allIds = new Set();
  for (const [scope, records] of Object.entries(groups)) {
    for (const r of records) {
      if (!r.id || allIds.has(scope + r.id)) throw Error('GROUP_ID_REQUIRED_OR_DUPLICATE');
      allIds.add(scope + r.id);
    }
  }
  const relationIndexes = new Map();
  const detailFor = (scope, record, period, stack = []) => {
    if (stack.includes(scope)) throw Error('CYCLIC_DETAIL_RELATION');
    const relation = (data.relations || []).find(r => r.fromScope === scope);
    if (!relation) return record.detail || { missingReason: '本轮未取得更底层明细或可靠关联，无法继续下钻。' };
    if (!relation.on?.length) throw Error('DETAIL_JOIN_KEYS_REQUIRED');
    if (!relationIndexes.has(scope)) {
      const index = new Map();
      for (const child of groups[relation.toScope] || []) {
        const values = relation.on.map(key => child.keyValues?.[key.child]);
        if (values.some(v => v == null)) continue;
        const key = JSON.stringify(values.map(String));
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(child);
      }
      relationIndexes.set(scope, index);
    }
    const parentValues = relation.on.map(key => record.keyValues?.[key.parent]);
    const matches = parentValues.some(v => v == null) ? [] : relationIndexes.get(scope).get(JSON.stringify(parentValues.map(String))) || [];
    const sourceColumns = [...new Map(matches.flatMap(r => r.detailColumns || []).map(c => [c.key, c])).values()];
    return { level: relation.toScope, label: relation.label || '展开底层明细',
      scope: `${data.meta[period]}；截止${data.meta.cutoff}；${record.name}`,
      evidence: '来源与分页记录见本报告数据来源说明；继承父对象和期间，未跨范围合并',
      coverage: relation.coverage || '覆盖范围待核验', missingReason: relation.missingReason || '未取得匹配的下层明细，不代表没有业务记录。',
      terminalReason: relation.terminalReason,
      columns: [{ key: 'object', label: '业务对象 / 源记录' }, ...sourceColumns.map(c => ({ key: 'source_' + c.key, label: c.label })), ...metrics.map(m => ({ key: m.id, label: m.name }))],
      rows: matches.map(child => ({ values: { object: child.name, skuCode: child.skuCode ?? '—', skuName: child.skuName ?? '—',
        ...Object.fromEntries(sourceColumns.map(c => ['source_' + c.key, child.details?.[c.key] ?? '—'])),
        ...Object.fromEntries(metrics.map(m => [m.id, format(child.metrics?.[m.id]?.[period], m)])) },
        detail: (data.relations || []).some(r => r.fromScope === relation.toScope) ? detailFor(relation.toScope, child, period, [...stack, scope]) : child.detail })),
    };
  };
  const notes = items => (items || []).length ? (items || []).map(x => `<p>${escape(x)}</p>`).join('') : '<p>本轮未取得足够证据，待补充。</p>';
  const heading = (n, title) => `<div class="section-head"><div><div class="section-kicker">SECTION 0${n}</div><h2>${title}</h2></div><div class="section-desc">${escape(data.meta.cutoff)} · ${escape(data.meta.scope)}</div></div>`;
  function table(scope, period, ids, title) {
    const records = groups[scope] || [];
    const previous = period === 'month' ? 'previousMonth' : 'previousWeek';
    const year = period === 'month' ? 'yearMonth' : 'yearWeek';
    const columns = ids.map(id => metricById[id]);
    if (!records.length) gaps.push(`${title}：未取得对象明细`);
    return `<h3>${escape(title)}</h3><div class="table-wrap"><table><thead><tr><th>对象 / 责任范围</th>${columns.map(m =>
      `<th>${escape(m.name)}</th><th>环比</th><th>同比</th>`).join('')}</tr></thead><tbody>${records.map(record => {
      const key = `${scope}-${period}-${hash(record.id).slice(0, 16)}`;
      entries[key] = detailFor(scope, record, period);
      const states = columns.map(m => status(record.metrics?.[m.id]?.[period]));
      const state = states.includes('severe') ? 'severe' : states.includes('warning') ? 'warning' : null;
      return `<tr data-drill-key="${key}"${state ? ` data-status-row="${state}"` : ''}><td>${escape(record.name)}</td>${columns.map(m => {
        const observations = record.metrics?.[m.id] || {};
        return `<td class="num">${format(observations[period], m)}</td><td class="num">${delta(observations[period], observations[previous], m)}</td><td class="num">${delta(observations[period], observations[year], m)}</td>`;
      }).join('')}</tr>`;
    }).join('') || `<tr data-no-drill><td colspan="${1 + columns.length * 3}">数据缺失：未取得当前对象列表，不沿用演示成员。</td></tr>`}</tbody></table></div>`;
  }
  const cards = metrics.map(m => {
    const obs = data.national?.[m.id] || {}, state = status(obs.month);
    if (!obs.month?.complete) gaps.push(`${m.name}：全国月度指标未取得完整结果`);
    return `<article class="kpi ${state}" data-status="${state}"><div class="kpi-top"><span class="kpi-name">${escape(m.name)}</span><span class="status ${state}">${labels[state]}</span></div><div class="kpi-value">${format(obs.month, m)}</div><div class="kpi-target">目标 ${escape(m.target || '待确认')}</div><div class="delta">${[
      ['月环比', delta(obs.month, obs.previousMonth, m)], ['月同比', delta(obs.month, obs.yearMonth, m)], ['本周', format(obs.week, m)], ['周环比', delta(obs.week, obs.previousWeek, m)],
    ].map(([name, v]) => `<div class="delta-row"><span>${name}</span><b>${v}</b></div>`).join('')}</div></article>`;
  }).join('');
  const sections = {
    overview: heading(1, '一、六大核心指标达成总览') + '<div class="filters"><button class="filter active" data-filter="all">全部指标</button><button class="filter" data-filter="risk">预警与严重</button><button class="filter" data-filter="healthy">达标</button></div>' + `<div class="kpis">${cards}</div><h3>本期结论摘要</h3>${notes(data.summary)}`,
    base: heading(2, '二、基地维度达成分析') + table('base', 'month', ['fulfillment', 'ontime', 'stockAge', 'shippingDays'], '2.1 基地月度达成') + table('base', 'week', ['fulfillment', 'ontime', 'stockAge', 'shippingDays'], '2.2 基地周度达成') + '<h3>2.3 原因分析与改善措施</h3>' + notes(data.analysis?.base),
    director: heading(3, '三、应责总监维度达成分析') + table('director', 'month', ['fulfillment', 'ontime', 'stockAge', 'shippingDays'], '3.1 应责总监月度达成') + table('director', 'week', ['fulfillment', 'ontime', 'stockAge', 'shippingDays'], '3.2 应责总监周度达成') + '<h3>3.3 重点责任对象观察</h3>' + notes(data.analysis?.director),
    category: heading(4, '四、品项维度达成分析') + table('category', 'month', ['fulfillment', 'shippingDays', 'stockAge'], '4.1 品项月度达成') + table('category', 'week', ['fulfillment', 'shippingDays', 'stockAge'], '4.2 品项周度达成') + '<h3>4.3 原因分析与改善措施</h3>' + notes(data.analysis?.category),
  };
  const staticTable = (columns, rows) => `<div class="table-wrap"><table><thead><tr>${columns.map(([k, v]) => `<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${(rows || []).map(row => `<tr>${columns.map(([k]) => `<td>${escape(row[k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}">本轮未取得可验证记录，待补充。</td></tr>`}</tbody></table></div>`;
  sections.actions = heading(5, '五、改善措施：执行情况与长期规划') + '<h3>5.1 执行情况</h3>' + staticTable([
    ['line', '条线'], ['action', '关键动作'], ['problem', '对应问题'], ['status', '状态'], ['owner', '责任角色'], ['due', '计划时间'], ['evidence', '完成/验收证据'],
  ], data.actions) + '<h3>5.2 长期规划</h3>' + staticTable([
    ['name', '机制'], ['content', '机制内容'], ['target', '目标'], ['owner', '责任角色'], ['milestone', '里程碑/触发规则'],
  ], data.longTerm) + '<h3>下周重点</h3>' + notes(data.nextWeek);
  let html = fs.readFileSync(path.join(__dirname, '../assets/weekly-report-html-template.html'), 'utf8');
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(data.meta.title)}</title>`);
  html = html.replace(/<section class="hero">[\s\S]*?<\/section>/, () => `<section class="hero"><div class="eyebrow">PLAN OPERATIONS WEEKLY REVIEW</div><h1>${escape(data.meta.title)}</h1><div class="meta">${[
    `月度累计：${data.meta.month}`, `本周：${data.meta.week}`, `截止：${data.meta.cutoff}`, `范围：${data.meta.scope || '待确认'}`, `数据版本：${data.meta.version || '待确认'}`,
  ].map(x => `<span>${escape(x)}</span>`).join('')}</div>${data.meta.demo ? '<div class="demo-note">合成测试数据，不代表正式经营结果</div>' : ''}</section>`);
  for (const [id, content] of Object.entries(sections)) html = html.replace(new RegExp(`<section class="section" id="${id}">[\\s\\S]*?<\\/section>`), () => `<section class="section" id="${id}">${content}</section>`);
  html = html.replace('<script type="application/json" id="weekly-report-drill-data">{"entries":{}}</script>', () =>
    `<script type="application/json" id="weekly-report-drill-data">${json({ entries })}</script>`);
  const quality = `<div class="footnote"><strong>数据缺口与来源</strong>${notes([...new Set(gaps)])}${notes((data.lineage || []).map(l => `${l.jobId}；查询时间${l.queriedAt}；来源文件${path.basename(l.file || '')}；指纹${l.identity || ''}`))}</div>`;
  html = html.replace('</main>', () => quality + '</main>');
  if (/DEMO-V1|华东基地|西南基地|总监A/.test(html) && !data.meta.demo && !JSON.stringify(data).includes('华东基地') && !JSON.stringify(data).includes('西南基地')) throw Error('TEMPLATE_DEMO_RESIDUE');
  return { html, quality: { rendererVersion: 1, gaps: [...new Set(gaps)], drillEntries: Object.keys(entries).length } };
}
module.exports = { generate };
if (require.main === module) {
  try { const result = generate(read(process.argv[2])); save(process.argv[3], result.html); save(process.argv[3] + '.quality.json', result.quality); console.log('REPORT_WRITTEN'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
