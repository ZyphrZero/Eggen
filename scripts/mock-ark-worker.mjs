import { readFile } from 'node:fs/promises'
import { Miniflare, Response } from 'miniflare'
import { transformWithEsbuild } from 'vite'

const source = await readFile(new URL('../worker/arkTasks.ts', import.meta.url), 'utf8')
const script = (await transformWithEsbuild(source, 'arkTasks.ts', { target: 'es2022' })).code
const image = await readFile(new URL('../public/eggen-icon.png', import.meta.url))
const delay = Number(process.env.MOCK_DELAY_MS ?? 15000)
let submissions = 0

const mf = new Miniflare({
  modules: true,
  script,
  port: Number(process.env.MOCK_WORKER_PORT ?? 8787),
  compatibilityDate: '2026-05-07',
  durableObjects: { ARK_TASKS: { className: 'ArkTask', useSQLite: true } },
  serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
  outboundService: async (request) => {
    if (request.url === 'https://eggen.test/mock-image.png') {
      return new Response(image, { headers: { 'Content-Type': 'image/png' } })
    }
    if (request.url !== 'https://ark.cn-beijing.volces.com/api/v3/images/generations') {
      throw new Error('Unexpected mock upstream URL')
    }
    submissions++
    console.log(`Mock Ark submission ${submissions}`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return Response.json({ data: [{ url: 'https://eggen.test/mock-image.png', size: '512x512' }] })
  },
})

console.log(`Mock Ark Worker: ${await mf.ready}, delay: ${delay} ms`)
process.on('SIGINT', async () => {
  await mf.dispose()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  await mf.dispose()
  process.exit(0)
})
