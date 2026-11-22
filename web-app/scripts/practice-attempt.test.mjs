import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPracticeAnswerRows, buildPracticeAttemptRow, isMissingHistoryTable, isPracticeAttempt, isSchoolAttempt, practiceKindFilter, schoolAttemptMetadata, schoolExamFilter, schoolKindFilter } from '../src/features/exam/core/practice-attempt.ts'
import { createExamRuntimeSession, getRemainingSeconds } from '../src/features/exam/core/exam-session.ts'
import { excludeLocallyReviewedAttempts, settleHistorySource } from '../src/features/history/services/history-source.ts'

function fixture() {
  const session = {
    sessionId: 'mock', title: 'Đề thi thử', subjectId: 'TOAN', subjectName: 'Toán',
    topicId: 'practice-mock', topicName: 'Tổng hợp', difficultyLevel: 2,
    difficultyLabel: 'Cân bằng', durationMinutes: 50, seed: 42, selectionMode: 'balanced',
    blueprintId: 'bo-gddt-toan-22', deliveryMode: 'local_mock', createdAt: 1000,
    questions: [
      { questionId: 'mc', topicId: 'topic', questionType: 'multiple_choice', content: 'MC?', level: 2,
        answers: [
          { answerId: 'mc-B', optionLabel: 'A', content: 'Đúng', isCorrect: true, displayOrder: 1, metadata: { originalLabel: 'B' } },
          { answerId: 'mc-A', optionLabel: 'B', content: 'Sai', isCorrect: false, displayOrder: 2, metadata: { originalLabel: 'A' } },
        ] },
      { questionId: 'tf', topicId: 'topic', questionType: 'true_false', content: 'TF?', level: 2, answers: [],
        statements: [{ statementId: 'tf-a', content: 'a', isCorrect: true }, { statementId: 'tf-b', content: 'b', isCorrect: false }] },
      { questionId: 'sa', topicId: 'topic', questionType: 'short_answer', content: 'SA?', level: 2, answers: [], acceptedResponses: ['42'] },
    ],
  }
  const runtime = createExamRuntimeSession(session)
  runtime.startedAt = 1000
  runtime.submittedAt = 61000
  runtime.selectedAnswerIdsByQuestionId.mc = 'mc-B'
  runtime.selectedTrueFalseByQuestionId.tf = { 'tf-a': true, 'tf-b': false }
  runtime.shortAnswerByQuestionId.sa = ' 42 '
  return { session, runtime }
}

test('unlimited remaining-time helper handles absent, zero, negative and non-finite durations', () => {
  for (const durationMinutes of [undefined, 0, -1, NaN, Infinity]) {
    assert.equal(getRemainingSeconds({ durationMinutes }, { startedAt: Date.now() - 9999999 }), null)
  }
  assert.equal(getRemainingSeconds({}, { startedAt: Date.now() }), null)
})

test('finite timers count down and clamp expired exams at zero', (t) => {
  t.mock.method(Date, 'now', () => 61000)
  assert.equal(getRemainingSeconds({ durationMinutes: 2 }, { startedAt: 1000 }), 60)
  assert.equal(getRemainingSeconds({ durationMinutes: 1 }, { startedAt: 1000 }), 0)
  assert.equal(getRemainingSeconds({ durationMinutes: 0.5 }, { startedAt: 1000 }), 0)
})

test('practice rows only use live columns; status, timing, feedback and reproducibility are metadata', () => {
  const { session, runtime } = fixture()
  runtime.aiExplanationsByQuestionId.mc = 'Giải thích'
  runtime.selectedAnswerIdsByQuestionId.mc = 'mc-A'
  const row = buildPracticeAttemptRow({ userId: 'user', session, runtime, status: 'completed' })
  assert.deepEqual(Object.keys(row).sort(), ['user_id', 'exam_id', 'score', 'correct_count', 'wrong_count', 'skipped_count', 'total_count', 'started_at', 'completed_at', 'metadata'].sort())
  assert.equal(row.exam_id, null)
  assert.equal(row.total_count, 3)
  assert.equal(row.correct_count, 2)
  assert.equal(row.wrong_count, 1)
  assert.equal(row.metadata.attempt_kind, 'practice')
  assert.equal(row.metadata.status, 'completed')
  assert.equal(row.metadata.total_time_taken_seconds, 60)
  assert.equal(row.metadata.ai_feedback, 'Giải thích')
  assert.equal(row.metadata.seed, 42)
  assert.equal(row.metadata.selection_mode, 'balanced')
  assert.equal(row.metadata.blueprint_id, 'bo-gddt-toan-22')
  assert.deepEqual(row.metadata.question_ids, ['mc', 'tf', 'sa'])
  assert.deepEqual(row.metadata.presented_option_order[0].options, [
    { answer_id: 'mc-B', label: 'A', original_label: 'B' },
    { answer_id: 'mc-A', label: 'B', original_label: 'A' },
  ])
  assert.deepEqual(row.metadata.session, session)
  assert.deepEqual(row.metadata.runtime, runtime)
})

