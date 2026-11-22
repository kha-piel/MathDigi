import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSEParser, loadHistory, persistMessage, rateLimitMessage } from './service'
import { limitHistory, useTutorStore, TUTOR_EXAM_DISABLED } from './store'

vi.mock('../../lib/supabase/client', () => ({ getSupabaseBrowserClient: () => { throw new Error('table missing') } }))
afterEach(() => { useTutorStore.getState().clearTutorContext(); useTutorStore.getState().setTutorDisabled(null); useTutorStore.getState().setActiveController(null) })

describe('SSE parser', () => {
  it('parses fragmented frames and multiple events', () => {
    const receive = vi.fn()
    const parse = createSSEParser(receive)
    parse('data: {"type":"delta","te')
    parse('xt":"Toán"}\r\n\r\ndata: {"type":"done"}\n\n')
    expect(receive.mock.calls).toEqual([[{ type: 'delta', text: 'Toán' }], [{ type: 'done' }]])
  })
  it('ignores empty frames and comments', () => {
    const receive = vi.fn()
    createSSEParser(receive)(': heartbeat\n\n\n\n')
    expect(receive).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and forwards server errors', () => {
    expect(() => createSSEParser(vi.fn())('data: bad\n\n')).toThrow()
    const receive = vi.fn()
    createSSEParser(receive)('data: {"type":"error","message":"Lỗi"}\n\n')
    expect(receive).toHaveBeenCalledWith({ type: 'error', message: 'Lỗi' })
  })
})

it('sets and clears context', () => {
  useTutorStore.getState().setTutorContext({ question_content: 'x+1' })
  expect(useTutorStore.getState().context?.question_content).toBe('x+1')
  useTutorStore.getState().clearTutorContext()
  expect(useTutorStore.getState().context).toBeNull()
})
it('disables tutor and aborts a stream when an exam starts, then re-enables after submission', () => {
  const state = useTutorStore.getState()
  const controller = new AbortController()
  state.setTutorContext({ question_content: 'x', correct_answer: '1' })
  state.setActiveController(controller)
  state.setTutorDisabled(TUTOR_EXAM_DISABLED)
  expect(controller.signal.aborted).toBe(true)
  expect(useTutorStore.getState().disabledReason).toBe(TUTOR_EXAM_DISABLED)
  expect(useTutorStore.getState().context).toBeNull()
  const blocked = new AbortController()
  state.setActiveController(blocked)
  expect(blocked.signal.aborted).toBe(true)
  state.setTutorDisabled(null)
  state.setTutorContext({ question_content: 'x', correct_answer: '1', solution: 'x=1' })
  expect(useTutorStore.getState().disabledReason).toBeNull()
  expect(useTutorStore.getState().context?.solution).toBe('x=1')
})
it('keeps newest 50 messages, including empty history', () => {
  expect(limitHistory([])).toEqual([])
  const messages = Array.from({ length: 55 }, (_, i) => ({ role: 'user' as const, content: String(i) }))
  expect(limitHistory(messages)).toEqual(messages.slice(5))
  expect(messages).toHaveLength(55)
})
it('degrades gracefully when history is unavailable', async () => {
  expect(await loadHistory('student')).toEqual([])
  expect(await persistMessage('student', { role: 'user', content: 'x' }, null)).toBe(false)
})

it.each([null, '', 'unreadable', '-1', '0'])('does not invent a retry delay for %s', (value) => {
  expect(rateLimitMessage(value)).toBe('Bạn hỏi quá nhanh. Hãy thử lại sau.')
})

it.each([['30', '30 giây'], ['90', '2 phút'], ['7200', '2 giờ'], ['86400', '24 giờ']])('formats retry delay %s sensibly', (value, delay) => {
  expect(rateLimitMessage(value)).toBe(`Bạn hỏi quá nhanh. Hãy thử lại sau khoảng ${delay}.`)
})

it('supports HTTP-date Retry-After headers', () => {
  expect(rateLimitMessage('Wed, 21 Oct 2015 07:30:00 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toContain('2 phút')
})
