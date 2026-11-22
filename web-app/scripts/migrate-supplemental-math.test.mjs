import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditSupplementalMath, loadSupplementalMath, makeImportSql } from './migrate-supplemental-math.mjs'

test('includes served and raw math data without the physics bank', async () => {
  const report = auditSupplementalMath(await loadSupplementalMath())
  assert.equal(report.total, 510)
  assert.equal(report.served, 414)
  assert.equal(report.pending, 96)
  assert.equal(report.sources.length, 17)
  assert.equal(Object.keys(report.topics).length, 15)
  assert.ok(!report.sources.includes('supplemental-physics-topic-questions.ts'))
  assert.deepEqual(report.exactDuplicateGroups, [])
  assert.equal(report.sameStemDifferentOptions.length, 1)
})

test('recognizes reordered choices and flags conflicting answer contents', () => {
  const source = {
    questionId: 'first',
    questionType: 'multiple_choice',
    questionText: 'Tính  $x$.',
    topic: 'Đại số',
    options: [
      { optionLabel: 'A', optionText: 'Một' },
      { optionLabel: 'B', optionText: 'Hai' },
    ],
    answerValue: 'A',
  }
  const reordered = {
    ...source,
    questionId: 'second',
    questionText: 'Tính $x$.'.normalize('NFD'),
    options: [
      { optionLabel: 'A', optionText: 'Hai' },
      { optionLabel: 'B', optionText: 'Một' },
    ],
    answerValue: 'B',
  }
  const variant = {
    ...source,
    questionId: 'third',
    options: [{ optionLabel: 'A', optionText: 'Ba' }, source.options[1]],
  }
  const asRows = (questions) => questions.map((question) => ({ question, file: 'test.ts', wasServed: false }))
  const report = auditSupplementalMath(asRows([source, reordered, variant]))
  assert.deepEqual(report.exactDuplicateGroups, [{ ids: ['first', 'second'], conflictingAnswers: false }])
  assert.deepEqual(report.sameStemDifferentOptions, [['first', 'second', 'third']])
  const conflict = auditSupplementalMath(asRows([source, { ...reordered, answerValue: 'A' }]))
  assert.deepEqual(conflict.exactDuplicateGroups, [{ ids: ['first', 'second'], conflictingAnswers: true }])
  assert.throws(() => makeImportSql(asRows([source, reordered])), /Resolve duplicate source questions/u)
})

test('SQL keeps each legacy question and option, and separates live and raw content', async () => {
  const rows = await loadSupplementalMath()
  const sql = makeImportSql(rows)
  const [, body] = sql.match(/jsonb_to_recordset\(\$supplemental\$(.+)\$supplemental\$::jsonb\)/u)
  const payload = JSON.parse(body)
  assert.equal(payload.length, rows.length)
  for (const [index, item] of payload.entries()) {
    const { question, wasServed } = rows[index]
    assert.equal(item.question_id, question.questionId)
    assert.equal(item.question_text, question.questionText)
    assert.equal(item.correct_answer, question.answerValue)
    assert.equal(item.difficulty_level, question.difficultyLevel)
    assert.equal(item.review_status, wasServed ? 'approved' : 'pending_review')
    assert.deepEqual(item.options, question.options.map((option) => ({
      option_label: option.optionLabel,
      option_text: option.optionText,
      display_order: option.displayOrder,
    })))
  }
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\n$/u)
})

test('chooses a different SQL delimiter if one occurs in the legacy text', async () => {
  const [row] = await loadSupplementalMath()
  const changed = { ...row, question: { ...row.question, questionText: "Tính $supplemental$: x'." } }
  const sql = makeImportSql([changed])
  const [, body] = sql.match(/jsonb_to_recordset\(\$supplemental_\$(.+)\$supplemental_\$::jsonb\)/u)
  assert.equal(JSON.parse(body)[0].question_text, changed.question.questionText)
})
