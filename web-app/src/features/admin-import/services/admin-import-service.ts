import katex from 'katex'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { env } from '../../../lib/config/env'
import { getAuthorizationHeader, getSupabaseBrowserClient } from '../../../lib/supabase/client'
import { invalidateSchoolExamCaches } from '../../practice/services/school-exam-service'
import { invalidatePracticeQuestionBankCache } from '../../practice/services/practice-service'

export type AdminQuestionType = 'multiple_choice' | 'true_false' | 'short_answer'
export type SubjectCode = 'TOAN' | 'VAT_LY' | 'HOA_HOC'

export type AdminImportMetadata = {
  schoolName: string
  city: string
  subjectCode: SubjectCode
  subjectName: string
  year: string
  variantCode: string
  durationMinutes: string
}

export type AdminExamDraft = {
  examId: string
  title: string
  schoolName: string
  city: string
  subjectCode: SubjectCode
  subjectName: string
  year: number
  durationMinutes: number
  variantCode: string
  pdfStoragePath: string
  pdfUrl: string
}

export type AdminImportOption = {
  label: 'A' | 'B' | 'C' | 'D'
  text: string
}

export type AdminImportStatement = {
  label: 'a' | 'b' | 'c' | 'd'
  text: string
}

export type AdminImportAsset = {
  persistedId?: string
  assetType: 'question_block' | 'figure' | 'table' | 'other'
  assetPath: string
  pageNumber?: number | null
  assetDataUrl?: string | null
  publicUrl?: string
}

export type AdminImportChange = {
  field: string
  original: string
  corrected: string
  reason: string
}

export type AdminImportQuestion = {
  persistedId?: string
  reviewed?: boolean
  difficultyLevel: number | null
  questionNumber: number
  questionType: AdminQuestionType
  topic: string
  questionText: string
  options: AdminImportOption[]
  statements: AdminImportStatement[]
  correctAnswer: string
  isValid: boolean
  warnings: string[]
  changes: AdminImportChange[]
  assets: AdminImportAsset[]
  rawExcerpt?: string | null
}

export type AdminImportValidationResponse = {
  isValid: boolean
  warnings: string[]
  examDraft: AdminExamDraft
  questions: AdminImportQuestion[]
  rawModelResponse?: string | null
}

export type ManagedImportedExam = {
  importState: 'pending_review' | 'published' | 'unpublished' | 'undone' | null
  examId: string
  title: string
  schoolName: string
  city: string
  subjectCode: SubjectCode
  subjectName: string
  year: number
  durationMinutes: number
  pdfUrl: string
  sourcePath: string | null
  isActive: boolean
  createdAt: string
  variantCode: string
}

type SaveAdminImportedExamInput = {
  pdfFile: File
  draft: AdminImportValidationResponse
}

type UpdateManagedImportedExamInput = {
  examId: string
  title: string
  schoolName: string
  city: string
  subjectCode: SubjectCode
  year: number
  durationMinutes: number
  variantCode: string
  isActive: boolean
}

type ManagedExamQuestionRow = {
  question_id: string
  exam_id: string
  question_number: number
  difficulty_level: number | null
  review_status: 'draft' | 'pending_review' | 'approved' | 'rejected'
  question_type: AdminQuestionType
  question_text: string
  correct_answer: string | null
  statement_json: Array<{ label: string; text: string }> | null
  topic: string | null
  obsidian_source_path: string | null
  has_image: boolean
  metadata: Record<string, unknown> | null
  options: Array<{
    option_label: 'A' | 'B' | 'C' | 'D'
    option_text: string
    display_order: number
  }> | null
  assets: Array<{
    asset_id: string
    import_archived: boolean
    asset_type: AdminImportAsset['assetType']
    asset_path: string
    display_order: number
  }> | null
}

type SectionPart = AdminQuestionType

const STORAGE_BUCKET = 'school-exams'
const PDF_MIME_TYPE = 'application/pdf'
const SAVE_UNCONFIRMED_MESSAGE = 'Chưa xác nhận được kết quả lưu. Hãy tải lại danh sách đề trước khi thử lại.'

export const subjectOptions: Array<{
  code: SubjectCode
  name: string
  durationMinutes: string
}> = [
  { code: 'TOAN', name: 'Toán học', durationMinutes: '90' },
  { code: 'VAT_LY', name: 'Vật lý', durationMinutes: '50' },
  { code: 'HOA_HOC', name: 'Hóa học', durationMinutes: '50' },
]

