type PageResult<T> = {
  data: T[] | null
  error: { message: string; code?: string } | null
}

export async function fetchQuestionPages<T>(
  readPage: (start: number, end: number) => PromiseLike<PageResult<T>>,
  optional = false,
): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await readPage(start, start + 999)
    if (error) {
      if (optional && (error.code === 'PGRST205' || error.code === 'PGRST200' ||
        error.code === '42P01' || /schema cache|could not find the table/i.test(error.message))) return []
      throw new Error(error.message)
    }
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}
