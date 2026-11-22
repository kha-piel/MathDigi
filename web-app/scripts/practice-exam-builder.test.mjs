import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBlueprintQuestions, contentFingerprint, deduplicateQuestions, isContextDependentQuestion } from '../src/features/practice/services/practice-exam-builder.ts'
import { fetchQuestionPages } from '../src/features/practice/services/practice-pool-loader.ts'
import { practiceBlueprints } from '../src/features/practice/data/practice-blueprints.ts'
import { buildSubmissionSummary, checkQuestion, createExamRuntimeSession, formatCorrectResponse } from '../src/features/exam/core/exam-session.ts'

const blueprint = practiceBlueprints.find((b) => b.blueprintId === 'bo-gddt-toan-22')
const singleSection = (count, level = 2, type = 'multiple_choice') => ({
  ...blueprint,
  sections: [{ id: 'test', title: 'Phần thử', questionType: type, count,
    levelCounts: { 1: 0, 2: 0, 3: 0, 4: 0, [level]: count } }],
})
function question(id, level = 2, type = 'multiple_choice') {
  return {
    questionId: id, topicId: 'topic', subjectId: 'TOAN', subjectName: 'Toán',
    sourceExamId: 'source', schoolName: '', year: 2025, tags: [], level,
    questionType: type, content: `Nội dung ${id}`,
    answers: type === 'multiple_choice' ? ['A', 'B', 'C', 'D'].map((label, index) => ({
      answerId: `${id}-${label}`, optionLabel: label, content: `Phương án ${index}`,
      isCorrect: index === 1, displayOrder: index + 1,
    })) : [],
    statements: type === 'true_false' ? [{ statementId: `${id}-a`, content: 'a', isCorrect: true }] : undefined,
    acceptedResponses: type === 'short_answer' ? ['42'] : undefined,
  }
}
const build = (questionBank, options = {}) => buildBlueprintQuestions({
  blueprint, questionBank, seed: 123, ...options,
})

test('context-dependent question detection covers numbered and relative references', () => {
  for (const text of [
    'Với miền ở câu 29, GTLN của $F=x-y$ bằng', 'Sử dụng câu 29 để tính.',
    'Dùng dữ kiện ở câu trên.', 'Dựa vào câu trước.', 'Câu hỏi trên cho kết quả nào?',
    'Kết quả câu trước là gì?', 'Dữ kiện câu trên cho biết điều gì?',
    'THEO KET QUA CAU 29', 'DỮ KIỆN CỦA CÂU HỎI TRƯỚC',
    'Câu 30. Sử dụng kết quả câu 29.', 'Theo dữ kiện ở câu hỏi số 29.',
  ]) assert.equal(isContextDependentQuestion(text, 30), true, text)
})

test('standalone questions, TF labels and own question numbers are not dependencies', () => {
  for (const text of [
    '', 'Tìm GTLN của $F=x-y$.', 'Câu a) Hàm số đồng biến. Câu b) Giá trị bằng 2.',
    'Câu 29. Tính diện tích miền.', '**Câu 29:** Tính diện tích miền.',
    'Câu hỏi 29: Cho hình lập phương.', 'Ở câu lạc bộ có 29 học sinh.',
    'Có bao nhiêu câu trả lời đúng?', 'Trả lời câu hỏi sau: Tính 2+2.',
    'Trong câu 29 này, tìm GTLN.',
    'Lượng thực phẩm nhỏ nhất thỏa mãn yêu cầu trên là bao nhiêu?',
    'Nhu cầu trước đây là 29 sản phẩm.',
  ]) assert.equal(isContextDependentQuestion(text, 29), false, text)
  assert.equal(isContextDependentQuestion('Câu 29. Tính diện tích miền.'), false)
  assert.equal(isContextDependentQuestion('Câu 29\nTính diện tích miền.'), false)
  assert.equal(isContextDependentQuestion('Câu 29'), false)
  assert.equal(isContextDependentQuestion('Câu 29. Dùng kết quả câu 28.', 29), true)
})

