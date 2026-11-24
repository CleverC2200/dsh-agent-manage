const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generate } = require('./generate-report.cjs');
const { make } = require('./make-query-plan.cjs');
const { assemble } = require('./assemble-data.cjs');
const { executeWeekly } = require('./run-weekly.cjs');
const { delta, format, status } = require('./report-core.cjs');
const observation = value => ({ value, complete: true });
function sample() {
  return { schemaVersion: 1, meta: { demo: true, title: '合成测试周报', month: '2026-11-01—2026-11-22', week: '2026-11-16—2026-11-22', cutoff: '2026-11-24 00:00 Asia/Shanghai', scope: '测试基地', version: 'TEST' },
    national: { fulfillment: { month: observation(95), previousMonth: observation(90), week: observation(0) } },
    groups: { base: [{ id: 'B1', name: '测试基地', keyValues: { base: 'B1' }, metrics: { fulfillment: { month: observation(95) } } }],
      sku: [{ id: 'B1-S1', name: '测试商品', skuCode: 'S1', skuName: '商品名称', keyValues: { base: 'B1', sku: 'S1' }, metrics: { fulfillment: { month: observation(95) } } }],
      order: [{ id: 'O1-1', name: '订单O1-行1', keyValues: { base: 'B1', sku: 'S1' }, metrics: {} }] },
    relations: [{ fromScope: 'base', toScope: 'sku', on: [{ parent: 'base', child: 'base' }], coverage: '全量合成测试' },
      { fromScope: 'sku', toScope: 'order', on: [{ parent: 'base', child: 'base' }, { parent: 'sku', child: 'sku' }], label: '查看订单行', terminalReason: '已到订单行级' }],
    actions: [{ action: '测试改善动作', evidence: '合成测试' }], summary: ['测试结论'], gaps: ['测试缺口'] };
}
function config() {
  return { context: { cutoff: '2026-11-24', scope: '测试基地', authorizationScope: 'test-consumer', definitionVersion: 'v1', sourceVersion: 'g1' },
    windows: { month: ['2026-11-01', '2026-11-22'], week: ['2026-11-16', '2026-11-22'] }, bindings: [{ id: 'fulfillment', model: 'test', inspectionSource: 'synthetic-inspection.json',
      members: ['test.value', 'test.date', 'test.base', 'test.sku'], measures: ['test.value'], timeDimension: 'test.date', baseDimension: 'test.base',
      responseFields: { value: 'source.value', skuCode: 'source.sku' }, scopes: [{ id: 'sku', dimensions: ['test.base', 'test.sku'], responseKeys: ['source.base', 'source.sku'] }] }] };
}
test('executor persists the plan first, limits concurrency, pages and replays raw responses', async () => {
  const c = config(), binding = c.bindings[0];
  binding.scopes.unshift({ id: 'national', dimensions: [] });
  c.bindings.push({ ...binding, model: 'second', id: 'ontime', scopes: [binding.scopes[0]] });
  const files = new Map(), inFlight = new Set();
  let peak = 0, completedSummaries = 0;
  const args = {
    signal: new AbortController().signal,
    write: async (file, raw) => { files.set(file, raw); },
    query: async ({ queries }) => {
      assert.ok(files.has('query-plan.json'));
      assert.ok(queries.length <= 4);
      const detail = queries[0].name.includes('__sku__');
      if (detail) assert.equal(completedSummaries, 2);
      inFlight.add(queries);
      peak = Math.max(peak, inFlight.size);
      await new Promise(resolve => setImmediate(resolve));
      inFlight.delete(queries);
      if (!detail) completedSummaries++;
      return JSON.stringify({ datasets: queries.map(({ name, query }) => ({
        name, offset: query.offset, dataStatus: 'ok', hasMorePages: detail && query.offset === 0,
        rows: [{ 'source.value': 4.02, 'source.base': 'B', 'source.sku': 'S' + query.offset }]
      })) });
    }
  };
  const stats = await executeWeekly(c, sample(), args);
  assert.equal(peak, 2);
  assert.equal(stats.responses, 4);
  const manifest = JSON.parse(files.get('results-manifest.json'));
  const replay = assemble(make(c), manifest, sample(), '.', file => JSON.parse(files.get(path.basename(file))));
  assert.deepEqual(JSON.parse(files.get('report-data.json')), JSON.parse(JSON.stringify(replay)));
  assert.equal(replay.groups.sku.length, 2);
  assert.ok(files.get('report.html').includes('4.02%'));
});
test('denied query stops scheduling and never publishes a report', async () => {
  const written = [];
  await assert.rejects(executeWeekly(config(), sample(), {
    signal: new AbortController().signal,
    query: async () => { throw Error('DENIED'); },
    write: async file => { written.push(file); }
  }), /DENIED/);
  assert.deepEqual(written, ['query-plan.json', 'report-seed.json', 'results-manifest.json']);
});
test('authoritative percentages retain scale, real zero and missing comparisons differ', () => {
  assert.equal(format(observation(4.02), { unit: '%' }), '4.02%');
  assert.equal(format(observation(0), { unit: '%' }), '0.00%');
  assert.equal(format({ value: 4, complete: false }, { unit: '%' }), '—');
  assert.equal(delta(observation(95), observation(90), { unit: '%' }), '+5.00 pct');
  assert.equal(delta(observation(95), null, { unit: '%' }), '—');
  assert.throws(() => format(observation('95'), { unit: '%' }), /FINITE_NUMBER/);
  assert.equal(status({ value: null, complete: true, statusVerified: true, status: 'healthy' }), 'info');
});
test('generator removes sample business data and escapes text and embedded JSON', () => {
  const data = sample(); data.meta.demo = false; data.summary = ['</script><img src=x onerror=alert(1)>'];
  data.groups.base[0].name = '</script><img src=x onerror=alert(1)>';
  const { html } = generate(data);
  assert.ok(!html.includes('DEMO-V1'));
  assert.ok(!html.includes('西南基地'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('95.00%'));
  assert.ok(html.includes('0.00%'));
  assert.ok(html.includes('\\u003c/script'));
});
test('fixed renderer preserves five modules and binds SKU then source records', () => {
  const { html, quality } = generate(sample());
  assert.equal((html.match(/<section class="section"/g) || []).length, 5);
  assert.equal(quality.drillEntries, 2);
  assert.ok(html.includes('订单O1-行1'));
  assert.ok(html.includes('商品名称'));
  assert.ok(html.includes(".section:not(#actions)"));
  assert.ok(html.includes('本轮未取得对象明细') || quality.gaps.some(g => g.includes('应责总监')));
});
test('query planner rejects uninspected fields and SKU without base, binds context to cache identity', () => {
  const c = config(), p = make(c);
  assert.equal(p.jobs.length, 2);
  assert.equal(p.batches.length, 1);
  assert.equal(p.maxConcurrency, 2);
  const changed = config(); changed.context.authorizationScope = 'another';
  assert.notEqual(make(changed).jobs[0].identity, p.jobs[0].identity);
  c.bindings[0].scopes[0].dimensions = ['test.sku'];
  assert.throws(() => make(c), /BASE_DIMENSION_REQUIRED/);
  c.bindings[0].scopes[0].dimensions = ['test.invented'];
  assert.throws(() => make(c), /UNINSPECTED_MEMBER/);
});
test('same query reused across equivalent report consumers rather than fetched twice', () => {
  const c = config();
  c.bindings[0].scopes.push({ ...c.bindings[0].scopes[0], id: 'base' });
  const p = make(c);
  assert.equal(p.jobs.length, 4);
  assert.equal(p.batches.flatMap(b => b.args.queries).length, 2);
  assert.equal(p.jobs[2].queryName, p.jobs[0].id);
});
test('relations cannot join unrelated parents or recurse in a cycle', () => {
  const d = sample(); d.groups.sku[0].keyValues.base = 'OTHER';
  const html = generate(d).html;
  assert.ok(!html.includes('订单O1-行1'));
  d.groups.sku[0].keyValues.base = 'B1';
  d.relations[1].toScope = 'base';
  assert.throws(() => generate(d), /CYCLIC_DETAIL_RELATION/);
});
test('incomplete pages never become complete metrics; continuation preserves query offset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-render-'));
  const plan = make(config()), name = plan.jobs[0].id;
  const page = { name, dataStatus: 'ok', offset: 0, hasMorePages: true, totalRowCount: 2, rows: [{ 'source.value': 95, 'source.base': 'B1', 'source.sku': 'S1' }] };
  fs.writeFileSync(path.join(root, 'response.json'), JSON.stringify({ datasets: [page] }));
  const manifest = { context: plan.context, files: [{ path: 'response.json', batchIndex: 0, queriedAt: '2026-11-24T00:00:00Z' }] };
  const result = assemble(plan, manifest, sample(), root);
  assert.equal(result.groups.sku, undefined);
  assert.equal(result.nextPages[0].args.queries[0].query.offset, 1);
  assert.ok(result.gaps.some(g => g.includes('不将部分明细当全量')));
  const second = { ...page, offset: 1, hasMorePages: false, rows: [{ 'source.value': 90, 'source.base': 'B1', 'source.sku': 'S2' }] };
  fs.writeFileSync(path.join(root, 'second.json'), JSON.stringify({ datasets: [second] }));
  manifest.files.push({ path: 'second.json', batchIndex: 0, queriedAt: '2026-11-24T00:00:01Z' });
  assert.equal(assemble(plan, manifest, sample(), root).groups.sku.length, 2);
  second.rows[0]['source.sku'] = 'S1';
  fs.writeFileSync(path.join(root, 'second.json'), JSON.stringify({ datasets: [second] }));
  assert.throws(() => assemble(plan, manifest, sample(), root), /DUPLICATE_GROUP_ROW/);
  second.rows[0]['source.sku'] = 'S2';
  second.dataset_generation = 'new-generation'; page.dataset_generation = 'old-generation';
  fs.writeFileSync(path.join(root, 'second.json'), JSON.stringify({ datasets: [second] }));
  fs.writeFileSync(path.join(root, 'response.json'), JSON.stringify({ datasets: [page] }));
  assert.throws(() => assemble(plan, manifest, sample(), root), /GENERATION_MISMATCH/);
  manifest.context = { ...manifest.context, cutoff: 'changed' };
  assert.throws(() => assemble(plan, manifest, sample(), root), /RESULT_CONTEXT_MISMATCH/);
});
module.exports = { sample, config };
