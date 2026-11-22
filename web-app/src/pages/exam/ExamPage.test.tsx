import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { createExamRuntimeSession, type ExamRuntimeSession } from '../../features/exam/core/exam-session'
import type { ExamDraftSession } from '../../features/exam/store/exam-draft-store'
import { ExamPage } from './ExamPage'

const fixture = vi.hoisted(() => ({ session: null as ExamDraftSession | null, runtime: null as ExamRuntimeSession | null }))
vi.mock('../../features/exam/store/exam-draft-store', () => ({
  useExamDraftStore: (selector: (state: object) => unknown) => selector({ sessions: { test: fixture.session } }),
}))
vi.mock('../../features/exam/store/exam-runtime-store', () => ({
  useExamRuntimeStore: (selector: (state: object) => unknown) => selector({ sessions: { test: fixture.runtime } }),
}))

it.each([
  [60, false, false],
  [60, true, true],
  [0, false, true],
  [-1, false, true],
])('shows inline chat appropriately for duration %s and submitted %s', (durationMinutes, submitted, visible) => {
  fixture.session = {
    sessionId: 'test', title: 'Toán', subjectId: 'math', subjectName: 'Toán',
    topicId: 'topic', topicName: 'Hàm số', difficultyLevel: 1, difficultyLabel: 'Cơ bản',
    durationMinutes, createdAt: 1, questions: [{ questionId: 'q1', topicId: 'topic', content: '$x+1=2$', level: 1, questionType: 'short_answer', answers: [], acceptedResponses: ['1'] }],
  }
  fixture.runtime = { ...createExamRuntimeSession(fixture.session), submittedAt: submitted ? 1 : null }
  const markup = renderToStaticMarkup(<MemoryRouter initialEntries={['/exam/test']}><Routes><Route path="/exam/:sessionId" element={<ExamPage />} /></Routes></MemoryRouter>)
  expect(markup.includes('AI Chat')).toBe(visible)
  expect(markup.includes('Hỏi AI về câu đang làm...')).toBe(visible)
})
