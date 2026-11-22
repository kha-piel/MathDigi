import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/exam/services/exam-ai-service.ts', import.meta.url), 'utf8')
  .replace("import { env } from '../../../lib/config/env'", "const env = { aiApiBaseUrl: 'http://test' }")
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
const { sendExamChatMessage, requestAutoExplanation } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const input = { questionContent: '1+1?', selectedAnswer: '1', correctAnswer: '2', prompt: 'Help' }
const friendly = 'Gia sư AI đang tạm thời không phản hồi được. Vui lòng thử lại sau.'
const originalFetch = globalThis.fetch
const originalError = console.error
const logs = []
console.error = (...args) => logs.push(args.join(' '))

try {
  for (const request of [sendExamChatMessage, requestAutoExplanation]) {
    globalThis.fetch = async () => Response.json({ status: 'success', explanation: 'Hai' })
    assert.equal(await request(input), 'Hai')
    for (const response of [
      () => new Response('{"private":"invalid key"}', { status: 502 }),
      () => Response.json({ status: 'error', explanation: 'private provider error' }),
      () => Response.json({ status: 'err', explanation: 'private provider error' }),
      () => Response.json({ status: 'success', explanation: '' }),
      () => Response.json(null),
      () => new Response('not json'),
      () => { throw new Error('private network failure') },
    ]) {
      globalThis.fetch = async () => response()
      await assert.rejects(request(input), { message: friendly })
    }
  }
  assert.ok(logs.some((line) => line.includes('invalid key')))
  assert.ok(logs.some((line) => line.includes('private provider error')))
  console.log('PASS: tutor success, HTTP/error status, empty/malformed body, network failures, and diagnostic logging (both chat entry points)')
} finally {
  globalThis.fetch = originalFetch
  console.error = originalError
}
