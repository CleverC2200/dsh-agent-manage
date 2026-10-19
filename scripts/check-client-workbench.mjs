import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

export function verifyWorkbenchClientInputs(workbench, consumers) {
  const file = resolve(workbench, 'src/resource-selection.ts')
  if (!existsSync(file)) throw Error(`PRESET_CLIENT_INPUT_REQUIRED: DSH_WORKBENCH_CHECKOUT: ${workbench}`)
  const program = ts.createProgram([file], { noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  const symbol = source && checker.getSymbolAtLocation(source)
  const exported = new Set(symbol ? checker.getExportsOfModule(symbol).map(row => row.name) : [])
  for (const consumer of consumers) {
    const document = ts.createSourceFile(consumer, readFileSync(consumer, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of document.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'preset-client-workbench/resource-selection')
        continue
      const names = statement.importClause?.namedBindings
      if (!names || !ts.isNamedImports(names)) continue
      for (const specifier of names.elements) {
        const name = (specifier.propertyName ?? specifier.name).text
        if (!exported.has(name))
          throw Error(`PRESET_CLIENT_INPUT_REQUIRED: ${consumer} imports ${name}, missing from ${file}; use the Workbench pinned by scripts/quality-peer-baseline.json`)
      }
    }
  }
}
