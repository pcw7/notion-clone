/**
 * 페이지 본문 저장 — 프로젝터 (판결 X-1 / X-3 / X-6)
 *
 * 이 파일이 지키는 것 네 가지. 전부 조용히 깨지는 종류다.
 *
 *   ① 왕복 무손실 — 저장한 문서를 다시 읽으면 같아야 한다
 *   ② 안 바뀌면 안 쓴다 — 같은 문서를 두 번 저장하면 두 번째는 쓰기 0건
 *   ③ 순서를 맞바꿔도 UNIQUE 에 걸리지 않는다 (지연 불가 제약 + 임시 키)
 *   ④ 낡은 문서가 하위 페이지를 지우지 못한다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, createBareWorkspace, joinAs, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import type { BlockType } from './types.ts'
import { asBlockId, type BlockId } from '../ids.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

function blk(type: BlockType, text = '', children: EditorBlock[] = []): EditorBlock {
  return { id: randomUUID(), type, title: text === '' ? [] : [textRun(text)], children }
}

/** 문서를 [타입, 텍스트, 자식] 로 납작하게 만들어 비교하기 쉽게. */
function shape(doc: EditorDoc): unknown {
  const walk = (blocks: readonly EditorBlock[]): unknown =>
    blocks.map((b) => [b.type, b.title[0]?.plain_text ?? '', walk(b.children ?? [])])
  return walk(doc.blocks)
}

async function newPage(title = '본문 테스트'): Promise<BlockId> {
  const page = await createPage(fx.owner.ctx, { title: titleFromPlainText(title) })
  return page.id
}

describe('savePageBody — 왕복', () => {
  test('저장한 문서를 다시 읽으면 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()

    const doc: EditorDoc = {
      blocks: [
        blk('heading_1', '제목'),
        blk('bulleted_list_item', '항목', [blk('paragraph', '자식'), blk('paragraph', '자식2')]),
        blk('divider'),
        blk('to_do', '할 일'),
      ],
    }

    const saved = await savePageBody(fx.owner.ctx, pageId, doc)
    assert.ok(saved.ok, JSON.stringify(saved))

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(loaded)
    assert.deepEqual(shape(loaded.doc), shape(doc))
    // id 도 보존된다 — 클라이언트가 만든 id 가 정본이다.
    assert.deepEqual(
      loaded.doc.blocks.map((b) => b.id),
      doc.blocks.map((b) => b.id),
    )
  })

  test('빈 페이지의 본문은 빈 배열이다 — 서버가 문단을 만들어 두지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const loaded = await loadPageBody(fx.owner.ctx, await newPage())
    assert.deepEqual(loaded?.doc.blocks, [])
  })

  test('to_do 의 checked 같은 properties 가 보존된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const todo: EditorBlock = { ...blk('to_do', '완료'), properties: { checked: true } }

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [todo] })).ok)
    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.equal(loaded?.doc.blocks[0].properties?.checked, true)
  })

  test('모르는 타입이 왕복에서 살아남는다 (F-01-02)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const exotic: EditorBlock = {
      id: randomUUID(),
      type: 'audio' as BlockType,
      title: [],
      properties: { url: 'https://example.com/a.mp3' },
    }

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [exotic] })).ok)
    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    const back = loaded?.doc.blocks[0]

    assert.equal(back?.type, 'unsupported')
    assert.equal(back?.properties?.original_type, 'audio')
    assert.deepEqual(back?.properties?.original_properties, { url: 'https://example.com/a.mp3' })
  })
})

describe('savePageBody — 안 바뀌면 안 쓴다 (§9-Q1 쓰기 증폭)', () => {
  test('같은 문서를 두 번 저장하면 두 번째는 쓰기 0건이고 version 도 안 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const doc: EditorDoc = { blocks: [blk('paragraph', '가'), blk('paragraph', '나')] }

    const first = await savePageBody(fx.owner.ctx, pageId, doc)
    assert.ok(first.ok)
    assert.equal(first.writes.inserted, 2)

    const second = await savePageBody(fx.owner.ctx, pageId, doc)
    assert.ok(second.ok)
    assert.deepEqual(second.writes, { inserted: 0, updated: 0, deleted: 0, reordered: 0 })
    // version 은 검색 인덱스의 external version 이다 [X-6].
    // 내용이 같은데 올리면 인덱서가 같은 페이지를 계속 다시 읽는다.
    assert.equal(second.version, first.version)
  })

  test('한 블록만 고치면 한 행만 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const a = blk('paragraph', '가')
    const b = blk('paragraph', '나')
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [a, b] })).ok)

    const edited = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [a, { ...b, title: [textRun('나 수정')] }],
    })
    assert.ok(edited.ok)
    assert.deepEqual(edited.writes, { inserted: 0, updated: 1, deleted: 0, reordered: 0 })
  })
})

