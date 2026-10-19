/** Browser UI through an authenticated temporary Core Host; no installed-client or model claim. */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, expect as browserExpect } from '@playwright/test'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountUserAgentRoutes } from '../src/runtime/user-agent-routes.js'
import { USER_AGENT_ROUTES } from '../src/contracts/user-agents.js'
import { mountSkillEditor } from '../src/runtime/skill-editor.js'
import { agentOn, completion, core, official, presetHarness, record, turn } from './core-preset-harness.js'

it('creates and enables an Agent in the ordinary browser entry, then starts its real standard Core Session without changing existing work', async () => {
  const { ctx, home } = await presetHarness({ companyBundle: 'absent', selectedDefault: 'minimal' })
  const original = await agentOn(ctx, 'browser-existing-task', 'standard', undefined, home)
  const existingEvents = JSON.stringify(original.session.snapshotEvents())
  const originalDefault = ctx.agentPresets.defaultId
  const resources = new BusinessResources(ctx, join(home, 'browser-resources.json'))
  await resources.load()
  ctx.provide('agentResources', resources)
  const pluginPrompt = JSON.stringify({ persona: 'BROWSER_PLUGIN_ORIGINAL', consumerCode: 'controlled-reader', skills: [] })
  await writeFile(join(home, 'browser-plugin.json'), pluginPrompt)
  await resources.register([
    {
      id: 'browser-plugin',
      label: '浏览器插件助手',
      root: home,
      prompt: 'browser-plugin.json',
      publishPreset: true,
      cube: true,
      profile: { label: 'Plugin', consumerCode: 'controlled-reader', skills: [] }
    }
  ])
  onTestFinished(() => resources.dispose())
  const agents = new UserAgents(ctx, join(home, 'browser-user-agents.json'))
  await agents.load()
  mountUserAgentRoutes(ctx, agents)
  await mountSkillEditor(ctx, agents)
  onTestFinished(() => agents.dispose())
  const standard = ctx.tools
    .schemas(original)
    .map(tool => tool.name)
    .sort()
  const started: Awaited<ReturnType<typeof agentOn>>[] = []
  // The browser's native-start port crosses HTTP into the actual Core operation.
  ctx.connection.fetch.register({
    path: '/api/browser-journey/start',
    methods: ['POST'],
    fetch: async request => {
      const { preset } = z
        .object({ preset: z.string().min(1) })
        .strict()
        .parse(await request.json())
      const agent = await agentOn(ctx, `browser-created-${started.length}`, preset, undefined, home)
      started.push(agent)
      return Response.json({ sessionId: agent.id, preset: ctx.agentPresets.composedPreset(agent.ctx), cwd: agent.session.header.cwd })
    }
  })
  const workbench = resolve(process.env.DSH_WORKBENCH_CHECKOUT ?? '../dsh-agent-workbench')
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import React from 'react';
      import {Context} from ${JSON.stringify(join(core, 'vendor/cordis/lib/index.js'))};
      import {apply as rendererApply} from ${JSON.stringify(join(core, 'packages/client/ui-renderer/src/client/index.ts'))};
      import {apply as layoutApply,inject as layoutInject} from ${JSON.stringify(join(core, 'packages/client/ui-layout/src/client/index.ts'))};
      import {apply as manageApply,inject as manageInject} from './src/client/index.ts';
      import {WorkbenchController} from ${JSON.stringify(join(workbench, 'src/workbench.ts'))};
      (async()=>{
        const source=value=>({getSnapshot:()=>value,subscribe:()=>()=>{}});
        const ctx=new Context();const dictionaries={};
        const locale={...source({active:'zh',revision:0}),register:(name,copy)=>{dictionaries[name]=copy.zh;return()=>{}},bind:name=>(key,params)=>Object.entries(params??{}).reduce((copy,[key,value])=>copy.replaceAll('{'+key+'}',value),dictionaries[name]?.[key]??key)};
        ctx.provide('locale',locale);
        ctx.provide('theme',{getTheme:()=>({active:{colorScheme:'light',tokens:{}},fontSize:14})});
        ctx.provide('shortcuts',{register:()=>()=>{},catalog:source([])});
        ctx.provide('uiWorkspace',{startSession:()=>{}});
        ctx.provide('remote',{credentials:{}});
        await ctx.plugin({apply:rendererApply}).await();const slots=ctx.get('slots');slots.installLocale(locale);
        const absent=source({key:undefined,hooks:{session:source(undefined),conversation:source(undefined)},keyedHooks:{projection:undefined},props:{}});
        slots.installScope('session',{current:absent,bindingSource:()=>absent,renderArea:(_binding,{children})=>children});
        slots.provideRoot({hooks:{sessions:source({byId:{}}),workspaces:source({items:[]})},props:{selectWorkspace:()=>{},inputActions:{}}});
        await ctx.plugin({inject:layoutInject,apply:layoutApply}).await();const layout=ctx.get('layout');
        const workbench=new WorkbenchController({panel:id=>layout.selectPanel(id),startAgent:async preset=>{
          const response=await fetch('/api/browser-journey/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({preset})});
          if(!response.ok)throw Error('CORE_SESSION_START_FAILED');
          await response.json();
        },openAgentSession:async session=>{window.skillEditorSession=session}});
        ctx.provide('agentWorkbench',workbench);
        await ctx.plugin({inject:manageInject,apply:manageApply}).await();
        ctx.get('uiRenderer').mount(document.getElementById('root'));
        layout.selectPanel('agent-plugin-workspace');
        window.journeyReady=true;window.journeyDispose=()=>ctx.fiber.dispose();
      })().catch(error=>{console.error(error);window.journeyFailure=error.message});
    `
    },
    bundle: true,
    write: false,
    outfile: 'journey.js',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.DSH_CLIENT_TITLE': '"Agent journey"', __dshManageClientCss: '""' },
    alias: { react: resolve('node_modules/react'), 'react-dom': resolve('node_modules/react-dom'), '@deepseek-ai/cordis': join(core, 'vendor/cordis/lib/index.js') },
    loader: { '.png': 'dataurl', '.css': 'text' },
    plugins: [
      {
        name: 'official-css-modules',
        setup(builder) {
          builder.onLoad({ filter: /\.module\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'local-css' }))
        }
      }
    ]
  })
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
  const html = `<style>${await readFile(join(workbench, 'theme/tokens.css'), 'utf8')}\n${css}\nhtml,body,#root{margin:0;height:100%}</style><div id="root"></div><script src="/journey.js"></script>`
  const { bridge } = await official('@deepseek-ai/dsh-client-connection/src/http-bridge.ts')
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const server = createServer(async (request, response) => {
    try {
      if (request.url?.startsWith('/api/')) {
        const rejected = ctx.connection.requestRejection(request)
        if (rejected) {
          response.writeHead(rejected).end()
          return
        }
        await bridge(request, response, handler, 1024 * 1024)
      } else if (request.url === '/journey.js') {
        const rejected = ctx.connection.requestRejection(request)
        if (rejected) {
          response.writeHead(rejected).end()
          return
        }
        response.writeHead(200, { 'content-type': 'text/javascript' }).end(script)
      } else if (ctx.connection.authorizeIndex(request, response)) response.writeHead(200, { 'content-type': 'text/html' }).end(html)
    } catch (error) {
      console.error('BROWSER_JOURNEY_HOST_FAILURE', error)
      response.writeHead(500).end('BROWSER_JOURNEY_HOST_FAILURE')
    }
  })
  await new Promise<void>(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
  onTestFinished(
    () =>
      new Promise<void>(resolveClosed => {
        server.closeAllConnections()
        server.close(() => resolveClosed())
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('BROWSER_JOURNEY_ADDRESS')
  const base = `http://127.0.0.1:${address.port}`
  // The existing installed browser runs headless with a fresh Playwright profile.
  const browser = await chromium.launch({ headless: true, ...(process.env.DSH_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_TEST_BROWSER_CHANNEL } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const failures: string[] = []
  let expectedApplyFailure = false
  let observedApplyFailure = 0
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (expectedApplyFailure && message.location().url.endsWith('/skills/directory/apply') && message.text().includes('400')) {
      observedApplyFailure++
      return
    }
    failures.push(message.text())
  })
  onTestFinished(async () => {
    if (process.env.PRESET_EVIDENCE_DIR && !page.isClosed())
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'browser-last-state.txt'), (await page.locator('body').innerText()) + '\n' + JSON.stringify(failures))
    if (!page.isClosed()) await page.evaluate(() => Reflect.get(window, 'journeyDispose')?.())
    await page.context().close()
    await browser.close()
    await record('browser-journey-cleanup', { browserConnected: browser.isConnected() })
  })
  expect((await page.request.get(base + USER_AGENT_ROUTES.list)).status()).toBe(401)
  await page.goto(ctx.connection.authenticatedUrl(base))
  await browserExpect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady') ?? Reflect.get(window, 'journeyFailure'))).toBe(true)
  await browserExpect(page.getByRole('heading', { name: 'Agent 配置', exact: true })).toBeVisible()
  const cancelledName = 'Cancelled Agent must not exist'
  await page.getByRole('button', { name: '＋ 添加 Agent', exact: true }).click()
  await page.getByRole('textbox', { name: '名称', exact: true }).fill(cancelledName)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await agents.list()).toEqual([])
  await page.getByRole('button', { name: '＋ 添加 Agent', exact: true }).click()
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('浏览器个人助手')
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('真实配置发布')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('BROWSER_PERSONAL_AGENT_INSTRUCTIONS')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await browserExpect(page.getByRole('status')).toHaveText('配置已保存')
  const saved = (await agents.list())[0]!
  expect(saved.publication).toBe('ready')
  expect((await ctx.agentPresets.list()).some(row => row.id === saved.preset)).toBe(true)
  expect(ctx.agentPresets.defaultId).toBe(originalDefault)
  expect(JSON.stringify(original.session.snapshotEvents())).toBe(existingEvents)
  await browserExpect(page.getByRole('navigation', { name: 'Agent 配置', exact: true })).toHaveText('提示词SkillMCP')
  await page.getByRole('button', { name: '‹ 返回 Agent 列表', exact: true }).click()
  const personalRow = page.locator('article').filter({ has: page.getByText('浏览器个人助手', { exact: true }) })
  await personalRow.getByRole('button', { name: /浏览器个人助手/ }).click()
  await page.getByLabel('\u66f4\u591a\u64cd\u4f5c', { exact: true }).click()
  const personalStart = page.getByRole('button', { name: '开始使用', exact: true })
  await browserExpect(personalStart).toBeEnabled()
  const toggle = page.getByRole('switch', { name: '启用 浏览器个人助手', exact: true })
  await toggle.click()
  await browserExpect(personalStart).toBeDisabled()
  await toggle.click()
  await browserExpect(personalStart).toBeEnabled()
  const foreign = await page.request.post(base + USER_AGENT_ROUTES.save, {
    headers: { origin: 'https://foreign.invalid' },
    data: { name: 'Untrusted', prompt: 'x', description: '', enabled: true }
  })
  expect(foreign.status()).toBe(403)
  await personalStart.click()
  await browserExpect.poll(() => started.length).toBe(1)
  const { forwardWebRequest } = await import(/* @vite-ignore */ `${core}/apps/desktop/src/web-document.ts`)
  const cookie = (await page.context().cookies(base)).map(value => `${value.name}=${value.value}`).join('; ')
  const nativeRequest = (origin: string) =>
    new Request('dsh-app://app' + USER_AGENT_ROUTES.enabled, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ id: saved.id, enabled: true })
    })
  expect((await forwardWebRequest(nativeRequest('dsh-app://app'), base, cookie)).status).toBe(200)
  expect((await forwardWebRequest(nativeRequest('dsh-app://untrusted'), base, cookie)).status).toBe(403)
  expect((await forwardWebRequest(nativeRequest('null'), base, cookie)).status).toBe(403)
  expect(started).toHaveLength(1)
  const session = started[0]!
  expect(ctx.agentPresets.composedPreset(session.ctx)).toBe(saved.preset)
  expect(
    ctx.tools
      .schemas(session)
      .map(tool => tool.name)
      .sort()
  ).toEqual(standard)
  expect(ctx.commands.list(session).map(command => command.name)).toContain('compact')
  expect(JSON.stringify(await ctx.systemPrompt.assemble({ scope: session, agent: session } as never))).toContain('BROWSER_PERSONAL_AGENT_INSTRUCTIONS')
  expect(ctx.agentPresets.defaultId).toBe(originalDefault)
  expect(JSON.stringify(original.session.snapshotEvents())).toBe(existingEvents)
  const skillSource = join(home, 'browser-skill-input')
  await mkdir(join(skillSource, 'references'), { recursive: true })
  await mkdir(join(skillSource, 'assets'))
  await writeFile(join(skillSource, 'SKILL.md'), '---\nname: browser-directory\ndescription: Browser directory fixture\n---\nBROWSER_BODY')
  await writeFile(join(skillSource, 'references/data.txt'), 'BROWSER_REFERENCE_BEFORE')
  await writeFile(join(skillSource, 'assets/blob.bin'), Buffer.from([0, 255, 13, 10]))
  await page.getByRole('button', { name: 'Skill', exact: true }).click()
  await page.getByRole('button', { name: '＋ 添加 Skill', exact: true }).click()
  await page.getByRole('button', { name: '从文件夹导入', exact: true }).click()
  await page.getByRole('textbox', { name: '宿主文件夹路径', exact: true }).fill(skillSource)
  await page.getByRole('button', { name: '读取可导入 Skill', exact: true }).click()
  await page.getByRole('button', { name: '导入所选 Skill', exact: true }).click()
  const skillRow = page.locator('article').filter({ has: page.getByText('browser-directory', { exact: true }) })
  await skillRow.getByRole('button', { name: '编辑', exact: true }).click()
  const editorUI = page.getByRole('region', { name: 'Skill 目录编辑器', exact: true })
  await editorUI.getByRole('button', { name: 'references/data.txt', exact: true }).click()
  await editorUI.getByRole('textbox', { name: 'Skill 正文', exact: true }).fill('BROWSER_MANUAL_REFERENCE')
  await editorUI.getByRole('button', { name: '写入文件', exact: true }).click()
  await browserExpect(editorUI.getByRole('status')).toContainText('有未应用修改')
  await editorUI.getByRole('button', { name: '应用修改', exact: true }).click()
  await browserExpect(editorUI.getByText('修改已应用，新聊天将使用完整新版本。', { exact: true })).toBeVisible()
  const afterManual = await agentOn(ctx, 'browser-skill-manual', saved.preset, undefined, home)
  const manualSkill = await ctx.skills.get('browser-directory', { scope: afterManual, cwd: home })
  expect(await readFile(join(manualSkill!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('BROWSER_MANUAL_REFERENCE')
  await editorUI.getByRole('textbox', { name: '相对文件路径', exact: true }).fill('references/new.txt')
  await editorUI.getByRole('button', { name: '新增文本文件', exact: true }).click()
  await editorUI.getByRole('textbox', { name: 'Skill 正文', exact: true }).fill('NEW_UNAPPLIED_FILE')
  await editorUI.getByRole('button', { name: '写入文件', exact: true }).click()
  await editorUI.getByRole('textbox', { name: '相对文件路径', exact: true }).fill('references/renamed.txt')
  await editorUI.getByRole('button', { name: '将当前文件改名为此路径', exact: true }).click()
  await browserExpect(editorUI.getByRole('button', { name: 'references/renamed.txt', exact: true })).toBeVisible()
  await editorUI.getByRole('button', { name: '删除文件', exact: true }).click()
  await editorUI.getByRole('button', { name: '确认删除文件', exact: true }).click()
  await browserExpect(editorUI.getByRole('button', { name: 'references/renamed.txt', exact: true })).toHaveCount(0)
  await editorUI.getByRole('button', { name: 'assets/blob.bin', exact: true }).click()
  await editorUI.getByLabel('替换二进制文件', { exact: true }).setInputFiles({ name: 'replacement.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 254, 1, 2]) })
  await browserExpect(editorUI.getByRole('button', { name: '写入文件', exact: true })).toBeDisabled()
  const workcopy = await agents.directories.open({ id: saved.id, name: 'browser-directory' })
  expect((await agents.directories.read({ id: saved.id, name: 'browser-directory', path: 'assets/blob.bin' })).data).toBe(Buffer.from([0, 254, 1, 2]).toString('base64'))
  await editorUI.getByRole('button', { name: 'SKILL.md', exact: true }).click()
  await editorUI.getByRole('textbox', { name: 'Skill 正文', exact: true }).fill('invalid YAML')
  await editorUI.getByRole('button', { name: '写入文件', exact: true }).click()
  expectedApplyFailure = true
  const invalidApply = page.waitForResponse(response => response.url().endsWith('/skills/directory/apply') && response.status() === 400)
  await editorUI.getByRole('button', { name: '应用修改', exact: true }).click()
  await invalidApply
  await browserExpect(editorUI.getByRole('alert')).toContainText('SKILL_DIRECTORY_INVALID')
  expectedApplyFailure = false
  expect(observedApplyFailure).toBe(1)
  await browserExpect(editorUI.getByRole('textbox', { name: 'Skill 正文', exact: true })).toHaveValue('invalid YAML')
  const afterFailure = await agentOn(ctx, 'browser-invalid-apply', saved.preset, undefined, home)
  expect((await ctx.skills.get('browser-directory', { scope: afterFailure, cwd: home }))?.content).toBe('BROWSER_BODY')
  await editorUI.getByRole('button', { name: '放弃未应用修改', exact: true }).click()
  await editorUI.getByRole('button', { name: '确认放弃修改', exact: true }).click()
  await browserExpect(editorUI.getByRole('button', { name: 'references/renamed.txt', exact: true })).toHaveCount(0)
  await editorUI.getByRole('button', { name: '让 Agent 修改', exact: true }).click()
  await browserExpect.poll(() => page.evaluate(() => Reflect.get(window, 'skillEditorSession')?.sessionId)).toBeTruthy()
  const browserEditor = await page.evaluate(() => Reflect.get(window, 'skillEditorSession'))
  const editorAgent = ctx.agents.list().find(agent => agent.id === browserEditor.sessionId)!
  expect(editorAgent.session.header.cwd).toBe(workcopy.cwd)
  expect(browserEditor.draft).toContain('skill_directory_apply')
  await completion(ctx, 262144, false, undefined, {
    tools: [
      { name: 'read', arguments: { file_path: join(workcopy.cwd, 'SKILL.md') } },
      {
        name: 'write',
        arguments: { file_path: join(workcopy.cwd, 'SKILL.md'), content: '---\nname: browser-directory\ndescription: Browser directory fixture\n---\nBROWSER_AGENT_BODY' }
      },
      { name: 'read', arguments: { file_path: join(workcopy.cwd, 'references/data.txt') } },
      { name: 'write', arguments: { file_path: join(workcopy.cwd, 'references/data.txt'), content: 'BROWSER_AGENT_REFERENCE' } },
      { name: 'skill_directory_apply', arguments: {} }
    ],
    checkpoint: ''
  })
  await turn(ctx, editorAgent, 'Complete the explicit fixture change to this Skill and apply it.')
  const afterAgent = await agentOn(ctx, 'browser-skill-agent', saved.preset, undefined, home)
  const agentSkill = await ctx.skills.get('browser-directory', { scope: afterAgent, cwd: home })
  expect(agentSkill?.content).toBe('BROWSER_AGENT_BODY')
  expect(await readFile(join(agentSkill!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('BROWSER_AGENT_REFERENCE')
  expect(await readFile(join(manualSkill!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('BROWSER_MANUAL_REFERENCE')
  expect(await readFile(join(skillSource, 'assets/blob.bin'))).toEqual(Buffer.from([0, 255, 13, 10]))
  await editorUI.getByRole('button', { name: '刷新变更', exact: true }).click()
  await browserExpect(editorUI.getByRole('textbox', { name: 'Skill 正文', exact: true })).toHaveValue(/BROWSER_AGENT_BODY/)
  await editorUI.getByRole('button', { name: '恢复上一可用版本', exact: true }).click()
  await browserExpect(editorUI.getByText('已恢复上一可用的完整版本。', { exact: true })).toBeVisible()
  const restoredBusiness = await agentOn(ctx, 'browser-restored-skill', saved.preset, undefined, home)
  expect((await ctx.skills.get('browser-directory', { scope: restoredBusiness, cwd: home }))?.content).toBe('BROWSER_BODY')
  await editorUI.getByRole('button', { name: 'SKILL.md', exact: true }).click()
  if (process.env.PRESET_EVIDENCE_DIR) {
    await page.screenshot({ path: join(process.env.PRESET_EVIDENCE_DIR, 'skill-editor-desktop.png') })
    await page.setViewportSize({ width: 520, height: 900 })
    await page.screenshot({ path: join(process.env.PRESET_EVIDENCE_DIR, 'skill-editor-narrow.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
  }
  await editorUI.getByRole('button', { name: '关闭编辑器', exact: true }).click()
  await page.getByRole('button', { name: '‹ 返回 Agent 列表', exact: true }).click()
  await page.getByRole('button', { name: /浏览器插件助手/ }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('BROWSER_PLUGIN_CUSTOMIZED')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await browserExpect(page.getByRole('status')).toHaveText('配置已保存')
  const plugin = await resources.pluginAgent('browser-plugin')
  expect(plugin).toMatchObject({ preset: 'browser-plugin', origin: 'plugin', prompt: 'BROWSER_PLUGIN_CUSTOMIZED', customized: true })
  expect(await readFile(join(home, 'browser-plugin.json'), 'utf8')).toBe(pluginPrompt)
  await page.getByRole('button', { name: 'MCP', exact: true }).click()
  await browserExpect(page.getByRole('heading', { name: '使用的 MCP', exact: true })).toBeVisible()
  expect(await page.getByRole('button', { name: '添加 MCP', exact: true }).count()).toBe(0)
  const cubeSwitch = page.getByRole('switch', { name: '启用 浏览器插件助手 的 Cube', exact: true })
  await browserExpect(cubeSwitch).toHaveAttribute('aria-checked', 'true')
  expect((await cubeSwitch.boundingBox())?.width).toBe(36)
  if (process.env.PRESET_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PRESET_EVIDENCE_DIR, 'plugin-cube.png') })
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('MUST_NOT_SAVE_CANCELLED_PROMPT')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await browserExpect(page.getByRole('heading', { name: 'Agent 配置', exact: true })).toBeVisible()
  expect((await resources.pluginAgent('browser-plugin')).prompt).toBe('BROWSER_PLUGIN_CUSTOMIZED')
  await page.getByRole('button', { name: /浏览器插件助手/ }).click()
  await page.getByRole('button', { name: '‹ 返回 Agent 列表', exact: true }).click()
  const pluginRow = page.locator('article').filter({ has: page.getByText('浏览器插件助手', { exact: true }) })
  await pluginRow.getByRole('button', { name: /浏览器插件助手/ }).click()
  await page.getByLabel('\u66f4\u591a\u64cd\u4f5c', { exact: true }).click()
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await browserExpect.poll(() => started.length).toBe(2)
  expect(ctx.agentPresets.composedPreset(started[1].ctx)).toBe('browser-plugin')
  expect(ctx.agentPresets.defaultId).toBe(originalDefault)
  expect(failures.filter(message => !message.includes('403'))).toEqual([])
  if (process.env.PRESET_EVIDENCE_DIR) {
    await page.screenshot({ path: join(process.env.PRESET_EVIDENCE_DIR, 'browser-agent-start.png') })
    await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'browser-agent-start.aria.txt'), await page.locator('body').ariaSnapshot())
  }
  await record('browser-agent-journey', {
    stage: 'browser-real-core',
    ui: 'actual Manage client plus official Renderer/Layout',
    authentication: 'temporary Core browser cookie',
    configuration: 'actual authenticated Fetch routes',
    cancelPreserved: true,
    enableRefresh: true,
    tabs: ['prompt', 'skill', 'mcp'],
    session: { id: session.id, preset: saved.preset, cwd: session.session.header.cwd },
    nativeStartPort: 'test HTTP transport to real Core Agent creation',
    standardToolsEqual: true,
    defaultPreserved: true,
    existingSessionPreserved: true,
    unauthenticated: 401,
    crossOrigin: 403,
    nativeForwarding: 'actual Core desktop forwardWebRequest, temporary Host cookie, trusted app only',
    pluginPresetPreserved: true,
    pluginSourceUntouched: true,
    installedClient: false,
    native: 'owner lane',
    skillDirectory: {
      import: 'folder',
      manualAttachmentApplied: true,
      newRenameDelete: true,
      binaryReplacement: true,
      invalidApplyPreserved: true,
      reset: true,
      restore: true,
      editorSessionId: editorAgent.id,
      cwd: workcopy.cwd,
      officialTools: ['read', 'write', 'skill_directory_apply'],
      nativeNavigationPort: 'fixture; complete profile navigation remains owner lane'
    },
    model: 'local scripted completion through actual official Agent loop',
    geaBusiness: 'not-invoked'
  })
}, 60_000)