export const topicOptionsBySubjectCode: Record<SubjectCode, string[]> = {
  TOAN: [
    'Hình học không gian và Oxyz',
    'Nguyên hàm và tích phân',
    'Khảo sát hàm số, cực trị và GTLN/GTNN',
    'Mũ và logarit',
    'Xác suất, tổ hợp và thống kê',
    'Quan hệ vuông góc và khối đa diện',
  ],
  VAT_LY: [
    'Dao động cơ',
    'Sóng cơ',
    'Điện xoay chiều',
    'Dao động và sóng điện từ',
    'Sóng ánh sáng',
    'Lượng tử ánh sáng',
    'Hạt nhân nguyên tử',
    'Điện tích và điện trường',
    'Dòng điện không đổi',
    'Từ trường',
    'Cảm ứng điện từ',
    'Quang học',
  ],
  HOA_HOC: [
    'Cấu tạo nguyên tử, bảng tuần hoàn và liên kết hóa học',
    'Phản ứng oxi hóa khử',
    'Tốc độ phản ứng và cân bằng hóa học',
    'Dung dịch, pH và chuẩn độ',
    'Este và lipit',
    'Cacbohidrat',
    'Amin, amino axit và protein',
    'Polime',
    'Đại cương kim loại',
    'Kim loại kiềm, kiềm thổ và nhôm',
    'Sắt và hợp chất của sắt',
    'Điện phân',
    'Tổng hợp hóa vô cơ',
    'Tổng hợp hóa hữu cơ',
    'Hóa học với thực tiễn',
  ],
}

export function createEmptyMetadata(): AdminImportMetadata {
  const defaultSubject = subjectOptions[0]
  return {
    schoolName: '',
    city: '',
    subjectCode: defaultSubject.code,
    subjectName: defaultSubject.name,
    year: String(new Date().getFullYear()),
    variantCode: '101',
    durationMinutes: defaultSubject.durationMinutes,
  }
}

export function estimateExamId(metadata: AdminImportMetadata) {
  return [
    slugify(metadata.schoolName),
    metadata.subjectCode.toLowerCase(),
    metadata.year.trim(),
    slugify(metadata.variantCode),
  ]
    .filter(Boolean)
    .join('-')
}

