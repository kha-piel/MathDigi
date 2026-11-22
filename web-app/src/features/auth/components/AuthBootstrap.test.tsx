// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthBootstrap } from './AuthBootstrap'
import { useAuthSessionStore, type AuthUserSummary } from '../store/auth-session-store'

const service = vi.hoisted(() => ({ cached: vi.fn(), current: vi.fn(), listen: vi.fn() }))
vi.mock('../../../lib/config/env', () => ({ hasSupabaseEnv: () => true }))
vi.mock('../services/auth-service', () => ({
  getCachedAuthUserSummary: service.cached,
  getCurrentAuthUserSummary: service.current,
  onAuthStateChange: service.listen,
}))

const user: AuthUserSummary = { id: 'user-1', email: 'user@example.test', role: 'admin' }
let root: Root
let container: HTMLDivElement
let emit: (user: AuthUserSummary | null) => void
let resolveCached: (user: AuthUserSummary | null) => void
let resolveCurrent: (user: AuthUserSummary | null) => void

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  useAuthSessionStore.setState({ status: 'booting', user: null, errorMessage: null })
  service.cached.mockImplementation(() => new Promise((resolve) => { resolveCached = resolve }))
  service.current.mockImplementation(() => new Promise((resolve) => { resolveCurrent = resolve }))
  service.listen.mockImplementation((listener) => {
    emit = listener
    return vi.fn()
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('stays anonymous when sign-out precedes pending cached and current user results', async () => {
  await act(async () => root.render(<AuthBootstrap>Ready</AuthBootstrap>))
  emit(null)
  await act(async () => {
    resolveCached(user)
    resolveCurrent(user)
  })
  expect(useAuthSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null })
})

it('lets a newer listener user win over pending bootstrap results', async () => {
  await act(async () => root.render(<AuthBootstrap>Ready</AuthBootstrap>))
  emit({ ...user, id: 'user-2' })
  await act(async () => {
    resolveCached(user)
    resolveCurrent(user)
  })
  expect(useAuthSessionStore.getState().user?.id).toBe('user-2')
  emit(null)
  expect(useAuthSessionStore.getState().status).toBe('anonymous')
  emit(user)
  expect(useAuthSessionStore.getState().user).toEqual(user)
})

it('restores from cache and allows current-user verification until a listener event arrives', async () => {
  await act(async () => root.render(<AuthBootstrap>Ready</AuthBootstrap>))
  await act(async () => resolveCached(user))
  expect(useAuthSessionStore.getState()).toMatchObject({ status: 'authenticated', user })
  const verifiedUser = { ...user, role: 'teacher' }
  await act(async () => resolveCurrent(verifiedUser))
  expect(useAuthSessionStore.getState().user).toEqual(verifiedUser)
  emit(null)
  expect(useAuthSessionStore.getState().status).toBe('anonymous')
})

it('finishes anonymously when both bootstrap lookups have no session', async () => {
  await act(async () => root.render(<AuthBootstrap>Ready</AuthBootstrap>))
  await act(async () => {
    resolveCached(null)
    resolveCurrent(null)
  })
  expect(useAuthSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null })
})

it('reports a bootstrap error when no auth state has resolved', async () => {
  service.cached.mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<AuthBootstrap>Ready</AuthBootstrap>))
  expect(useAuthSessionStore.getState()).toMatchObject({ status: 'anonymous', errorMessage: 'offline' })
})
