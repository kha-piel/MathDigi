import type { PracticeBlueprint, PracticeQuestion } from '../types/practice-types'

export type PracticeSelectionMode = 'balanced' | 'random'

export function seededRandom(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function deduplicateQuestions<T>(questions: T[], key: (question: T) => string): T[] {
  const seen = new Set<string>()
  return questions.filter((question) => {
    const fingerprint = key(question)
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function contentFingerprint(type: string, text: string, options: string[], assets: string[] = []) {
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim()
  return JSON.stringify([type, normalize(text), options.map(normalize).sort(), [...new Set(assets)].sort()])
}

export function isContextDependentQuestion(content: string, ownQuestionNumber?: number) {
  const questionMarker = '\uE000'
  const normalized = content.normalize('NFC').toLowerCase()
    .replace(/(?<![\p{L}\p{N}_])câu(?![\p{L}\p{N}_])/gu, questionMarker)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bcau\b/g, 'nonquestion').replaceAll(questionMarker, 'cau')
    .replace(/[đĐ]/g, 'd').toLowerCase().trim()
    .replace(/^(?:#{1,6}\s*)?(?:\*\*)?cau(?: hoi)?\s+\d+[ \t]*(?:\*\*)?[ \t]*(?:[.:)]|\r?\n|$)\s*/, '')
    .replace(/\s+/g, ' ')
  let referencesAnotherNumber = false
  const withoutNumbers = normalized.replace(/\bcau(?: hoi)?\s+(?:so\s+)?(\d+)\b/g, (_match, number: string) => {
    if (Number(number) !== ownQuestionNumber) referencesAnotherNumber = true
    return ''
  })
  return referencesAnotherNumber || /\bcau(?: hoi)?\s+(?:tren|truoc|vua roi)\b/.test(withoutNumbers)
    || /\b(?:o|ket qua(?: cua)?|du kien(?: cua)?)\s+cau(?: hoi)?\b(?!\s+lac bo\b)/.test(withoutNumbers)
}

export function buildBlueprintQuestions(input: {
  blueprint: PracticeBlueprint
  questionBank: PracticeQuestion[]
  seed: number
  mode?: PracticeSelectionMode
  seenQuestionIds?: ReadonlySet<string>
  preferredSchoolName?: string
}) {
  const random = seededRandom(input.seed)
  const warnings: string[] = []
  const used = new Set<string>()
  const examCounts = new Map<string, number>()
  const topicCounts = new Map<string, number>()
  const independentQuestions = input.questionBank.filter((q) =>
    !isContextDependentQuestion(q.content, q.sourceMeta?.sourceQuestionNumber))
  const bank = deduplicateQuestions(independentQuestions, (q) => contentFingerprint(
    q.questionType, q.content, q.questionType === 'true_false'
      ? (q.statements ?? []).map((s) => s.content) : q.answers.map((a) => a.content),
    q.assetUrls?.length ? q.assetUrls : q.hasImage ? [`source:${q.sourceExamId}:${q.questionId}`] : [],
  ))
  const mode = input.mode ?? 'balanced'
  const questions = input.blueprint.sections.flatMap((section) => {
    const selected: PracticeQuestion[] = []
    function pick(level?: number) {
      const candidates = shuffle(bank.filter((q) => q.questionType === section.questionType &&
        !used.has(q.questionId) && (level === undefined || q.level === level)), random)
      candidates.sort((a, b) => {
        const unseen = Number(input.seenQuestionIds?.has(a.questionId) ?? false) -
          Number(input.seenQuestionIds?.has(b.questionId) ?? false)
        if (unseen || mode === 'random') return unseen
        const score = (q: PracticeQuestion) =>
          (examCounts.get(q.sourceExamId) ?? 0) / 8 + (topicCounts.get(q.topicId) ?? 0) / 6 -
          (input.preferredSchoolName && q.schoolName === input.preferredSchoolName ? 0.25 : 0)
        return score(a) - score(b)
      })
      const question = candidates[0]
      if (!question) return undefined
      used.add(question.questionId)
      examCounts.set(question.sourceExamId, (examCounts.get(question.sourceExamId) ?? 0) + 1)
      topicCounts.set(question.topicId, (topicCounts.get(question.topicId) ?? 0) + 1)
      selected.push(question)
      return question
    }
    if (mode === 'random') {
      for (let i = 0; i < section.count; i++) if (!pick()) break
    } else {
      for (const level of [1, 2, 3, 4] as const) {
        const substitutions = new Map<number, number>()
        const priority = [level, ...[4, 3, 2, 1].filter((l) => l < level),
          ...[1, 2, 3, 4].filter((l) => l > level)]
        for (let i = 0; i < section.levelCounts[level]; i++) {
          let question: PracticeQuestion | undefined
          for (const candidateLevel of priority) {
            question = pick(candidateLevel)
            if (question) break
          }
          if (question && question.level !== level) {
            substitutions.set(question.level, (substitutions.get(question.level) ?? 0) + 1)
          }
        }
        for (const [replacement, count] of substitutions) {
          warnings.push(`${section.title}: thiếu ${count} câu mức ${level}, đã thay bằng mức ${replacement}.`)
        }
      }
    }
    if (selected.length < section.count) {
      warnings.push(`${section.title}: kho chỉ có ${selected.length}/${section.count} câu; đề đã được rút gọn.`)
    }
    return shuffle(selected, random).map((q) => ({
      ...q,
      answers: q.questionType === 'multiple_choice'
        ? shuffle(q.answers, random).map((answer, index) => ({
            ...answer,
            optionLabel: String.fromCharCode(65 + index),
            displayOrder: index + 1,
            metadata: { ...answer.metadata, originalLabel: answer.metadata?.originalLabel ?? answer.optionLabel },
          }))
        : q.answers.map((answer) => ({ ...answer })),
    }))
  })
  if (!questions.length) throw new Error('Kho câu hỏi Toán hiện trống. Vui lòng thử lại sau.')
  return { questions, warnings }
}
