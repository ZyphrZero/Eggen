import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

async function embedDefaultConfig(value: string) {
  const source = value.trim()
  if (!source) return source

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source)
    if (!url.pathname.toLowerCase().endsWith('.json')) return source

    const response = await fetch(source)
    if (!response.ok) throw new Error(`预置配置请求失败：HTTP ${response.status}`)
    return `embedded-config:${Buffer.from(await response.text()).toString('base64')}`
  }

  const fileUrl = source.startsWith('file://')
  const path = fileUrl ? fileURLToPath(source) : resolve(source)
  if (!existsSync(path)) {
    if (fileUrl || source.toLowerCase().endsWith('.json')) throw new Error(`预置配置文件不存在：${path}`)
    return source
  }
  return `embedded-config:${Buffer.from(readFileSync(path)).toString('base64')}`
}

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const defaultApiUrl = await embedDefaultConfig(process.env.VITE_DEFAULT_API_URL ?? env.VITE_DEFAULT_API_URL ?? '')
  if (defaultApiUrl.startsWith('embedded-config:')) process.env.VITE_DEFAULT_API_URL = defaultApiUrl
  // vitest 的 command 同样是 serve，不排除会把开发代理注入测试环境，导致「部署无代理」相关的用例失败。
  const devProxyConfig = command === 'serve' && !process.env.VITEST ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: {
        '/api/ark/': { target: 'http://127.0.0.1:8787' },
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
  }
})
