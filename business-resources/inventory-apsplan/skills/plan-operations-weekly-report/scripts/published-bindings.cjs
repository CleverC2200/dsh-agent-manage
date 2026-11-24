const { defaults } = require('./report-core.cjs');
const models = {
  cancellation: 'workbench_cancellation_qa', amendment: 'workbench_amendment_qa',
  fulfillment: 'workbench_fulfillment_qa', ontime: 'workbench_ontime_qa',
  stockAge: 'workbench_stock_age_qa', shippingDays: 'workbench_stock_turnover_qa'
};
function publishedBinding(id, inspection, revision, gaps) {
  const model = inspection.semanticModel?.find(item => item.name === models[id]);
  if (!model || model.meta?.model_revision !== revision) throw Error('PUBLISHED_MODEL_REVISION_MISMATCH:' + id);
  const members = [...model.measures, ...model.dimensions];
  const byName = new Map(members.map(member => [member.name, member]));
  const name = suffix => model.name + '.' + suffix;
  const field = suffix => byName.get(name(suffix))?.aliasMember;
  if (!field('value_final') || !byName.has(name('stat_time'))) throw Error('PUBLISHED_CONTRACT_CHANGED:' + id);
  const scopes = [];
  function scope(scopeId, keys, groups = keys) {
    if (!groups.every(key => byName.has(name(key))) || !keys.every(key => field(key))) {
      gaps.push(id + '/' + scopeId + '：模型未发布所需分组或响应映射');
      return;
    }
    scopes.push({ id: scopeId, dimensions: groups.map(name), responseKeys: keys.map(field), keyNames: keys });
  }
  scope('national', [], ['status', 'target', 'unit'].filter(key => byName.has(name(key))));
  if (['fulfillment', 'ontime', 'stockAge', 'shippingDays'].includes(id)) {
    scope('base', ['base_name']);
    scope('director', ['base_name', 'director_name']);
    if (id !== 'ontime') scope('category', ['item_name']);
    scope('sku', ['base_name', 'sku_code']);
  }
  return { id, model: model.name, inspectionSource: 'inspect-' + id + '.json',
    members: members.map(member => member.name), timeDimension: name('stat_time'), baseDimension: name('base_name'),
    measures: ['value_final', 'numerator_final', 'denominator_final'].filter(key => field(key)).map(name),
    responseFields: { value: field('value_final'), numerator: field('numerator_final'), denominator: field('denominator_final'),
      missingReason: field('missing_reason'), skuCode: field('sku_code') }, scopes };
}
async function publishedConfig(config, seed, inspect, save, signal) {
  if (config.bindings?.length || !config.publishedModelRevision) return config;
  const bindings = [], gaps = [];
  for (const { id } of defaults) {
    signal.throwIfAborted();
    const raw = await inspect({ model: models[id], limit: 50 }, signal);
    await save('inspect-' + id + '.json', raw);
    bindings.push(publishedBinding(id, typeof raw === 'string' ? JSON.parse(raw) : raw, config.publishedModelRevision, gaps));
  }
  seed.gaps = [...(seed.gaps || []), ...gaps];
  if (!seed.relations?.length && bindings.some(binding => binding.scopes.some(scope => scope.id === 'sku')))
    seed.relations = [{ fromScope: 'base', toScope: 'sku', on: [{ parent: 'base_name', child: 'base_name' }] }];
  return { ...config, bindings };
}
module.exports = { publishedConfig, publishedBinding };
