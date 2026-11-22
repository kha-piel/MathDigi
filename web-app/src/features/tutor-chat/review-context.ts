export function resolveTutorReviewItem<T extends { questionNumber: number }>(
  items: T[],
  selectedNumber: number | null,
  previousNumber: number | null,
) {
  const questionNumber = selectedNumber ?? previousNumber
  return questionNumber === null ? items[0] : items.find((item) => item.questionNumber === questionNumber)
}
