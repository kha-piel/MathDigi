import { env } from '../../lib/config/env'
import { getSupabaseBrowserClient } from '../../lib/supabase/client'
import { limitHistory, useTutorStore, type ChatMessage, type TutorContext } from './store'

type TutorEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; message: string }

export function createSSEParser(onEvent: (event: TutorEvent) => void) {
  let buffer = ''
  return (text: string) => {
    buffer += text.replace(/\r/g, '')
    let index: number
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (data) onEvent(JSON.parse(data) as TutorEvent)
    }
  }
}

export async function streamTutor(messages: ChatMessage[], context: TutorContext | null, reveal: boolean, signal: AbortSignal, onDelta: (text: string) => void) {
  if (!navigator.onLine) throw new Error('Bạn đang ngoại tuyến. Hãy kiểm tra kết nối mạng.')
  const { data } = await getSupabaseBrowserClient().auth.getSession()
  if (!data.session) throw new Error('Vui lòng đăng nhập lại để hỏi gia sư.')
  if (useTutorStore.getState().disabledReason || signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const response = await fetch(`${env.aiApiBaseUrl.replace(/\/$/, '')}/api/tutor/chat`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ messages: messages.slice(-12).map((m) => ({ ...m, content: m.content.slice(0, 2000) })), context, reveal_solution: reveal }),
  })
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.' : response.status === 429 ? `Bạn hỏi quá nhanh. Thử lại sau ${response.headers.get('Retry-After') || '60'} giây.` : response.status >= 500 ? 'Gia sư đang bận. Vui lòng thử lại sau.' : 'Không thể gửi câu hỏi. Hãy kiểm tra nội dung.')
  }
  if (!response.body) throw new Error('Không nhận được phản hồi từ gia sư.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let done = false
  const parse = createSSEParser((event) => {
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'done') done = true
    if (event.type === 'delta') onDelta(event.text)
  })
  try {
    while (!done) {
      const part = await reader.read()
      if (part.done) break
      parse(decoder.decode(part.value, { stream: true }))
    }
    if (!done) throw new Error('Kết nối bị gián đoạn. Hãy thử lại.')
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

export async function loadHistory(userId: string): Promise<ChatMessage[]> {
  try {
    const { data, error } = await getSupabaseBrowserClient().from('student_tutor_chat_messages').select('role,content').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
    return error ? [] : limitHistory((data ?? []).reverse() as ChatMessage[])
  } catch { return [] }
}

export async function persistMessage(userId: string, message: ChatMessage, context: TutorContext | null) {
  try {
    const reference = context ? { source: context.source, exam_id: context.exam_id, question_number: context.question_number, attempt_id: context.attempt_id } : {}
    const { error } = await getSupabaseBrowserClient().from('student_tutor_chat_messages').insert({ user_id: userId, ...message, content: message.content.slice(0, 8000), context: reference })
    return !error
  } catch { return false }
}

export async function deleteHistory(userId: string) {
  try {
    const { error } = await getSupabaseBrowserClient().from('student_tutor_chat_messages').delete().eq('user_id', userId)
    return !error
  } catch { return false }
}
