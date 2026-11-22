export function tutorQuestionOptions(question: {
  answers: { content: string }[]
  statements?: { content: string }[]
}) {
  return [
    ...question.answers.map((answer) => answer.content),
    ...(question.statements ?? []).map((statement, index) => `${String.fromCharCode(97 + index)}) ${statement.content}`),
  ]
}
