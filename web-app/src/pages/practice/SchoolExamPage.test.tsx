// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SchoolExamPaperRecord, SchoolExamQuestionRecord } from '../../features/practice/types/school-exam-types'
import { useTutorStore } from '../../features/tutor-chat/store'
import { SchoolExamPage } from './SchoolExamPage'

const service = vi.hoisted(() => ({ fetchSchoolExamById: vi.fn(), fetchSchoolExamQuestions: vi.fn() }))
vi.mock('../../features/practice/services/school-exam-service', () => ({
  ...service, normalizeAnswer: (value: string) => value.trim(),
}))
vi.mock('../../features/auth/store/auth-session-store', () => ({
  useAuthSessionStore: (selector: (state: object) => unknown) => selector({ user: null }),
}))

let root: Root
let container: HTMLDivElement
let router: ReturnType<typeof createMemoryRouter>
let exam: SchoolExamPaperRecord
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useTutorStore.getState().clearTutorContext()
  useTutorStore.getState().setTutorDisabled(null)
  const parts = ['multiple_choice', 'true_false', 'short_answer'] as const
  exam = {
    examId: 'test', examTitle: 'Luyện tập', schoolName: 'Trường', city: '', subjectId: 'math', subjectName: 'Toán',
    year: 2026, durationMinutes: 0, pdfUrl: '', displayVariantCode: '', answerKeyProvided: true, tags: [],
    sections: parts.map((partCode, index) => ({
      sectionId: partCode, partCode, title: partCode, instructions: '', startQuestionNumber: index + 1,
      endQuestionNumber: index + 1, displayOrder: index, optionsPerQuestion: 2, statementCount: 1,
    })),
  }
  const records: SchoolExamQuestionRecord[] = parts.map((questionType, index) => ({
    questionId: `q${index + 1}`, examId: 'test', questionNumber: index + 1, questionType, difficultyLevel: 1,
    questionText: `Nội dung ${index + 1}`, topic: 'Hàm số', obsidianSourcePath: '', hasImage: false, assetPaths: [],
    answerValue: ['A', 'D', '42'][index],
    options: questionType === 'multiple_choice' ? [{ optionLabel: 'A', optionText: 'Đáp án A', displayOrder: 1 }] : [],
    statements: questionType === 'true_false' ? [{ label: 'a', text: 'Mệnh đề đúng' }] : [],
  }))
  service.fetchSchoolExamById.mockResolvedValue(exam)
  service.fetchSchoolExamQuestions.mockResolvedValue(records)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  router = createMemoryRouter([{ path: '/school/:examId', element: <SchoolExamPage /> }], { initialEntries: ['/school/test'] })
})
afterEach(async () => {
  await act(async () => root.unmount())
  router.dispose()
  expect(useTutorStore.getState().context).toBeNull()
  expect(useTutorStore.getState().disabledReason).toBeNull()
  container.remove()
})

async function renderExam() {
  await act(async () => root.render(<RouterProvider router={router} />))
}

it('sets first-question context before submission and follows answers and keyboard focus in untimed practice', async () => {
  await renderExam()
  expect(useTutorStore.getState().context).toMatchObject({
    question_number: 1, question_content: expect.stringContaining('Nội dung 1'),
    options: ['A. Đáp án A'], correct_answer: 'A', question_type: 'multiple_choice',
  })
  const cards = container.querySelectorAll('article')
  await act(async () => cards[0].querySelector('input')!.click())
  expect(useTutorStore.getState().context?.student_answer).toBe('A')
  await act(async () => cards[1].querySelector('input')!.click())
  expect(useTutorStore.getState().context).toMatchObject({
    question_number: 2, options: ['a. Mệnh đề đúng'], student_answer: 'D', correct_answer: 'D',
  })
  const shortAnswer = cards[2].querySelector('input')!
  await act(async () => shortAnswer.focus())
  expect(useTutorStore.getState().context?.question_number).toBe(3)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(shortAnswer, '42')
    shortAnswer.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(useTutorStore.getState().context).toMatchObject({ question_number: 3, student_answer: '42', correct_answer: '42' })
  expect(useTutorStore.getState().disabledReason).toBeNull()
})

it('keeps timed exams disabled with no context even after a question is answered', async () => {
  exam.durationMinutes = 30
  await renderExam()
  await act(async () => container.querySelector('article input')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(useTutorStore.getState().context).toBeNull()
  expect(useTutorStore.getState().disabledReason).not.toBeNull()
})

it('clears stale context when there are no questions', async () => {
  exam.sections = []
  service.fetchSchoolExamQuestions.mockResolvedValue([])
  useTutorStore.getState().setTutorContext({ question_content: 'Câu cũ' })
  await renderExam()
  expect(useTutorStore.getState().context).toBeNull()
})

it('does not retain context when loading the exam fails', async () => {
  service.fetchSchoolExamById.mockRejectedValueOnce(new Error('Không tải được đề'))
  useTutorStore.getState().setTutorContext({ question_content: 'Câu cũ' })
  await renderExam()
  expect(useTutorStore.getState().context).toBeNull()
  expect(container.textContent).toContain('Không tải được đề')
})
