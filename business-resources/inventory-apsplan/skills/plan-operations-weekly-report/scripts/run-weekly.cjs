const path = require('node:path');
const { make } = require('./make-query-plan.cjs');
const { assemble } = require('./assemble-data.cjs');
const { generate } = require('./generate-report.cjs');
const { publishedConfig } = require('./published-bindings.cjs');

function checkedReport(data) {
  const result = generate(data);
  const sections = Array.from(result.html.matchAll(/<section class="section" id="([^"]+)">/g), match => match[1]);
  if (sections.join(',') !== 'overview,base,director,category,actions') throw Error('REPORT_SECTION_MISMATCH');
  const embedded = result.html.match(/<script type="application\/json" id="weekly-report-drill-data">([\s\S]*?)<\/script>/);
  if (!embedded || Object.keys(JSON.parse(embedded[1]).entries).length !== result.quality.drillEntries)
    throw Error('REPORT_DRILL_DATA_MISMATCH');
  return result;
}

async function executeWeekly(config, seed, { inspect, query, write, signal }) {
  if (!seed.meta?.title) throw Error('REPORT_TITLE_REQUIRED');
  const files = [], responses = new Map();
  const save = (file, value) => write(file, typeof value === 'string' ? value : JSON.stringify(value));
  const plan = make(await publishedConfig(config, seed, inspect, save, signal));
  await save('query-plan.json', plan);
  await save('report-seed.json', seed);
  const stop = new AbortController();
  const active = AbortSignal.any([signal, stop.signal]);
  const manifest = { context: plan.context, files };
  async function batch(index) {
    let queries = plan.batches[index].args.queries;
    for (let page = 0; queries.length; page++) {
      active.throwIfAborted();
      const started = Date.now();
      const raw = await query({ ...plan.batches[index].args, queries }, active);
      active.throwIfAborted();
      const response = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(response?.datasets)) throw Error('RAW_DATASETS_REQUIRED');
      const file = 'response-' + index + '-' + page + '.json';
      await save(file, raw);
      files.push({ path: file, batchIndex: index, queriedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started });
      responses.set(file, response);
      const requests = new Map(queries.map(request => [request.name, request]));
      const next = [];
      for (const dataset of response.datasets) {
        const request = requests.get(dataset.name);
        if (!request || dataset.offset !== request.query.offset) throw Error('UNEXPECTED_RESPONSE_PAGE');
        requests.delete(dataset.name);
        if (dataset.dataStatus === 'ok' && dataset.hasMorePages === true && dataset.rows?.length) {
          next.push({ name: dataset.name, query: { ...request.query, offset: dataset.offset + dataset.rows.length } });
        }
      }
      queries = next;
    }
  }
  try {
    for (const phase of ['summary', 'detail']) {
      const pending = plan.batches.map((item, index) => ({ ...item, index })).filter(item => item.phase === phase);
      let cursor = 0;
      async function worker() {
        try {
          while (cursor < pending.length) await batch(pending[cursor++].index);
        } catch (error) { stop.abort(error); throw error; }
      }
      await Promise.allSettled(Array.from({ length: Math.min(plan.maxConcurrency, pending.length) }, worker));
      active.throwIfAborted();
    }
  } finally {
    files.sort((a, b) => a.batchIndex - b.batchIndex);
    await save('results-manifest.json', manifest);
  }
  const data = assemble(plan, manifest, seed, '.', file => responses.get(path.basename(file)));
  const result = checkedReport(data);
  await save('report-data.json', data);
  await save('quality.json', result.quality);
  await save('report.html', result.html);
  return { batches: plan.batches.length, responses: files.length, gaps: result.quality.gaps.length, drillEntries: result.quality.drillEntries };
}

module.exports = { executeWeekly, checkedReport };

if (require.main === module) {
  const { read, save } = require('./report-core.cjs');
  try {
    if (!process.argv[2]) throw Error('REPORT_DIRECTORY_REQUIRED');
    const file = name => path.join(process.argv[2], name);
    const data = assemble(read(file('query-plan.json')), read(file('results-manifest.json')), read(file('report-seed.json')), process.argv[2]);
    const result = checkedReport(data);
    save(file('report-data.json'), data);
    save(file('quality.json'), result.quality);
    save(file('report.html'), result.html);
    console.log(JSON.stringify({ report: file('report.html'), gaps: result.quality.gaps.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