describe('savePageBody — 순서 변경', () => {
  test('두 블록을 맞바꿔도 UNIQUE 에 걸리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // ux_block_sibling_order 는 CREATE UNIQUE INDEX 라 지연될 수 없다.
    // 한 문장 안에서 키를 맞바꾸면 중간 상태에서 충돌한다.
    const pageId = await newPage()
    const a = blk('paragraph', '가')
    const b = blk('paragraph', '나')

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [a, b] })).ok)
    const swapped = await savePageBody(fx.owner.ctx, pageId, { blocks: [b, a] })
    assert.ok(swapped.ok, JSON.stringify(swapped))

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(loaded?.doc.blocks.map((x) => x.title[0]?.plain_text), ['나', '가'])
  })

  test('여러 블록을 뒤집어도 순서가 정확하다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const blocks = Array.from({ length: 12 }, (_, i) => blk('paragraph', `b${i}`))

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks })).ok)
    const reversed = [...blocks].reverse()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: reversed })).ok)

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(
      loaded?.doc.blocks.map((x) => x.title[0]?.plain_text),
      reversed.map((x) => x.title[0]?.plain_text),
    )
  })

  test('블록을 다른 부모로 옮기면 중첩이 따라간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const child = blk('paragraph', '움직이는 블록')
    const parent = blk('toggle', '토글')

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [parent, child] })).ok)
    // child 를 parent 안으로 들여쓴다 (Tab).
    assert.ok(
      (await savePageBody(fx.owner.ctx, pageId, { blocks: [{ ...parent, children: [child] }] })).ok,
    )

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.equal(loaded?.doc.blocks.length, 1)
    assert.equal(loaded?.doc.blocks[0].children?.[0].id, child.id)
  })
})

describe('savePageBody — 삭제 (X-3 / B5)', () => {
  test('문서에서 사라진 본문 블록은 행이 지워진다 — 휴지통에 가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')
    const pageId = await newPage()
    const keep = blk('paragraph', '남는다')
    const gone = blk('paragraph', '사라진다')

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [keep, gone] })).ok)
    const removed = await savePageBody(fx.owner.ctx, pageId, { blocks: [keep] })
    assert.ok(removed.ok)
    assert.equal(removed.writes.deleted, 1)

    // X-3: lifecycle 은 type='page' 만의 축이다. 문단은 trashed 가 될 수 없으므로
    // 물리 삭제가 유일한 표현이다. 행 자체가 없어야 한다.
    const rows = await query(`SELECT id FROM block WHERE id = $1`, [gone.id])
    assert.equal(rows.length, 0)
  })

  test('부모를 지우면 자식도 함께 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')
    const pageId = await newPage()
    const child = blk('paragraph', '자식')
    const parent = blk('toggle', '부모', [child])

    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [parent] })).ok)
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [] })).ok)

    const rows = await query(`SELECT id FROM block WHERE id = ANY($1::uuid[])`, [
      [parent.id, child.id],
    ])
    assert.equal(rows.length, 0, '자식이 고아로 남았다')
  })
})

describe('savePageBody — 자식 페이지', () => {
  test('문서에서 자식 페이지가 빠지면 저장을 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 낡은 탭 하나가 하위 페이지를 통째로 지우는 경로를 막는다.
    const pageId = await newPage()
    const child = await createPage(fx.owner.ctx, {
      parentPageId: pageId,
      title: titleFromPlainText('하위'),
    })

    const result = await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '본문')] })
    assert.equal(result.ok, false)
    if (!result.ok && result.reason === 'page_ref_missing') {
      assert.deepEqual(result.missing, [child.id])
    } else {
      assert.fail(`page_ref_missing 이어야 한다: ${JSON.stringify(result)}`)
    }
  })

  test('자식 페이지를 문서에 두면 저장되고 순서가 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const child = await createPage(fx.owner.ctx, {
      parentPageId: pageId,
      title: titleFromPlainText('하위'),
    })

    const para = blk('paragraph', '본문')
    const ref: EditorBlock = { id: child.id, type: 'page', title: [] }

    // 본문을 자식 페이지 **앞**에 둔다.
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [para, ref] })).ok)

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.deepEqual(loaded?.doc.blocks.map((b) => b.id), [para.id, child.id])
    // 자식 페이지의 제목은 프로젝터가 건드리지 않는다 — 그 페이지의 것이다.
    assert.equal(loaded?.doc.blocks[1].title[0]?.plain_text, '하위')
  })

  test('자식 페이지를 본문 블록 안에 중첩하면 거부한다 (Phase 0 범위)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const child = await createPage(fx.owner.ctx, { parentPageId: pageId })

    const ref: EditorBlock = { id: child.id, type: 'page', title: [] }
    const result = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [blk('toggle', '토글', [ref])],
    })

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'page_ref_nested')
  })

  test('휴지통에 있는 자식 페이지의 order_key 를 밀어내지 않는다 (B2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')
    const pageId = await newPage()
    const trashed = await createPage(fx.owner.ctx, { parentPageId: pageId })

    // B2: 삭제 시 parent_id · order_key 를 절대 변경하지 않는다.
    await query(
      `UPDATE block SET lifecycle='trashed', trashed_at=now(), trashed_by=$2, trash_root_id=id,
                        purge_after = now() + interval '30 days'
        WHERE id = $1`,
      [trashed.id, fx.owner.userId],
    )

    // 이제 본문을 저장한다. 문서에는 휴지통 페이지가 없다.
    const saved = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [blk('paragraph', '가'), blk('paragraph', '나')],
    })
    assert.ok(saved.ok, JSON.stringify(saved))

    const row = await query<{ order_key: string; lifecycle: string }>(
      `SELECT order_key, lifecycle FROM block WHERE id = $1`,
      [trashed.id],
    )
    assert.equal(row[0].order_key, trashed.orderKey, '휴지통 페이지의 키가 바뀌었다 (B2 위반)')
    assert.equal(row[0].lifecycle, 'trashed')
  })
})

