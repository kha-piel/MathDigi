import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { registerHooks } from 'node:module'

const supplementalDirectory = new URL('../src/features/practice/data/', import.meta.url)
const excludedFiles = new Set([
  'supplemental-physics-topic-questions.ts',
  'supplemental-reviewed-helper.ts',
])

function normalizeText(text) {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function topicSlug(topic) {
  return topic.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gu, 'd')
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

function validateQuestion(question, file) {
  const fail = (reason) => {
    throw new Error(`${file}: ${question.questionId ?? '(missing ID)'}: ${reason}`)
  }
  if (!question.questionId || !question.questionText?.trim() || !question.topic?.trim()) {
    fail('missing question ID, prompt or topic')
  }
  if (question.hasImage || question.assetPaths?.length || question.assets?.length) {
    fail('has assets; migrate and verify them before importing this question')
  }
  if (question.questionType !== 'multiple_choice' || question.statements?.length) {
    fail('unexpected question type')
  }
  if (!Number.isInteger(question.difficultyLevel) || question.difficultyLevel < 1 || question.difficultyLevel > 4) {
    fail('difficulty must be an integer from 1 to 4')
  }
  const options = question.options ?? []
  if (options.map(({ optionLabel }) => optionLabel).sort().join('') !== 'ABCD' ||
      options.some(({ optionText }) => !optionText?.trim()) ||
      options.map(({ displayOrder }) => displayOrder).sort().join('') !== '1234' ||
      !options.some(({ optionLabel }) => optionLabel === question.answerValue)) {
    fail('expected four ordered, nonempty options A–D and an answer matching one of them')
  }
}

export async function loadSupplementalMath() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      // Legacy app data imports the helper without its extension; Node requires it.
      if (context.parentURL?.startsWith(supplementalDirectory.href) && specifier === './supplemental-reviewed-helper') {
        return nextResolve(`${specifier}.ts`, context)
      }
      return nextResolve(specifier, context)
    },
  })

  try {
    const files = (await readdir(supplementalDirectory))
      .filter((file) => /^supplemental-.+\.ts$/u.test(file) && !excludedFiles.has(file))
      .sort()
    if (!files.length) throw new Error('No supplemental math sources found; use the pre-cutover revision.')
    const rows = []
    const seenIds = new Set()
    for (const file of files) {
      const exportedArrays = Object.values(await import(new URL(file, supplementalDirectory))).filter(Array.isArray)
      if (exportedArrays.length !== 1 || exportedArrays[0].length === 0) {
        throw new Error(`${file}: expected one nonempty question array`)
      }
      const wasServed = file.endsWith('-reviewed.ts') || file === 'supplemental-knowledge-review-questions.ts'
      for (const question of exportedArrays[0]) {
        validateQuestion(question, file)
        if (seenIds.has(question.questionId)) throw new Error(`Duplicate legacy ID: ${question.questionId}`)
        seenIds.add(question.questionId)
        rows.push({ question, file, wasServed })
      }
    }
    return rows
  } finally {
    hook.deregister()
  }
}

export function questionFingerprint(question) {
  return createHash('sha256').update(JSON.stringify([
    question.questionType,
    normalizeText(question.questionText),
    question.options.map(({ optionText }) => normalizeText(optionText)).sort(),
  ])).digest('hex')
}

export function auditSupplementalMath(rows) {
  const byStem = new Map()
  const byFingerprint = new Map()
  const byTopic = new Map()
  for (const { question, wasServed } of rows) {
    const stem = normalizeText(question.questionText)
    const fingerprint = questionFingerprint(question)
    const entry = {
      id: question.questionId,
      fingerprint,
      answer: normalizeText(question.options.find(({ optionLabel }) => optionLabel === question.answerValue).optionText),
    }
    if (!byStem.has(stem)) byStem.set(stem, [])
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, [])
    byStem.get(stem).push(entry)
    byFingerprint.get(fingerprint).push(entry)
    if (!byTopic.has(question.topic)) byTopic.set(question.topic, { served: 0, pending: 0 })
    byTopic.get(question.topic)[wasServed ? 'served' : 'pending'] += 1
  }

  const served = rows.filter((row) => row.wasServed).length
  return {
    total: rows.length,
    served,
    pending: rows.length - served,
    sources: [...new Set(rows.map((row) => row.file))],
    topics: Object.fromEntries([...byTopic].sort(([left], [right]) => left.localeCompare(right, 'vi'))),
    exactDuplicateGroups: [...byFingerprint.values()].filter((group) => group.length > 1).map((group) => ({
      ids: group.map((entry) => entry.id),
      conflictingAnswers: new Set(group.map((entry) => entry.answer)).size > 1,
    })),
    sameStemDifferentOptions: [...byStem.values()]
      .filter((group) => new Set(group.map((entry) => entry.fingerprint)).size > 1)
      .map((group) => group.map((entry) => entry.id)),
  }
}

