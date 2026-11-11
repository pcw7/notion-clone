/**
 * 코멘트 권한자의 제안 검사 (SG-5b · 정본 [보강 SG-1] ⑨)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 원문이 그대로면 받는다 — 내 insert · delete · format 제안을 더하고, 내 제안을 고치고 지운다
 *   ② 원문을 바꾸면 거부한다 — 글을 그냥 넣거나 지우기 · 서식을 그냥 걸기 · 블록 속성 바꾸기 · 남의 insert 를 받아들이기(마크 떼기)
 *   ③ 남의 이름이 선 제안을 건드리면 거부한다 — 남의 제안 글 바꾸기 · 지우기 · 새 sid 를 남의 이름으로 · 내 제안을 남의 이름으로
 *   ④ 남이 넣자는 글에 내 delete 제안을 겹치거나 서식을 입혀도 그 제안은 그대로다 — 받는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { blockSchema, SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { suggestOnlyViolation } from './suggest-only.ts'

const ME = randomUUID()
const OTHER = randomUUID()
const ins = (sid: string, author = ME): Mark => blockSchema.marks[SUGGESTION_INSERT_MARK]!.create({ sid, author_id: author })
const del = (sid: string, author = ME): Mark => blockSchema.marks[SUGGESTION_DELETE_MARK]!.create({ sid, author_id: author })
const fmt = (sid: string, author = ME, added: unknown[] = [{ type: 'bold', attrs: {} }]): Mark =>
  blockSchema.marks[SUGGESTION_FORMAT_MARK]!.create({ sid, author_id: author, added, removed: [] })
const bold = (): Mark => blockSchema.marks.bold!.create()
const italic = (): Mark => blockSchema.marks.italic!.create()
const text = (s: string, ...marks: Mark[]): PmNode => blockSchema.text(s, marks)
const ID = randomUUID()
const para = (inline: PmNode[], id: string = ID): PmNode =>
  blockSchema.nodes.blockContainer!.create({ blockId: id }, [blockSchema.nodes.paragraph!.create({ props: {}, format: {} }, inline)])
const todo = (inline: PmNode[], checked: boolean): PmNode =>
  blockSchema.nodes.blockContainer!.create({ blockId: ID }, [blockSchema.nodes.to_do!.create({ props: { checked }, format: {} }, inline)])
const docOf = (...containers: PmNode[]): PmNode =>
  blockSchema.nodes.doc!.create(null, blockSchema.nodes.blockGroup!.create(null, containers))
const one = (...inline: PmNode[]): PmNode => docOf(para(inline))

describe('코멘트 권한자의 제안 검사 (SG-5b)', () => {
  test('① 원문이 그대로면 받는다 — 내 제안을 더하고 고치고 지운다', () => {
    const base = one(text('안녕 세상'))
    // insert
    assert.equal(suggestOnlyViolation(base, one(text('안녕 '), text('새 ', ins('a')), text('세상')), ME), null)
    // delete
    assert.equal(suggestOnlyViolation(base, one(text('안녕 '), text('세상', del('b'))), ME), null)
    // format — 굵게를 바로 걸고 마크를 단다(SG-5a)
    assert.equal(suggestOnlyViolation(base, one(text('안녕 '), text('세상', bold(), fmt('c'))), ME), null)
    // 내 제안 고치기 · 지우기
    const mine = one(text('안녕 '), text('새 ', ins('a')), text('세상'))
    assert.equal(suggestOnlyViolation(mine, one(text('안녕 '), text('새로운 ', ins('a')), text('세상')), ME), null)
    assert.equal(suggestOnlyViolation(mine, base, ME), null)
  })

  test('② 원문을 바꾸면 거부한다', () => {
    const base = one(text('안녕 세상'))
    assert.equal(suggestOnlyViolation(base, one(text('안녕 새 세상')), ME), 'original_changed')
    assert.equal(suggestOnlyViolation(base, one(text('안녕')), ME), 'original_changed')
    assert.equal(suggestOnlyViolation(base, one(text('안녕 '), text('세상', bold())), ME), 'original_changed')
    assert.equal(suggestOnlyViolation(docOf(todo([text('할 일')], false)), docOf(todo([text('할 일')], true)), ME), 'original_changed')
    // 남이 넣자는 글을 받아들이기(마크 떼기) — 원문에 글이 생긴다
    assert.equal(suggestOnlyViolation(one(text('가'), text('나', ins('x', OTHER))), one(text('가나')), ME), 'original_changed')
    // 블록을 하나 더
    assert.equal(suggestOnlyViolation(base, docOf(para([text('안녕 세상')]), para([], randomUUID())), ME), 'original_changed')
  })

  test('③ 남의 이름이 선 제안을 건드리면 거부한다', () => {
    const theirs = one(text('가'), text('나다', ins('x', OTHER)))
    // 남이 넣자는 글 바꾸기 · 지우기
    assert.equal(suggestOnlyViolation(theirs, one(text('가'), text('나', ins('x', OTHER))), ME), 'others_suggestion')
    assert.equal(suggestOnlyViolation(theirs, one(text('가')), ME), 'others_suggestion')
    // 남이 지우자는 글의 마크를 떼기 — 원문은 같다(delete 글은 원문에 있다)
    assert.equal(suggestOnlyViolation(one(text('가나', del('y', OTHER))), one(text('가나')), ME), 'others_suggestion')
    // 남의 서식 제안을 내 서식으로 덮기 — 원문(제안 전 서식)은 같아도 그 사람의 제안이 바뀐다
    const fmtTheirs = one(text('가나', bold(), fmt('z', OTHER)))
    assert.equal(
      suggestOnlyViolation(fmtTheirs, one(text('가나', bold(), italic(), fmt('z', OTHER, [{ type: 'bold', attrs: {} }, { type: 'italic', attrs: {} }]))), ME),
      'others_suggestion',
    )
    // 새 sid 를 남의 이름으로 · 내 제안을 남의 이름으로
    const base = one(text('가'))
    assert.equal(suggestOnlyViolation(base, one(text('가'), text('나', ins('n', OTHER))), ME), 'others_suggestion')
    assert.equal(suggestOnlyViolation(one(text('가'), text('나', ins('m'))), one(text('가'), text('나', ins('m', OTHER))), ME), 'others_suggestion')
  })

  test('④ 남이 넣자는 글에 내 delete 를 겹치거나 서식을 입혀도 받는다', () => {
    const theirs = one(text('가'), text('나다', ins('x', OTHER)))
    assert.equal(suggestOnlyViolation(theirs, one(text('가'), text('나다', ins('x', OTHER), del('d'))), ME), null)
    // 글이 다른 마크로 쪼개져도 그 제안의 글은 같다
    assert.equal(suggestOnlyViolation(theirs, one(text('가'), text('나', ins('x', OTHER)), text('다', bold(), ins('x', OTHER))), ME), null)
  })
})
