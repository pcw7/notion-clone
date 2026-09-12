/**
 * 색인이 애플리케이션 경로에서 실제로 유지되는가 — W7 (F-07-06)
 *
 * `verify-schema.mjs` [8] 은 **트리거**를 SQL 로 직접 찔러 본다. 이 파일은 그
 * 위층을 본다 — `createPage` · `renamePage` · `savePageBody` · `movePage` ·
 * `trashPage` 를 실제로 불러서 색인이 따라오는지.
 *
 * 두 층이 다 필요한 이유: 트리거가 맞아도 **앱이 `indexPageText` 를 부르는 것을
 * 잊으면** 색인은 조용히 낡는다. 그 누락은 스키마 검증으로 보이지 않는다.
 *
 * 이 파일이 지키는 것.
 *
 *   ① 페이지를 만들면 제목이 색인된다
 *   ② 본문을 저장하면 본문이 색인된다
 *   ③ 이름을 바꾸면 색인 제목도 바뀐다 (본문은 그대로)
 *   ④ **페이지를 옮기면 권한 축이 따라간다** — 본문을 다시 읽지 않고
 *   ⑤ 휴지통 · 복원이 `in_trash` 로 따라간다
 *   ⑥ 자식 페이지의 제목은 부모 본문 색인에 섞이지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, renamePage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { movePage } from '../block/move-page.ts'
import { trashPage, restorePage } from '../block/trash.ts'
import { stopInheriting } from '../permissions/acl.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import type { EditorDoc } from '../editor/document.ts'
import { textRun } from '../contracts/rich-text.ts'

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

type IndexRow = {
  title_text: string | null
  body_text: string | null
  lang: string | null
  perm_scope_id: string
  in_trash: boolean
  ancestor_ids: string[]
  parent_id: string | null
  version: string
  region_id: string
  tsv: string
}

/** 색인 행을 그대로 읽는다. 읽기 경로를 만들지 않는다 — 그건 다음 PR(검색 질의)이다. */
const indexOf = async (pageId: string): Promise<IndexRow | null> =>
  withReadTransaction((tx) =>
    tx.queryMaybe<IndexRow>(
      `SELECT title_text, body_text, lang, perm_scope_id, in_trash,
              ancestor_ids, parent_id, version, region_id, tsv::text AS tsv
         FROM search_document WHERE doc_id = $1`,
      [pageId],
    ),
  )

const newPage = async (title: string, parentPageId?: BlockId): Promise<BlockId> =>
  (
    await createPage(fx.owner.ctx, {
      title: titleFromPlainText(title),
      ...(parentPageId ? { parentPageId } : {}),
    })
  ).id

/** 문단만 있는 최소 문서. `title` 은 properties 가 아니라 최상위 필드다(계약). */
const docOf = (...texts: string[]): EditorDoc => ({
  blocks: texts.map((t) => ({
    id: randomUUID(),
    type: 'paragraph' as const,
    title: t === '' ? [] : [textRun(t)],
  })),
})

describe('색인 생성', () => {
  test('★ 페이지를 만들면 제목이 색인된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('검색될 제목')

    const row = await indexOf(page)
    assert.ok(row !== null, '페이지를 만들었는데 색인 행이 없다')
    assert.equal(row.title_text, '검색될 제목')
    assert.equal(row.lang, 'ko')
    assert.equal(row.in_trash, false)
  })

  test('색인 행은 block 의 권한 축과 region 을 그대로 갖는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('권한 축 확인')

    const row = await indexOf(page)
    // 루트 페이지는 자기 자신이 스코프다.
    assert.equal(row?.perm_scope_id, page)
    assert.ok((row?.region_id.length ?? 0) > 0, 'region_id 가 비어 있다')
  })

  test('제목이 없어도 행은 생긴다 — 본문으로 찾을 수 있어야 한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, {})).id

    const row = await indexOf(page)
    assert.ok(row !== null)
    assert.equal(row.title_text, '')
  })
})

describe('본문 색인', () => {
  test('★ 본문을 저장하면 본문이 색인된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('본문 있는 페이지')
    const saved = await savePageBody(fx.owner.ctx, page, docOf('첫 문단이다', '둘째 문단이다'))
    assert.equal(saved.ok, true)

    const row = await indexOf(page)
    assert.equal(row?.body_text, '첫 문단이다\n둘째 문단이다')
    // 제목도 함께 채워진다 — 백필 행(title_text = NULL)이 저장 한 번으로 완전해진다.
    assert.equal(row?.title_text, '본문 있는 페이지')
  })

  test('★ 제목은 weight A, 본문은 weight B 로 들어간다 (F-07-02 의 필드 분리)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('알파')
    await savePageBody(fx.owner.ctx, page, docOf('베타'))

    const row = await indexOf(page)
    assert.ok(row !== null)
    assert.match(row.tsv, /'알파':1A/, `제목이 weight A 가 아니다: ${row.tsv}`)
    assert.match(row.tsv, /'베타':\d+B/, `본문이 weight B 가 아니다: ${row.tsv}`)
  })

  test('본문을 비우면 색인 본문도 비워진다 — 지운 글이 계속 검색되면 안 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('비울 페이지')
    await savePageBody(fx.owner.ctx, page, docOf('지워질 내용이다'))
    assert.equal((await indexOf(page))?.body_text, '지워질 내용이다')

    await savePageBody(fx.owner.ctx, page, docOf(''))
    assert.equal((await indexOf(page))?.body_text, '')
  })

  test('★ 자식 페이지의 제목은 부모 본문에 섞이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('부모 페이지')
    const child = await newPage('자식 제목이다', parent)

    // 자식 페이지는 부모 문서 안의 참조 노드로 들어가야 저장이 거부되지 않는다.
    const saved = await savePageBody(fx.owner.ctx, parent, {
      blocks: [
        { id: randomUUID(), type: 'paragraph', title: [textRun('부모 본문')] },
        { id: child, type: 'page', title: [] },
      ],
    })
    assert.equal(saved.ok, true)

    assert.equal((await indexOf(parent))?.body_text, '부모 본문')
    // 자식은 자기 행에 자기 제목을 갖는다.
    assert.equal((await indexOf(child))?.title_text, '자식 제목이다')
  })

  test('언어는 제목과 본문을 함께 보고 정한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 제목만 보면 'en' 이 될 페이지.
    const page = await newPage('Q3 Report')
    await savePageBody(fx.owner.ctx, page, docOf('한국어 본문이다'))

    assert.equal((await indexOf(page))?.lang, 'ko')
  })
})

