import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthSessionStore } from '../../features/auth/store/auth-session-store'
import {
  createEmptyMetadata,
  setManagedExamImportState,
  fetchManagedImportedExamDraft,
  fetchManagedImportedExams,
  getDraftValidationIssues,
  getPdfFileTypeIssue,
  getQuestionValidationIssues,
  requestExamPdfValidation,
  saveAdminImportedExam,
  saveManagedImportedExamDraft,
  subjectOptions,
  topicOptionsBySubjectCode,
  type AdminImportMetadata,
  type AdminImportAsset,
  type AdminImportQuestion,
  type AdminImportStatement,
  type AdminImportValidationResponse,
  type ManagedImportedExam,
  type SubjectCode,
  updateManagedImportedExam,
} from '../../features/admin-import/services/admin-import-service'

type AnswerChoice = 'A' | 'B' | 'C' | 'D'
type AnswerKeyByNumber = Record<number, string>
const PART_TWO_COUNT = 4
const PART_THREE_COUNT = 6

type ManagedExamFormState = {
  examId: string
  title: string
  schoolName: string
  city: string
  subjectCode: SubjectCode
  year: string
  durationMinutes: string
  variantCode: string
  isActive: boolean
}

export function ImportExamPage() {
  const user = useAuthSessionStore((state) => state.user)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [metadata, setMetadata] = useState<AdminImportMetadata>(createEmptyMetadata())
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const partOneQuestionCount = getPartOneQuestionCount(metadata.subjectCode)
  const [partOneAnswers, setPartOneAnswers] = useState<Record<number, AnswerChoice | ''>>(
    () => createAnswerChoiceState(partOneQuestionCount),
  )
  const [partTwoAnswers, setPartTwoAnswers] = useState<AnswerKeyByNumber>(() =>
    createAnswerTextState(PART_TWO_COUNT),
  )
  const [partThreeAnswers, setPartThreeAnswers] = useState<AnswerKeyByNumber>(() =>
    createAnswerTextState(PART_THREE_COUNT),
  )
  const [dragActive, setDragActive] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [validationStatus, setValidationStatus] = useState('')
  const [apiError, setApiError] = useState('')
  const [importReport, setImportReport] = useState<Awaited<ReturnType<typeof saveAdminImportedExam>> | null>(null)
  const [result, setResult] = useState<AdminImportValidationResponse | null>(null)
  const [managedExams, setManagedExams] = useState<ManagedImportedExam[]>([])
  const [isLoadingManagedExams, setIsLoadingManagedExams] = useState(true)
  const [managerError, setManagerError] = useState('')
  const [editingExamId, setEditingExamId] = useState<string | null>(null)
  const [managedForm, setManagedForm] = useState<ManagedExamFormState | null>(null)
  const [isUpdatingManagedExam, setIsUpdatingManagedExam] = useState(false)
  const [deletingExamId, setDeletingExamId] = useState<string | null>(null)
  const [editingQuestionExamId, setEditingQuestionExamId] = useState<string | null>(null)
  const [managedDraft, setManagedDraft] = useState<AdminImportValidationResponse | null>(null)
  const [isLoadingManagedDraft, setIsLoadingManagedDraft] = useState(false)
  const [isSavingManagedDraft, setIsSavingManagedDraft] = useState(false)
  const [managedDraftDirty, setManagedDraftDirty] = useState(false)

  const draftIssues = useMemo(() => {
    return getDraftValidationIssues({
      draft: result,
      pdfFile,
    })
  }, [pdfFile, result])

  const answerKeyText = useMemo(
    () =>
      buildAnswerKeyText({
        partOneAnswers,
        partTwoAnswers,
        partThreeAnswers,
        partOneQuestionCount,
        partTwoQuestionCount: PART_TWO_COUNT,
        partThreeQuestionCount: PART_THREE_COUNT,
      }),
    [partOneAnswers, partOneQuestionCount, partThreeAnswers, partTwoAnswers],
  )
  const topicSuggestions = useMemo(
    () => topicOptionsBySubjectCode[metadata.subjectCode] ?? [],
    [metadata.subjectCode],
  )

  useEffect(() => {
    void loadManagedExams()
  }, [])

  async function loadManagedExams() {
    try {
      setIsLoadingManagedExams(true)
      setManagerError('')
      const exams = await fetchManagedImportedExams()
      setManagedExams(exams)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể tải danh sách đề đã nhập.'
      setManagerError(message)
    } finally {
      setIsLoadingManagedExams(false)
    }
  }

  function updateMetadataField<Key extends keyof AdminImportMetadata>(
    key: Key,
    value: AdminImportMetadata[Key],
  ) {
    setMetadata((current) => ({
      ...current,
      [key]: value,
    }))
    setResult(null)
  }

  function updateSubject(subjectCode: SubjectCode) {
    const subject = subjectOptions.find((item) => item.code === subjectCode)
    const nextPartOneQuestionCount = getPartOneQuestionCount(subjectCode)
    setMetadata((current) => ({
      ...current,
      subjectCode,
      subjectName: subject?.name ?? current.subjectName,
      durationMinutes: subject?.durationMinutes ?? current.durationMinutes,
    }))
    setPartOneAnswers((current) => resizeAnswerChoiceState(current, nextPartOneQuestionCount))
    setResult(null)
  }

  function handleSelectedFile(file: File) {
    const fileTypeIssue = getPdfFileTypeIssue(file)
    if (fileTypeIssue) {
      toast.error(fileTypeIssue)
      return
    }

    setPdfFile(file)
    setApiError('')
    setResult(null)
    toast.success(`Đã chọn PDF: ${file.name}`)
  }

  function handlePickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      handleSelectedFile(file)
    }
    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      handleSelectedFile(file)
    }
  }

  async function handleValidate() {
    if (!pdfFile) {
      toast.error('Hãy chọn tệp PDF trước khi phân tích.')
      return
    }

    const requiredFields: Array<[string, string]> = [
      ['Tên trường', metadata.schoolName],
      ['Thành phố', metadata.city],
      ['Năm thi', metadata.year],
      ['Mã đề', metadata.variantCode],
    ]
    const missingField = requiredFields.find(([, value]) => !value.trim())
    if (missingField) {
      toast.error(`Thiếu ${missingField[0]}.`)
      return
    }

    try {
      setIsValidating(true)
      setApiError('')
      setValidationStatus('Đang chuẩn bị tải PDF lên...')
      const payload = await requestExamPdfValidation({
        pdfFile,
        metadata,
        answerKeyText,
        onStatusChange: setValidationStatus,
      })
      setValidationStatus('')
      setResult(payload)

      if (payload.questions.length > 0) {
        toast.success(`AI đã trích xuất ${payload.questions.length} câu hỏi từ PDF.`)
      } else {
        toast.warning('AI chưa trích xuất được câu hỏi nào. Hãy kiểm tra PDF.')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể phân tích PDF lúc này.'
      setApiError(message)
      toast.error(message)
    } finally {
      setIsValidating(false)
      setValidationStatus('')
    }
  }

  async function handleSave() {
    if (!result || !pdfFile || !result.questions.length) return
    try {
      setIsSaving(true)
      setApiError('')
      setImportReport(null)
      const saved = await saveAdminImportedExam({ pdfFile, draft: result })
      setImportReport(saved)
      setResult(null)
      setPdfFile(null)
      toast.success(`Đã lưu bản nháp ${saved.questionCount} câu. Hãy duyệt trước khi xuất bản.`)
      await loadManagedExams()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể lưu vào Supabase.'
      setApiError(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  function updateQuestionField(index: number, patch: Partial<AdminImportQuestion>) {
    setResult((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                ...patch,
              }
            : question,
        ),
      }
    })
  }

  function updateOption(index: number, label: 'A' | 'B' | 'C' | 'D', text: string) {
    setResult((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                options: question.options.map((option) =>
                  option.label === label ? { ...option, text } : option,
                ),
              }
            : question,
        ),
      }
    })
  }

  function updateStatement(index: number, label: AdminImportStatement['label'], text: string) {
    setResult((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                statements: question.statements.map((statement) =>
                  statement.label === label ? { ...statement, text } : statement,
                ),
              }
            : question,
        ),
      }
    })
  }

  async function addQuestionAsset(index: number, file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP cho câu hỏi.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setResult((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          questions: current.questions.map((question, questionIndex) => {
            if (questionIndex !== index) {
              return question
            }

            const nextAssetIndex = question.assets.length + 1
            const normalizedName = file.name
              .toLowerCase()
              .replace(/[^a-z0-9.]+/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '')
            const extension = normalizedName.split('.').pop() || 'png'
            const asset: AdminImportAsset = {
              assetType: 'figure',
              assetPath: `assets/q${String(question.questionNumber).padStart(2, '0')}-manual-${nextAssetIndex}.${extension}`,
              pageNumber: null,
              assetDataUrl: dataUrl,
            }

            return {
              ...question,
              assets: [...question.assets, asset],
            }
          }),
        }
      })
      toast.success(`Đã thêm ảnh vào câu ${result?.questions[index]?.questionNumber ?? index + 1}.`)
    } catch {
      toast.error('Không đọc được tệp ảnh vừa chọn.')
    }
  }

  function removeQuestionAsset(index: number, assetIndex: number) {
    setResult((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                assets: question.assets.filter((_, currentAssetIndex) => currentAssetIndex !== assetIndex),
              }
            : question,
        ),
      }
    })
  }

  function startEditingManagedExam(exam: ManagedImportedExam) {
    setEditingExamId(exam.examId)
    setManagedForm({
      examId: exam.examId,
      title: exam.title,
      schoolName: exam.schoolName,
      city: exam.city,
      subjectCode: exam.subjectCode,
      year: String(exam.year),
      durationMinutes: String(exam.durationMinutes),
      variantCode: exam.variantCode,
      isActive: exam.isActive,
    })
  }

  function stopEditingManagedExam() {
    setEditingExamId(null)
    setManagedForm(null)
  }

  async function openManagedQuestionEditor(exam: ManagedImportedExam) {
    try {
      setEditingQuestionExamId(exam.examId)
      setIsLoadingManagedDraft(true)
      const draft = await fetchManagedImportedExamDraft(exam.examId)
      setManagedDraft(draft)
      setManagedDraftDirty(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể mở trình chỉnh sửa câu hỏi của đề thi.'
      toast.error(message)
      setEditingQuestionExamId(null)
      setManagedDraft(null)
    } finally {
      setIsLoadingManagedDraft(false)
    }
  }

  function closeManagedQuestionEditor() {
    setEditingQuestionExamId(null)
    setManagedDraft(null)
  }

  function updateManagedFormField<Key extends keyof ManagedExamFormState>(
    key: Key,
    value: ManagedExamFormState[Key],
  ) {
    setManagedForm((current) => (current ? { ...current, [key]: value } : current))
  }

  async function handleSaveManagedExam() {
    if (!managedForm) {
      return
    }

    if (
      !managedForm.title.trim() ||
      !managedForm.schoolName.trim() ||
      !managedForm.city.trim() ||
      !managedForm.year.trim() ||
      !managedForm.durationMinutes.trim()
    ) {
      toast.error('Hãy điền đủ thông tin trước khi cập nhật đề thi.')
      return
    }

    try {
      setIsUpdatingManagedExam(true)
      await updateManagedImportedExam({
        examId: managedForm.examId,
        title: managedForm.title,
        schoolName: managedForm.schoolName,
        city: managedForm.city,
        subjectCode: managedForm.subjectCode,
        year: Number(managedForm.year) || new Date().getFullYear(),
        durationMinutes: Number(managedForm.durationMinutes) || 0,
        variantCode: managedForm.variantCode,
        isActive: managedForm.isActive,
      })
      toast.success('Đã cập nhật thông tin đề thi.')
      stopEditingManagedExam()
      await loadManagedExams()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể cập nhật đề thi lúc này.'
      toast.error(message)
    } finally {
      setIsUpdatingManagedExam(false)
    }
  }

  async function handleArchiveManagedExam(exam: ManagedImportedExam) {
    if (!window.confirm(`Ẩn đề "${exam.title}" khỏi học sinh? Dữ liệu và tệp được giữ lại.`)) return
    try {
      setDeletingExamId(exam.examId)
      const state = await setManagedExamImportState(exam.examId, 'undo')
      toast.success(state === 'undone' ? 'Đã hoàn tác nhập đề. Dữ liệu được giữ lại để có thể khôi phục.' : 'Đã ẩn đề. Các bài làm của học sinh được giữ nguyên.')
      if (editingQuestionExamId === exam.examId) closeManagedQuestionEditor()
      if (editingExamId === exam.examId) stopEditingManagedExam()
      await loadManagedExams()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể ẩn đề thi lúc này.')
    } finally {
      setDeletingExamId(null)
    }
  }

  async function handlePublishManagedExam(examId: string) {
    try {
      setIsSavingManagedDraft(true)
      await setManagedExamImportState(examId, 'published')
      closeManagedQuestionEditor()
      toast.success('Đã xuất bản đề thi.')
      await loadManagedExams()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể xuất bản đề thi.')
    } finally {
      setIsSavingManagedDraft(false)
    }
  }

  function updateManagedDraftQuestionField(index: number, patch: Partial<AdminImportQuestion>) {
    setManagedDraftDirty(true)
    setManagedDraft((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                reviewed: false,
                ...patch,
              }
            : question,
        ),
      }
    })
  }

  function updateManagedDraftOption(index: number, label: 'A' | 'B' | 'C' | 'D', text: string) {
    setManagedDraftDirty(true)
    setManagedDraft((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                reviewed: false,
                options: question.options.map((option) =>
                  option.label === label ? { ...option, text } : option,
                ),
              }
            : question,
        ),
      }
    })
  }

  function updateManagedDraftStatement(
    index: number,
    label: AdminImportStatement['label'],
    text: string,
  ) {
    setManagedDraftDirty(true)
    setManagedDraft((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                reviewed: false,
                statements: question.statements.map((statement) =>
                  statement.label === label ? { ...statement, text } : statement,
                ),
              }
            : question,
        ),
      }
    })
  }

  async function addManagedDraftQuestionAsset(index: number, file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP cho câu hỏi.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setManagedDraftDirty(true)
      setManagedDraft((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          questions: current.questions.map((question, questionIndex) => {
            if (questionIndex !== index) {
              return question
            }

            const nextAssetIndex = question.assets.length + 1
            const normalizedName = file.name
              .toLowerCase()
              .replace(/[^a-z0-9.]+/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '')
            const extension = normalizedName.split('.').pop() || 'png'

            return {
              ...question,
              reviewed: false,
              assets: [
                ...question.assets,
                {
                  assetType: 'figure',
                  assetPath: `assets/q${String(question.questionNumber).padStart(2, '0')}-manual-${nextAssetIndex}.${extension}`,
                  pageNumber: null,
                  assetDataUrl: dataUrl,
                },
              ],
            }
          }),
        }
      })
      toast.success('Đã thêm ảnh vào đề đang chỉnh sửa.')
    } catch {
      toast.error('Không đọc được tệp ảnh vừa chọn.')
    }
  }

  function removeManagedDraftQuestionAsset(index: number, assetIndex: number) {
    setManagedDraftDirty(true)
    setManagedDraft((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                reviewed: false,
                assets: question.assets.filter((_, currentAssetIndex) => currentAssetIndex !== assetIndex),
              }
            : question,
        ),
      }
    })
  }

  async function handleSaveManagedDraft() {
    if (!managedDraft) {
      return
    }


    try {
      setIsSavingManagedDraft(true)
      await saveManagedImportedExamDraft({
        draft: managedDraft,
      })
      setManagedDraft(await fetchManagedImportedExamDraft(managedDraft.examDraft.examId))
      setManagedDraftDirty(false)
      toast.success('Đã lưu kết quả duyệt. Hãy sửa các câu còn lỗi trước khi xuất bản.')
      await loadManagedExams()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể lưu nội dung đề thi đã sửa.'
      toast.error(message)
    } finally {
      setIsSavingManagedDraft(false)
    }
  }

  return (
    <section className="space-y-6">
      <TopicSuggestionList subjectCode={metadata.subjectCode} topics={topicSuggestions} />
      <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_26px_80px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1f2937_52%,#111827_100%)] px-6 py-7 text-white md:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100/90">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
            Nhập đề thi từ PDF
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h1 className="max-w-[14ch] text-4xl font-extrabold tracking-[-0.04em] text-white md:text-5xl">
                Tải đề thi lên để AI phân tích.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                Giáo viên tải PDF lên, chọn môn, nhập thông tin đề thi và điền đáp án cho ba phần. Hệ thống tự đặt thời lượng theo môn, trích xuất câu hỏi, ghép đáp án và tạo bản xem trước để giáo viên kiểm tra trước khi lưu.
              </p>
            </div>
            <div className="grid gap-3 rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <StatusPill label="Người thao tác" value={user?.fullName || user?.email || 'Giáo viên'} />
              <StatusPill label="Vai trò" value={user?.role === 'admin' ? 'Quản trị viên' : 'Giáo viên'} />
              <StatusPill label="Thời lượng mặc định" value={`${metadata.durationMinutes} phút`} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-5">
            <SectionHeading
              title="Thông tin bắt buộc"
              description="Thời lượng được đặt tự động theo môn học. Mã định danh đề được tạo từ tên trường, môn, năm thi và mã đề."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <SubjectField value={metadata.subjectCode} onChange={updateSubject} />
              <InputField
                label="Tên trường"
                onChange={(value) => updateMetadataField('schoolName', value)}
                placeholder="THPT Văn Lang"
                value={metadata.schoolName}
              />
              <InputField
                label="Thành phố"
                onChange={(value) => updateMetadataField('city', value)}
                placeholder="Hà Nội"
                value={metadata.city}
              />
              <InputField
                label="Năm thi"
                onChange={(value) => updateMetadataField('year', value)}
                placeholder="2026"
                type="number"
                value={metadata.year}
              />
              <InputField
                label="Mã đề"
                onChange={(value) => updateMetadataField('variantCode', value)}
                placeholder="101"
                value={metadata.variantCode}
              />
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_14px_42px_rgba(15,23,42,0.04)]">
              <div className="mb-2 block text-sm font-semibold text-slate-900">
                Đáp án do giáo viên nhập
              </div>
              <div className="space-y-4">
                <AnswerKeySection
                  description="Phần I. Trắc nghiệm nhiều lựa chọn"
                  title="Phần I"
                >
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {buildNumberRange(1, partOneQuestionCount).map((questionNumber) => (
                      <AnswerChoiceField
                        key={questionNumber}
                        questionNumber={questionNumber}
                        value={partOneAnswers[questionNumber] ?? ''}
                        onChange={(value) => {
                          setPartOneAnswers((current) => ({
                            ...current,
                            [questionNumber]: value,
                          }))
                          setResult(null)
                        }}
                      />
                    ))}
                  </div>
                </AnswerKeySection>

                <AnswerKeySection
                  description="Phần II. Đúng / Sai"
                  title="Phần II"
                >
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {buildNumberRange(1, PART_TWO_COUNT).map((questionNumber) => (
                      <AnswerTextField
                        key={questionNumber}
                        maxLength={4}
                        onChange={(value) => {
                          setPartTwoAnswers((current) => ({
                            ...current,
                            [questionNumber]: value.toUpperCase().replace(/[^DS]/g, '').slice(0, 4),
                          }))
                          setResult(null)
                        }}
                        placeholder="DDSS"
                        questionNumber={questionNumber}
                        value={partTwoAnswers[questionNumber] ?? ''}
                      />
                    ))}
                  </div>
                </AnswerKeySection>

                <AnswerKeySection
                  description="Phần III. Trả lời ngắn"
                  title="Phần III"
                >
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {buildNumberRange(1, PART_THREE_COUNT).map((questionNumber) => (
                      <AnswerTextField
                        key={questionNumber}
                        onChange={(value) => {
                          setPartThreeAnswers((current) => ({
                            ...current,
                            [questionNumber]: value,
                          }))
                          setResult(null)
                        }}
                        placeholder="68"
                        questionNumber={questionNumber}
                        value={partThreeAnswers[questionNumber] ?? ''}
                      />
                    ))}
                  </div>
                </AnswerKeySection>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {buildAnswerKeyHint(partOneQuestionCount, PART_TWO_COUNT, PART_THREE_COUNT)} Nếu thiếu đáp án, bản xem trước sẽ cảnh báo để giáo viên bổ sung.
              </p>
            </div>
          </section>

          <section className="space-y-5">
            <SectionHeading
              title="Tải PDF đề thi lên"
              description="Hệ thống chỉ nhận tệp PDF và dùng Gemini 2.5 Flash để trích xuất câu hỏi."
            />

            <div
              className={[
                'rounded-[30px] border border-dashed px-6 py-8 transition',
                dragActive
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-300 bg-slate-50/90',
              ].join(' ')}
              onDragEnter={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                setDragActive(false)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDrop={handleDrop}
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="space-y-3">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/80 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                    <Upload className="h-6 w-6 text-slate-700" strokeWidth={1.9} />
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-slate-900">
                      Kéo thả PDF vào đây
                    </div>
                    <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                      Tệp PDF gốc sẽ được tải lên Supabase Storage khi lưu bản nháp.
                    </p>
                  </div>
                </div>

                <button
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-100 active:translate-y-px"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <FileText className="h-4 w-4" strokeWidth={1.8} />
                  Chọn PDF
                </button>
              </div>

              <input
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handlePickFile}
                ref={fileInputRef}
                type="file"
              />

              {pdfFile ? (
                <div className="mt-6 flex items-center justify-between gap-4 rounded-[24px] border border-emerald-200 bg-white px-4 py-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{pdfFile.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-100"
                    onClick={() => {
                      setPdfFile(null)
                      setResult(null)
                    }}
                    type="button"
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 active:translate-y-px"
                disabled={isValidating}
                onClick={() => void handleValidate()}
                type="button"
              >
                {isValidating ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                )}
                Phân tích PDF bằng AI
              </button>

              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 active:translate-y-px"
                disabled={isSaving || isValidating || !result?.questions.length}
                onClick={() => void handleSave()}
                type="button"
              >
                {isSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Save className="h-4 w-4" strokeWidth={1.8} />
                )}
                Lưu bản nháp chờ duyệt
              </button>
            </div>

            {importReport ? (
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950" role="status">
                Đã lưu bản nháp: {importReport.questionCount - importReport.flaggedCount} câu hợp lệ, {importReport.warningCount} cảnh báo, {importReport.flaggedCount} câu cần sửa.
                <button
                  className="ml-2 font-semibold underline"
                  onClick={() => {
                    const exam = managedExams.find((item) => item.examId === importReport.examId)
                    if (exam) void openManagedQuestionEditor(exam)
                  }}
                  disabled={!managedExams.some((exam) => exam.examId === importReport.examId)}
                  type="button"
                >
                  Mở đề để duyệt
                </button>
              </div>
            ) : null}

            {isValidating && validationStatus ? (
              <div className="rounded-[24px] border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-sky-800">
                <div className="flex items-center gap-2 font-semibold">
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                  {validationStatus}
                </div>
                <p className="mt-2 text-xs leading-5 text-sky-700">
                  PDF có văn bản thường được xử lý nhanh hơn. PDF dạng ảnh hoặc bản quét có thể mất nhiều thời gian hơn để nhận dạng chữ.
                </p>
              </div>
            ) : null}

            {apiError ? <InlineAlert message={apiError} title="Không thể phân tích PDF" /> : null}

            <ManagedExamPanel
              deletingExamId={deletingExamId}
              editingExamId={editingExamId}
              exams={managedExams}
              form={managedForm}
              isLoading={isLoadingManagedExams}
              isSaving={isUpdatingManagedExam}
              onDelete={handleArchiveManagedExam}
              onEdit={startEditingManagedExam}
              onEditQuestions={openManagedQuestionEditor}
              onFormChange={updateManagedFormField}
              onRefresh={() => void loadManagedExams()}
              onSave={() => void handleSaveManagedExam()}
              onStopEditing={stopEditingManagedExam}
              panelError={managerError}
            />
          </section>
        </div>
      </div>

      {editingQuestionExamId ? (
        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_22px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Chỉnh sửa đề đã nhập
              </div>
              <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-slate-950">
                Sửa đề đã lưu trong hệ thống
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                Bạn có thể sửa nội dung, đáp án, chuyên đề và hình ảnh của từng câu hỏi như trong bản xem trước.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isSavingManagedDraft || isLoadingManagedDraft || !managedDraft}
                onClick={() => void handleSaveManagedDraft()}
                type="button"
              >
                {isSavingManagedDraft ? 'Đang lưu...' : 'Lưu kết quả duyệt'}
              </button>
              {managedDraft && managedExams.some((exam) => exam.examId === editingQuestionExamId && exam.importState && !exam.isActive) ? (
                <button
                  className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={isSavingManagedDraft || managedDraftDirty || !managedDraft.questions.length ||
                    managedDraft.questions.some((question) => !question.reviewed || getQuestionValidationIssues(question).length > 0)}
                  onClick={() => void handlePublishManagedExam(managedDraft.examDraft.examId)}
                  type="button"
                >
                  Xuất bản đề thi
                </button>
              ) : null}
              <button
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                disabled={isSavingManagedDraft}
                onClick={closeManagedQuestionEditor}
                type="button"
              >
                Đóng trình chỉnh sửa
              </button>
            </div>
          </div>

          <div className="mt-6">
            {isLoadingManagedDraft ? <PreviewSkeleton /> : null}
            {!isLoadingManagedDraft && !managedDraft ? <EmptyPreviewState /> : null}
            {!isLoadingManagedDraft && managedDraft ? (
              <PreviewEditor
                addQuestionAsset={addManagedDraftQuestionAsset}
                draftIssues={getDraftValidationIssues({
                  draft: managedDraft,
                  pdfFile: new File(['managed-exam'], 'managed-exam.pdf', {
                    type: 'application/pdf',
                  }),
                }).filter((issue) => issue !== 'Chưa có tệp PDF.')}
                removeQuestionAsset={removeManagedDraftQuestionAsset}
                result={managedDraft}
                subjectCode={managedDraft.examDraft.subjectCode}
                updateOption={updateManagedDraftOption}
                updateQuestionField={updateManagedDraftQuestionField}
                updateStatement={updateManagedDraftStatement}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_22px_60px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Bản xem trước
            </div>
            <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-slate-950">
              Kiểm tra và sửa trước khi lưu
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Bản xem trước hỗ trợ ba phần: trắc nghiệm A–D, đúng/sai (DDSS) và trả lời ngắn.
            </p>
          </div>

          {result ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              {result.questions.length} câu hỏi
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          {isValidating ? <PreviewSkeleton /> : null}
          {!isValidating && !result ? <EmptyPreviewState /> : null}
          {!isValidating && result ? (
            <PreviewEditor
              draftIssues={draftIssues}
              result={result}
              subjectCode={metadata.subjectCode}
              updateOption={updateOption}
              updateQuestionField={updateQuestionField}
              updateStatement={updateStatement}
              addQuestionAsset={addQuestionAsset}
              removeQuestionAsset={removeQuestionAsset}
            />
          ) : null}
        </div>
      </section>
    </section>
  )
}

function PreviewEditor({
  result,
  draftIssues,
  subjectCode,
  updateQuestionField,
  updateOption,
  updateStatement,
  addQuestionAsset,
  removeQuestionAsset,
}: {
  result: AdminImportValidationResponse
  draftIssues: string[]
  subjectCode: SubjectCode
  updateQuestionField: (index: number, patch: Partial<AdminImportQuestion>) => void
  updateOption: (index: number, label: 'A' | 'B' | 'C' | 'D', text: string) => void
  updateStatement: (index: number, label: AdminImportStatement['label'], text: string) => void
  addQuestionAsset: (index: number, file: File) => void
  removeQuestionAsset: (index: number, assetIndex: number) => void
}) {
  return (
    <div className="space-y-5">
      {result.warnings.length > 0 ? (
        <WarningBlock items={result.warnings} title="Cảnh báo chung" tone="warning" />
      ) : null}

      {draftIssues.length > 0 ? (
        <WarningBlock items={draftIssues} title="Cần sửa trước khi xuất bản" tone="danger" />
      ) : null}

      {result.questions.map((question, index) => {
        const clientIssues = getQuestionValidationIssues(question)
        const isQuestionReady = clientIssues.length === 0
        const localizedQuestionNumber = toLocalizedQuestionNumber(question.questionType, question.questionNumber)
        const questionSectionLabel = formatQuestionSectionLabel(question.questionType)

        return (
          <article
            className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_16px_40px_rgba(15,23,42,0.04)]"
            key={`${question.questionNumber}-${index}`}
          >
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {questionSectionLabel} - Câu {localizedQuestionNumber}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={isQuestionReady ? 'success' : 'danger'}>
                    {isQuestionReady ? (question.reviewed ? 'Đã duyệt' : 'Hợp lệ') : 'Cần sửa'}
                  </Badge>
                  <Badge tone="neutral">{formatQuestionType(question.questionType)}</Badge>
                  {question.assets.length > 0 ? <Badge tone="neutral">Có hình</Badge> : null}
                  {question.warnings.length > 0 ? (
                    <Badge tone="warning">{question.warnings.length} cảnh báo</Badge>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {!question.persistedId ? <InputField
                  compact
                  label="Số câu trong phần"
                  onChange={(value) =>
                    updateQuestionField(index, {
                      questionNumber: toGlobalQuestionNumber(
                        question.questionType,
                        Number(value) || 0,
                      ),
                    })
                  }
                  type="number"
                  value={String(localizedQuestionNumber)}
                /> : null}
                <label className="block text-sm font-semibold text-slate-900">
                  Mức độ (1–4)
                  <select
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"
                    onChange={(event) => updateQuestionField(index, { difficultyLevel: Number(event.target.value) || null })}
                    value={question.difficultyLevel ?? ''}
                  >
                    <option value="">Chọn mức độ</option>
                    <option value="1">1 — Nhận biết</option>
                    <option value="2">2 — Thông hiểu</option>
                    <option value="3">3 — Vận dụng</option>
                    <option value="4">4 — Vận dụng cao</option>
                  </select>
                </label>
                <AnswerField
                  onChange={(value) =>
                    updateQuestionField(index, {
                    correctAnswer: question.questionType === 'short_answer' ? value : value.toUpperCase(),
                    })
                  }
                  question={question}
                />
                {question.persistedId ? (
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <input
                      checked={Boolean(question.reviewed)}
                      disabled={!isQuestionReady}
                      onChange={(event) => updateQuestionField(index, { reviewed: event.target.checked })}
                      type="checkbox"
                    />
                    Xác nhận đã duyệt câu này
                  </label>
                ) : null}
              </div>

              <label className="mt-3 block">
                <div className="mb-2 text-sm font-semibold text-slate-900">Chuyên đề</div>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-12 w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-300"
                  list={`topic-suggestions-${subjectCode}`}
                  onChange={(event) =>
                    updateQuestionField(index, {
                      topic: event.target.value,
                    })
                  }
                  placeholder="AI gợi ý chuyên đề, giáo viên có thể chỉnh sửa"
                  spellCheck={false}
                  type="text"
                  value={question.topic}
                />
              </label>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-900">Đề bài</div>
                  <textarea
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="min-h-[150px] w-full rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-emerald-300"
                    onChange={(event) =>
                      updateQuestionField(index, {
                        questionText: event.target.value,
                      })
                    }
                    spellCheck={false}
                    value={question.questionText}
                  />
                </label>

                {question.questionType === 'multiple_choice' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {question.options.map((option) => (
                      <label
                        className="rounded-[24px] border border-slate-200 bg-white p-4"
                        key={option.label}
                      >
                        <div className="mb-2 text-sm font-semibold text-slate-900">
                          Đáp án {option.label}
                        </div>
                        <textarea
                          autoCapitalize="off"
                          autoCorrect="off"
                          className="min-h-[110px] w-full rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white"
                          onChange={(event) => updateOption(index, option.label, event.target.value)}
                          spellCheck={false}
                          value={option.text}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.questionType === 'true_false' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {question.statements.map((statement) => (
                      <label
                        className="rounded-[24px] border border-slate-200 bg-white p-4"
                        key={statement.label}
                      >
                        <div className="mb-2 text-sm font-semibold text-slate-900">
                          Mệnh đề {statement.label}
                        </div>
                        <textarea
                          autoCapitalize="off"
                          autoCorrect="off"
                          className="min-h-[110px] w-full rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white"
                          onChange={(event) =>
                            updateStatement(index, statement.label, event.target.value)
                          }
                          spellCheck={false}
                          value={statement.text}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                {clientIssues.length > 0 ? (
                  <WarningBlock items={clientIssues} title="Lỗi cần sửa" tone="danger" />
                ) : (
                  <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-800">
                    Câu này hợp lệ và có thể lưu.
                  </div>
                )}

                {question.warnings.length > 0 ? (
                  <WarningBlock items={question.warnings} title="Cảnh báo từ AI" tone="warning" />
                ) : null}

                <QuestionAssetEditor
                  assets={question.assets}
                  onAddAsset={(file) => addQuestionAsset(index, file)}
                  onRemoveAsset={(assetIndex) => removeQuestionAsset(index, assetIndex)}
                  questionNumber={localizedQuestionNumber}
                  questionSectionLabel={questionSectionLabel}
                />

                {question.changes.length > 0 ? (
                  <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">Nội dung AI đã sửa</div>
                    <div className="mt-3 space-y-3">
                      {question.changes.map((change, changeIndex) => (
                        <div
                          className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3"
                          key={`${change.field}-${changeIndex}`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {change.field}
                          </div>
                          <div className="mt-2 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">Gốc:</span>{' '}
                            {change.original || '--'}
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">Đã sửa:</span>{' '}
                            {change.corrected || '--'}
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">Lý do:</span>{' '}
                            {change.reason || '--'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ManagedExamPanel({
  exams,
  isLoading,
  panelError,
  editingExamId,
  form,
  isSaving,
  deletingExamId,
  onRefresh,
  onEdit,
  onEditQuestions,
  onStopEditing,
  onFormChange,
  onSave,
  onDelete,
}: {
  exams: ManagedImportedExam[]
  isLoading: boolean
  panelError: string
  editingExamId: string | null
  form: ManagedExamFormState | null
  isSaving: boolean
  deletingExamId: string | null
  onRefresh: () => void
  onEdit: (exam: ManagedImportedExam) => void
  onEditQuestions: (exam: ManagedImportedExam) => void
  onStopEditing: () => void
  onFormChange: <Key extends keyof ManagedExamFormState>(
    key: Key,
    value: ManagedExamFormState[Key],
  ) => void
  onSave: () => void
  onDelete: (exam: ManagedImportedExam) => void
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_42px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Quản lý đề đã nhập</div>
          <div className="mt-1 text-sm leading-6 text-slate-500">
            Chỉnh sửa thông tin, xuất bản, ẩn hoặc hoàn tác nhập đề.
          </div>
        </div>
        <button
          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
          onClick={onRefresh}
          type="button"
        >
          Tải lại danh sách
        </button>
      </div>

      {panelError ? <InlineAlert message={panelError} title="Không thể tải danh sách đề" /> : null}

      {isLoading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((item) => (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4" key={item}>
              <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
              <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-slate-200" />
              <div className="mt-2 h-3 w-3/4 animate-pulse rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
      ) : null}

      {!isLoading && exams.length === 0 ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
          Chưa có đề nào được lưu từ trang này.
        </div>
      ) : null}

      {!isLoading && exams.length > 0 ? (
        <div className="mt-4 space-y-4">
          {exams.map((exam) => {
            const isEditing = editingExamId === exam.examId && form?.examId === exam.examId

            return (
              <div
                className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                key={exam.examId}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-950">{exam.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">
                      {exam.schoolName} | {exam.subjectName} | {exam.year} | Mã {exam.variantCode || '--'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={exam.isActive ? 'success' : 'warning'}>
                        {exam.importState === 'pending_review' ? 'Chờ duyệt' : exam.importState === 'undone' ? 'Đã hoàn tác nhập' : exam.isActive ? 'Đã xuất bản' : 'Đang ẩn'}
                      </Badge>
                      <Badge tone="neutral">{exam.examId}</Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      href={exam.pdfUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Mở PDF
                    </a>
                    <button
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      onClick={() => onEdit(exam)}
                      type="button"
                    >
                      Sửa thông tin
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      disabled={exam.importState === 'published'}
                      onClick={() => void onEditQuestions(exam)}
                      type="button"
                    >
                      {exam.importState === 'published' ? 'Ẩn đề để sửa' : 'Duyệt / sửa câu hỏi'}
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={deletingExamId === exam.examId || exam.importState === 'undone' || exam.importState === 'unpublished'}
                      onClick={() => void onDelete(exam)}
                      type="button"
                    >
                      {deletingExamId === exam.examId ? 'Đang ẩn...' : 'Hoàn tác / ẩn đề'}
                    </button>
                  </div>
                </div>

                {isEditing && form ? (
                  <div className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <InputField
                        compact
                        label="Tiêu đề đề thi"
                        onChange={(value) => onFormChange('title', value)}
                        value={form.title}
                      />
                      <SubjectField
                        compact
                        value={form.subjectCode}
                        onChange={(value) => onFormChange('subjectCode', value)}
                      />
                      <InputField
                        compact
                        label="Tên trường"
                        onChange={(value) => onFormChange('schoolName', value)}
                        value={form.schoolName}
                      />
                      <InputField
                        compact
                        label="Thành phố"
                        onChange={(value) => onFormChange('city', value)}
                        value={form.city}
                      />
                      <InputField
                        compact
                        label="Năm thi"
                        onChange={(value) => onFormChange('year', value)}
                        type="number"
                        value={form.year}
                      />
                      <InputField
                        compact
                        label="Thời lượng"
                        onChange={(value) => onFormChange('durationMinutes', value)}
                        type="number"
                        value={form.durationMinutes}
                      />
                      <InputField
                        compact
                        label="Mã đề"
                        onChange={(value) => onFormChange('variantCode', value)}
                        value={form.variantCode}
                      />
                      <label className="block">
                        <div className="mb-2 text-sm font-semibold text-slate-900">Trạng thái</div>
                        <button
                          className={[
                            'h-12 w-full rounded-[20px] border px-4 text-sm font-semibold transition',
                            form.isActive
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700',
                          ].join(' ')}
                          disabled={Boolean(exam.importState)}
                          onClick={() => onFormChange('isActive', !form.isActive)}
                          type="button"
                        >
                          {form.isActive ? 'Đang hiển thị cho học sinh' : 'Đang ẩn khỏi học sinh'}
                        </button>
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                        disabled={isSaving}
                        onClick={onSave}
                        type="button"
                      >
                        {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </button>
                      <button
                        className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        onClick={onStopEditing}
                        type="button"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                ) : null}

              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  )
}

function TopicSuggestionList({
  subjectCode,
  topics,
}: {
  subjectCode: SubjectCode
  topics: string[]
}) {
  return (
    <datalist id={`topic-suggestions-${subjectCode}`}>
      {topics.map((topic) => (
        <option key={topic} value={topic} />
      ))}
    </datalist>
  )
}

function AnswerKeySection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[22px] border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs leading-5 text-slate-500">{description}</div>
      </div>
      {children}
    </section>
  )
}

function AnswerChoiceField({
  questionNumber,
  value,
  onChange,
}: {
  questionNumber: number
  value: AnswerChoice | ''
  onChange: (value: AnswerChoice | '') => void
}) {
  return (
    <label className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Câu {questionNumber}
      </div>
      <select
        className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white"
        onChange={(event) => onChange(event.target.value as AnswerChoice | '')}
        value={value}
      >
        <option value="">--</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
      </select>
    </label>
  )
}

function AnswerTextField({
  questionNumber,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  questionNumber: number
  value: string
  onChange: (value: string) => void
  placeholder: string
  maxLength?: number
}) {
  return (
    <label className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Câu {questionNumber}
      </div>
      <input
        autoCapitalize="off"
        autoCorrect="off"
        className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white"
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={value}
      />
    </label>
  )
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  compact = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  compact?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
      <input
        autoCapitalize="off"
        autoCorrect="off"
        className={[
          'w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-300',
          compact ? 'h-12' : 'h-14',
        ].join(' ')}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type={type}
        value={value}
      />
    </label>
  )
}

function SubjectField({
  value,
  onChange,
  compact = false,
}: {
  value: SubjectCode
  onChange: (value: SubjectCode) => void
  compact?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-semibold text-slate-900">Môn học</div>
      <select
        className={[
          'w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-emerald-300',
          compact ? 'h-12' : 'h-14',
        ].join(' ')}
        onChange={(event) => onChange(event.target.value as SubjectCode)}
        value={value}
      >
        {subjectOptions.map((subject) => (
          <option key={subject.code} value={subject.code}>
            {subject.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function createAnswerChoiceState(total: number): Record<number, AnswerChoice | ''> {
  return buildNumberRange(1, total).reduce<Record<number, AnswerChoice | ''>>((acc, questionNumber) => {
    acc[questionNumber] = ''
    return acc
  }, {})
}

function createAnswerTextState(total: number): AnswerKeyByNumber {
  return buildNumberRange(1, total).reduce<AnswerKeyByNumber>((acc, questionNumber) => {
    acc[questionNumber] = ''
    return acc
  }, {})
}

function resizeAnswerChoiceState(
  current: Record<number, AnswerChoice | ''>,
  total: number,
): Record<number, AnswerChoice | ''> {
  return buildNumberRange(1, total).reduce<Record<number, AnswerChoice | ''>>((acc, questionNumber) => {
    acc[questionNumber] = current[questionNumber] ?? ''
    return acc
  }, {})
}

function buildNumberRange(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function buildAnswerKeyText(input: {
  partOneAnswers: Record<number, AnswerChoice | ''>
  partTwoAnswers: AnswerKeyByNumber
  partThreeAnswers: AnswerKeyByNumber
  partOneQuestionCount: number
  partTwoQuestionCount: number
  partThreeQuestionCount: number
}) {
  const entries: string[] = []

  for (const questionNumber of buildNumberRange(1, input.partOneQuestionCount)) {
    const value = input.partOneAnswers[questionNumber]?.trim()
    if (value) {
      entries.push(`${questionNumber}.${value}`)
    }
  }

  for (const localNumber of buildNumberRange(1, input.partTwoQuestionCount)) {
    const value = input.partTwoAnswers[localNumber]?.trim().toUpperCase()
    if (value) {
      entries.push(`${localNumber + input.partOneQuestionCount}.${value}`)
    }
  }

  for (const localNumber of buildNumberRange(1, input.partThreeQuestionCount)) {
    const value = input.partThreeAnswers[localNumber]?.trim()
    if (value) {
      entries.push(`${localNumber + input.partOneQuestionCount + input.partTwoQuestionCount}: ${value}`)
    }
  }

  return entries.join(', ')
}

function getPartOneQuestionCount(subjectCode: SubjectCode) {
  return subjectCode === 'VAT_LY' || subjectCode === 'HOA_HOC' ? 18 : 12
}

function buildAnswerKeyHint(partOneCount: number, partTwoCount: number, partThreeCount: number) {
  const partTwoStart = partOneCount + 1
  const partTwoEnd = partOneCount + partTwoCount
  const partThreeStart = partTwoEnd + 1
  const partThreeEnd = partTwoEnd + partThreeCount
  return `Hệ thống tự ghép đáp án theo số câu 1–${partOneCount}, ${partTwoStart}–${partTwoEnd} và ${partThreeStart}–${partThreeEnd}.`
}

function AnswerField({
  question,
  onChange,
}: {
  question: AdminImportQuestion
  onChange: (value: string) => void
}) {
  if (question.questionType === 'multiple_choice') {
    return (
      <label className="block">
        <div className="mb-2 text-sm font-semibold text-slate-900">Đáp án đúng</div>
        <select
          className="h-12 w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-emerald-300"
          onChange={(event) => onChange(event.target.value)}
          value={question.correctAnswer}
        >
          <option value="">Chọn</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      </label>
    )
  }

  return (
    <InputField
      compact
      label={question.questionType === 'true_false' ? 'Đáp án DDSS' : 'Đáp án ngắn'}
      onChange={onChange}
      placeholder={question.questionType === 'true_false' ? 'DDSS' : '68'}
      value={question.correctAnswer}
    />
  )
}

function QuestionAssetEditor({
  assets,
  questionNumber,
  questionSectionLabel,
  onAddAsset,
  onRemoveAsset,
}: {
  assets: AdminImportAsset[]
  questionNumber: number
  questionSectionLabel: string
  onAddAsset: (file: File) => void
  onRemoveAsset: (assetIndex: number) => void
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
            Ảnh của câu hỏi
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Cắt ảnh từ PDF rồi tải lên đây. Ảnh sẽ được lưu cùng {questionSectionLabel.toLowerCase()} câu {questionNumber}.
          </p>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
          <Upload className="h-4 w-4" strokeWidth={1.8} />
          Thêm ảnh
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                onAddAsset(file)
              }
              event.target.value = ''
            }}
            type="file"
          />
        </label>
      </div>

      {assets.length > 0 ? (
        <div className="mt-4 space-y-3">
          {assets.map((asset, assetIndex) => (
            <div
              className="rounded-[20px] border border-slate-200 bg-slate-50 p-3"
              key={`${asset.assetPath}-${assetIndex}`}
            >
              {asset.assetDataUrl || asset.publicUrl ? (
                <img
                  alt={`${questionSectionLabel} câu ${questionNumber}, ảnh ${assetIndex + 1}`}
                  className="max-h-80 w-full rounded-[16px] object-contain"
                  src={asset.assetDataUrl || asset.publicUrl}
                />
              ) : (
                <div className="text-sm text-slate-500">Chưa có ảnh xem trước.</div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {asset.assetType} {asset.pageNumber ? `- trang ${asset.pageNumber}` : '- tải lên thủ công'}
                </div>
                <button
                  className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                  onClick={() => onRemoveAsset(assetIndex)}
                  type="button"
                >
                  Xóa ảnh
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
          Chưa có ảnh nào cho câu này.
        </div>
      )}
    </div>
  )
}

function InlineAlert({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-800">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm leading-6">{message}</div>
    </div>
  )
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  const className =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'danger'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${className}`}
    >
      {children}
    </span>
  )
}

function WarningBlock({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'warning' | 'danger'
}) {
  const className =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : 'border-amber-200 bg-amber-50 text-amber-800'

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${className}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
        {title}
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  )
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
        {label}
      </div>
      <div className="mt-2 break-all text-sm font-semibold text-white">{value}</div>
    </div>
  )
}

function EmptyPreviewState() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
        <div className="h-3 w-24 rounded-full bg-slate-200" />
        <div className="mt-4 h-8 max-w-lg rounded-full bg-slate-200" />
        <div className="mt-3 h-4 max-w-2xl rounded-full bg-slate-200" />
        <div className="mt-2 h-4 max-w-xl rounded-full bg-slate-200" />
      </div>
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-6">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
          <Sparkles className="h-5 w-5 text-slate-500" strokeWidth={1.8} />
        </div>
        <div className="mt-4 text-lg font-semibold text-slate-900">Chưa có bản xem trước</div>
        <p className="mt-2 max-w-md text-sm leading-7 text-slate-500">
          Tải PDF lên, nhập thông tin đề thi và đáp án, rồi chọn Phân tích PDF bằng AI.
        </p>
      </div>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      {[0, 1].map((item) => (
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5" key={item}>
          <div className="h-5 w-28 rounded-full bg-slate-200" />
          <div className="mt-4 h-10 w-full rounded-[20px] bg-slate-200" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((block) => (
              <div className="h-28 rounded-[24px] bg-slate-200" key={block} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatQuestionType(questionType: AdminImportQuestion['questionType']) {
  if (questionType === 'multiple_choice') {
    return 'Trắc nghiệm'
  }
  if (questionType === 'true_false') {
    return 'Đúng/sai'
  }
  return 'Trả lời ngắn'
}

function formatQuestionSectionLabel(questionType: AdminImportQuestion['questionType']) {
  if (questionType === 'multiple_choice') {
    return 'Phần I'
  }
  if (questionType === 'true_false') {
    return 'Phần II'
  }
  return 'Phần III'
}

function toLocalizedQuestionNumber(
  questionType: AdminImportQuestion['questionType'],
  questionNumber: number,
) {
  if (questionType === 'multiple_choice') {
    return questionNumber
  }
  if (questionType === 'true_false') {
    return Math.max(1, questionNumber - 12)
  }
  return Math.max(1, questionNumber - 16)
}

function toGlobalQuestionNumber(
  questionType: AdminImportQuestion['questionType'],
  localizedQuestionNumber: number,
) {
  if (localizedQuestionNumber <= 0) {
    return 0
  }
  if (questionType === 'multiple_choice') {
    return localizedQuestionNumber
  }
  if (questionType === 'true_false') {
    return localizedQuestionNumber + 12
  }
  return localizedQuestionNumber + 16
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Dữ liệu tệp không hợp lệ.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Không đọc được tệp.'))
    reader.readAsDataURL(file)
  })
}
