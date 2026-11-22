import { expect, it } from 'vitest'
import { tutorQuestionOptions } from './question-context'

it('includes labeled true-false claims alongside answer choices', () => {
  expect(tutorQuestionOptions({ answers: [{ content: 'Một lựa chọn' }], statements: [{ content: '$x > 0$' }, { content: '$x < 1$' }] })).toEqual(['Một lựa chọn', 'a) $x > 0$', 'b) $x < 1$'])
})

it('handles questions without choices or statements', () => {
  expect(tutorQuestionOptions({ answers: [] })).toEqual([])
  expect(tutorQuestionOptions({ answers: [{ content: 'A' }], statements: [] })).toEqual(['A'])
})
