// @vitest-environment jsdom
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { onAuthStateChange } from './auth-service'

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  from: vi.fn(),
  query: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../../lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { onAuthStateChange: mocks.listen },
    from: mocks.from,
  }),
}))

const session = { user: { id: 'user-1', email: 'user@example.test', user_metadata: {} } } as Session
let emit: (event: string, session: Session | null) => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.listen.mockImplementation((listener) => {
    emit = listener
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
  })
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: mocks.query }) }) })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('defers Supabase queries until after the auth callback and keeps the profile role', async () => {
  mocks.query.mockResolvedValue({ data: { role: 'admin', email: session.user.email }, error: null })
  const callback = vi.fn()
  onAuthStateChange(callback)
  expect(emit('INITIAL_SESSION', session)).toBeUndefined()
  expect(mocks.from).not.toHaveBeenCalled()
  expect(callback).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1', role: 'admin' }))
})

it('reports an empty session without fetching a profile', async () => {
  const callback = vi.fn()
  onAuthStateChange(callback)
  emit('SIGNED_OUT', null)
  await vi.advanceTimersByTimeAsync(0)
  expect(callback).toHaveBeenCalledExactlyOnceWith(null)
  expect(mocks.from).not.toHaveBeenCalled()
})

it.each([
  ['missing profile', () => Promise.resolve({ data: null, error: null })],
  ['query error', () => Promise.resolve({ data: null, error: new Error('offline') })],
  ['rejected query', () => Promise.reject(new Error('offline'))],
  ['timeout', () => new Promise(() => {})],
])('falls back safely for %s', async (_name, query) => {
  mocks.query.mockImplementation(query)
  const callback = vi.fn()
  onAuthStateChange(callback)
  emit('SIGNED_IN', session)
  await vi.advanceTimersByTimeAsync(6000)
  expect(callback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'user-1' }))
})

it('ignores a queued profile resolution after sign-out', async () => {
  const callback = vi.fn()
  onAuthStateChange(callback)
  emit('SIGNED_IN', session)
  emit('SIGNED_OUT', null)
  await vi.advanceTimersByTimeAsync(0)
  expect(callback).toHaveBeenCalledExactlyOnceWith(null)
  expect(mocks.from).not.toHaveBeenCalled()
})

it.each(['sign-out', 'newer sign-in', 'unsubscribe'])('ignores an in-flight stale result after %s', async (action) => {
  let resolve!: (value: object) => void
  mocks.query.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  mocks.query.mockResolvedValue({ data: { role: 'teacher' }, error: null })
  const callback = vi.fn()
  const unsubscribe = onAuthStateChange(callback)
  emit('SIGNED_IN', session)
  await vi.advanceTimersByTimeAsync(0)
  if (action === 'unsubscribe') unsubscribe()
  else if (action === 'sign-out') emit('SIGNED_OUT', null)
  else emit('SIGNED_IN', { ...session, user: { ...session.user, id: 'user-2' } })
  await vi.advanceTimersByTimeAsync(0)
  resolve({ data: { role: 'admin' }, error: null })
  await vi.advanceTimersByTimeAsync(0)
  if (action === 'unsubscribe') {
    expect(callback).not.toHaveBeenCalled()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  } else if (action === 'sign-out') {
    expect(callback).toHaveBeenCalledExactlyOnceWith(null)
  } else {
    expect(callback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'user-2', role: 'teacher' }))
  }
})
