const { builtinModules } = require('node:module')

module.exports = {
  forbidden: [
    {
      name: 'inventory-calculations-stay-pure',
      severity: 'error',
      from: { path: '^src/(inventory-compute|aps-compute)/' },
      to: { path: '^src/(application|catalog|client|context|index|routes|runtime)(/|\\.)' }
    },
    {
      name: 'client-cannot-import-host',
      severity: 'error',
      from: { path: '^src/client' },
      to: { path: '^src/(application|catalog|context|routes|runtime)(/|\\.)' }
    },
    {
      name: 'client-cannot-import-node',
      severity: 'error',
      from: { path: '^src/client' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'catalog-cannot-import-host-or-client',
      severity: 'error',
      from: { path: '^src/catalog' },
      to: { path: '^src/(application|client|context|index|routes|runtime)(/|\\.)' }
    },
    {
      name: 'runtime-cannot-import-client-or-routes',
      severity: 'error',
      from: { path: '^src/runtime' },
      to: { path: '^src/(client|routes)(/|\\.)' }
    },
    {
      name: 'contracts-cannot-import-runtime',
      severity: 'error',
      from: { path: '^src/contracts' },
      to: { path: '^src/(application|catalog|client|runtime|host)(/|\\.)' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)node_modules/',
    includeOnly: `^(src(?:/|$)|node:|(?:${builtinModules.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$)`,
    tsPreCompilationDeps: true
  }
}