describe('이름 변경', () => {
  test('★ 이름을 바꾸면 색인 제목도 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('옛 제목')
    await renamePage(fx.owner.ctx, page, titleFromPlainText('새 제목'))

    assert.equal((await indexOf(page))?.title_text, '새 제목')
  })

  test('★ 이름만 바꿔도 본문 색인은 살아 있다 — 제목 변경이 본문을 날리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('제목 바꿀 페이지')
    await savePageBody(fx.owner.ctx, page, docOf('남아 있어야 하는 본문'))
    await renamePage(fx.owner.ctx, page, titleFromPlainText('바뀐 제목'))

    const row = await indexOf(page)
    assert.equal(row?.title_text, '바뀐 제목')
    assert.equal(row?.body_text, '남아 있어야 하는 본문')
  })
})

describe('메타데이터만 바뀌는 경로 — 본문 재색인 없이 따라간다 (F-07-06)', () => {
  test('★ 페이지를 옮기면 ancestor_ids 와 권한 축이 따라간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const oldParent = await newPage('옛 부모')
    const newParent = await newPage('새 부모')
    const page = await newPage('옮겨질 페이지', oldParent)
    await savePageBody(fx.owner.ctx, page, docOf('본문은 그대로여야 한다'))

    const before = await indexOf(page)
    assert.deepEqual(before?.ancestor_ids, [oldParent])

    const moved = await movePage(fx.owner.ctx, page, newParent)
    assert.equal(moved.noop, false, '이동이 아무것도 하지 않았다')

    const after = await indexOf(page)
    assert.deepEqual(after?.ancestor_ids, [newParent], '이동 후 조상이 따라오지 않았다')
    assert.equal(after?.parent_id, newParent)
    // 본문은 건드리지 않았다 — 트리거가 메타만 갱신한다.
    assert.equal(after?.body_text, '본문은 그대로여야 한다')
  })

  test('★ 상속을 끊으면 권한 축이 색인에 반영된다 — 검색 필터가 즉시 좁아진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('공유 부모')
    const page = await newPage('따로 관리할 페이지', parent)
    await savePageBody(fx.owner.ctx, page, docOf('내용'))

    // 끊기 전에는 부모의 스코프를 쓴다.
    assert.equal((await indexOf(page))?.perm_scope_id, parent)

    await stopInheriting(fx.owner.ctx, page)

    const after = await indexOf(page)
    assert.equal(after?.perm_scope_id, page, '상속을 끊었는데 색인의 권한 축이 안 바뀌었다')
    assert.equal(after?.body_text, '내용', '권한 변경이 본문 색인을 날렸다')
  })
})

describe('휴지통', () => {
  test('★ 휴지통에 보내면 in_trash 가 true 가 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('버릴 페이지')
    await savePageBody(fx.owner.ctx, page, docOf('버려질 내용'))

    await trashPage(fx.owner.ctx, page)
    assert.equal((await indexOf(page))?.in_trash, true)
  })

  test('★ 복원하면 in_trash 가 false 로 돌아오고 본문도 살아 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('복원할 페이지')
    await savePageBody(fx.owner.ctx, page, docOf('돌아올 내용'))
    await trashPage(fx.owner.ctx, page)

    await restorePage(fx.owner.ctx, page)
    const row = await indexOf(page)
    assert.equal(row?.in_trash, false)
    assert.equal(row?.body_text, '돌아올 내용')
  })

  test('하위 페이지도 함께 in_trash 가 된다 — 삭제 루트 단위 전이를 따라간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('지울 부모')
    const child = await newPage('딸려 갈 자식', parent)

    await trashPage(fx.owner.ctx, parent)
    assert.equal((await indexOf(child))?.in_trash, true)
  })
})

describe('버전', () => {
  test('★ 저장하면 색인의 version 이 block 과 같이 오른다 (X-6 의 external version)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('버전 확인')
    const before = await indexOf(page)

    const saved = await savePageBody(fx.owner.ctx, page, docOf('내용이 생겼다'))
    assert.equal(saved.ok, true)

    const after = await indexOf(page)
    assert.ok(
      BigInt(after?.version ?? '0') > BigInt(before?.version ?? '0'),
      `version 이 오르지 않았다: ${before?.version} → ${after?.version}`,
    )
    // 저장이 돌려준 값과 색인의 값이 같아야 한다 — 순서 뒤바뀜 판정의 근거다.
    if (saved.ok) assert.equal(after?.version, saved.version)
  })
})
