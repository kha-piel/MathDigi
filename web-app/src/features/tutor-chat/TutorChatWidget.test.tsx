// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TutorChatWidget } from './TutorChatWidget'
import { useTutorStore } from './store'

const service = vi.hoisted(() => ({
  loadHistory: vi.fn(), persistMessage: vi.fn(), deleteHistory: vi.fn(), streamTutor: vi.fn(),
}))
vi.mock('./service', () => service)
vi.mock('../auth/store/auth-session-store', () => ({
  useAuthSessionStore: (selector: (state: object) => unknown) => selector({ user: { id: 'student' } }),
}))
vi.mock('../../components/ui/MarkdownContent', () => ({ MarkdownContent: ({ content }: { content: string }) => <p>{content}</p> }))

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  service.loadHistory.mockResolvedValue([])
  service.persistMessage.mockResolvedValue(true)
  service.deleteHistory.mockResolvedValue(true)
  service.streamTutor.mockReset()
  useTutorStore.getState().setTutorDisabled(null)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<TutorChatWidget />))
  await click('Mở gia sư Toán')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === label || element.textContent === label)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

async function typeDraft(value: string) {
  const input = document.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

it('retries the failed message without clearing a separate unsent draft', async () => {
  service.streamTutor.mockRejectedValueOnce(new Error('Lỗi mạng')).mockResolvedValueOnce(undefined)
  await typeDraft('Giải bài toán này')
  await submit()
  await typeDraft('Bản nháp câu hỏi tiếp theo')
  await click('Thử lại')
  expect(service.streamTutor.mock.calls[1][0]).toEqual([{ role: 'user', content: 'Giải bài toán này' }])
  expect(document.querySelector('textarea')!.value).toBe('Bản nháp câu hỏi tiếp theo')
})