test('answer rows serialize presented MC label, TF map and short text with correct grading', () => {
  const { session, runtime } = fixture()
  const rows = buildPracticeAnswerRows('attempt', session, runtime)
  assert.deepEqual(rows.map((row) => row.question_number), [1, 2, 3])
  assert.ok(rows.every((row) => row.attempt_id === 'attempt' && row.is_correct))
  assert.equal(rows[0].selected_answer, 'A')
  assert.equal(rows[0].correct_answer, 'A')
  assert.equal(rows[0].metadata.selected_answer_text, 'A. Đúng')
  assert.equal(rows[0].metadata.correct_answer_text, 'A. Đúng')
  assert.deepEqual(rows[0].metadata.original_labels, { A: 'B', B: 'A' })
  assert.equal(rows[0].metadata.question_id, 'mc')
  assert.equal(rows[0].question_content, 'MC?')
  assert.equal(rows[0].topic, 'topic')
  assert.deepEqual(JSON.parse(rows[1].selected_answer), { 'tf-a': true, 'tf-b': false })
  assert.equal(rows[1].selected_answer, rows[1].correct_answer)
  assert.equal(rows[2].selected_answer, '42')
  assert.equal(rows[2].correct_answer, '42')
})

test('empty and incomplete responses serialize safely, with wrong/unanswered grading', () => {
  const { session } = fixture()
  const runtime = createExamRuntimeSession(session)
  const rows = buildPracticeAnswerRows('attempt', session, runtime)
  assert.ok(rows.every((row) => row.selected_answer === null && !row.is_correct))
  runtime.selectedTrueFalseByQuestionId.tf = { 'tf-a': true }
  const partial = buildPracticeAnswerRows('attempt', session, runtime)[1]
  assert.equal(partial.is_correct, false)
  assert.deepEqual(JSON.parse(partial.selected_answer), { 'tf-a': true })
  assert.deepEqual(buildPracticeAnswerRows('attempt', { ...session, questions: [] }, runtime), [])
  const row = buildPracticeAttemptRow({ userId: 'user', session, runtime, status: 'in_progress' })
  assert.equal(row.score, null)
  assert.equal(row.metadata.status, 'in_progress')
  assert.ok(row.completed_at)
})

test('practice and school classification never mix; legacy school rows still count', () => {
  const practice = { exam_id: null, metadata: { attempt_kind: 'practice' } }
  const school = { exam_id: 'exam', metadata: schoolAttemptMetadata({ attempt_kind: 'practice', other: true }) }
  const legacy = { exam_id: 'exam', metadata: {} }
  const legacyNull = { exam_id: 'exam', metadata: null }
  const orphan = { exam_id: null, metadata: {} }
  const malformedPractice = { exam_id: 'exam', metadata: { attempt_kind: 'practice' } }
  const rows = [practice, school, legacy, legacyNull, orphan, malformedPractice]
  assert.deepEqual(rows.filter(isSchoolAttempt), [school, legacy, legacyNull])
  assert.deepEqual(rows.filter(isPracticeAttempt), [practice, malformedPractice])
  assert.ok(rows.every((row) => !(isSchoolAttempt(row) && isPracticeAttempt(row))))
  assert.equal(school.metadata.other, true)
  assert.deepEqual(practiceKindFilter(), ['metadata->>attempt_kind', 'practice'])
  assert.deepEqual(practiceKindFilter('student_attempts.'), ['student_attempts.metadata->>attempt_kind', 'practice'])
  assert.deepEqual(schoolExamFilter(), ['exam_id', 'is', null])
  assert.equal(schoolKindFilter(), 'metadata->>attempt_kind.is.null,metadata->>attempt_kind.neq.practice')
})

test('a failed history source does not discard successful or empty sources', async () => {
  const sources = await Promise.all([
    settleHistorySource(Promise.resolve(['school']), [], 'Đề trường'),
    settleHistorySource(Promise.reject(new Error('RLS')), [], 'Luyện tập'),
    settleHistorySource(Promise.resolve([]), [], 'AI'),
  ])
  assert.deepEqual(sources.map((source) => source.data), [['school'], [], []])
  assert.deepEqual(sources.map((source) => source.error), [null, 'Luyện tập: RLS', null])
})

test('saved local submissions suppress only their corresponding cloud duplicate', () => {
  const cloud = [{ attemptId: 'saved' }, { attemptId: 'other-device' }]
  const local = [{ sessionId: 'local', persistedAttemptId: 'saved' }]
  assert.deepEqual(excludeLocallyReviewedAttempts(cloud, local), [{ attemptId: 'other-device' }])
  assert.deepEqual(excludeLocallyReviewedAttempts(cloud, []), cloud)
  assert.deepEqual(excludeLocallyReviewedAttempts([], local), [])
  assert.deepEqual(excludeLocallyReviewedAttempts(cloud, [{ persistedAttemptId: null }]), cloud)
  assert.deepEqual(local, [{ sessionId: 'local', persistedAttemptId: 'saved' }])
})

test('missing-table handling is limited to absent schema/relationships', () => {
  assert.equal(isMissingHistoryTable({ code: 'PGRST205', message: 'missing' }), true)
  assert.equal(isMissingHistoryTable({ code: '42P01', message: 'missing' }), true)
  assert.equal(isMissingHistoryTable({ code: '42501', message: 'permission denied' }), false)
})