export async function requestExamPdfValidation(input: {
  pdfFile: File
  metadata: AdminImportMetadata
  answerKeyText: string
  onStatusChange?: (message: string) => void
}) {
  await assertNewPdf(await fingerprintPdf(input.pdfFile, true))
  if (!env.aiApiBaseUrl) {
    throw new Error(
      'Thiếu VITE_AI_API_BASE_URL. Hãy sao chép web-app/.env.example thành web-app/.env.local và cấu hình địa chỉ dịch vụ AI.',
    )
  }

  const formData = new FormData()
  formData.append('pdfFile', withPdfMimeType(input.pdfFile))
  formData.append('subjectCode', input.metadata.subjectCode)
  formData.append('subjectName', input.metadata.subjectName)
  formData.append('schoolName', input.metadata.schoolName)
  formData.append('city', input.metadata.city)
  formData.append('year', input.metadata.year)
  formData.append('variantCode', input.metadata.variantCode)
  formData.append('durationMinutes', input.metadata.durationMinutes)
  formData.append('answerKeyText', input.answerKeyText)

  const authorizationHeader = await getAuthorizationHeader()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 240_000)
  const statusTimers = [
    window.setTimeout(() => {
      input.onStatusChange?.('Đang đọc văn bản từ PDF và gửi sang AI...')
    }, 1_000),
    window.setTimeout(() => {
      input.onStatusChange?.('AI đang tách câu hỏi và ghép đáp án...')
    }, 12_000),
    window.setTimeout(() => {
      input.onStatusChange?.('Đang xử lý. Nếu PDF là bản quét, Gemini có thể mất vài phút...')
    }, 45_000),
  ]

  input.onStatusChange?.('Đang tải PDF lên dịch vụ AI...')

  const response = await fetch(`${env.aiApiBaseUrl}/api/admin/import-exam-pdf/validate`, {
    method: 'POST',
    headers: authorizationHeader,
    body: formData,
    signal: controller.signal,
  })
    .catch(() => {
      if (controller.signal.aborted) {
        throw new Error('Đã hết thời gian chờ AI phân tích PDF. Hãy thử lại hoặc chọn tệp nhỏ hơn.')
      }

      throw new Error(
        `Không thể kết nối tới dịch vụ AI (${env.aiApiBaseUrl}). Hãy kiểm tra kết nối và trạng thái dịch vụ.`,
      )
    })
    .finally(() => {
      window.clearTimeout(timeoutId)
      for (const timerId of statusTimers) {
        window.clearTimeout(timerId)
      }
    })

  if (!response.ok) {
    const payload: { detail?: unknown } | null = await response.json().catch(() => null)
    const detail = payload?.detail
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
        ? detail.message
        : ''
    throw new Error(message || `Dịch vụ AI trả về lỗi HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as AdminImportValidationResponse
  return normalizeValidationResponse(payload)
}

export function getQuestionValidationIssues(question: AdminImportQuestion) {
  const issues: string[] = []
  if (!question.questionText.trim()) {
    issues.push('Thiếu đề bài.')
  }

  if (!Number.isInteger(question.questionNumber) || question.questionNumber <= 0) {
    issues.push('Số thứ tự câu hỏi phải là số nguyên dương.')
  }

  if (question.difficultyLevel === null || ![1, 2, 3, 4].includes(question.difficultyLevel)) {
    issues.push('Chọn mức độ từ 1 đến 4.')
  }
  if (!question.topic.trim()) issues.push('Chọn chuyên đề cho câu hỏi.')
  if ([question.questionText, ...question.options.map((item) => item.text),
    ...question.statements.map((item) => item.text), question.correctAnswer].some(hasInvalidMath)) {
    issues.push('Có công thức LaTeX không hiển thị được.')
  }

  if (question.questionType === 'multiple_choice') {
    const optionMap = new Map(question.options.map((option) => [option.label, option.text.trim()]))
    for (const label of ['A', 'B', 'C', 'D'] as const) {
      if (!optionMap.get(label)) {
        issues.push(`Thiếu nội dung đáp án ${label}.`)
      }
    }
    if (!['A', 'B', 'C', 'D'].includes(question.correctAnswer.trim().toUpperCase())) {
      issues.push('Đáp án đúng phải là A, B, C hoặc D.')
    }
  }

  if (question.questionType === 'true_false') {
    if (question.statements.length < 4) {
      issues.push('Cần đủ bốn mệnh đề a, b, c, d.')
    }
    const statementMap = new Map(
      question.statements.map((statement) => [statement.label, statement.text.trim()]),
    )
    for (const label of ['a', 'b', 'c', 'd'] as const) {
      if (!statementMap.get(label)) {
        issues.push(`Thiếu nội dung mệnh đề ${label}.`)
      }
    }
    if (!/^[DS]{4}$/.test(question.correctAnswer.trim().toUpperCase())) {
      issues.push('Đáp án đúng/sai phải gồm bốn ký tự D hoặc S.')
    }
  }

  if (question.questionType === 'short_answer' && !/^[+-]?\d+(?:[.,]\d+)?(?:\s*\|\s*[+-]?\d+(?:[.,]\d+)?)*$/.test(question.correctAnswer.trim())) {
    issues.push('Đáp án trả lời ngắn phải là số. Dùng | để phân tách các đáp án được chấp nhận.')
  }

  return issues
}

function hasInvalidMath(text: string) {
  const latex = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$|(?<![\\$])\$([^$\n]+?)(?<!\\)\$/g
  for (const match of text.matchAll(latex)) {
    try {
      katex.renderToString(match[1] ?? match[2] ?? match[3] ?? match[4], { throwOnError: true })
    } catch {
      return true
    }
  }
  return /(?<!\\)\$|\\[()[\]]/.test(text.replace(latex, ''))
}

export function getDraftValidationIssues(input: {
  draft: AdminImportValidationResponse | null
  pdfFile: File | null
}) {
  const issues: string[] = []
  if (!input.pdfFile) {
    issues.push('Chưa có tệp PDF.')
  }

  if (!input.draft) {
    issues.push('Chưa có kết quả phân tích từ AI.')
    return issues
  }

  const numbers = input.draft.questions.map((question) => question.questionNumber)
  const duplicateNumbers = numbers.filter((value, index) => numbers.indexOf(value) !== index)
  if (duplicateNumbers.length > 0) {
    issues.push(`Số câu hỏi bị trùng: ${Array.from(new Set(duplicateNumbers)).join(', ')}.`)
  }

  if (input.draft.questions.length === 0) {
    issues.push('Chưa có câu hỏi nào để lưu.')
  }

  for (const question of input.draft.questions) {
    const questionIssues = getQuestionValidationIssues(question)
    if (questionIssues.length > 0) {
      issues.push(`Câu ${question.questionNumber}: ${questionIssues.join(' ')}`)
    }
  }

  return issues
}

export function getPdfFileTypeIssue(file: File) {
  if (file.type && file.type !== PDF_MIME_TYPE) {
    return 'Định dạng khai báo của tệp không phải PDF (application/pdf).'
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return 'Chỉ hỗ trợ tệp PDF.'
  }
  return null
}

function withPdfMimeType(file: File) {
  return file.type === PDF_MIME_TYPE
    ? file
    : new File([file], file.name, { type: PDF_MIME_TYPE, lastModified: file.lastModified })
}

async function fingerprintPdf(file: File, checkPages = false) {
  const fileTypeIssue = getPdfFileTypeIssue(file)
  if (fileTypeIssue) throw new Error(fileTypeIssue)
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF vượt quá 20 MB.')
  const header = await file.slice(0, 8).text()
  if (!/^%PDF-[0-9]\.[0-9]$/.test(header)) throw new Error('Nội dung tệp không phải PDF.')
  const bytes = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  if (checkPages) {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = getDocument({ data: bytes })
    try {
      const doc = await task.promise.catch(() => {
        throw new Error('PDF bị hỏng hoặc bị khóa. Hãy chọn tệp PDF khác.')
      })
      if (doc.numPages > 30) throw new Error('PDF vượt quá 30 trang.')
    } finally {
      await task.destroy()
    }
  }
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function assertNewPdf(sha256: string) {
  const { data, error } = await getSupabaseBrowserClient().from('exams')
    .select('exam_id').eq('import_pdf_sha256', sha256).neq('import_state', 'undone').maybeSingle()
  if (error) throw new Error('Không thể kiểm tra PDF trùng lặp.')
  if (data) throw new Error(`PDF đã được nhập vào đề ${data.exam_id}.`)
}

export async function saveAdminImportedExam(input: SaveAdminImportedExamInput) {
  const supabase = getSupabaseBrowserClient()
  const { examDraft, warnings } = input.draft
  if (!input.draft.questions.length) throw new Error('Chưa có câu hỏi nào để lưu.')
  const sha256 = await fingerprintPdf(input.pdfFile)
  await assertNewPdf(sha256)
  const attempt = crypto.randomUUID()
  const existing = await supabase.from('exams').select('import_state')
    .eq('exam_id', examDraft.examId).maybeSingle()
  if (existing.error) throw new Error('Không thể kiểm tra mã đề.')
  const examId = existing.data?.import_state === 'undone' ? `${examDraft.examId}-${attempt}` : examDraft.examId
  const prefix = `${examDraft.subjectCode}/${examDraft.year}/${examId}/${attempt}`
  const paths: string[] = []
  const used = new Set<number>()
  const reserved = new Set(input.draft.questions.map((question) => question.questionNumber))
  let fallback = 1
  const normalized = input.draft.questions.map((question) => {
    let questionNumber = question.questionNumber
    if (!Number.isSafeInteger(questionNumber) || questionNumber <= 0 || questionNumber > 2147483647 || used.has(questionNumber)) {
      while (used.has(fallback) || reserved.has(fallback)) fallback++
      question = { ...question, warnings: [...question.warnings, `Cần kiểm tra số câu gốc: ${questionNumber}.`] }
      questionNumber = fallback++
    }
    used.add(questionNumber)
    return { ...question, questionNumber }
  })

  let questions: AdminImportQuestion[]
  let commitUnknown = false
  try {
    const pdfUrl = await uploadImportObject(`${prefix}/source.pdf`, withPdfMimeType(input.pdfFile), PDF_MIME_TYPE, paths)
    questions = await uploadQuestionAssets(prefix, normalized, paths)
    const bundle = buildImportBundle(examId, questions, {
      title: examDraft.title,
      school_name: examDraft.schoolName,
      city: examDraft.city,
      subject_code: examDraft.subjectCode,
      subject_name: examDraft.subjectName,
      year: examDraft.year,
      duration_minutes: examDraft.durationMinutes,
      pdf_url: pdfUrl,
      display_variant_code: examDraft.variantCode,
      answer_key_provided: questions.every((question) => Boolean(question.correctAnswer.trim())),
      source_path: `admin-import:${input.pdfFile.name}`,
      tags: ['admin-import', examDraft.subjectCode.toLowerCase()],
      import_attempt_id: attempt,
      import_pdf_sha256: sha256,
      import_warnings: warnings,
    })
    commitUnknown = true
    const { error } = await runImportSaveOperation('RPC', SAVE_UNCONFIRMED_MESSAGE, () =>
      supabase.rpc('save_school_exam_import', { bundle }),
    )
    if (error) {
      console.error('Exam import save RPC failed:', error)
      if (isDefiniteImportSaveFailure(error.code)) {
        commitUnknown = false
        throw new Error(error.code === '23505'
          ? 'PDF hoặc mã đề đã tồn tại.'
          : 'Không thể lưu bản nháp đề thi. Hãy thử lại hoặc liên hệ quản trị viên.')
      }
      const confirmed = await runImportSaveOperation('confirmation', SAVE_UNCONFIRMED_MESSAGE, async () => {
        const result = await supabase.from('exams').select('exam_id')
          .eq('import_attempt_id', attempt).maybeSingle()
        if (result.error) throw result.error
        return result
      })
      if (!confirmed.data) {
        throw new Error(SAVE_UNCONFIRMED_MESSAGE)
      }
    }
  } catch (error) {
    if (!commitUnknown) await cleanupFailedUpload(paths)
    throw error
  }
  return {
    examId,
    questionCount: questions.length,
    flaggedCount: questions.filter((question) => getQuestionValidationIssues(question).length > 0).length,
    warningCount: warnings.length + questions.reduce((count, question) => count + question.warnings.length, 0),
  }
}

export async function fetchManagedImportedExams() {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('exams')
    .select(
      'exam_id, title, school_name, city, subject_code, subject_name, year, duration_minutes, pdf_url, display_variant_code, source_path, is_active, import_state, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(24)

  if (error) {
    throw new Error(`Không thể tải danh sách đề đã nhập: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
      examId: row.exam_id,
      title: row.title,
      schoolName: row.school_name,
      city: row.city,
      subjectCode: row.subject_code as SubjectCode,
      subjectName: row.subject_name,
      year: row.year,
      durationMinutes: row.duration_minutes,
      pdfUrl: row.pdf_url,
      sourcePath: row.source_path ?? null,
      isActive: row.is_active,
      importState: row.import_state ?? null,
      createdAt: row.created_at,
      variantCode: row.display_variant_code ?? 'DEFAULT',
    }) satisfies ManagedImportedExam)
}

