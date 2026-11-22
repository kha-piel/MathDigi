import { buildSubmissionSummary, checkQuestion, formatCorrectResponse, formatQuestionResponse } from './exam-session.ts'
import type { ExamRuntimeSession } from './exam-session'
import type { ExamDraftSession } from '../store/exam-draft-store'

export type AttemptKindRow = {
  exam_id: string | null
  metadata?: { attempt_kind?: string } | null
}

export function isPracticeAttempt(row: AttemptKindRow) {
  return row.metadata?.attempt_kind === 'practice'
}

export function isSchoolAttempt(row: AttemptKindRow) {
  return row.exam_id !== null && !isPracticeAttempt(row)
}

export function practiceKindFilter(prefix = ''): [string, string] {
  return [`${prefix}metadata->>attempt_kind`, 'practice']
}

export function schoolExamFilter(prefix = ''): [string, 'is', null] {
  return [`${prefix}exam_id`, 'is', null]
}

export function schoolKindFilter(prefix = '') {
  return `${prefix}metadata->>attempt_kind.is.null,${prefix}metadata->>attempt_kind.neq.practice`
}

export function schoolAttemptMetadata(metadata?: Record<string, unknown>) {
  return { ...metadata, attempt_kind: 'school' }
}

export function buildPracticeAttemptRow(input: {
  userId: string
  session: ExamDraftSession
  runtime: ExamRuntimeSession
  status: 'completed' | 'in_progress'
}) {
  const { userId, session, runtime, status } = input
  const summary = buildSubmissionSummary(session, runtime)
  return {
    user_id: userId,
    exam_id: null,
    score: status === 'completed' ? summary.score : null,
    correct_count: summary.correctCount,
    wrong_count: summary.wrongCount,
    skipped_count: summary.skippedCount,
    total_count: session.questions.length,
    started_at: new Date(runtime.startedAt).toISOString(),
    completed_at: new Date(runtime.submittedAt ?? runtime.startedAt).toISOString(),
    metadata: {
      attempt_kind: 'practice', status, source: 'web-app',
      title: session.title, local_session_id: session.sessionId,
      topic_name: session.topicName, subject_name: session.subjectName,
      difficulty_label: session.difficultyLabel,
      seed: session.seed, selection_mode: session.selectionMode, blueprint_id: session.blueprintId,
      question_ids: session.questions.map((q) => q.questionId),
      presented_option_order: session.questions.map((q) => ({
        question_id: q.questionId,
        options: q.answers.map((a) => ({ answer_id: a.answerId, label: a.optionLabel,
          original_label: a.metadata?.originalLabel ?? a.optionLabel })),
      })),
      total_time_taken_seconds: summary.timeTakenSeconds,
      ai_feedback: summary.reviewItems.filter((item) => !item.correct && item.explanation)
        .map((item) => item.explanation).join('\n\n') || null,
      session, runtime,
    },
  }
}

export type PracticeAttemptMetadata = ReturnType<typeof buildPracticeAttemptRow>['metadata']

export function buildPracticeAnswerRows(attemptId: string, session: ExamDraftSession, runtime: ExamRuntimeSession) {
  return session.questions.map((question, index) => {
    const result = checkQuestion(runtime, question)
    let selected: string | null
    if (question.questionType === 'multiple_choice') {
      selected = question.answers.find((a) => a.answerId === runtime.selectedAnswerIdsByQuestionId[question.questionId])?.optionLabel ?? null
    } else if (question.questionType === 'true_false') {
      const map = runtime.selectedTrueFalseByQuestionId[question.questionId]
      selected = map && Object.keys(map).length ? JSON.stringify(map) : null
    } else {
      selected = runtime.shortAnswerByQuestionId[question.questionId]?.trim() || null
    }
    return {
      attempt_id: attemptId,
      question_number: index + 1,
      question_type: question.questionType,
      selected_answer: selected,
      correct_answer: question.questionType === 'multiple_choice'
        ? question.answers.find((a) => a.isCorrect)?.optionLabel ?? null
        : question.questionType === 'true_false'
          ? JSON.stringify(Object.fromEntries((question.statements ?? []).map((s) => [s.statementId, s.isCorrect])))
          : question.acceptedResponses?.join('|') ?? null,
      is_correct: result.hasSelection && result.isCorrect,
      question_content: question.content,
      topic: question.topicId,
      metadata: {
        question_id: question.questionId,
        original_labels: Object.fromEntries(question.answers.map((a) => [a.optionLabel, a.metadata?.originalLabel ?? a.optionLabel])),
        question,
        selected_answer_text: formatQuestionResponse(runtime, question),
        correct_answer_text: formatCorrectResponse(question),
        ai_explanation: runtime.aiExplanationsByQuestionId[question.questionId] ?? question.explanation,
      },
    }
  })
}

export function isMissingHistoryTable(error: { code?: string; message: string }) {
  return ['PGRST205', 'PGRST200', '42P01'].includes(error.code ?? '') || /schema cache|could not find the table/i.test(error.message)
}
