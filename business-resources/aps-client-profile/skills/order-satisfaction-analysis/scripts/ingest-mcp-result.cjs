// 把 query_business_data 的返回（含被转存到临时文件的完整结果）提取为报告源行文件。
// 目的：避免大结果逐行进入模型上下文，也避免重写一次性提取脚本。
// 用法：
//   node ingest-mcp-result.cjs <返回JSON> --list
//   node ingest-mcp-result.cjs <返回JSON> <数据集名> <输出文件> [字段映射.json] [--period YYYY-MM] [--allow-partial]
// 字段映射：{"规范列名":"返回成员名或成员名后缀"}；省略则保留返回原键。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--period'));

if (!positional[0]) {
  console.error('用法：node ingest-mcp-result.cjs <返回JSON> --list | <返回JSON> <数据集名> <输出文件> [字段映射.json] [--period YYYY-MM] [--allow-partial]');
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(positional[0], 'utf8'));
const datasets = Array.isArray(doc?.datasets) ? doc.datasets
  : Array.isArray(doc) ? [{ name: 'rows', rows: doc }]
  : doc?.rows ? [{ name: doc.name || 'rows', rows: doc.rows, rowCount: doc.rowCount, totalRowCount: doc.totalRowCount, hasMorePages: doc.hasMorePages, dataStatus: doc.dataStatus, warnings: doc.warnings }]
  : null;
if (!datasets) { console.error('无法识别返回结构：既无 datasets 数组，也无 rows 数组'); process.exit(2); }

if (flag('--list')) {
  console.log(JSON.stringify(datasets.map((d) => ({
    name: d.name, rowCount: d.rowCount, totalRowCount: d.totalRowCount,
    hasMorePages: d.hasMorePages, dataStatus: d.dataStatus,
    warnings: (d.warnings || []).map((w) => w.code || w),
    members: d.rows?.[0] ? Object.keys(d.rows[0]).length : 0,
  })), null, 2));
  process.exit(0);
}

const name = positional[1];
const outFile = positional[2];
const mapFile = positional[3] && !positional[3].startsWith('--') ? positional[3] : null;
const period = valueOf('--period');
if (!name || !outFile) { console.error('缺数据集名或输出文件'); process.exit(1); }

const ds = datasets.find((d) => d.name === name) || datasets.find((d) => String(d.name || '').startsWith(name));
if (!ds) { console.error('未找到数据集 ' + name + '；可用：' + datasets.map((d) => d.name).join(', ')); process.exit(2); }

// 完整性闸门：分页未结束不得当作全量落盘（历史上曾把 Top30 当全量使用）
if (ds.hasMorePages === true && !flag('--allow-partial')) {
  console.error('数据集 ' + name + ' 仍有后续分页（hasMorePages=true）；请继续取数，或显式加 --allow-partial 并在任务单标注 partial。');
  process.exit(3);
}

const map = mapFile ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
const pick = (row, source) => {
  if (Object.hasOwn(row, source)) return row[source];
  const suffix = source.includes('.') ? source.slice(source.lastIndexOf('.') + 1) : source;
  const hits = Object.keys(row).filter((k) => k === suffix || k.endsWith('.' + suffix));
  return hits.length === 1 ? row[hits[0]] : undefined;
};

const missing = new Set();
const rows = ds.rows.map((raw) => {
  if (!map) return raw;
  const o = {};
  for (const [canonical, source] of Object.entries(map)) {
    const v = pick(raw, source);
    if (v === undefined) { missing.add(source); o[canonical] = null; continue; }
    o[canonical] = v;
  }
  return o;
});
if (missing.size) {
  console.error('以下成员在返回行中不存在（不得用未查字段填空）：' + [...missing].join(', '));
  process.exit(4);
}

const payload = {
  period: period || undefined,
  dataset: name,
  source: {
    rowCount: ds.rowCount, totalRowCount: ds.totalRowCount, offset: ds.offset,
    hasMorePages: ds.hasMorePages === true, dataStatus: ds.dataStatus || null,
    warnings: ds.warnings || [], lastRefreshTime: ds.lastRefreshTime || null,
    checksum: ds.checksum || null, queryFingerprint: ds.queryFingerprint || null,
  },
  rows,
};
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload));

const numeric = Object.keys(rows[0] || {}).filter((k) => typeof rows[0][k] === 'number');
const round = (v) => Math.round(v * 1e6) / 1e6;
const sums = Object.fromEntries(numeric.map((k) => [k, round(rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : 0), 0))]));
console.log(JSON.stringify({
  dataset: name, out: outFile, rows: rows.length,
  source: payload.source, bytes: fs.statSync(outFile).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex'),
  sums,
  note: '数值合计仅用于与全国/上级口径勾稽，不等于业务口径结论。',
}, null, 1));
