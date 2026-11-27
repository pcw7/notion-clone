/**
 * 사본에서 고칠 수 있는가 — SY7 의 편집 조건 표 (SB-3 · F-01-11 · 정본 [보강 SB-0] ⑧ [SB-3 고침] · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 표 — A 를 보기만 · 고치기 · 잠김(서버가 embed 연결을 그 모드로 받는다 — `collab-server.db.test.ts` 가 본다) × B 가 편집 · 읽기 전용 ·
 *      제안 모드. 고치는 것은 "A 고치기 × B 편집" 한 칸뿐이다. 같은 페이지의 사본은 B 의 편집 가능이 곧 A 의 연결이다
 *   ② 잠깐 멈춤 — 고칠 수 있는 연결이어도 끊겼거나 · 첫 동기화 전 · 닫혔으면 입력을 받지 않는다(`paused` — 묶기는 그대로). 다시 여는 중 ·
 *      아직 모르면 쓰지 않는 묶기다
 *   ③ 표의 칸마다 실제 묶기 — `read_only` 칸의 중첩 편집기에 친 글은 문서에 쓰이지 않고 보낼 update 도 없다(**B 가 읽기 전용이면 보내지
 *      않는다**) · 고치는 칸은 X 안에 쓰이고 A 로 건너간다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'

import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc } from '../collab/ydoc.ts'
import { exchange, findBlock, headless, peer } from '../testing/collab-peers.ts'
import { copyEditState, type CopyEditInput } from './synced-copy-edit.ts'
import { createCopyEditorState, findSyncedGroup } from './synced-copy-binding.ts'

const X = '22222222-2222-4222-8222-00000000000a'
const C1 = '22222222-2222-4222-8222-000000000001'

/** 서버가 embed 연결을 받는 모양 — 보기만 · 잠김은 읽기 전용(`collab-server.ts` `embedMode`). */
const A_SIDE = {
  view: { readOnly: true },
  edit: { readOnly: false },
  locked: { readOnly: true },
} as const
const LIVE = { online: true, synced: true, reopening: false, closed: null } as const
const B_SIDE = {
  editable: { outerEditable: true, outerSuggesting: false },
  read_only: { outerEditable: false, outerSuggesting: false },
  suggesting: { outerEditable: true, outerSuggesting: true },
} as const

type Row = { readonly a: keyof typeof A_SIDE; readonly b: keyof typeof B_SIDE; readonly input: CopyEditInput }
const ROWS: Row[] = (Object.keys(A_SIDE) as (keyof typeof A_SIDE)[]).flatMap((a) =>
  (Object.keys(B_SIDE) as (keyof typeof B_SIDE)[]).map((b) => ({ a, b, input: { ...B_SIDE[b], attachment: { ...LIVE, ...A_SIDE[a] } } })),
)

describe('사본에서 고칠 수 있는가 — SY7 (SB-3)', () => {
  test('★ ① 표 — A 고치기 × B 편집 한 칸만 고친다 · 같은 페이지는 B 를 따른다', () => {
    const got = ROWS.map((row) => `${row.a}×${row.b}=${copyEditState(row.input)}`)
    assert.deepEqual(got, [
      'view×editable=read_only',
      'view×read_only=read_only',
      'view×suggesting=read_only',
      'edit×editable=editable',
      'edit×read_only=read_only',
      'edit×suggesting=read_only',
      'locked×editable=read_only',
      'locked×read_only=read_only',
      'locked×suggesting=read_only',
    ])
    const same = (Object.keys(B_SIDE) as (keyof typeof B_SIDE)[]).map((b) => `${b}=${copyEditState({ ...B_SIDE[b], attachment: 'same' })}`)
    assert.deepEqual(same, ['editable=editable', 'read_only=read_only', 'suggesting=read_only'])
  })

  test('② 잠깐 멈춤 — 끊김 · 첫 동기화 전 · 닫힘은 paused · 다시 여는 중 · 모름 · 아직 안 붙음은 read_only', () => {
    const editing = B_SIDE.editable
    const at = (patch: object) => copyEditState({ ...editing, attachment: { ...LIVE, readOnly: false, ...patch } as CopyEditInput['attachment'] })
    assert.equal(at({ online: false }), 'paused')
    assert.equal(at({ synced: false }), 'paused')
    assert.equal(at({ closed: 'not_found' }), 'paused')
    assert.equal(at({ reopening: true, readOnly: null }), 'read_only', '다시 여는 동안 인증 전 — 모른다')
    assert.equal(at({ readOnly: null }), 'read_only')
    assert.equal(copyEditState({ ...editing, attachment: null }), 'read_only')
  })

  test('★ ③ 표의 칸마다 실제 묶기 — read_only 칸은 쓰지도 보낼 것도 없고 · 고치는 칸은 X 안에 쓰여 A 로 건너간다', () => {
    for (const row of ROWS) {
      const a = createBodyYDoc({
        blocks: [{ id: X, type: SYNCED_BLOCK_TYPE, title: [], properties: {}, format: {}, children: [{ id: C1, type: 'paragraph', title: [textRun('안')], properties: {}, format: {}, children: [] }] }],
      })
      a.clientID = 1
      const b = peer(a, 2)
      const group = findSyncedGroup(b, X)
      assert.ok(group)
      const state = copyEditState(row.input)
      const nested = headless(createCopyEditorState(group, { readOnly: state === 'read_only' }))
      nested.dispatch(nested.state.tr.insertText('사본 ', findBlock(nested.state.doc, C1).pos + 2))
      const pending = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
      const nothing = Y.encodeStateAsUpdate(new Y.Doc()).length
      if (state === 'read_only') {
        assert.equal(pending.length, nothing, `${row.a}×${row.b} — 보낼 update 가 없다`)
        assert.equal(nested.state.doc.textContent, '안', `${row.a}×${row.b} — 화면도 그대로`)
      } else {
        assert.ok(pending.length > nothing, `${row.a}×${row.b} — 쓴다`)
        exchange(a, b)
        assert.equal(findSyncedGroup(a, X)?.toString().includes('사본 안'), true, `${row.a}×${row.b} — A 의 X 안에`)
      }
      nested.destroy()
    }
  })
})