export async function updateManagedImportedExam(input: UpdateManagedImportedExamInput) {
  const supabase = getSupabaseBrowserClient()
  const subject = subjectOptions.find((item) => item.code === input.subjectCode)

  if (!subject) {
    throw new Error('Môn học không hợp lệ.')
  }

  const payload = {
    title: input.title.trim(),
    school_name: input.schoolName.trim(),
    city: input.city.trim(),
    subject_code: input.subjectCode,
    subject_name: subject.name,
    year: input.year,
    duration_minutes: input.durationMinutes,
    display_variant_code: input.variantCode.trim() || 'DEFAULT',
    is_active: input.isActive,
  }

  const { error: examError } = await supabase
    .from('exams')
    .update(payload)
    .eq('exam_id', input.examId)

  if (examError) {
    throw new Error(`Không thể cập nhật thông tin đề thi: ${examError.message}`)
  }

}

export async function fetchManagedImportedExamDraft(examId: string) {
  const supabase = getSupabaseBrowserClient()
  const { data: examRow, error: examError } = await supabase
    .from('exams')
    .select(
      'exam_id, title, school_name, city, subject_code, subject_name, year, duration_minutes, pdf_url, display_variant_code, import_warnings',
    )
    .eq('exam_id', examId)
    .maybeSingle<{
      exam_id: string
      title: string
      school_name: string
      city: string
      subject_code: SubjectCode
      subject_name: string
      year: number
      duration_minutes: number
      pdf_url: string
      display_variant_code: string | null
      import_warnings: string[]
    }>()

  if (examError) {
    throw new Error(`Không thể tải thông tin đề thi: ${examError.message}`)
  }

  if (!examRow) {
    throw new Error('Không tìm thấy đề thi cần chỉnh sửa.')
  }

  const { data: questionRows, error: questionError } = await supabase
    .from('questions')
    .select(
      'question_id, exam_id, question_number, difficulty_level, review_status, question_type, question_text, correct_answer, statement_json, topic, obsidian_source_path, has_image, metadata, options:question_options(option_label, option_text, display_order), assets:question_assets(asset_id, asset_type, asset_path, display_order, import_archived)',
    )
    .eq('exam_id', examId)
    .order('question_number', { ascending: true })
    .returns<ManagedExamQuestionRow[]>()

  if (questionError) {
    throw new Error(`Không thể tải câu hỏi của đề thi: ${questionError.message}`)
  }

  return {
    isValid: true,
    warnings: examRow.import_warnings,
    examDraft: {
      examId: examRow.exam_id,
      title: examRow.title,
      schoolName: examRow.school_name,
      city: examRow.city,
      subjectCode: examRow.subject_code,
      subjectName: examRow.subject_name,
      year: examRow.year,
      durationMinutes: examRow.duration_minutes,
      variantCode: examRow.display_variant_code ?? '101',
      pdfStoragePath: '',
      pdfUrl: examRow.pdf_url,
    },
    questions: (questionRows ?? []).map((question) =>
      normalizeQuestion(
        {
          persistedId: question.question_id,
          difficultyLevel: question.difficulty_level,
          reviewed: question.review_status === 'approved',
          questionNumber: question.question_number,
          questionType: question.question_type,
          topic: question.topic ?? '',
          questionText: question.question_text,
          options: (question.options ?? []).map((option) => ({
            label: option.option_label,
            text: option.option_text,
          })),
          statements: (question.statement_json ?? []).map((statement) => ({
            label: statement.label as AdminImportStatement['label'],
            text: statement.text,
          })),
          correctAnswer: question.correct_answer ?? '',
          isValid: true,
          warnings: Array.isArray(question.metadata?.import_warnings) ? question.metadata.import_warnings : [],
          changes: [],
          assets: (question.assets ?? []).filter((asset) => !asset.import_archived).map((asset) => ({
            persistedId: asset.asset_id,
            assetType: asset.asset_type,
            assetPath: asset.asset_path,
            publicUrl: asset.asset_path,
          })),
          rawExcerpt: null,
        },
        question.question_number,
      ),
    ),
    rawModelResponse: null,
  } satisfies AdminImportValidationResponse
}

