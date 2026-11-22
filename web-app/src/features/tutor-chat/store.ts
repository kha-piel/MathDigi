import { create } from 'zustand'

export type TutorContext = {
  question_number?: number
  question_content: string
  options?: string[]
  question_type?: string
  topic?: string
  student_answer?: string
  correct_answer?: string
  solution?: string
  source?: string
  exam_id?: string
  attempt_id?: string
}
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export const limitHistory = (messages: ChatMessage[]) => messages.slice(-50)

export const useTutorStore = create<{
  context: TutorContext | null
  setTutorContext: (context: TutorContext) => void
  clearTutorContext: () => void
  disabledReason: string | null
  activeController: AbortController | null
  setTutorDisabled: (reason: string | null) => void
  setActiveController: (controller: AbortController | null) => void
}>((set, get) => ({
  context: null,
  disabledReason: null,
  activeController: null,
  setTutorDisabled: (disabledReason) => {
    if (disabledReason) get().activeController?.abort()
    set(disabledReason ? { disabledReason, context: null, activeController: null } : { disabledReason })
  },
  setActiveController: (activeController) => {
    if (get().disabledReason) activeController?.abort()
    else set({ activeController })
  },
  setTutorContext: (context) => set({ context }),
  clearTutorContext: () => set({ context: null }),
}))
export const setTutorContext = (context: TutorContext) => useTutorStore.getState().setTutorContext(context)
export const clearTutorContext = () => useTutorStore.getState().clearTutorContext()
export const TUTOR_EXAM_DISABLED = 'Gia sư Toán tạm tắt trong lúc làm bài thi'
export const setTutorDisabled = (reason: string | null) => useTutorStore.getState().setTutorDisabled(reason)