test('balanced and random mock pools exclude dependent questions without mutating the source', () => {
  const standalone = question('standalone')
  const dependent = { ...question('dependent'), content: 'Với miền ở câu 29, GTLN của F bằng' }
  for (const mode of ['balanced', 'random']) {
    const result = build([standalone, dependent], { blueprint: singleSection(2), mode })
    assert.deepEqual(result.questions.map((q) => q.questionId), ['standalone'])
    assert.ok(result.warnings.length)
    assert.throws(() => build([dependent], { blueprint: singleSection(1), mode }))
  }
  assert.equal(dependent.content, 'Với miền ở câu 29, GTLN của F bằng')
})

test('small pool returns a partial exam and warnings without throwing', () => {
  const result = build([question('one')])
  assert.equal(result.questions.length, 1)
  assert.ok(result.warnings.some((w) => w.includes('rút gọn')))
  assert.equal(result.warnings.filter((w) => w.includes('rút gọn')).length, 3)
})

test('empty pool throws a clear error', () => {
  assert.throws(() => build([]), /Kho câu hỏi Toán hiện trống/)
})

test('missing level falls to lower levels descending before higher, with warnings', () => {
  const result = build([question('lower', 2), question('higher', 4), question('lowest', 1)], {
    blueprint: singleSection(1, 3),
  })
  assert.equal(result.questions[0].questionId, 'lower')
  assert.deepEqual(result.warnings, ['Phần thử: thiếu 1 câu mức 3, đã thay bằng mức 2.'])
})

test('missing level uses higher levels only when no lower question remains', () => {
  const result = build([question('higher', 2)], { blueprint: singleSection(1, 1) })
  assert.match(result.warnings[0], /thiếu 1 câu mức 1, đã thay bằng mức 2/)
})

const fullPool = blueprint.sections.flatMap((section) => [1, 2, 3, 4].flatMap((level) =>
  Array.from({ length: 12 }, (_, i) => question(`${section.id}-${level}-${i}`, level, section.questionType))))

test('balanced exam retains section order and exact level quotas when available', () => {
  const result = build(fullPool)
  assert.deepEqual(result.warnings, [])
  let start = 0
  for (const section of blueprint.sections) {
    const questions = result.questions.slice(start, start + section.count)
    assert.ok(questions.every((q) => q.questionType === section.questionType))
    for (const level of [1, 2, 3, 4]) {
      assert.equal(questions.filter((q) => q.level === level).length, section.levelCounts[level])
    }
    start += section.count
  }
  assert.equal(result.questions.length, 22)
})

test('seed reproduces full selection and option order without mutating pool', () => {
  const original = structuredClone(fullPool)
  assert.deepEqual(build(fullPool), build(fullPool))
  assert.notDeepEqual(build(fullPool), build(fullPool, { seed: 124 }))
  assert.deepEqual(fullPool, original)
})

test('duplicate content, reordered options, and repeated IDs do not repeat questions', () => {
  const first = question('first')
  const duplicate = { ...first, questionId: 'duplicate', content: `  ${first.content}  `,
    answers: [...first.answers].reverse() }
  const repeatedId = { ...question('other'), questionId: 'first' }
  const result = build([first, duplicate, repeatedId, question('unique')], { blueprint: singleSection(4) })
  assert.equal(result.questions.length, 2)
  assert.equal(new Set(result.questions.map((q) => q.questionId)).size, 2)
})

test('deduplication normalizes Unicode and whitespace, preserves first source and variants', () => {
  const rows = [question('one'), { ...question('two'), content: 'Nội dung one',
    answers: [...question('one').answers].reverse() }, question('three')]
  const result = deduplicateQuestions(rows, (q) => contentFingerprint(q.questionType, q.content, q.answers.map((a) => a.content)))
  assert.deepEqual(result.map((q) => q.questionId), ['one', 'three'])
})

test('different diagrams survive deduplication while the same diagram still dedupes', () => {
  const first = { ...question('image-one'), assetUrls: ['/exam-a/diagram.png'] }
  const second = { ...first, questionId: 'image-two', assetUrls: ['/exam-b/diagram.png'] }
  const copy = { ...first, questionId: 'image-copy', answers: [...first.answers].reverse() }
  const result = build([first, second, copy], { blueprint: singleSection(3) })
  assert.deepEqual(new Set(result.questions.map((q) => q.questionId)), new Set(['image-one', 'image-two']))
  const unknownImages = ['one', 'two'].map((questionId) => ({ ...first, questionId, assetUrls: [], hasImage: true }))
  assert.equal(build(unknownImages, { blueprint: singleSection(2) }).questions.length, 2)
  assert.equal(contentFingerprint('mc', 'x', ['A'], ['/a', '/b']), contentFingerprint('mc', 'x', ['A'], ['/b', '/a', '/a']))
})