export async function saveManagedImportedExamDraft(input: {
  draft: AdminImportValidationResponse
}) {
  const { examDraft, questions } = input.draft
  const paths: string[] = []
  const prefix = `${examDraft.subjectCode}/${examDraft.year}/${examDraft.examId}/${crypto.randomUUID()}`
  let commitUnknown = false
  try {
    const uploadedQuestions = await uploadQuestionAssets(prefix, questions, paths)
    const bundle = buildImportBundle(examDraft.examId, uploadedQuestions)
    commitUnknown = true
    const { error } = await runImportSaveOperation('review RPC', SAVE_UNCONFIRMED_MESSAGE, () =>
      getSupabaseBrowserClient().rpc('save_school_exam_import', { bundle, reviewing: true }),
    )
    if (error) {
      console.error('Exam import save review RPC failed:', error)
      commitUnknown = !isDefiniteImportSaveFailure(error.code)
      throw new Error(commitUnknown
        ? SAVE_UNCONFIRMED_MESSAGE
        : 'Không thể lưu kết quả duyệt. Hãy thử lại hoặc liên hệ quản trị viên.')
    }
  } catch (error) {
    if (!commitUnknown) await cleanupFailedUpload(paths)
    throw error
  }
}

export async function setManagedExamImportState(examId: string, state: 'published' | 'undo') {
  const { data, error } = await getSupabaseBrowserClient().rpc('set_school_exam_import_state', {
    target_exam_id: examId,
    target_state: state,
  })
  if (error) throw new Error(`Không thể đổi trạng thái đề thi: ${error.message}`)
  invalidateSchoolExamCaches()
  invalidatePracticeQuestionBankCache()
  return data as 'published' | 'unpublished' | 'undone'
}

