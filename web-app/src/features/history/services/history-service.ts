import { isMissingHistoryTable, practiceKindFilter } from '../../exam/core/practice-attempt'
import { settleHistorySource } from './history-source'
import { getSupabaseBrowserClient } from '../../../lib/supabase/client'
import {
  fetchSchoolExamAiHistory,
  type SchoolExamAiHistoryMessage,
} from '../../practice/services/school-exam-attempt-service'

export type PracticeAiHistoryMessage = {
  messageId: string
  sessionId: string
  attemptId: string | null
  examTitle: string
  role: 'user' | 'assistant' | 'system'
  content: string
  questionId: string | null
  createdAt: string
}

export type UnifiedAiHistoryItem = {
  id: string
  source: 'practice' | 'school_exam'
  title: string
  context: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

type PracticeAiMessageRow = {
  message_id: string
  attempt_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  metadata: { question_id?: string } | null
  student_attempts: { metadata: { title?: string } | null } | { metadata: { title?: string } | null }[] | null
}

export async function fetchPracticeAiHistory(userId: string): Promise<PracticeAiHistoryMessage[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('student_ai_messages')
    .select('message_id, attempt_id, role, content, created_at, metadata, student_attempts!inner(user_id, metadata)')
    .eq('student_attempts.user_id', userId)
    .eq(...practiceKindFilter('student_attempts.'))
    .order('created_at', { ascending: false })
    .returns<PracticeAiMessageRow[]>()
  if (error) {
    if (isMissingHistoryTable(error)) return []
    throw new Error(`Không thể tải lịch sử AI luyện tập: ${error.message}`)
  }
  return (data ?? []).map((message) => ({
    messageId: message.message_id,
    sessionId: message.attempt_id,
    attemptId: message.attempt_id,
    examTitle: unwrapSingle(message.student_attempts)?.metadata?.title ?? 'AI luyện tập',
    role: message.role,
    content: message.content,
    questionId: message.metadata?.question_id ?? null,
    createdAt: message.created_at,
  }))
}

export async function fetchUnifiedAiHistory(userId: string): Promise<UnifiedAiHistoryItem[]> {
  const [practiceMessages, schoolExamMessages] = await Promise.all([
    settleHistorySource(fetchPracticeAiHistory(userId), [], 'AI luyện tập'),
    settleHistorySource(fetchSchoolExamAiHistory(userId), [], 'AI đề trường'),
  ])

  for (const source of [practiceMessages, schoolExamMessages]) {
    if (source.error) console.warn(source.error)
  }
  return [
    ...practiceMessages.data.map((message) => ({
      id: `practice-${message.messageId}`,
      source: 'practice' as const,
      title: message.examTitle,
      context: message.questionId ? `Cau hoi ${message.questionId}` : 'On tap kien thuc',
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
    ...schoolExamMessages.data.map(mapSchoolExamAiMessage),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

function mapSchoolExamAiMessage(message: SchoolExamAiHistoryMessage): UnifiedAiHistoryItem {
  return {
    id: `school-${message.messageId}`,
    source: 'school_exam',
    title: message.examTitle,
    context: message.questionNumber ? `${message.schoolName} - Cau ${message.questionNumber}` : message.schoolName,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }
}

function unwrapSingle<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}
