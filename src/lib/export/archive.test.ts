/**
 * 익스포트 끝에서 끝까지 — 스냅샷 → ZIP 바이트 → 우리가 짜지 않은 구현으로 풀기 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **풀면 링크가 열린다** — 모든 `.md` 의 상대 링크 · 이미지가 ZIP 안의 실제 항목을 가리킨다
 *      (못 읽은 첨부 하나만 예외이고, 그것은 보고서가 센다)
 *   ② **bsdtar 로 풀린다** — 이모지 · 겹치는 제목 · `#` · 괄호가 든 제목으로 만든 이름이 디스크에 생긴다
 *   ③ **보고서가 마지막에 흘려보낸 것까지 센다** — 못 읽은 첨부
 *   ④ **크기 추정이 실제 ZIP 보다 작지 않다 · 한계에서는 잘라 쓰지 않고 멈춘다**
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { findBsdtar, findPython, run, runPythonJson, unavailable } from '../testing/external-tools.ts'
import { streamExportZip } from './archive.ts'
import {
  REPORT_PATH,
  estimateExport,
  planExport,
  type ExportDatabaseNode,
  type ExportFile,
  type ExportNode,
  type ExportPageNode,
  type ExportSnapshot,
} from './plan.ts'
import { ZipError } from './zip.ts'

// ── 스냅샷 하나 — 이름과 링크를 괴롭히는 것들을 모았다 ──────────────

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)] })
const ref = (node: { readonly id: string }): EditorBlock => ({ id: node.id, type: 'page', title: [] })
const fileImage = (fileId: string): EditorBlock => ({
  id: randomUUID(),
  type: 'image',
  title: [],
  properties: { source: { type: 'file', file_id: fileId } },
})

function pageNode(title: string, blocks: EditorBlock[] = [], childIds: string[] = [], extra: Partial<ExportPageNode> = {}): ExportPageNode {
  return { kind: 'page', id: randomUUID(), title: [textRun(title)], doc: { blocks }, childIds, ...extra }
}

const photo: ExportFile = { id: randomUUID(), mime: 'image/png', originalName: '사진 (1).png', sizeBytes: 2048 }
const lost: ExportFile = { id: randomUUID(), mime: 'image/jpeg', originalName: '사라진.jpg', sizeBytes: 999 }
const photoBytes = randomBytes(photo.sizeBytes)

const twinA = pageNode('하위 (1)', [para('쌍둥이 A')])
const twinB = pageNode('하위 (1)', [para('쌍둥이 B')])
const deep = pageNode('깊은 #곳', [para('바닥')])
const middle = pageNode('🧭 중간', [ref(deep)], [deep.id])
const root = pageNode(
  '📝 회의록',
  [para('본문'), fileImage(photo.id), fileImage(lost.id), ref(twinA), ref(twinB), ref(middle), { id: randomUUID(), type: 'page', title: [] }],
  [twinA.id, twinB.id, middle.id],
)
const rowPage = pageNode('🎯 목표', [para('행 본문'), fileImage(photo.id)], [], {
  cells: { t: { type: 'title', title: [textRun('🎯 목표')] }, n: { type: 'number', number: 3 } },
})
const database: ExportDatabaseNode = {
  kind: 'database',
  id: randomUUID(),
  name: '할 일 #1',
  columns: [
    { propertyId: 'n', name: '수량', type: 'number' },
    { propertyId: 't', name: '이름', type: 'title' },
  ],
  rowIds: [rowPage.id],
}

const nodes: ExportNode[] = [root, twinA, twinB, middle, deep, database, rowPage]
const snapshot: ExportSnapshot = {
  scope: { kind: 'workspace' },
  exportedAt: new Date('2026-09-13T12:00:00Z'),
  rootIds: [root.id, database.id],
  nodes: new Map(nodes.map((node) => [node.id, node])),
  files: new Map([photo, lost].map((file) => [file.id, file])),
  excluded: { no_access: 1 },
}

const plan = planExport(snapshot, { untitled: '제목 없음' })
const readAttachment = async (fileId: string): Promise<Uint8Array | null> => (fileId === photo.id ? photoBytes : null)

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

type Unzipped = { bad: string | null; names: string[]; texts: Record<string, string> }

// ── 검사 ──────────────────────────────────────────────────────────────

describe('익스포트 끝에서 끝까지', () => {
  let dir = ''
  let zipFile = ''
  let bytes = Buffer.alloc(0)

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'export-e2e-'))
    zipFile = join(dir, 'export.zip')
    bytes = await collect(streamExportZip(plan, readAttachment))
    writeFileSync(zipFile, bytes)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  const missingPaths = plan.entries.filter((e) => e.kind === 'file' && e.fileId === lost.id).map((e) => e.path)

  test('★ ① · ③ python 으로 풀면 항목이 계획대로 있고, 모든 상대 링크가 그 안의 항목을 가리킨다', (t) => {
    const python = findPython()
    if (python === null) return t.skip(unavailable('python'))

    const unzipped = runPythonJson(
      python,
      [
        'import sys, json, zipfile',
        'z = zipfile.ZipFile(sys.argv[1])',
        'names = [i.filename for i in z.infolist()]',
        "texts = {n: z.read(n).decode('utf-8') for n in names if n.endswith(('.md', '.csv', '.json'))}",
        'print(json.dumps({"bad": z.testzip(), "names": names, "texts": texts}))',
      ].join('\n'),
      [zipFile],
    ) as Unzipped

    assert.equal(unzipped.bad, null)
    assert.equal(missingPaths.length, 1, '못 읽는 첨부는 한 곳에서만 쓴다')
    assert.deepEqual(unzipped.names, [...plan.entries.map((e) => e.path).filter((p) => !missingPaths.includes(p)), REPORT_PATH])

    // 링크 검사 — 렌더러가 읽은 href · src 를 **렌더러처럼** 풀어 ZIP 안의 경로로 되돌린다.
    const names = new Set(unzipped.names)
    let checked = 0
    const dangling: string[] = []
    for (const [path, markdown] of Object.entries(unzipped.texts)) {
      if (!path.endsWith('.md')) continue
      const html = micromark(markdown, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] })
      for (const [, raw] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue
        // `#` · `?` 뒤는 경로가 아니다(조각 · 질의). 파일 이름의 `#` 을 인코딩하지 않았다면 여기서
        // 경로가 잘려 열리지 않는 링크로 잡힌다 — 전체를 디코드하면 그 실수를 못 본다.
        const pathPart = raw.split(/[?#]/)[0]
        const target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(pathPart)))
        checked += 1
        if (!names.has(target)) dangling.push(`${path} → ${target}`)
      }
    }
    assert.ok(checked >= 6, `검사한 링크가 너무 적다: ${checked}`)
    assert.deepEqual(dangling, missingPaths.map((p) => `${p.split('/')[0]}.md → ${p}`), '열리지 않는 링크는 못 읽은 첨부 하나뿐이다')

    const report = JSON.parse(unzipped.texts[REPORT_PATH]) as { missing_attachments: number; notes: string[]; counts: Record<string, number> }
    assert.equal(report.missing_attachments, 1)
    assert.ok(report.notes.some((n) => n.includes('첨부 파일 1개')), report.notes.join('\n'))
    assert.deepEqual(report.counts, { pages: 5, databases: 1, rows: 1, attachments: 3 })
  })

  test('★ ② bsdtar 로 풀면 모든 이름이 디스크에 생긴다 — 이모지 제목도', (t) => {
    const bsdtar = findBsdtar()
    if (bsdtar === null) return t.skip(unavailable('bsdtar'))
    const out = join(dir, 'bsdtar')
    mkdirSync(out)
    const result = run(bsdtar, ['-xf', zipFile, '-C', out])
    assert.equal(result.status, 0, result.stderr)
    for (const entry of plan.entries) {
      if (missingPaths.includes(entry.path)) continue
      const onDisk = readFileSync(join(out, ...entry.path.split('/')))
      const expected = entry.kind === 'text' ? Buffer.from(entry.text, 'utf8') : photoBytes
      assert.ok(onDisk.equals(expected), entry.path)
    }
  })

  test('④ 크기 추정은 실제 ZIP 보다 작지 않다', () => {
    const estimate = estimateExport(plan)
    assert.ok(estimate.bytes >= bytes.length, `${estimate.bytes} < ${bytes.length}`)
    assert.equal(estimate.fits, true)
  })

  // 항목이 적으면 보고서 몫(64KB)이 헤더를 가려서 "헤더를 세지 않는" 추정도 통과한다.
  // 헤더가 보고서 몫을 넘도록 항목을 늘린다(3,000 × 헤더 약 110바이트 ≈ 330KB).
  test('④ 항목이 많아도 추정이 실제보다 작지 않다 — 헤더를 센다', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => pageNode(`페이지 ${i}`))
    const big = planExport(
      { ...snapshot, rootIds: many.map((n) => n.id), nodes: new Map(many.map((n) => [n.id, n])), files: new Map(), excluded: {} },
      { untitled: '제목 없음' },
    )
    const zipped = await collect(streamExportZip(big, readAttachment))
    const estimate = estimateExport(big)
    assert.ok(estimate.bytes >= zipped.length, `${estimate.bytes} < ${zipped.length}`)
  })

  test('같은 계획이면 같은 바이트다', async () => {
    assert.ok((await collect(streamExportZip(plan, readAttachment))).equals(bytes))
  })

  test('④ 상한을 넘으면 잘라 쓰지 않고 던진다', async () => {
    await assert.rejects(
      collect(streamExportZip(plan, readAttachment, { maxBytes: 2048 })),
      (e: unknown) => e instanceof ZipError && e.code === 'too_large',
    )
  })
})