function buildImportBundle(examId: string, questions: AdminImportQuestion[], examFields = {}) {
  const sections = buildSectionRows(examId, questions)
  const sectionIds = new Map(sections.map((section) => [section.part_code, section.section_id]))
  return {
    exam: { exam_id: examId, ...examFields },
    sections,
    questions: questions.map((question) => ({
      question_id: question.persistedId ?? buildQuestionId(examId, question.questionNumber),
      exam_id: examId,
      section_id: sectionIds.get(question.questionType),
      question_number: question.questionNumber,
      difficulty_level: question.difficultyLevel,
      question_type: question.questionType,
      question_text: question.questionText.trim(),
      correct_answer: question.correctAnswer.trim(),
      statement_json: question.questionType === 'true_false' ? question.statements : [],
      topic: question.topic.trim() || null,
      has_image: question.assets.length > 0,
      metadata: {
        source_question_number: question.questionNumber,
        import_source: 'admin_pdf_dashboard',
        import_issues: getQuestionValidationIssues(question),
        import_review_confirmed: question.reviewed === true,
        import_warnings: question.warnings,
      },
    })),
    options: questions.flatMap((question) => {
      const questionId = question.persistedId ?? buildQuestionId(examId, question.questionNumber)
      return question.options.map((option, index) => ({
        option_id: `${questionId}-option-${option.label.toLowerCase()}`,
        question_id: questionId,
        option_label: option.label,
        option_text: option.text.trim(),
        display_order: index + 1,
      }))
    }),
    assets: questions.flatMap((question) => {
      const questionId = question.persistedId ?? buildQuestionId(examId, question.questionNumber)
      return question.assets.filter((asset) => asset.publicUrl).map((asset, index) => ({
        asset_id: asset.persistedId ?? `${questionId}-asset-${crypto.randomUUID()}`,
        question_id: questionId,
        asset_type: asset.assetType,
        asset_path: asset.publicUrl,
        caption: asset.pageNumber ? `Trang ${asset.pageNumber}` : null,
        display_order: index + 1,
      }))
    }),
  }
}

