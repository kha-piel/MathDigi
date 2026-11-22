import { getSupabaseBrowserClient } from '../../../lib/supabase/client'
import { buildPracticeAnswerRows, buildPracticeAttemptRow, isMissingHistoryTable, practiceKindFilter } from '../core/practice-attempt'
import type { PracticeAttemptMetadata } from '../core/practice-attempt'
import type { ExamRuntimeSession } from '../core/exam-session'
import type { ExamDraftSession } from '../store/exam-draft-store'

type PersistAttemptInput = { userId: string; session: ExamDraftSession; runtime: ExamRuntimeSession }
type CloudSyncResult = {
  examId: null
  attemptId: string
  chatSessionId: null
  syncedChatMessageCount: number
}

export type InProgressAttemptListItem = {
  attemptId: string
  examTitle: string
  topicName: string
  difficultyLabel: string
  progressCount: number
  totalQuestions: number
  updatedAt: string
}

export type RestoredCloudAttempt = { session: ExamDraftSession; runtime: ExamRuntimeSession }

type PracticeAttemptRow = {
  attempt_id: string
  started_at: string
  updated_at: string
  metadata: PracticeAttemptMetadata | null
}

export async function persistCompletedAttempt(input: PersistAttemptInput): Promise<string> {
  return (await savePracticeAttempt(input, 'completed')).attemptId
}

export async function syncInProgressAttempt(input: PersistAttemptInput): Promise<CloudSyncResult> {
  return savePracticeAttempt(input, 'in_progress')
}

async function savePracticeAttempt(input: PersistAttemptInput, status: 'completed' | 'in_progress'): Promise<CloudSyncResult> {
  const supabase = getSupabaseBrowserClient()
  const row = buildPracticeAttemptRow({ ...input, status })
  let attemptId = input.runtime.persistedAttemptId
  if (attemptId) {
    const { data, error } = await supabase.from('student_attempts')
      .update(row).eq('attempt_id', attemptId).eq('user_id', input.userId)
      .eq(...practiceKindFilter()).select('attempt_id').single<{ attempt_id: string }>()
    if (error || !data) throw new Error(`Không thể lưu bài luyện tập: ${error?.message ?? 'Không tìm thấy bài làm'}`)
  } else {
    const { data, error } = await supabase.from('student_attempts')
      .insert(row).select('attempt_id').single<{ attempt_id: string }>()
    if (error || !data) throw new Error(`Không thể lưu bài luyện tập: ${error?.message ?? 'Không tạo được bài làm'}`)
    attemptId = data.attempt_id
    input.runtime = { ...input.runtime, persistedAttemptId: attemptId }
  }

  const answers = buildPracticeAnswerRows(attemptId, input.session, input.runtime)
  if (answers.length) {
    const { error } = await supabase.from('student_answers')
      .upsert(answers, { onConflict: 'attempt_id,question_number' })
    if (error) throw new Error(`Không thể lưu đáp án luyện tập: ${error.message}`)
  }

  let syncedChatMessageCount = input.runtime.syncedChatMessageCount
  const messages = input.runtime.chatHistory.slice(syncedChatMessageCount)
  if (messages.length) {
    try {
      const { error } = await supabase.from('student_ai_messages').insert(messages.map((message) => ({
        attempt_id: attemptId,
        question_number: message.questionId
          ? input.session.questions.findIndex((q) => q.questionId === message.questionId) + 1 || null : null,
        role: message.role === 'ai' ? 'assistant' : message.role,
        content: message.content,
        metadata: { question_id: message.questionId, local_message_id: message.id, created_at_ms: message.createdAt },
      })))
      if (error) throw new Error(error.message)
      syncedChatMessageCount = input.runtime.chatHistory.length
    } catch (error) {
      console.warn('Không thể đồng bộ lịch sử AI; bài làm vẫn được lưu.', error)
    }
  }
  return { examId: null, attemptId, chatSessionId: null, syncedChatMessageCount }
}

export async function fetchInProgressAttempts(userId: string): Promise<InProgressAttemptListItem[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.from('student_attempts')
    .select('attempt_id, started_at, updated_at, metadata')
    .eq('user_id', userId).eq(...practiceKindFilter()).eq('metadata->>status', 'in_progress')
    .order('updated_at', { ascending: false }).returns<PracticeAttemptRow[]>()
  if (error) {
    if (isMissingHistoryTable(error)) return []
    throw new Error(`Không thể tải bài đang làm: ${error.message}`)
  }
  return (data ?? []).map((row) => {
    const session = row.metadata?.session
    const runtime = row.metadata?.runtime
    return {
      attemptId: row.attempt_id,
      examTitle: row.metadata?.title ?? 'Bài luyện tập',
      topicName: row.metadata?.topic_name ?? '--',
      difficultyLabel: row.metadata?.difficulty_label ?? '--',
      progressCount: session?.questions.filter((q) => {
        if (q.questionType === 'multiple_choice') return Boolean(runtime?.selectedAnswerIdsByQuestionId[q.questionId])
        if (q.questionType === 'short_answer') return Boolean(runtime?.shortAnswerByQuestionId[q.questionId]?.trim())
        return (q.statements ?? []).length > 0 && q.statements?.every((s) =>
          s.statementId in (runtime?.selectedTrueFalseByQuestionId[q.questionId] ?? {}))
      }).length ?? 0,
      totalQuestions: session?.questions.length ?? 0,
      updatedAt: row.updated_at,
    }
  })
}

export async function restoreInProgressAttempt(attemptId: string): Promise<RestoredCloudAttempt | null> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.from('student_attempts')
    .select('attempt_id, started_at, updated_at, metadata').eq('attempt_id', attemptId)
    .eq(...practiceKindFilter()).eq('metadata->>status', 'in_progress').maybeSingle<PracticeAttemptRow>()
  if (error) {
    if (isMissingHistoryTable(error)) return null
    throw new Error(`Không thể khôi phục bài làm: ${error.message}`)
  }
  const session = data?.metadata?.session
  const runtime = data?.metadata?.runtime
  if (!data || !session?.questions?.length || !runtime) return null
  return {
    session: { ...session, deliveryMode: 'cloud' },
    runtime: { ...runtime, submittedAt: null, persistedExamId: null, persistedAttemptId: data.attempt_id,
      persistedChatSessionId: null, lastSyncedAt: Date.now() },
  }
}
