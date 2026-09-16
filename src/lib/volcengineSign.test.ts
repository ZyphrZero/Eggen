import { describe, expect, it } from 'vitest'
import { buildSignedQuery } from './volcengineSign'

/** 官方 SDK @volcengine/openapi 的 Signer.getSignUrl 对同一输入（含 X-NotSignBody 为空串）的输出 */
const OFFICIAL_SDK_OUTPUT =
  'Action=QueryBalanceAcct&Version=2022-01-01&X-Algorithm=HMAC-SHA256&X-Credential=AKTESTACCESSKEYID%2F20260915%2Fcn-shanghai%2Fbilling%2Frequest&X-Date=20260915T042841Z&X-NotSignBody=&X-SignedHeaders=&X-SignedQueries=Action%3BVersion%3BX-Algorithm%3BX-Credential%3BX-Date%3BX-NotSignBody%3BX-SignedHeaders&X-Signature=d434741c7a873a27d7c42f28a6690dfcfe249a5c22e9b64f7fbff9305dcd9212'

const BASE_OPTIONS = {
  method: 'POST',
  pathname: '/',
  service: 'billing',
  region: 'cn-shanghai',
  params: { Action: 'QueryBalanceAcct', Version: '2022-01-01' },
  date: new Date('2026-09-15T04:28:41.000Z'),
}

const CREDENTIALS = { accessKeyId: 'AKTESTACCESSKEYID', secretAccessKey: 'test-secret-access-key' }

describe('volcengineSign', () => {
  it('matches the official SDK byte for byte when X-NotSignBody is empty', async () => {
    const query = await buildSignedQuery({ ...BASE_OPTIONS, notSignBody: '' }, CREDENTIALS)
    expect(query).toBe(OFFICIAL_SDK_OUTPUT)
  })

  it('defaults X-NotSignBody to a truthy value', async () => {
    const query = await buildSignedQuery(BASE_OPTIONS, CREDENTIALS)
    const params = new URLSearchParams(query)

    expect(params.get('X-NotSignBody')).toBe('1')
    expect(params.get('X-Algorithm')).toBe('HMAC-SHA256')
    expect(params.get('X-Credential')).toBe('AKTESTACCESSKEYID/20260915/cn-shanghai/billing/request')
    expect(params.get('X-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(params.get('X-SignedQueries')).toBe('Action;Version;X-Algorithm;X-Credential;X-Date;X-NotSignBody;X-SignedHeaders')
  })

  it('includes the session token for temporary credentials', async () => {
    const query = await buildSignedQuery(BASE_OPTIONS, { ...CREDENTIALS, sessionToken: 'sts-token' })
    const params = new URLSearchParams(query)

    expect(params.get('X-Security-Token')).toBe('sts-token')
    expect(params.get('X-SignedQueries')).toContain('X-Security-Token')
  })

  it('escapes the credential slash inside the signed query', async () => {
    const query = await buildSignedQuery(BASE_OPTIONS, CREDENTIALS)
    expect(query).toContain('X-Credential=AKTESTACCESSKEYID%2F20260915%2Fcn-shanghai%2Fbilling%2Frequest')
  })
})
