import { expect, it } from 'vitest'
import { resolveTutorReviewItem } from './review-context'

it('uses the first question only before a review selection exists', () => {
  const items = [{ questionNumber: 1 }, { questionNumber: 2 }]
  expect(resolveTutorReviewItem(items, null, null)).toBe(items[0])
  expect(resolveTutorReviewItem(items, 2, null)).toBe(items[1])
  expect(resolveTutorReviewItem(items, null, 2)).toBe(items[1])
})

it('handles missing questions without switching to the first question', () => {
  expect(resolveTutorReviewItem([], null, null)).toBeUndefined()
  expect(resolveTutorReviewItem([{ questionNumber: 1 }], null, 2)).toBeUndefined()
})