function normalizeValidationResponse(payload: AdminImportValidationResponse): AdminImportValidationResponse {
  return {
    ...payload,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    questions: (payload.questions ?? []).map((question, index) =>
      normalizeQuestion(question, index + 1),
    ),
  }
}



function normalizeQuestion(question: AdminImportQuestion, fallbackNumber: number): AdminImportQuestion {
  const optionMap = new Map(
    (Array.isArray(question.options) ? question.options : []).map((option) => [
      String(option.label).trim().toUpperCase(),
      String(option.text ?? '').trim(),
    ]),
  )
  const statementMap = new Map(
    (Array.isArray(question.statements) ? question.statements : []).map((statement) => [
      String(statement.label).trim().toLowerCase(),
      String(statement.text ?? '').trim(),
    ]),
  )

  const questionType = ['multiple_choice', 'true_false', 'short_answer'].includes(
    question.questionType,
  )
    ? question.questionType
    : 'multiple_choice'

  return {
    persistedId: question.persistedId,
    reviewed: question.reviewed,
    difficultyLevel: [1, 2, 3, 4].includes(question.difficultyLevel ?? 0) ? question.difficultyLevel : null,
    questionNumber: Number(question.questionNumber) || fallbackNumber,
    questionType,
    topic: String(question.topic ?? '').trim(),
    questionText: String(question.questionText ?? '').trim(),
    options:
      questionType === 'multiple_choice'
        ? (['A', 'B', 'C', 'D'] as const).map((label) => ({
            label,
            text: optionMap.get(label) ?? '',
          }))
        : [],
    statements:
      questionType === 'true_false'
        ? (['a', 'b', 'c', 'd'] as const).map((label) => ({
            label,
            text: statementMap.get(label) ?? '',
          }))
        : [],
    correctAnswer: String(question.correctAnswer ?? '').trim().toUpperCase(),
    isValid: Boolean(question.isValid),
    warnings: Array.isArray(question.warnings) ? question.warnings : [],
    changes: Array.isArray(question.changes) ? question.changes : [],
    assets: Array.isArray(question.assets)
      ? question.assets.filter((asset) => asset.assetType !== 'question_block')
      : [],
    rawExcerpt: question.rawExcerpt ?? null,
  }
}

