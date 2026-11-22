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

it.each([false, true])('preserves the draft when requesting a solution (stream fails: %s)', async (fails) => {
  const context = { question_number: 1, question_content: 'Tính 1 + 1', correct_answer: '2', solution: '1 + 1 = 2' }
  await act(async () => useTutorStore.getState().setTutorContext(context))
  if (fails) service.streamTutor.mockRejectedValueOnce(new Error('Lỗi mạng'))
  else service.streamTutor.mockResolvedValueOnce(undefined)
  await typeDraft('Câu hỏi chưa gửi')
  await click('Xem lời giải')
  expect(service.streamTutor.mock.calls[0].slice(0, 3)).toEqual([
    [{ role: 'user', content: 'Hãy trình bày lời giải đầy đủ cho câu hỏi này.' }], context, true,
  ])
  expect(document.querySelector('textarea')!.value).toBe('Câu hỏi chưa gửi')
  await act(async () => useTutorStore.getState().clearTutorContext())
})

it.each(['textarea', 'header button', '[role="dialog"]'])('closes on Escape from %s without discarding the draft', async (selector) => {
  await typeDraft('Bản nháp')
  const target = document.querySelector<HTMLElement>(selector)!
  target.focus()
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('[aria-label="Mở gia sư Toán"]')?.getAttribute('aria-expanded')).toBe('false')
  await click('Mở gia sư Toán')
  expect(document.querySelector('textarea')!.value).toBe('Bản nháp')
})

it('mounts the fixed launcher outside the page layout', () => {
  const launcher = document.querySelector('[aria-label="Đóng gia sư Toán"]')!
  expect(container.contains(launcher)).toBe(false)
  expect(launcher.parentElement!.parentElement).toBe(document.body)
  expect(launcher.parentElement!.className).toContain('fixed bottom-4 right-4')
})

it('removes the empty assistant placeholder on a stream error', async () => {
  service.streamTutor.mockRejectedValueOnce(new Error('Lỗi mạng'))
  await typeDraft('Câu hỏi')
  await submit()
  expect(document.body.textContent).toContain('Lỗi mạng')
  expect(document.body.textContent).not.toContain('Đang suy nghĩ…')
  expect([...document.querySelectorAll('p')].some((p) => p.textContent === 'Gia sư')).toBe(false)
})

it('removes the empty assistant placeholder when stopped', async () => {
  service.streamTutor.mockImplementationOnce((_messages, _context, _reveal, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  await typeDraft('Câu hỏi')
  await submit()
  expect(document.body.textContent).toContain('Đang suy nghĩ…')
  await click('Dừng')
  expect(document.body.textContent).not.toContain('Đang suy nghĩ…')
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it('retains partial assistant content when a stream fails', async () => {
  service.streamTutor.mockImplementationOnce(async (_messages, _context, _reveal, _signal, onDelta: (text: string) => void) => {
    onDelta('Gợi ý bước đầu')
    throw new Error('Mất kết nối')
  })
  await typeDraft('Câu hỏi')
  await submit()
  expect(document.body.textContent).toContain('Gợi ý bước đầu')
  expect(document.body.textContent).not.toContain('Đang suy nghĩ…')
})
