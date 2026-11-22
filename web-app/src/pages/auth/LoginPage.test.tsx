// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { PublicOnlyRoute } from '../../features/auth/components/PublicOnlyRoute'
import { ProtectedRoute } from '../../features/auth/components/ProtectedRoute'
import { useAuthSessionStore } from '../../features/auth/store/auth-session-store'
import { LoginPage } from './LoginPage'

vi.mock('../../features/auth/services/auth-service', () => ({
  loginWithIdentity: vi.fn().mockResolvedValue(undefined),
}))

it('navigates directly home only after the deferred auth profile reaches the store', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthSessionStore.setState({ status: 'anonymous', user: null, errorMessage: null })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const router = createMemoryRouter([
    { path: '/login', element: <PublicOnlyRoute><LoginPage /></PublicOnlyRoute> },
    { path: '/home', element: <ProtectedRoute><div>Home</div></ProtectedRoute> },
  ], { initialEntries: ['/login'] })
  const paths: string[] = []
  const unsubscribe = router.subscribe((state) => paths.push(state.location.pathname))
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    const inputs = container.querySelectorAll('input')
    await act(async () => {
      for (const [index, input] of Array.from(inputs).entries()) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, index === 0 ? 'student@example.test' : 'password')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(paths).toEqual([])
    expect(router.state.location.pathname).toBe('/login')
    await act(async () => useAuthSessionStore.getState().setAuthenticated({
      id: 'student', email: 'student@example.test', role: 'student',
    }))
    expect(paths).toEqual(['/home'])
    expect(container.textContent).toBe('Home')
  } finally {
    unsubscribe()
    await act(async () => root.unmount())
    router.dispose()
    container.remove()
  }
})
