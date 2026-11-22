#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const bucket = 'school-exams'
const prefixes = ['VAT_LY', 'HOA_HOC']
const digest = (data) => createHash('sha256').update(data).digest('hex')

function safeObjectPath(value) {
  if (typeof value !== 'string' || !prefixes.includes(value.split('/')[0]) ||
      value.includes('\\') || /[\x00-\x1f\x7f]/.test(value) ||
      value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe or non-math-cleanup object path in listing/manifest')
  }
  return value
}

async function localFile(root, objectPath, creating = false) {
  const filename = path.resolve(root, safeObjectPath(objectPath))
  if (creating) await mkdir(path.dirname(filename), { recursive: true })
  const resolved = await realpath(creating ? path.dirname(filename) : filename)
  if (!resolved.startsWith(root + path.sep)) throw new Error('Backup path escapes backup directory')
  return filename
}

export async function main(args = process.argv.slice(2), env = process.env) {
  let backupDir, restoreDir, execute = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') execute = true
    else if (args[i] === '--backup-dir' || args[i] === '--restore') {
      const option = args[i]
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('Missing directory argument')
      if (option === '--backup-dir') backupDir = value
      else restoreDir = value
    } else throw new Error('Unknown argument; use --backup-dir DIR, --execute, or --restore DIR')
  }
  if (restoreDir && (backupDir || execute)) throw new Error('--restore cannot be combined with backup/delete options')
  if (execute && !backupDir) throw new Error('--execute requires --backup-dir and a complete successful backup')
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  let base
  try {
    base = new URL(env.SUPABASE_URL)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
  } catch { throw new Error('Invalid SUPABASE_URL') }
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  async function request(endpoint, options = {}) {
    let response
    try {
      response = await fetch(`${base.href.replace(/\/$/, '')}/storage/v1/${endpoint}`, {
        ...options, redirect: 'error', headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60_000),
      })
    } catch { throw new Error('Storage request failed (network, redirect, or timeout)') }
    if (!response.ok) throw new Error(`Storage request failed (HTTP ${response.status})`)
    return response
  }
  const encoded = (objectPath) => objectPath.split('/').map(encodeURIComponent).join('/')
  if (restoreDir) {
    const root = await realpath(restoreDir)
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
    if (manifest.version !== 1 || manifest.bucket !== bucket || !Array.isArray(manifest.objects)) throw new Error('Invalid backup manifest')
    const seen = new Set()
    for (const object of manifest.objects) {
      safeObjectPath(object.path)
      if (seen.has(object.path)) throw new Error('Duplicate manifest object')
      seen.add(object.path)
      const data = await readFile(await localFile(root, object.path))
      if (data.length !== object.size || digest(data) !== object.sha256) throw new Error('Backup checksum/size mismatch; nothing restored')
    }
    for (const object of manifest.objects) {
      const data = await readFile(await localFile(root, object.path))
      if (digest(data) !== object.sha256) throw new Error('Backup changed during restore')
      await request(`object/${bucket}/${encoded(object.path)}`, {
        method: 'POST', headers: { 'Content-Type': object.contentType || 'application/octet-stream', 'x-upsert': 'true' }, body: data,
      })
    }
    console.log(`Restored ${manifest.objects.length} objects from verified backup`)
    return
  }

  const objects = []
  const seen = new Set()
  async function list(prefix) {
    for (let offset = 0; ; offset += 1000) {
      const response = await request(`object/list/${bucket}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      })
      let entries
      try { entries = await response.json() } catch { throw new Error('Invalid Storage list response') }
      if (!Array.isArray(entries)) throw new Error('Invalid Storage list response')
      for (const entry of entries) {
        const objectPath = safeObjectPath(`${prefix}/${entry.name}`)
        if (seen.has(objectPath)) throw new Error('Duplicate listing path; stop writes and retry')
        seen.add(objectPath)
        if (entry.id == null && entry.metadata == null) await list(objectPath)
        else {
          const size = entry.metadata?.size
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('Storage object has invalid/missing size')
          objects.push({ path: objectPath, size, contentType: entry.metadata?.mimetype || 'application/octet-stream' })
        }
      }
      if (entries.length < 1000) break
    }
  }
  for (const prefix of prefixes) await list(prefix)
  objects.sort((a, b) => a.path.localeCompare(b.path))
  console.log(`Objects: ${objects.length}`)
  console.log(`Total bytes: ${objects.reduce((sum, object) => sum + object.size, 0)}`)
  for (const object of objects) console.log(object.path)
  if (!backupDir) { console.log('Dry run: no files downloaded or deleted'); return }

  await mkdir(backupDir, { recursive: true })
  const root = await realpath(backupDir)
  for (const object of objects) {
    const response = await request(`object/${bucket}/${encoded(object.path)}`, { headers: { 'Accept-Encoding': 'identity' } })
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length !== object.size) throw new Error('Downloaded size mismatch; no objects deleted')
    await writeFile(await localFile(root, object.path, true), data, { flag: 'wx', mode: 0o600 })
    object.sha256 = digest(data)
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, bucket, objects }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(`Backed up ${objects.length} objects; manifest.json written`)
  if (!execute) { console.log('Backup only: no objects deleted'); return }
  for (const object of objects) {
    const data = await readFile(await localFile(root, object.path))
    if (digest(data) !== object.sha256) throw new Error('Backup changed; no objects deleted')
  }
  for (let offset = 0; offset < objects.length; offset += 100) {
    await request(`object/${bucket}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: objects.slice(offset, offset + 100).map((object) => object.path) }),
    })
  }
  console.log(`Deleted ${objects.length} objects; keep backup for --restore`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Filesystem errors can contain user-provided paths, but never print credentials.
    const message = String(error.message).replaceAll(process.env.SUPABASE_SERVICE_ROLE_KEY || '\0', '[REDACTED]')
      .replaceAll(process.env.SUPABASE_URL || '\0', '[REDACTED]')
    console.error(`ERROR: ${message}`)
    process.exitCode = 1
  })
}
