/**
 * 정규화 ⑥ — 동기화 블록 (SB-1 · 정본 §3.4 [보강 SB-0] ⑥ · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ⓐ 자식 없는 원본 → 빈 문단 하나(씨앗 id — 같은 입력이면 같은 id)
 *   ⓑ 자식을 가진 사본 → 자식을 사본 바로 뒤 형제로
 *   ⓒ 동기화 블록 안(어느 깊이든)의 원본 → 껍데기를 벗겨 자식을 그 자리에 · 사본 → 뺀다
 *   ⓓ 동기화 블록 안의 하위 페이지 · 인라인 데이터베이스 참조 → 가장 바깥 동기화 블록 바로 뒤로
 *   ⓔ 모양이 틀린 `synced_from`(소문자 uuid 가 아님 · 자기 id)의 사본 → 뺀다
 *   · 결과는 스키마 · 문서 계약(`validateDoc`)에 맞고 **두 번 돌려도 같다**(고칠 것 0개 · `eq`)
 *   · 규칙은 레지스트리의 `excludedDescendantTypes` 를 읽는다 — 그 칸을 끄면 ⓒⓓ 가 고치지 않는다(반사실 줄)
 *
 * 입력은 ProseMirror 의 **검사하지 않는** `create` 로 만든다 — 협업 참여자가 Y.Doc 에 남길 수 있는 모양이다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'

import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { specOf } from '../block/types.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema as S } from '../editor/schema.ts'
import { normalizeBody, type NormalizeFix, type NormalizeResult } from './normalize.ts'

const SEED = randomUUID()
const ids = Array.from({ length: 12 }, () => randomUUID())
const [A, B, C, D, E, F, P, Q] = ids
const NAMES = new Map([[A, 'A'], [B, 'B'], [C, 'C'], [D, 'D'], [E, 'E'], [F, 'F'], [P, 'P'], [Q, 'Q']])

const attrs = { props: {}, format: {} }
const para = (text = '') => S.nodes.paragraph.create(attrs, text === '' ? [] : [S.text(text)])
const toggle = (text: string) => S.nodes.toggle.create(attrs, [S.text(text)])
const original = () => S.nodes[SYNCED_BLOCK_TYPE]!.create({ props: {}, format: {} })
const copy = (from: unknown) => S.nodes[SYNCED_BLOCK_TYPE]!.create({ props: { synced_from: from }, format: {} })
const pageRef = () => S.nodes.page_ref.create(attrs)
const databaseRef = () => S.nodes.database_ref.create(attrs)
const container = (id: string, ...children: PmNode[]) => S.nodes.blockContainer.create({ blockId: id }, children)
const group = (...children: PmNode[]) => S.nodes.blockGroup.create(null, children)
const doc = (...children: PmNode[]) => S.nodes.doc.create(null, children)

/** `A[원본](B) C` 꼴 — 동기화 블록은 `[원본]` · `[사본]`, 참조는 `[페이지]` · `[DB]`, 모르는 id 는 `?`. */
function shape(node: PmNode): string {
  const walk = (list: readonly EditorBlock[]): string =>
    list
      .map((b) => {
        const name = NAMES.get(b.id) ?? '?'
        const kind =
          b.type === SYNCED_BLOCK_TYPE ? (b.properties?.synced_from === undefined ? '[원본]' : '[사본]')
          : b.type === 'page' ? '[페이지]'
          : b.type === 'database' ? '[DB]'
          : ''
        const text = b.title.map((r) => r.plain_text).join('')
        const kids = b.children?.length ? `(${walk(b.children)})` : ''
        return `${name}${kind}${text ? `:${text}` : ''}${kids}`
      })
      .join(' ')
  return walk(pmToDoc(node).blocks)
}

/** 정규화하고, 스키마 · 문서 계약 · 멱등(두 번 돌려도 같다)을 함께 확인한다. */
function normalized(input: PmNode, pageRefs?: ReadonlySet<string>): NormalizeResult {
  const result = normalizeBody(input, { seed: SEED, pageRefs })
  result.doc.check()
  assert.deepEqual(validateDoc(pmToDoc(result.doc)), [])
  const again = normalizeBody(result.doc, { seed: SEED, pageRefs })
  assert.deepEqual(again.fixes, [], `멱등이 아니다: ${again.fixes.join(', ')}`)
  assert.ok(again.doc.eq(result.doc), '두 번 돌린 결과가 다르다')
  return result
}

const has = (result: NormalizeResult, fix: NormalizeFix): boolean => result.fixes.includes(fix)

