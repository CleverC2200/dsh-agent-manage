const { read, save, hash, periods, defaults } = require('./report-core.cjs');
function make(config) {
  if (!config.context?.cutoff || !config.context?.scope || !config.context?.definitionVersion ||
      !config.context?.authorizationScope || !config.context?.sourceVersion) throw Error('QUERY_CONTEXT_REQUIRED');
  const jobs = [], gaps = [], seen = new Map(), ids = new Set();
  for (const binding of config.bindings || []) {
    if (!defaults.some(m => m.id === binding.id)) throw Error('UNKNOWN_REPORT_METRIC');
    if (!binding.id || !binding.model || !binding.inspectionSource || !binding.responseFields?.value)
      throw Error('INSPECTED_BINDING_REQUIRED');
    const allowed = new Set(binding.members || []);
    const check = member => { if (!allowed.has(member)) throw Error('UNINSPECTED_MEMBER:' + member); };
    (binding.measures || []).forEach(check);
    if (!binding.measures?.length) throw Error('MEASURES_REQUIRED');
    check(binding.timeDimension);
    for (const scope of binding.scopes || []) {
      if (!['national', 'base', 'director', 'category', 'sku', 'order', 'batch'].includes(scope.id)) throw Error('INVALID_SCOPE');
      const dimensions = [...new Set(scope.dimensions || [])];
      dimensions.forEach(check);
      if (['sku', 'director'].includes(scope.id) && (!binding.baseDimension || !dimensions.includes(binding.baseDimension)))
        throw Error('BASE_DIMENSION_REQUIRED:' + scope.id);
      if (scope.id !== 'national' && (!dimensions.length || !scope.responseKeys?.length)) throw Error('GROUP_KEYS_REQUIRED');
      const standardPeriods = ['sku', 'order', 'batch'].includes(scope.id) ? ['month', 'week'] : periods;
      for (const period of scope.periods || standardPeriods) {
        if (!periods.includes(period)) throw Error('INVALID_PERIOD');
        const range = config.windows?.[period];
        if (!range) { gaps.push(`${binding.id}/${scope.id}/${period}:缺少可比期间`); continue; }
        if (!Array.isArray(range) || range.length !== 2 || range.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d)) || range[0] > range[1])
          throw Error('INVALID_DATE_RANGE');
        if (range.some(d => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)) throw Error('INVALID_DATE_RANGE');
        const filters = [...(binding.filters || []), ...(scope.filters || [])];
        const checkFilters = items => items.forEach(f => {
          if (f.member) check(f.member);
          if (f.and) checkFilters(f.and);
          if (f.or) checkFilters(f.or);
        });
        checkFilters(filters);
        const query = { measures: binding.measures, dimensions, timeDimensions: [{ dimension: binding.timeDimension, dateRange: range }], filters, limit: 500, offset: 0 };
        if (dimensions.length) query.order = Object.fromEntries(dimensions.map(d => [d, 'asc']));
        if (scope.order) {
          Object.keys(scope.order).forEach(check);
          query.order = scope.order;
        }
        const identity = hash({ context: config.context, model: binding.model, query });
        const id = `${binding.id}__${scope.id}__${period}`;
        if (ids.has(id)) throw Error('DUPLICATE_JOB_ID');
        ids.add(id);
        const queryName = seen.get(identity) || id;
        seen.set(identity, queryName);
        if (scope.keyNames && scope.keyNames.length !== (scope.responseKeys || []).length) throw Error('GROUP_KEY_MAPPING_MISMATCH');
        jobs.push({ id, queryName, alias: queryName !== id, identity, metricId: binding.id, scope: scope.id, period,
          phase: ['sku', 'order', 'batch'].includes(scope.id) ? 'detail' : 'summary', model: binding.model,
          fields: binding.responseFields, detailFields: binding.detailFields || [], statusMap: binding.statusMap, statusDefinitionSource: binding.statusDefinitionSource,
          keys: scope.responseKeys || [], keyNames: scope.keyNames || scope.responseKeys || [], labels: scope.responseLabels || scope.responseKeys || [],
          inspectionSource: binding.inspectionSource, request: query });
      }
    }
  }
  const batches = [];
  if (!jobs.length) throw Error('NO_QUERIES_PLANNED');
  for (const phase of ['summary', 'detail']) {
    const models = [...new Set(jobs.filter(j => j.phase === phase).map(j => j.model))];
    for (const model of models) {
      const group = jobs.filter(j => !j.alias && j.phase === phase && j.model === model);
      for (let i = 0; i < group.length; i += 4) batches.push({ phase, model, args: { action: 'query', response_mode: 'inline_complete',
        queries: group.slice(i, i + 4).map(j => ({ name: j.id, query: j.request })) } });
    }
  }
  return { schemaVersion: 1, context: config.context, windows: config.windows, jobs, batches, gaps,
    maxConcurrency: 2, requiresRuntimeAuthorization: true, reuseRule: '仅复用相同identity的完整结果；换授权范围、截止、来源版本或口径必须重新查询' };
}
module.exports = { make };
if (require.main === module) {
  try { save(process.argv[3], make(read(process.argv[2]))); console.log('QUERY_PLAN_WRITTEN'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