test('option shuffle keeps IDs/correctness and presented labels consistent with grading and review', () => {
  const source = question('mc')
  const result = build([source], { blueprint: singleSection(1) })
  const q = result.questions[0]
  assert.deepEqual(q.answers.map((a) => a.optionLabel), ['A', 'B', 'C', 'D'])
  assert.notDeepEqual(q.answers.map((a) => a.answerId), source.answers.map((a) => a.answerId))
  for (const option of q.answers) {
    const old = source.answers.find((a) => a.answerId === option.answerId)
    assert.equal(option.isCorrect, old.isCorrect)
    assert.equal(option.metadata.originalLabel, old.optionLabel)
  }
  const correct = q.answers.find((a) => a.isCorrect)
  const session = { sessionId: 'session', durationMinutes: 50, questions: [q] }
  const runtime = createExamRuntimeSession(session)
  runtime.selectedAnswerIdsByQuestionId[q.questionId] = correct.answerId
  assert.equal(checkQuestion(runtime, q).isCorrect, true)
  const label = `${correct.optionLabel}. ${correct.content}`
  assert.equal(formatCorrectResponse(q), label)
  const review = buildSubmissionSummary(session, runtime)
  assert.equal(review.score, 10)
  assert.equal(review.reviewItems[0].selectedAnswerText, label)
  assert.equal(review.reviewItems[0].correctAnswerText, label)
  runtime.selectedAnswerIdsByQuestionId[q.questionId] = q.answers.find((a) => !a.isCorrect).answerId
  assert.equal(checkQuestion(runtime, q).isCorrect, false)
})

test('unseen questions take priority, with seen questions filling any remainder', () => {
  const pool = Array.from({ length: 10 }, (_, i) => question(String(i)))
  const seenQuestionIds = new Set(pool.slice(0, 9).map((q) => q.questionId))
  const options = { blueprint: singleSection(1), seenQuestionIds }
  assert.equal(build(pool, options).questions[0].questionId, '9')
  const result = build(pool, { ...options, blueprint: singleSection(3) })
  assert.equal(result.questions.length, 3)
  assert.ok(result.questions.some((q) => q.questionId === '9'))
  assert.deepEqual(result, build(pool, { ...options, blueprint: singleSection(3) }))
})

test('random mode ignores levels and spread but retains types, unseen preference and seed', () => {
  const pool = [question('seen', 4), question('unseen', 4), question('tf', 2, 'true_false')]
  const options = { blueprint: singleSection(1, 1), mode: 'random', seenQuestionIds: new Set(['seen']) }
  const result = build(pool, options)
  assert.equal(result.questions[0].questionId, 'unseen')
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result, build(pool, options))
})

test('TF statement order and short answer accepted responses remain intact', () => {
  const tf = question('tf', 2, 'true_false')
  tf.statements.push({ statementId: 'tf-b', content: 'b', isCorrect: false })
  const sa = question('sa', 1, 'short_answer')
  const result = build([tf, sa])
  assert.deepEqual(result.questions.find((q) => q.questionId === 'tf').statements, tf.statements)
  assert.deepEqual(result.questions.find((q) => q.questionId === 'sa').acceptedResponses, ['42'])
})

test('pagination reads all 1000-row pages and the final empty page', async () => {
  const calls = []
  const rows = Array.from({ length: 2000 }, (_, i) => i)
  const result = await fetchQuestionPages(async (start, end) => {
    calls.push([start, end])
    return { data: rows.slice(start, end + 1), error: null }
  })
  assert.deepEqual(result, rows)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
})

test('pagination handles empty pages and optional missing bank but surfaces real errors', async () => {
  assert.deepEqual(await fetchQuestionPages(async () => ({ data: [], error: null })), [])
  const missing = async () => ({ data: null, error: { code: 'PGRST205', message: 'missing table' } })
  assert.deepEqual(await fetchQuestionPages(missing, true), [])
  await assert.rejects(fetchQuestionPages(missing), /missing table/)
  await assert.rejects(fetchQuestionPages(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }), true), /permission denied/)
  await assert.rejects(fetchQuestionPages(async () => { throw new Error('network unavailable') }), /network unavailable/)
})
