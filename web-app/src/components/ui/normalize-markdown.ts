function fractionEnd(content: string, start: number) {
  const command = /^\\(?:frac|dfrac|tfrac)\b/.exec(content.slice(start))
  if (!command) return null
  let cursor = start + command[0].length
  for (let argument = 0; argument < 2; argument += 1) {
    while (/\s/.test(content[cursor] ?? '') && cursor < content.length) cursor += 1
    if (content[cursor] !== '{') return null
    let depth = 0
    do {
      if (content[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (content[cursor] === '{') depth += 1
      if (content[cursor] === '}') depth -= 1
      cursor += 1
    } while (depth > 0 && cursor < content.length)
    if (depth !== 0) return null
  }
  return cursor
}

export function normalizeMarkdown(content: string) {
  const normalized = content
    .replace(/\\\$/g, '$')
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression: string) => `$${expression}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => `$$${expression}$$`)
    .trim()

  return normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+|\$\$[\s\S]*?\$\$|\$[^$]*\$)/g)
    .map((part, index) => {
      if (index % 2) return part
      let result = ''
      for (let cursor = 0; cursor < part.length;) {
        const end = part[cursor] === '\\' ? fractionEnd(part, cursor) : null
        if (end !== null) {
          result += `$${part.slice(cursor, end)}$`
          cursor = end
        } else {
          result += part[cursor]
          cursor += 1
        }
      }
      return result
    }).join('')
}