describe('정규화 ⑥ — 동기화 블록', () => {
  test('올바른 원본은 그대로다 — 컬럼 · 토글 안의 원본도(01 F-01-12 "컬럼 안에 synced block — 허용")', () => {
    const input = doc(group(
      container(A, original(), group(container(B, para('내용')), container(C, toggle('접기'), group(container(D, para('깊이')))))),
      container(E, para('밖')),
    ))
    const result = normalized(input)
    assert.deepEqual(result.fixes, [])
    assert.ok(result.doc.eq(input))
  })

  test('★ ⓐ 자식 없는 원본 → 빈 문단 하나 · 씨앗 id(같은 입력이면 같은 id)', () => {
    const result = normalized(doc(group(container(A, original()), container(B, para('뒤')))))
    assert.equal(shape(result.doc), 'A[원본](?) B:뒤')
    assert.ok(has(result, 'synced_original_filled'))
    const filled = pmToDoc(result.doc).blocks[0]!.children![0]!
    assert.equal(filled.type, 'paragraph')
    const second = normalizeBody(doc(group(container(A, original()), container(B, para('뒤')))), { seed: SEED })
    assert.equal(pmToDoc(second.doc).blocks[0]!.children![0]!.id, filled.id, '결정론 — 참여자마다 같은 id')
  })

  test('★ ⓑ 자식을 가진 사본 → 자식을 사본 바로 뒤 형제로', () => {
    const result = normalized(doc(group(container(A, copy(F), group(container(B, para('b')), container(C, para('c')))), container(D, para('d')))))
    assert.equal(shape(result.doc), 'A[사본] B:b C:c D:d')
    assert.ok(has(result, 'synced_copy_children_lifted'))
  })

  test('★ ⓒ 동기화 블록 안의 원본은 껍데기를 벗기고 사본은 뺀다 — 깊이에 상관없이', () => {
    const input = doc(group(container(A, original(), group(
      container(B, original(), group(container(C, para('안쪽 원본의 글')))),
      container(D, toggle('토글'), group(container(E, copy(F)), container(P, para('토글 안'))))),
    )))
    const result = normalized(input)
    assert.equal(shape(result.doc), 'A[원본](C:안쪽 원본의 글 D:토글(P:토글 안))')
    assert.ok(has(result, 'synced_nested_unwrapped'))
  })

  test('★ ⓓ 동기화 블록 안의 하위 페이지 · 인라인 데이터베이스 → 가장 바깥 동기화 블록 바로 뒤로', () => {
    const input = doc(group(
      container(A, original(), group(
        container(B, para('b')),
        container(C, toggle('토글'), group(container(P, pageRef()))),
        container(Q, databaseRef()),
      )),
      container(D, para('d')),
    ))
    const result = normalized(input, new Set([P, Q]))
    assert.equal(shape(result.doc), 'A[원본](B:b C:토글) P[페이지] Q[DB] D:d')
    assert.ok(has(result, 'synced_ref_lifted'))
  })

  test('ⓓ 둘 수 없는 참조(받은 집합 밖)는 올리지 않고 뺀다 — 참조의 보통 규칙', () => {
    const result = normalized(doc(group(container(A, original(), group(container(B, para('b')), container(P, pageRef()))))), new Set())
    assert.equal(shape(result.doc), 'A[원본](B:b)')
    assert.ok(has(result, 'page_ref_dropped'))
  })

  test('★ ⓔ 모양이 틀린 synced_from 의 사본은 뺀다 — uuid 가 아님 · 수 · 자기 id', () => {
    for (const bad of ['not-a-uuid', 42, A]) {
      const result = normalized(doc(group(container(A, copy(bad)), container(B, para('b')))))
      assert.equal(shape(result.doc), 'B:b', `synced_from=${JSON.stringify(bad)}`)
      assert.ok(has(result, 'synced_copy_dropped'))
    }
  })

  test('ⓔ 대문자 uuid 는 빼지 않고 소문자로 고친다(CHECK 은 소문자만 받는다) · null 은 원본이다(키가 없는 것)', () => {
    const upper = normalized(doc(group(container(A, copy(F.toUpperCase())))))
    assert.equal(pmToDoc(upper.doc).blocks[0]!.properties?.synced_from, F)
    const nulled = normalized(doc(group(container(A, copy(null), group(container(B, para('b')))))))
    assert.equal(shape(nulled.doc), 'A[원본](B:b)')
    assert.deepEqual(pmToDoc(nulled.doc).blocks[0]!.properties, {})
  })

  test('원본의 다른 키는 지우고(속성은 빈 객체) · 다른 타입의 synced_from 은 지운다(행이 CHECK 에 걸려 투영이 멈추지 않게)', () => {
    const odd = S.nodes[SYNCED_BLOCK_TYPE]!.create({ props: { stray: 1 }, format: {} })
    const para2 = S.nodes.paragraph.create({ props: { synced_from: F }, format: {} }, [S.text('p')])
    const result = normalized(doc(group(container(A, odd, group(container(B, para2))))))
    const [top] = pmToDoc(result.doc).blocks
    assert.deepEqual(top!.properties, {})
    assert.deepEqual(top!.children![0]!.properties ?? {}, {})
    assert.ok(has(result, 'invalid_props_dropped'))
  })

  test('★ 여러 규칙이 한꺼번에 — 두 번 돌려도 같다', () => {
    const input = doc(group(
      container(A, original(), group(
        container(B, copy(F), group(container(C, para('사본의 자식')))),
        container(D, original()),
        container(P, pageRef()),
      )),
      container(E, copy('bad')),
      container(Q, copy(F), group(container(F, para('f')))),
    ))
    const result = normalized(input, new Set([P]))
    assert.equal(shape(result.doc), 'A[원본](C:사본의 자식) P[페이지] Q[사본] F:f')
  })

  test('반사실 줄 — 레지스트리의 excludedDescendantTypes 가 규칙의 근거다', () => {
    // 이 칸이 비면 ⓒⓓ 가 고치지 않는다(SB-1 반사실 — 칸을 끄면 위 ⓒ · ⓓ 가 떨어진다)
    assert.deepEqual([...(specOf(SYNCED_BLOCK_TYPE).excludedDescendantTypes ?? [])].sort(), ['database', 'page', 'synced_block'])
  })
})
