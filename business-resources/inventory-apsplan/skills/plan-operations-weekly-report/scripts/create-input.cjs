const fs = require('node:fs');
const path = require('node:path');
const { defaults } = require('./report-core.cjs');
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('EXPLICIT_OUTPUT_DIRECTORY_REQUIRED');
const seed = { schemaVersion: 1, meta: { title: '', month: '', week: '', cutoff: '', scope: '', version: '' },
  definitions: defaults, summary: [], analysis: { base: [], director: [], category: [] }, actions: [], longTerm: [], nextWeek: [], relations: [], gaps: [] };
const config = { context: { cutoff: '', scope: '', authorizationScope: '', definitionVersion: '', sourceVersion: '' }, windows: {}, publishedModelRevision: '', bindings: [] };
for (const file of ['report-seed.json', 'query-config.json']) if (fs.existsSync(path.join(root, file))) throw Error('OUTPUT_ALREADY_EXISTS');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'report-seed.json'), JSON.stringify(seed, null, 2), { flag: 'wx' });
fs.writeFileSync(path.join(root, 'query-config.json'), JSON.stringify(config, null, 2), { flag: 'wx' });
console.log('EMPTY_INPUTS_CREATED');
