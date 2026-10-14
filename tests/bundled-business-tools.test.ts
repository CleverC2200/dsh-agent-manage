import { readdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'

it('current packaged business Skills and capabilities retain native Cube tools and contain no retired runtime instructions', async () => {
  const root = resolve('business-resources')
  const walk = async (directory: string): Promise<string[]> => {
    const rows = await readdir(directory, { withFileTypes: true })
    return (await Promise.all(rows.map(row => (row.isDirectory() ? walk(join(directory, row.name)) : Promise.resolve([join(directory, row.name)]))))).flat()
  }
  const files = (await walk(root)).filter(file => /(?:SKILL\.md|capability\.json)$/.test(file))
  expect(files.length).toBeGreaterThan(10)
  for (const file of files) expect(await readFile(file, 'utf8'), file).not.toMatch(/gea_module_mcp|gea_cube_query|gea_gateway_catalog/)
  const branch = await readFile(join(root, 'inventory-fc/skills/fc/SKILL.md'), 'utf8')
  expect(branch).toContain('mcp__gea-gateway__inspect_cube_model')
  expect(branch).toContain('mcp__gea-gateway__query_business_data')
  expect(branch).toContain('order-net-gap-v3')
})
