const path = require('node:path');
const { read, save, hash, number } = require('./report-core.cjs');
function assemble(plan, manifest, seed, base = '.', load = read) {
  if (hash(manifest.context) !== hash(plan.context)) throw Error('RESULT_CONTEXT_MISMATCH');
  const groups = {}, national = {}, gaps = [...plan.gaps], nextPages = [], lineage = [];
  const datasets = [];
  for (const item of manifest.files || []) {
    const response = load(path.resolve(base, item.path));
    if (item.batchIndex == null || !plan.batches[item.batchIndex]) throw Error('BATCH_BINDING_REQUIRED');
    const names = new Set(plan.batches[item.batchIndex].args.queries.map(q => q.name));
    for (const dataset of response.datasets || []) {
      if (!names.has(dataset.name)) throw Error('UNEXPECTED_DATASET');
      datasets.push({ ...dataset, file: item.path, queriedAt: item.queriedAt });
    }
  }
  for (const job of plan.jobs) {
    const pages = datasets.filter(d => d.name === job.queryName).sort((a, b) => a.offset - b.offset);
    let offset = 0, incomplete = !pages.length;
    const rows = [], generations = new Set();
    for (const page of pages) {
      if (!Array.isArray(page.rows) || page.dataStatus !== 'ok' || page.offset !== offset || !page.queriedAt ||
          (page.coverage && page.coverage.state !== 'complete')) { incomplete = true; break; }
      offset += page.rows.length;
      if (page.dataset_generation != null) generations.add(page.dataset_generation);
      rows.push(...page.rows);
      lineage.push({ jobId: job.id, identity: job.identity, file: page.file, queriedAt: page.queriedAt, checksum: page.checksum, offset: page.offset });
    }
    const last = pages.at(-1);
    if (last && last.hasMorePages !== false) incomplete = true;
    if (last?.hasMorePages === true) {
      incomplete = true;
      if (last.rows?.length) nextPages.push({ jobId: job.id, args: { action: 'query', response_mode: 'inline_complete',
        queries: [{ name: job.queryName, query: { ...job.request, offset } }] } });
    }
    if (last && last.totalRowCount != null && Number(last.totalRowCount) !== rows.length) incomplete = true;
    if (generations.size > 1) throw Error('PAGINATION_GENERATION_MISMATCH');
    if (incomplete) { gaps.push(`${job.id}:未取得完整结果；本次不将部分明细当全量`); continue; }
    if (!rows.length) gaps.push(`${job.id}:来源返回空结果，不解释为零或无风险`);
    const seen = new Set();
    for (const row of rows) {
      const ids = job.keys.map(key => row[key]);
      if (ids.some(v => v == null)) throw Error('SOURCE_GROUP_KEY_MISSING');
      const key = JSON.stringify(ids);
      if (seen.has(key)) throw Error('DUPLICATE_GROUP_ROW:' + job.id);
      seen.add(key);
      if (job.scope === 'national' && rows.length !== 1) throw Error('NATIONAL_RESULT_NOT_SCALAR');
      if (!Object.hasOwn(row, job.fields.value)) throw Error('SOURCE_VALUE_FIELD_MISSING');
      const observation = { value: number(row[job.fields.value]), complete: true, source: job.identity,
        missingReason: row[job.fields.missingReason] || null };
      if (job.fields.generation && row[job.fields.generation] != null) generations.add(row[job.fields.generation]);
      if (generations.size > 1) throw Error('PAGINATION_GENERATION_MISMATCH');
      if (job.fields.status && job.statusDefinitionSource) {
        const mapped = job.statusMap?.[row[job.fields.status]];
        if (['healthy', 'warning', 'severe'].includes(mapped) && observation.value != null) {
          observation.status = mapped;
          observation.statusVerified = true;
          observation.statusDefinitionSource = job.statusDefinitionSource;
        }
      }
      for (const field of ['numerator', 'denominator']) if (job.fields[field]) observation[field] = number(row[job.fields[field]]);
      if (observation.value == null) gaps.push(`${job.id}/${key}:${observation.missingReason || '来源指标为空'}`);
      if (job.scope === 'national') {
        national[job.metricId] ||= {};
        national[job.metricId][job.period] = observation;
      } else {
        groups[job.scope] ||= {};
        const record = groups[job.scope][key] ||= { id: key, keyValues: Object.fromEntries(job.keyNames.map((k, i) => [k, ids[i]])),
          name: job.labels.map(k => row[k] ?? '名称缺失').join(' / '), metrics: {} };
        if (job.fields.skuCode) record.skuCode = row[job.fields.skuCode];
        if (job.fields.skuName) record.skuName = row[job.fields.skuName];
        record.details ||= {};
        record.detailColumns ||= [];
        for (const field of job.detailFields) {
          if (!field.key || !field.label || !field.field) throw Error('DETAIL_FIELD_MAPPING_REQUIRED');
          if (row[field.field] != null && typeof row[field.field] === 'object') throw Error('DETAIL_FIELD_MUST_BE_SCALAR');
          record.details[field.key] = row[field.field] ?? null;
          if (!record.detailColumns.some(c => c.key === field.key)) record.detailColumns.push({ key: field.key, label: field.label });
        }
        record.metrics[job.metricId] ||= {};
        record.metrics[job.metricId][job.period] = observation;
      }
    }
  }
  return { ...seed, meta: { ...seed.meta, cutoff: plan.context.cutoff, scope: plan.context.scope,
      version: plan.context.sourceVersion,
      month: plan.windows.month?.join('—') || '月度范围未确认', week: plan.windows.week?.join('—') || '周度范围未确认' },
    national, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, Object.values(v)])),
    gaps: [...(seed.gaps || []), ...gaps], lineage, nextPages: [...new Map(nextPages.map(p => [JSON.stringify(p.args), p])).values()], queryContext: plan.context };
}
module.exports = { assemble };
if (require.main === module) {
  try { save(process.argv[5], assemble(read(process.argv[2]), read(process.argv[3]), read(process.argv[4]), path.dirname(process.argv[3]))); console.log('REPORT_DATA_WRITTEN'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
