import type { ExamSubmissionSummary, ReviewQuestionSummary } from '../core/exam-session'
import { buildSubmissionSummary } from '../core/exam-session'
import { isMissingHistoryTable, practiceKindFilter } from '../core/practice-attempt'
import type { PracticeAttemptMetadata } from '../core/practice-attempt'
import { getSupabaseBrowserClient } from '../../../lib/supabase/client'

type AttemptReviewRow = {
  attempt_id: string
  score: number | null
  correct_count: number
  wrong_count: number
  skipped_count: number
  total_count: number
  completed_at: string | null
  metadata: Partial<PracticeAttemptMetadata> | null
}

type AnswerReviewRow = {
  question_number: number
  selected_answer: string | null
  correct_answer: string | null
  is_correct: boolean
  question_content: string | null
  metadata: {
    question_id?: string
    selected_answer_text?: string
    correct_answer_text?: string
    ai_explanation?: string
  } | null
}

export type PersistedAttemptReview = ExamSubmissionSummary & {
  attemptId: string
  examTitle: string
  topicName: string
  subjectName: string
  difficultyLabel: string
  completedAt: string | null
  status: string
}

export async function fetchPersistedAttemptReview(attemptId: string) {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.from('student_attempts')
    .select('attempt_id, score, correct_count, wrong_count, skipped_count, total_count, completed_at, metadata')
    .eq('attempt_id', attemptId).eq(...practiceKindFilter()).maybeSingle<AttemptReviewRow>()
  if (error) {
    if (isMissingHistoryTable(error)) return null
    throw new Error(`Không thể tải dữ liệu review: ${error.message}`)
  }
  if (!data) return null

  const { data: answers, error: answerError } = await supabase.from('student_answers')
    .select('question_number, selected_answer, correct_answer, is_correct, question_content, metadata')
    .eq('attempt_id', attemptId).order('question_number').returns<AnswerReviewRow[]>()
  const snapshot = data.metadata?.session && data.metadata?.runtime
    ? buildSubmissionSummary(data.metadata.session, data.metadata.runtime) : null
  if (answerError && !snapshot && !isMissingHistoryTable(answerError)) {
    throw new Error(`Không thể tải đáp án: ${answerError.message}`)
  }
  const reviewItems: ReviewQuestionSummary[] = answers?.length ? answers.map((row) => ({
    questionId: row.metadata?.question_id ?? String(row.question_number),
    questionContent: row.question_content ?? '',
    selectedAnswerText: row.metadata?.selected_answer_text ?? row.selected_answer ?? 'Chưa chọn đáp án',
    correctAnswerText: row.metadata?.correct_answer_text ?? row.correct_answer ?? 'Không rõ đáp án đúng',
    correct: row.is_correct,
    explanation: row.metadata?.ai_explanation,
  })) : snapshot?.reviewItems ?? []
  return {
    attemptId: data.attempt_id,
    examTitle: data.metadata?.title ?? 'Bài luyện tập',
    topicName: data.metadata?.topic_name ?? '--',
    subjectName: data.metadata?.subject_name ?? '--',
    difficultyLabel: data.metadata?.difficulty_label ?? '--',
    score: Math.round((data.score ?? 0) * 100) / 100,
    correctCount: data.correct_count,
    wrongCount: data.wrong_count,
    skippedCount: data.skipped_count,
    totalQuestions: data.total_count,
    passed: (data.score ?? 0) >= 5,
    timeTakenSeconds: data.metadata?.total_time_taken_seconds ?? 0,
    reviewItems,
    completedAt: data.completed_at,
    status: data.metadata?.status ?? 'completed',
  } satisfies PersistedAttemptReview
}
