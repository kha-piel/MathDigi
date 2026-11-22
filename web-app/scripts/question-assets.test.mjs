import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildQuestionAssetUrls } from '../src/features/practice/utils/question-assets.ts'

test('bank figures retain absolute, root-relative and relative paths without a PDF', () => {
  for (const path of ['https://cdn.example/diagram.png', '/bank/diagram.png', 'bank/diagram.png']) {
    assert.deepEqual(buildQuestionAssetUrls({ assetPaths: [], assets: [{ assetType: 'figure', assetPath: path, displayOrder: 1 }] }), [path])
  }
})

test('school figures use the PDF directory, preserve URLs and order, and omit question blocks', () => {
  const assets = [
    { assetType: 'figure', assetPath: 'second.png', displayOrder: 2 },
    { assetType: 'question_block', assetPath: 'block.png', displayOrder: 0 },
    { assetType: 'figure', assetPath: '/bank/first.png', displayOrder: 1 },
  ]
  assert.deepEqual(buildQuestionAssetUrls({ pdfUrl: '/papers/exam.pdf', assets, assetPaths: [] }), ['/bank/first.png', '/school-exam-assets/exam/second.png'])
  assert.equal(assets[0].assetPath, 'second.png')
  assert.deepEqual(buildQuestionAssetUrls({ assetPaths: [] }), [])
  assert.deepEqual(buildQuestionAssetUrls({ assetPaths: ['block.png', '/bank/q_hinh1.png'] }), ['/bank/q_hinh1.png'])
})
