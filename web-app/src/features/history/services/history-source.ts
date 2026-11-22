export async function settleHistorySource<T>(source: Promise<T>, fallback: T, label: string) {
  try {
    return { data: await source, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { data: fallback, error: `${label}: ${message}` }
  }
}
