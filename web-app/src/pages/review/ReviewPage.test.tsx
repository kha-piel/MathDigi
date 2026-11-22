// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createExamRuntimeSession, type ExamRuntimeSession } from '../../features/exam/core/exam-session'
import type { ExamDraftSession } from '../../features/exam/store/exam-draft-store'
import { useTutorStore } from '../../features/tutor-chat/store'
import { ReviewPage } from './ReviewPage'

const fixture = vi.hoisted(() => ({ session: null as ExamDraftSession | null, runtime: null as ExamRuntimeSession | null }))
vi.mock('../../features/exam/store/exam-draft-store', () => ({
  useExamDraftStore: (selector: (state: object) => unknown) => selector({ sessions: { test: fixture.session } }),
}))
vi.mock('../../features/exam/store/exam-runtime-store', () => ({
  useExamRuntimeStore: (selector: (state: object) => unknown) => selector({ sessions: { test: fixture.runtime } }),
}))
vi.mock('../../features/exam/services/exam-review-service', () => ({ fetchPersistedAttemptReview: vi.fn() }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useTutorStore.getState().clearTutorContext()
  fixture.session = {
    sessionId: 'test', title: 'Toán', subjectId: 'math', subjectName: 'Toán', topicId: 'topic', topicName: 'Hàm số',
    difficultyLevel: 1, difficultyLabel: 'Cơ bản', durationMinutes: 0, createdAt: 1,
    questions: [1, 2].map((number) => ({ questionId: `q${number}`, topicId: 'topic', content: `Câu hỏi ${number}`, level: 1, questionType: 'short_answer', answers: [], acceptedResponses: [String(number)], explanation: `Lời giải ${number}` })),
  }
  fixture.runtime = { ...createExamRuntimeSession(fixture.session), submittedAt: 1 }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  expect(useTutorStore.getState().context).toBeNull()
  container.remove()
})

async function renderReview() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/review/test']}><Routes><Route path="/review/:sessionId" element={<ReviewPage />} /></Routes></MemoryRouter>))
}

it('defaults to the first review question and retains the last clicked question on rerender', async () => {
  await renderReview()
  expect(useTutorStore.getState().context).toMatchObject({ question_number: 1, question_content: 'Câu hỏi 1', solution: 'Lời giải 1' })
  const second = [...container.querySelectorAll('h3')].find((heading) => heading.textContent === 'Câu 2')!
  await act(async () => second.closest('section')!.click())
  expect(useTutorStore.getState().context?.question_number).toBe(2)
  await renderReview()
  expect(useTutorStore.getState().context?.question_number).toBe(2)
})

it('clears stale context when there are no review questions', async () => {
  fixture.session!.questions = []
  fixture.runtime = { ...createExamRuntimeSession(fixture.session!), submittedAt: 1 }
  useTutorStore.getState().setTutorContext({ question_content: 'Câu cũ' })
  await renderReview()
  expect(useTutorStore.getState().context).toBeNull()
})
