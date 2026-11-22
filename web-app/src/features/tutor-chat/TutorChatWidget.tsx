import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { MarkdownContent } from '../../components/ui/MarkdownContent'
import { useAuthSessionStore } from '../auth/store/auth-session-store'
import { deleteHistory, loadHistory, persistMessage, streamTutor } from './service'
import { limitHistory, useTutorStore, type ChatMessage } from './store'

export function TutorChatWidget() {
  const userId = useAuthSessionStore((s) => s.user?.id)
  const disabled = useTutorStore((s) => s.disabledReason)
  return userId && !disabled ? <UserTutorChat key={userId} userId={userId} /> : null
}

function UserTutorChat({ userId }: { userId: string }) {
  const context = useTutorStore((s) => s.context)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState<{ messages: ChatMessage[]; reveal: boolean } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void loadHistory(userId).then((history) => { if (active) { setMessages(history); setLoaded(true) } })
    const online = () => setOffline(!navigator.onLine)
    window.addEventListener('online', online)
    window.addEventListener('offline', online)
    return () => { active = false; controller.current?.abort(); useTutorStore.getState().setActiveController(null); window.removeEventListener('online', online); window.removeEventListener('offline', online) }
  }, [userId])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, open])

  async function send(reveal = false, previous?: ChatMessage[]) {
    if (busy || offline || !loaded || useTutorStore.getState().disabledReason) return
    const text = reveal ? 'Hãy trình bày lời giải đầy đủ cho câu hỏi này.' : input.trim()
    if (!previous && !text) return
    const history = previous ?? limitHistory([...messages.filter((m) => m.content.trim()), { role: 'user', content: text }])
    const currentContext = context
    setInput(''); setError(''); setRetry(null); setBusy(true)
    setMessages(limitHistory([...history, { role: 'assistant', content: '' }]))
    const abort = new AbortController()
    controller.current = abort
    useTutorStore.getState().setActiveController(abort)
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; abort.abort() }, 70000)
    let answer = ''
    const save = async (message: ChatMessage) => {
      if (!await persistMessage(userId, message, currentContext)) setNotice('Không thể lưu lịch sử. Bạn vẫn có thể tiếp tục trò chuyện.')
    }
    try {
      if (!previous) await save(history[history.length - 1])
      await streamTutor(history, currentContext, reveal, abort.signal, (delta) => {
        answer = (answer + delta).slice(0, 8000)
        setMessages(limitHistory([...history, { role: 'assistant', content: answer }]))
      })
      if (answer) await save({ role: 'assistant', content: answer })
    } catch (cause) {
      if (!abort.signal.aborted || timedOut) {
        setError(timedOut ? 'Gia sư phản hồi quá lâu. Hãy thử lại.' : cause instanceof TypeError ? 'Không thể kết nối. Hãy kiểm tra mạng và thử lại.' : cause instanceof Error ? cause.message : 'Đã có lỗi. Vui lòng thử lại.')
        setRetry({ messages: history, reveal })
      }
    } finally {
      window.clearTimeout(timer)
      setBusy(false)
      controller.current = null
      if (useTutorStore.getState().activeController === abort) useTutorStore.getState().setActiveController(null)
    }
  }

  async function clear() {
    if (busy) return
    setMessages([]); setError(''); setRetry(null)
    setNotice(await deleteHistory(userId) ? '' : 'Đã xóa trên thiết bị; không thể xóa lịch sử đã lưu. Vui lòng thử lại.')
  }

  return <div className="fixed bottom-4 right-4 z-40">
    {open && <section role="dialog" aria-label="Gia sư Toán" className="fixed inset-2 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-auto sm:bottom-20 sm:right-4 sm:h-[560px] sm:max-h-[85dvh] sm:w-[380px]">
      <header className="flex items-center justify-between bg-indigo-700 px-4 py-3 text-white">
        <h2 className="font-bold">Gia sư Toán</h2>
        <div className="flex items-center gap-3"><button type="button" className="text-xs underline disabled:opacity-50" disabled={busy || !loaded} onClick={() => void clear()}>Xóa lịch sử</button><button type="button" aria-label="Đóng gia sư" onClick={() => setOpen(false)}><X size={20} /></button></div>
      </header>
      {offline && <p role="status" className="bg-amber-50 p-2 text-sm">Bạn đang ngoại tuyến. Hãy kết nối mạng để gửi tin nhắn.</p>}
      {context && <div className="flex items-center justify-between gap-2 border-b p-2 text-xs"><span className="rounded-full bg-indigo-50 px-2 py-1">Đang hỏi về: Câu {context.question_number ?? '?'}</span><button type="button" className="font-semibold text-indigo-700 disabled:opacity-50" disabled={busy || offline || !loaded} onClick={() => void send(true)}>Xem lời giải</button></div>}
      <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite" aria-relevant="additions text">
        {!messages.length && <p className="text-sm text-slate-500">Xin chào! Mình sẽ giúp bạn tìm hướng giải bài Toán từng bước.</p>}
        {messages.map((m, i) => <div key={i} className={`rounded-xl p-3 ${m.role === 'user' ? 'ml-6 bg-indigo-50' : 'mr-2 bg-slate-50'}`}><p className="mb-1 text-xs font-bold text-slate-500">{m.role === 'user' ? 'Bạn' : 'Gia sư'}</p>{m.role === 'assistant' ? <MarkdownContent content={m.content || 'Đang suy nghĩ…'} /> : <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>}</div>)}
        <div ref={bottom} />
      </div>
      {notice && <p className="px-3 text-xs text-amber-700">{notice}</p>}
      {error && <div role="alert" className="p-3 text-sm text-red-700">{error} {retry && <button type="button" disabled={busy || offline} className="underline" onClick={() => void send(retry.reveal, retry.messages)}>Thử lại</button>}</div>}
      <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <textarea aria-label="Câu hỏi Toán" placeholder="Nhập câu hỏi Toán…" className="w-full resize-none rounded-lg border border-slate-300 p-2 text-sm" rows={2} maxLength={2000} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
        <div className="flex items-center justify-between text-xs text-slate-500"><span>{input.length}/2000 · Shift+Enter xuống dòng</span>{busy ? <button type="button" className="rounded-lg bg-slate-700 px-3 py-2 text-white" onClick={() => controller.current?.abort()}>Dừng</button> : <button className="rounded-lg bg-indigo-700 px-3 py-2 text-white disabled:opacity-50" disabled={!input.trim() || offline || !loaded}>Gửi</button>}</div>
      </form>
    </section>}
    <button type="button" aria-label={open ? 'Đóng gia sư Toán' : 'Mở gia sư Toán'} aria-expanded={open} className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-700 text-white shadow-lg hover:bg-indigo-800" onClick={() => setOpen(!open)}>{open ? <X /> : <MessageCircle />}</button>
  </div>
}