describe('savePageBody — 거부 경로', () => {
  test('다른 워크스페이스의 페이지는 not_found 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const otherWs = await createBareWorkspace('본문 격리')
    const other = await joinAs(otherWs, await createUser(), 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 페이지') })

    const result = await savePageBody(fx.owner.ctx, foreign.id, {
      blocks: [blk('paragraph', '침입')],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'not_found')

    // 실제로 아무것도 안 써졌는지 확인한다.
    const loaded = await loadPageBody(other.ctx, foreign.id)
    assert.deepEqual(loaded?.doc.blocks, [])
  })

  test('없는 페이지도 not_found 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const result = await savePageBody(fx.owner.ctx, asBlockId(randomUUID()), { blocks: [] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'not_found')
  })

  test('계약을 어긴 문서는 저장 전에 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    const dup = randomUUID()
    const result = await savePageBody(fx.owner.ctx, pageId, {
      blocks: [
        { id: dup, type: 'paragraph', title: [] },
        { id: dup, type: 'paragraph', title: [] },
      ],
    })

    assert.equal(result.ok, false)
    if (!result.ok && result.reason === 'invalid_document') {
      assert.ok(result.issues.length > 0)
    } else {
      assert.fail(`invalid_document 여야 한다: ${JSON.stringify(result)}`)
    }
  })
})

describe('savePageBody — 낙관적 잠금 (§5.1 "다른 사람이 편집 중" 배너)', () => {
  test('expectedVersion 이 어긋나면 충돌을 알린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()

    const before = await loadPageBody(fx.owner.ctx, pageId)
    assert.ok(before)

    // 다른 사람이 먼저 저장했다.
    const theirs = await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '남의 글')] })
    assert.ok(theirs.ok)

    const mine = await savePageBody(
      fx.owner.ctx,
      pageId,
      { blocks: [blk('paragraph', '내 글')] },
      { expectedVersion: before.version },
    )
    assert.equal(mine.ok, false)
    if (!mine.ok && mine.reason === 'version_conflict') {
      assert.equal(mine.currentVersion, theirs.version)
    } else {
      assert.fail(`version_conflict 여야 한다: ${JSON.stringify(mine)}`)
    }

    // 거부됐으면 남의 글이 그대로 남아야 한다.
    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.equal(loaded?.doc.blocks[0].title[0]?.plain_text, '남의 글')
  })

  test('expectedVersion 을 주지 않으면 그냥 덮어쓴다 (순수 LWW)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '먼저')] })).ok)
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '나중')] })).ok)

    const loaded = await loadPageBody(fx.owner.ctx, pageId)
    assert.equal(loaded?.doc.blocks[0].title[0]?.plain_text, '나중')
  })

  test('저장하면 version 이 오르고 그 값으로 다음 저장이 통과한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = await newPage()

    const first = await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '1')] })
    assert.ok(first.ok)
    const second = await savePageBody(
      fx.owner.ctx,
      pageId,
      { blocks: [blk('paragraph', '2')] },
      { expectedVersion: first.version },
    )
    assert.ok(second.ok, JSON.stringify(second))
    assert.ok(Number(second.version) > Number(first.version))
  })
})

describe('savePageBody — 문서 경계', () => {
  test('자식 페이지의 본문은 부모 저장에 영향받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 범위 계산이 ancestor_path 였다면 여기서 자식 페이지의 본문이 지워진다.
    const pageId = await newPage()
    const child = await createPage(fx.owner.ctx, { parentPageId: pageId })

    const childBody = blk('paragraph', '자식 페이지의 본문')
    assert.ok((await savePageBody(fx.owner.ctx, child.id, { blocks: [childBody] })).ok)

    const ref: EditorBlock = { id: child.id, type: 'page', title: [] }
    assert.ok(
      (await savePageBody(fx.owner.ctx, pageId, { blocks: [blk('paragraph', '부모 본문'), ref] })).ok,
    )

    const childLoaded = await loadPageBody(fx.owner.ctx, child.id)
    assert.deepEqual(
      childLoaded?.doc.blocks.map((b) => b.title[0]?.plain_text),
      ['자식 페이지의 본문'],
      '부모를 저장했더니 자식 페이지의 본문이 사라졌다',
    )
  })
})
