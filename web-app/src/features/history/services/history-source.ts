export async function settleHistorySource<T>(source: Promise<T>, fallback: T, label: string) {
  try {
    return { data: await source, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { data: fallback, error: `${label}: ${message}` }
  }
}

export function excludeLocallyReviewedAttempts<T extends { attemptId: string }>(
  cloudAttempts: T[],
  localAttempts: { persistedAttemptId?: string | null }[],
) {
  const localIds = new Set(localAttempts.map((attempt) => attempt.persistedAttemptId).filter(Boolean))
  return cloudAttempts.filter((attempt) => !localIds.has(attempt.attemptId))
}
