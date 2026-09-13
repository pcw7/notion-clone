/**
 * 익스포트 조립 — F-09-14 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **배치가 노션과 같다** — `페이지.md` 옆에 같은 이름의 폴더, `DB.csv` 옆에 행 폴더
 *   ② **본문의 참조가 ZIP 안의 파일을 가리킨다** — 하위 페이지 · 첨부의 상대 링크가 실제 경로와 같다
 *   ③ **빠진 것은 센다** — 권한으로 빠진 참조 · 없는 파일 · 바뀐 파일 이름 · CSV 수식 막기
 *   ④ **스냅샷이 틀리면 조용히 넘기지 않는다** — 없는 노드 · 두 번 나오는 노드
 *
 * 링크가 ZIP 을 푼 뒤 실제로 열리는지는 `archive.test.ts` 가 python · bsdtar 로 끝까지 본다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { CsvColumn } from './csv.ts'
import {
  REPORT_PATH,
  estimateExport,
  planExport,
  reportNotes,
  serializeReport,
  type ExportDatabaseNode,
  type ExportFile,
  type ExportNode,
  type ExportPageNode,
  type ExportPlan,
  type ExportSnapshot,
} from './plan.ts'

const UNTITLED = '제목 없음'

function pageNode(
  title: string,
  blocks: EditorBlock[] = [],
  childIds: string[] = [],
  extra: Partial<ExportPageNode> = {},
): ExportPageNode {
  return {
    kind: 'page',
    id: randomUUID(),
    title: title === '' ? [] : [textRun(title)],
    doc: { blocks },
    childIds,
    ...extra,
  }
}

const ref = (node: { readonly id: string }): EditorBlock => ({ id: node.id, type: 'page', title: [] })
const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)] })
const fileImage = (fileId: string): EditorBlock => ({
  id: randomUUID(),
  type: 'image',
  title: [],
  properties: { source: { type: 'file', file_id: fileId } },
})

function snapshot(rootIds: string[], nodes: ExportNode[], files: ExportFile[] = [], extra: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    scope: { kind: 'workspace' },
    exportedAt: new Date('2026-09-13T12:00:00Z'),
    rootIds,
    nodes: new Map(nodes.map((node) => [node.id, node])),
    files: new Map(files.map((file) => [file.id, file])),
    ...extra,
  }
}

const plan = (s: ExportSnapshot): ExportPlan => planExport(s, { untitled: UNTITLED })
const paths = (p: ExportPlan): string[] => p.entries.map((entry) => entry.path)
const hex8 = (id: string): string => id.replace(/-/g, '').slice(0, 8)

function textAt(p: ExportPlan, path: string): string {
  const entry = p.entries.find((e) => e.path === path)
  assert.ok(entry !== undefined && entry.kind === 'text', `텍스트 항목이 없다: ${path}\n${paths(p).join('\n')}`)
  return entry.text
}

// ── ① · ② 배치와 링크 ────────────────────────────────────────────────

describe('① · ② 배치와 링크', () => {
  test('페이지 옆에 같은 이름의 폴더 — 토글 안에 둔 하위 페이지도 링크가 그 파일을 가리킨다', () => {
    const grandchild = pageNode('손자')
    const child = pageNode('하위 #1', [ref(grandchild)], [grandchild.id])
    const toggle: EditorBlock = { id: randomUUID(), type: 'toggle', title: [textRun('접힘')], children: [ref(child)] }
    const root = pageNode('루트 페이지', [para('앞'), toggle], [child.id])

    const p = plan(snapshot([root.id], [root, child, grandchild]))
    assert.deepEqual(paths(p), ['루트 페이지.md', '루트 페이지/하위 #1.md', '루트 페이지/하위 #1/손자.md'])
    // 공백은 직렬화기가, `#` 은 경로 조각 인코딩이 맡는다.
    assert.ok(textAt(p, '루트 페이지.md').includes('[하위 #1](루트%20페이지/하위%20%231.md)'), textAt(p, '루트 페이지.md'))
    assert.ok(textAt(p, '루트 페이지/하위 #1.md').includes('[손자](하위%20%231/손자.md)'))
  })

  test('★ 이모지 제목 — 파일 이름에서만 빠지고 문서 첫 줄에는 남는다 · 바뀐 이름을 센다', () => {
    const root = pageNode('📝 회의록')
    const p = plan(snapshot([root.id], [root]))
    assert.deepEqual(paths(p), ['회의록.md'])
    assert.ok(textAt(p, '회의록.md').startsWith('# 📝 회의록\n'))
    assert.equal(p.report.renamed_files, 1)
  })

  test('★ 같은 제목의 형제 — 둘 다 id 가 붙고 링크도 그 이름을 가리킨다', () => {
    const a = pageNode('회의록')
    const b = pageNode('회의록')
    const root = pageNode('모음', [ref(a), ref(b)], [a.id, b.id])
    const p = plan(snapshot([root.id], [root, a, b]))

    const nameA = `회의록 ${hex8(a.id)}`
    const nameB = `회의록 ${hex8(b.id)}`
    assert.deepEqual(paths(p), ['모음.md', `모음/${nameA}.md`, `모음/${nameB}.md`])
    const md = textAt(p, '모음.md')
    assert.ok(md.includes(`[회의록](모음/회의록%20${hex8(a.id)}.md)`), md)
    assert.ok(md.includes(`[회의록](모음/회의록%20${hex8(b.id)}.md)`), md)
    assert.equal(p.report.renamed_files, 2)
  })

  test('제목 없는 페이지는 대체 이름을 쓰고, 바뀐 이름으로 세지 않는다', () => {
    const root = pageNode('')
    const p = plan(snapshot([root.id], [root]))
    assert.deepEqual(paths(p), [`${UNTITLED}.md`])
    assert.ok(textAt(p, `${UNTITLED}.md`).startsWith(`# ${UNTITLED}\n`))
    assert.equal(p.report.renamed_files, 0)
  })

  test('워크스페이스 범위 — 최상위 여러 개, 보고서 이름과 겹치는 제목에는 id 를 붙인다', () => {
    const a = pageNode('첫 페이지')
    const trap = pageNode(REPORT_PATH)
    const p = plan(snapshot([a.id, trap.id], [a, trap]))
    assert.deepEqual(paths(p), ['첫 페이지.md', `${REPORT_PATH} ${hex8(trap.id)}.md`])
  })
})

// ── ③ 첨부 ────────────────────────────────────────────────────────────

describe('③ 첨부', () => {
  test('우리 파일은 페이지 폴더에 한 번만 · 이름은 원래 이름 + MIME 확장자 · 외부 이미지는 주소 그대로', () => {
    const png: ExportFile = { id: randomUUID(), mime: 'image/png', originalName: 'C:\\fakepath\\스크린샷 1.PNG', sizeBytes: 1234 }
    const gif: ExportFile = { id: randomUUID(), mime: 'image/gif', originalName: null, sizeBytes: 10 }
    const external: EditorBlock = {
      id: randomUUID(),
      type: 'image',
      title: [],
      properties: { source: { type: 'external', url: 'https://example.com/그림.png' } },
    }
    const root = pageNode('사진첩', [fileImage(png.id), fileImage(png.id), fileImage(gif.id), fileImage(randomUUID()), external])

    const p = plan(snapshot([root.id], [root], [png, gif]))
    assert.deepEqual(p.entries.slice(1), [
      { kind: 'file', path: '사진첩/스크린샷 1.png', fileId: png.id, sizeBytes: 1234 },
      { kind: 'file', path: '사진첩/image.gif', fileId: gif.id, sizeBytes: 10 },
    ])
    const md = textAt(p, '사진첩.md')
    assert.equal(md.split('![](사진첩/스크린샷%201.png)').length - 1, 2, md)
    assert.ok(md.includes('![](사진첩/image.gif)'), md)
    assert.ok(md.includes('![](https://example.com/그림.png)'), md)
    assert.equal(p.report.counts.attachments, 2)
    assert.equal(p.report.markdown_losses.omitted_images, 1, '파일 정보가 없는 이미지')
  })

  test('첨부와 하위 페이지 폴더가 같은 자리면 둘 다 id 가 붙는다', () => {
    const png: ExportFile = { id: randomUUID(), mime: 'image/png', originalName: '표지.png', sizeBytes: 1 }
    const child = pageNode('표지.png')
    const root = pageNode('책', [fileImage(png.id), ref(child)], [child.id])
    const p = plan(snapshot([root.id], [root, child], [png]))
    assert.deepEqual(paths(p), ['책.md', `책/표지 ${hex8(png.id)}.png`, `책/표지.png ${hex8(child.id)}.md`])
  })

  test('★ 권한으로 빠진 하위 페이지 참조 — 파일도 링크도 없고 센다', () => {
    const hiddenId = randomUUID()
    const root = pageNode('루트', [para('앞'), { id: hiddenId, type: 'page', title: [] }, para('뒤')])
    const p = plan(snapshot([root.id], [root], [], { excluded: { no_access: 1 } }))
    assert.deepEqual(paths(p), ['루트.md'])
    assert.ok(!textAt(p, '루트.md').includes('](') , textAt(p, '루트.md'))
    assert.equal(p.report.markdown_losses.omitted_pages, 1)
    assert.deepEqual(p.report.excluded, { no_access: 1 })
  })
})

// ── 데이터베이스 ──────────────────────────────────────────────────────

describe('데이터베이스', () => {
  const columns: CsvColumn[] = [
    { propertyId: 'status', name: '상태', type: 'select', options: [{ id: 'doing', name: '진행 중', color: 'blue' }] },
    { propertyId: 'title', name: '이름', type: 'title' },
    { propertyId: 'done', name: '완료', type: 'checkbox' },
  ]

  test('CSV(제목 열이 맨 앞) · 행마다 Markdown(속성 줄 + 본문) · 행의 하위 페이지', () => {
    const rowChild = pageNode('행의 하위')
    const first = pageNode('첫 행', [para('행 본문'), ref(rowChild)], [rowChild.id], {
      cells: {
        title: { type: 'title', title: [textRun('첫 행')] },
        status: { type: 'select', select: { id: 'doing' } },
        done: { type: 'checkbox', checkbox: true },
      },
    })
    const formula = pageNode('=수식', [], [], { cells: { title: { type: 'title', title: [textRun('=수식')] } } })
    const database: ExportDatabaseNode = { kind: 'database', id: randomUUID(), name: '할 일', columns, rowIds: [first.id, formula.id] }

    const p = plan(snapshot([database.id], [database, first, formula, rowChild]))
    assert.deepEqual(paths(p), ['할 일.csv', '할 일/첫 행.md', '할 일/첫 행/행의 하위.md', '할 일/=수식.md'])

    const csv = textAt(p, '할 일.csv').slice(1).split('\r\n')
    assert.deepEqual(csv.slice(0, 3), ['이름,상태,완료', '첫 행,진행 중,Yes', "'=수식,,No"])

    const rowMd = textAt(p, '할 일/첫 행.md')
    assert.ok(rowMd.startsWith('# 첫 행\n\n**상태**: 진행 중\\\n**완료**: Yes\n\n행 본문\n'), rowMd)
    assert.ok(rowMd.includes('[행의 하위](첫%20행/행의%20하위.md)'), rowMd)

    assert.deepEqual(p.report.counts, { pages: 1, databases: 1, rows: 2, attachments: 0 })
    assert.equal(p.report.csv_guarded_formulas, 1)
  })

  test('행이 없어도 헤더만 있는 CSV 가 생긴다', () => {
    const database: ExportDatabaseNode = { kind: 'database', id: randomUUID(), name: '빈 표', columns, rowIds: [] }
    const p = plan(snapshot([database.id], [database]))
    assert.deepEqual(paths(p), ['빈 표.csv'])
    assert.equal(textAt(p, '빈 표.csv').slice(1), '이름,상태,완료\r\n')
  })
})

// ── 보고서 · 크기 ─────────────────────────────────────────────────────

describe('보고서 · 크기', () => {
  test('무손실이면 알림이 없다 · JSON 으로 읽힌다', () => {
    const root = pageNode('평범', [para('글')])
    const p = plan(snapshot([root.id], [root], [], { scope: { kind: 'page', rootId: root.id } }))
    assert.deepEqual(reportNotes(p.report), [])
    const parsed = JSON.parse(serializeReport(p.report)) as Record<string, unknown>
    assert.equal(parsed.format, 'notion-clone-export')
    assert.equal(parsed.version, 1)
    assert.equal(parsed.exported_at, '2026-09-13T12:00:00.000Z')
    assert.deepEqual(parsed.scope, { kind: 'page', root_id: root.id })
    assert.deepEqual(parsed.notes, [])
  })

  test('0 이 아닌 항목마다 사람이 읽을 문장이 하나씩 붙는다', () => {
    const root = pageNode('📝 색', [
      { id: randomUUID(), type: 'paragraph', title: [textRun('빨강', { color: 'red' })] },
      { id: randomUUID(), type: 'page', title: [] },
    ])
    const p = plan(snapshot([root.id], [root], [], { excluded: { no_access: 2 } }))
    const notes = reportNotes({ ...p.report, missing_attachments: 3 })
    assert.equal(notes.length, 5, notes.join('\n'))
    assert.ok(notes.some((n) => n.includes('색 1곳')))
    assert.ok(notes.some((n) => n.includes('하위 페이지 참조 1개')))
    assert.ok(notes.some((n) => n.includes('첨부 파일 3개')))
    assert.ok(notes.some((n) => n.includes('파일 이름 1개')))
    assert.ok(notes.some((n) => n.includes('no_access: 2개')))
  })

  test('크기 추정은 항목 수와 바이트 상한을 준다', () => {
    const png: ExportFile = { id: randomUUID(), mime: 'image/png', originalName: 'a.png', sizeBytes: 5 * 1024 * 1024 }
    const root = pageNode('큰 페이지', [fileImage(png.id)])
    const p = plan(snapshot([root.id], [root], [png]))
    const estimate = estimateExport(p)
    assert.equal(estimate.entries, 3, '본문 · 첨부 · 보고서')
    assert.ok(estimate.bytes > png.sizeBytes)
    assert.equal(estimate.fits, true)
    assert.equal(estimateExport(p, 1024 * 1024).fits, false)
  })
})

// ── ④ 스냅샷 오류 ─────────────────────────────────────────────────────

describe('④ 스냅샷이 틀리면 조용히 넘기지 않는다', () => {
  test('없는 노드를 가리키면 던진다', () => {
    const root = pageNode('루트', [], [randomUUID()])
    assert.throws(() => plan(snapshot([root.id], [root])), /스냅샷에 없는 노드/)
  })

  test('같은 노드가 두 번 나오면 던진다(순환)', () => {
    const child = pageNode('하위')
    const root = pageNode('루트', [ref(child)], [child.id])
    const cyclic: ExportPageNode = { ...child, childIds: [root.id] }
    assert.throws(() => plan(snapshot([root.id], [root, cyclic])), /두 번 나온다/)
  })
})
