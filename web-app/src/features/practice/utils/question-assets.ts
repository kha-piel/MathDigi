import type { SchoolExamQuestionRecord } from '../types/school-exam-types'

export function buildQuestionAssetUrls(question: Pick<SchoolExamQuestionRecord, 'pdfUrl' | 'assets' | 'assetPaths'>) {
  const examSlug = (question.pdfUrl ?? '').split('/').pop()?.replace(/\.pdf$/i, '') ?? ''
  const paths = question.assets?.length
    ? question.assets.filter((asset) => asset.assetType === 'figure')
      .sort((a, b) => a.displayOrder - b.displayOrder).map((asset) => asset.assetPath)
    : question.assetPaths.filter((path) => /_hinh\d+\./i.test(path))
  return paths.map((path) => /^(https?:\/\/|\/)/i.test(path) || !examSlug
    ? path : `/school-exam-assets/${examSlug}/${path}`)
}