function quoteJson(value) {
  const json = JSON.stringify(value)
  let delimiter = '$supplemental$'
  while (json.includes(delimiter)) delimiter = delimiter.replace(/\$$/u, '_$')
  return `${delimiter}${json}${delimiter}`
}

export function makeImportSql(rows) {
  if (rows.length === 0) throw new Error('No questions to import')
  const { exactDuplicateGroups } = auditSupplementalMath(rows)
  if (exactDuplicateGroups.length) {
    throw new Error(`Resolve duplicate source questions before importing: ${JSON.stringify(exactDuplicateGroups)}`)
  }
  const topicNames = new Map()
  const payload = rows.map(({ question, file, wasServed }) => {
    const slug = topicSlug(question.topic)
    if (!slug || (topicNames.has(slug) && topicNames.get(slug) !== question.topic)) {
      throw new Error(`Ambiguous topic slug for ${question.topic}: ${slug}`)
    }
    topicNames.set(slug, question.topic)
    return {
      question_id: question.questionId,
      question_type: question.questionType,
      topic: question.topic,
      topic_slug: slug,
      difficulty_level: question.difficultyLevel,
      review_status: wasServed ? 'approved' : 'pending_review',
      question_text: question.questionText,
      correct_answer: question.answerValue,
      source: file,
      obsidian_source_path: question.obsidianSourcePath,
      tags: question.tags ?? [],
      content_hash: questionFingerprint(question),
      options: question.options.map(({ optionLabel, optionText, displayOrder }) => ({
        option_label: optionLabel,
        option_text: optionText,
        display_order: displayOrder,
      })),
      metadata: {
        import_batch: 'supplemental-math-v1',
        legacy_exam_id: question.examId,
        legacy_exam_title: question.examTitle,
        legacy_school_name: question.schoolName,
        legacy_year: question.year,
        legacy_pdf_url: question.pdfUrl,
        legacy_question_number: question.questionNumber,
        source_question_number: question.sourceQuestionNumber,
        section_number: question.sourceSectionNumber,
      },
    }
  })
  return `-- MathDigi supplemental backfill. Review the default audit before applying.
BEGIN;

CREATE TEMP TABLE supplemental_math_import ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${quoteJson(payload)}::jsonb) AS legacy(
  question_id text, question_type text, topic text, topic_slug text,
  difficulty_level integer, review_status text, question_text text, correct_answer text,
  source text, obsidian_source_path text, tags text[], content_hash text, options jsonb, metadata jsonb
);

LOCK TABLE public.question_bank IN SHARE ROW EXCLUSIVE MODE;

DO $check_conflicts$
DECLARE
  conflict_id text;
  incoming_id text;
BEGIN
  SELECT bank.question_id, legacy.question_id INTO conflict_id, incoming_id
  FROM public.question_bank AS bank
  JOIN supplemental_math_import AS legacy
    ON bank.question_id = legacy.question_id OR bank.content_hash = legacy.content_hash
  WHERE bank.question_id <> legacy.question_id
     OR bank.content_hash IS DISTINCT FROM legacy.content_hash
  ORDER BY legacy.question_id, bank.question_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Supplemental question % collides with existing question %; no rows imported',
      incoming_id, conflict_id;
  END IF;
END
$check_conflicts$;

INSERT INTO public.topics (subject_code, slug, topic_name)
SELECT DISTINCT 'TOAN', topic_slug, topic FROM supplemental_math_import
ON CONFLICT (subject_code, slug) DO NOTHING;

WITH inserted AS (
  INSERT INTO public.question_bank (
    question_id, subject_code, topic_id, topic, question_type, difficulty_level, review_status,
    question_text, correct_answer, source, obsidian_source_path, tags, content_hash, metadata
  )
  SELECT
    legacy.question_id, 'TOAN', topics.topic_id, legacy.topic, legacy.question_type,
    legacy.difficulty_level, legacy.review_status, legacy.question_text, legacy.correct_answer,
    legacy.source, legacy.obsidian_source_path, legacy.tags, legacy.content_hash, legacy.metadata
  FROM supplemental_math_import AS legacy
  JOIN public.topics AS topics ON topics.subject_code = 'TOAN' AND topics.slug = legacy.topic_slug
  ON CONFLICT (question_id) DO NOTHING
  RETURNING question_id
)
INSERT INTO public.question_bank_options (option_id, question_id, option_label, option_text, display_order)
SELECT inserted.question_id || '-option-' || options.option_label, inserted.question_id,
       options.option_label, options.option_text, options.display_order
FROM inserted
JOIN supplemental_math_import AS legacy USING (question_id)
CROSS JOIN LATERAL jsonb_to_recordset(legacy.options) AS options(option_label text, option_text text, display_order integer);

COMMIT;
`
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    const emitSql = args.length === 1 && args[0] === '--sql'
    if (args.length && !emitSql) throw new Error('Usage: node scripts/migrate-supplemental-math.mjs [--sql]')
    const rows = await loadSupplementalMath()
    console.log(emitSql ? makeImportSql(rows) : JSON.stringify(auditSupplementalMath(rows), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
