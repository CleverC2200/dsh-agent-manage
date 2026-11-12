import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'client/**', 'node_modules/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: [
      'src/application/catalog.ts',
      'src/application/details.ts',
      'src/application/project-agent-roles.ts',
      'src/catalog/manifests.ts',
      'src/catalog/source-catalog.ts',
      'src/catalog/surfaces.ts',
      'src/client/McpPluginCard.tsx',
      'src/runtime/forecast-source.ts',
      'src/runtime/hooks-mounts.ts',
      'src/runtime/lsp-mounts.ts',
      'src/runtime/mcp-client/connection.ts',
      'src/runtime/mcp-mounts.ts'
    ],
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
)
