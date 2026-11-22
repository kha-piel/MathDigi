import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/cleanup-non-math-storage.mjs', import.meta.url))
const original = new Map([
  ['VAT_LY/2026/nested/figure.png', Buffer.from('physics')],
  ['HOA_HOC/2026/source.pdf', Buffer.from('chemistry')],
  ['TOAN/2026/source.pdf', Buffer.from('math')],
])
let objects = new Map(original), deleted = 0, uploads = 0, failDownload = false, failList = false, unsafe = false
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.apikey, 'mock-secret-never-print')
    assert.equal(req.headers.authorization, 'Bearer mock-secret-never-print')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const base = '/storage/v1/object/'
    res.setHeader('Content-Type','application/json')
    if (req.url === `${base}list/school-exams`) {
      if (failList) { res.writeHead(503); res.end('{}'); return }
      const {prefix,limit,offset} = JSON.parse(body)
      assert.ok(prefix.startsWith('VAT_LY') || prefix.startsWith('HOA_HOC'))
      if (unsafe) { res.end(JSON.stringify([{name:'../escape', id:'bad', metadata:{size:1}}])); return }
      const entries = new Map()
      for (const [name,data] of objects) {
        if (!name.startsWith(prefix + '/')) continue
        const remainder = name.slice(prefix.length + 1)
        const part = remainder.split('/')[0]
        entries.set(part, remainder.includes('/') ? {name:part,id:null,metadata:null}
          : {name:part,id:name,metadata:{size:data.length,mimetype:name.endsWith('.pdf')?'application/pdf':'image/png'}})
      }
      res.end(JSON.stringify([...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(offset,offset+limit)))
    } else if (req.method === 'DELETE' && req.url === `${base}school-exams`) {
      for (const name of JSON.parse(body).prefixes) {
        assert.ok(!name.startsWith('TOAN/'))
        objects.delete(name); deleted++
      }
      res.end('[]')
    } else {
      assert.ok(req.url.startsWith(`${base}school-exams/`))
      const name = req.url.slice(`${base}school-exams/`.length).split('/').map(decodeURIComponent).join('/')
      assert.ok(!name.startsWith('TOAN/'))
      if (req.method === 'GET') {
        if (failDownload) { res.writeHead(500); res.end('{}'); return }
        assert.ok(objects.has(name))
        res.end(objects.get(name))
      } else {
        assert.equal(req.method,'POST'); assert.equal(req.headers['x-upsert'],'true')
        objects.set(name,body); uploads++; res.end('{}')
      }
    }
  } catch (error) { res.writeHead(500); res.end('{}'); console.error(error); }
})
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve))
const url = `http://127.0.0.1:${server.address().port}`
const work = await mkdtemp(path.join(tmpdir(),'mathdigi-storage-'))
async function run(args, success = true) {
  const result = await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{env:{...process.env,SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'mock-secret-never-print'}})
    let output=''
    child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data)
    child.on('error',reject); child.on('close',code=>resolve({code,output}))
  })
  assert.equal(result.code===0,success,result.output)
  assert.ok(!result.output.includes('mock-secret-never-print'))
  assert.ok(!result.output.includes(url))
  return result.output
}
try {
  let output=await run([])
  assert.match(output,/Objects: 2/); assert.match(output,/Total bytes: 16/); assert.equal(deleted,0)
  console.log('PASS: recursive dry run lists only non-math paths and total bytes; no secrets')
  await run(['--execute'],false); assert.equal(deleted,0)
  console.log('PASS: execute requires backup directory')
  failList=true; await run([],false); failList=false
  unsafe=true; await run([],false); unsafe=false
  console.log('PASS: HTTP list failures and unsafe paths fail closed')
  failDownload=true; await run(['--backup-dir',path.join(work,'failed'),'--execute'],false); failDownload=false
  assert.equal(deleted,0)
  console.log('PASS: failed backup prevents all deletions')
  output=await run(['--backup-dir',path.join(work,'backup-only')])
  assert.match(output,/Backup only: no objects deleted/); assert.equal(deleted,0)
  console.log('PASS: backup-only mode downloads without deleting')
  const backup=path.join(work,'backup')
  output=await run(['--backup-dir',backup,'--execute'])
  assert.match(output,/Deleted 2 objects/); assert.equal(objects.size,1); assert.ok(objects.has('TOAN/2026/source.pdf'))
  const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'))
  assert.equal(manifest.objects.length,2)
  for (const item of manifest.objects) assert.deepEqual(await readFile(path.join(backup,item.path)),original.get(item.path))
  console.log('PASS: execute backs up every object and manifest before deleting; TOAN untouched')
  await run(['--restore',backup]); assert.deepEqual(objects,original); assert.equal(uploads,2)
  console.log('PASS: restore reuploads exact bytes from verified manifest')
  const first=manifest.objects[0]
  await writeFile(path.join(backup,first.path),'corrupt')
  await run(['--restore',backup],false); assert.equal(uploads,2)
  console.log('PASS: corrupt backup rejected before any restore upload')
  objects=new Map([['TOAN/2026/source.pdf',Buffer.from('math')]])
  output=await run([]); assert.match(output,/Objects: 0/)
  console.log('PASS: empty non-math prefixes handled')
  objects=new Map(Array.from({length:1001},(_,i)=>[`VAT_LY/file-${String(i).padStart(4,'0')}`,Buffer.from('x')]))
  output=await run([]); assert.match(output,/Objects: 1001/); assert.match(output,/Total bytes: 1001/)
  console.log('PASS: listing paginates beyond 1000 objects')
  console.log('PASS: all Storage cleanup assertions (local HTTP mock only)')
} finally {
  await new Promise(resolve=>server.close(resolve))
  await rm(work,{recursive:true,force:true})
}
