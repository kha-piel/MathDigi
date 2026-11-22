import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { normalizeMarkdown } from '../src/components/ui/normalize-markdown.ts'

const componentUrl = new URL('../src/components/ui/MarkdownContent.tsx', import.meta.url)
const require = createRequire(import.meta.url)
const { outputText } = ts.transpileModule(await readFile(componentUrl, 'utf8'), {
  fileName: fileURLToPath(componentUrl),
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
})
const resolvedSource = outputText.replace(/from ["']([^"']+)["']/g, (_match, specifier) => {
  const url = specifier.startsWith('.')
    ? new URL(`${specifier}.ts`, componentUrl)
    : pathToFileURL(require.resolve(specifier))
  return `from ${JSON.stringify(url.href)}`
})
const { MarkdownContent } = await import(`data:text/javascript;base64,${Buffer.from(resolvedSource).toString('base64')}`)

test('MarkdownContent renders geometry and all supported math delimiters with KaTeX', () => {
  for (const content of ["$ABCD.A'B'C'D'$", String.raw`$\frac{3}{2}$`, String.raw`\(\frac{3}{2}\)`, String.raw`\[\frac{3}{2}\]`, String.raw`\$\frac{3}{2}\$`]) {
    const html = renderToStaticMarkup(createElement(MarkdownContent, { content }))
    assert.match(html, /class="katex"/)
    assert.doesNotMatch(html, /katex-error/)
  }
})

test('bare fractions render in question, choice, answer and explanation prose', () => {
  for (const content of [String.raw`\frac{3}{2}`, String.raw`A. \dfrac{3}{2}`, String.raw`Kết quả là \tfrac{3}{2}.`, String.raw`\frac{1+\frac{3}{2}}{\sqrt{2}}`]) {
    const html = renderToStaticMarkup(createElement(MarkdownContent, { content }))
    assert.match(html, /class="katex"/)
    assert.match(html, /class="mfrac"/)
    assert.doesNotMatch(html, /katex-error/)
  }
})

test('normalization preserves existing math and code, including bare fractions in code', () => {
  for (const content of [String.raw`$\frac{3}{2}$`, String.raw`$$\frac{3}{2}$$`, '`\\frac{3}{2}`', '```latex\n\\frac{3}{2}\n```', '~~~latex\n\\frac{3}{2}\n~~~']) {
    assert.equal(normalizeMarkdown(content), content)
  }
  assert.equal(normalizeMarkdown(String.raw`Tỉ số \frac{3}{2} và $x$.`), String.raw`Tỉ số $\frac{3}{2}$ và $x$.`)
})

test('empty, plain and malformed content remains safe and readable', () => {
  for (const content of ['', 'Chưa chọn đáp án', String.raw`\frac{3}`, String.raw`\frac{3}{2`]) {
    assert.equal(normalizeMarkdown(content), content)
    const html = renderToStaticMarkup(createElement(MarkdownContent, { content }))
    assert.doesNotMatch(html, /class="katex"|katex-error/)
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(MarkdownContent, { content: '<script>alert(1)</script>' })), /<script>/)
})