function buildSectionRows(examId: string, questions: AdminImportQuestion[]) {
  const order: SectionPart[] = ['multiple_choice', 'true_false', 'short_answer']
  return order
    .map((partCode, index) => {
      const partQuestions = questions
        .filter((question) => question.questionType === partCode)
        .sort((left, right) => left.questionNumber - right.questionNumber)
      if (partQuestions.length === 0) {
        return null
      }

      return {
        section_id: `${examId}-section-${partCode}`,
        exam_id: examId,
        part_code: partCode,
        title:
          partCode === 'multiple_choice'
            ? 'Phần I. Trắc nghiệm nhiều lựa chọn'
            : partCode === 'true_false'
              ? 'Phần II. Đúng/sai'
              : 'Phần III. Trả lời ngắn',
        instructions:
          partCode === 'multiple_choice'
            ? 'Mỗi câu chọn một trong bốn đáp án.'
            : partCode === 'true_false'
              ? 'Mỗi câu gồm bốn mệnh đề đúng/sai.'
              : 'Nhập đáp án ngắn.',
        start_question_number: partQuestions[0].questionNumber,
        end_question_number: partQuestions[partQuestions.length - 1].questionNumber,
        display_order: index + 1,
        options_per_question: partCode === 'multiple_choice' ? 4 : 0,
        statement_count: partCode === 'true_false' ? 4 : 0,
      }
    })
    .filter((section) => section !== null)
}

function isDefiniteImportSaveFailure(code: unknown) {
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('08')
}

async function runImportSaveOperation<T>(operation: string, message: string, run: () => PromiseLike<T>) {
  try {
    return await run()
  } catch (error) {
    console.error(`Exam import save ${operation} failed:`, error)
    throw new Error(message, { cause: error })
  }
}

async function uploadImportObject(path: string, body: Blob, contentType: string, paths: string[]) {
  return runImportSaveOperation(
    'Storage upload',
    'Không thể tải tệp đề thi lên. Hãy kiểm tra kết nối hoặc liên hệ quản trị viên.',
    async () => {
      const bucket = getSupabaseBrowserClient().storage.from(STORAGE_BUCKET)
      paths.push(path)
      const { error } = await bucket.upload(path, body, { cacheControl: '3600', contentType, upsert: false })
      if (error) throw error
      return bucket.getPublicUrl(path).data.publicUrl
    },
  )
}

async function cleanupFailedUpload(paths: string[]) {
  if (!paths.length) return
  await runImportSaveOperation(
    'Storage cleanup',
    'Không thể dọn các tệp đã tải lên sau khi lưu thất bại. Hãy liên hệ quản trị viên trước khi thử lại.',
    async () => {
      const { error } = await getSupabaseBrowserClient().storage.from(STORAGE_BUCKET).remove(paths)
      if (error) throw error
    },
  )
}

async function uploadQuestionAssets(prefix: string, questions: AdminImportQuestion[], paths: string[]) {
  const uploaded: AdminImportQuestion[] = []
  for (const question of questions) {
    const assets: AdminImportAsset[] = []
    for (const asset of question.assets) {
      if (!asset.assetDataUrl) {
        assets.push(asset)
        continue
      }
      const blob = dataUrlToBlob(asset.assetDataUrl)
      const name = asset.assetPath.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '-')
      const assetPath = `${prefix}/assets/${crypto.randomUUID()}-${name || 'image'}`
      const publicUrl = await uploadImportObject(assetPath, blob, blob.type || 'image/png', paths)
      assets.push({ ...asset, assetPath, publicUrl })
    }
    uploaded.push({ ...question, assets })
  }
  return uploaded
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, base64Data] = dataUrl.split(',')
  const contentType = metadata.match(/data:(.*?);base64/)?.[1] ?? 'image/png'
  const binary = window.atob(base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType })
}

function buildQuestionId(examId: string, questionNumber: number) {
  return `${examId}-q${String(questionNumber).padStart(2, '0')}`
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
