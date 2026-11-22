import { createClient } from '@supabase/supabase-js'
import { afterEach, expect, it, vi } from 'vitest'
import { getSupabaseBrowserClient } from '../../../lib/supabase/client'
import { updateManagedImportedExam } from './admin-import-service'

vi.mock('../../../lib/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(),
}))

const input = {
  examId: 'exam-1',
  title: 'Đề thi mới',
  city: 'Hà Nội',
  schoolName: 'THPT Kiểm thử',
  subjectCode: 'TOAN',
  year: 2026,
  durationMinutes: 90,
  variantCode: '101',
  isActive: true,
} as const

function mockExamUpdate(response: Response) {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    new Headers(init?.headers).get('Prefer')?.includes('return=representation')
      ? response
      : response.ok ? new Response(null, { status: 204 }) : response,
  )
  vi.mocked(getSupabaseBrowserClient).mockReturnValue(createClient('http://127.0.0.1:54321', 'test-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch },
  }))
  return fetch
}

afterEach(() => vi.restoreAllMocks())

it('rejects an exam update that was accepted by PostgREST but affected no rows', async () => {
  mockExamUpdate(Response.json([]))

  await expect(updateManagedImportedExam(input)).rejects.toThrow('Bạn không có quyền sửa hoặc đề thi không còn tồn tại.')
})

it('reports success when PostgREST returns the updated exam', async () => {
  const fetch = mockExamUpdate(Response.json([{ exam_id: input.examId }]))

  await expect(updateManagedImportedExam(input)).resolves.toBeUndefined()
  const [url, request] = fetch.mock.calls[0]
  expect(request?.method).toBe('PATCH')
  expect(new URL(String(url)).searchParams.get('exam_id')).toBe('eq.exam-1')
  expect(new URL(String(url)).searchParams.get('select')).toBe('exam_id')
})

it('shows a Vietnamese message when PostgREST returns an update error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockExamUpdate(Response.json({ code: '42501', message: 'permission denied for table exams' }, { status: 403 }))

  await expect(updateManagedImportedExam(input)).rejects.toThrow(
    /^Không thể cập nhật thông tin đề thi lúc này\. Vui lòng thử lại\.$/,
  )
})
