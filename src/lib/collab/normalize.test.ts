/**
 * 본문 트리 정규화 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **올바른 문서는 그대로다** — 고친 것 0개, 입력과 `eq`
 *   ② **규칙마다 스키마에 맞는 문서가 나오고, 잃지 않아야 할 것은 남는다**
 *   ③ **결정론 · 멱등** — 두 번 돌려도 같은 결과, 결과를 다시 넣으면 고칠 것이 없다
 *
 * 입력은 ProseMirror 의 **검사하지 않는** `create` 로 만든다 — `ydoc.ts` 가 Y.Doc 을 읽을 때 쓰는 것과
 * 같아서, 동시 편집이 Y.Doc 에 남긴 모양을 그대로 흉내 낼 수 있다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'

import { MAX_TREE_DEPTH } from '../block/types.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema as S } from '../editor/schema.ts'
import { isUuid } from '../ids.ts'
import { derivedBlockId, normalizeBody, type NormalizeFix, type NormalizeResult } from './normalize.ts'

const SEED = randomUUID()
const [A, B, C, D] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const NAMES = new Map([[A, 'A'], [B, 'B'], [C, 'C'], [D, 'D']])

const attrs = { props: {}, format: {} }
const para = (text = '') => S.nodes.paragraph.create(attrs, text === '' ? [] : [S.text(text)])
const heading = (text: string) => S.nodes.heading_1.create(attrs, [S.text(text)])
const container = (id: string, ...children: PmNode[]) => S.nodes.blockContainer.create({ blockId: id }, children)
const group = (...children: PmNode[]) => S.nodes.blockGroup.create(null, children)
const doc = (...children: PmNode[]) => S.nodes.doc.create(null, children)

/** `A(B,C) D` 꼴. 이름을 모르는 id 는 `?`, 내용은 `:글자` 로 붙인다. */
function shape(node: PmNode): string {
  const blocks = pmToDoc(node).blocks
  const walk = (list: readonly EditorBlock[]): string =>
    list
      .map((b) => {
        const name = NAMES.get(b.id) ?? '?'
        const text = b.title.map((r) => r.plain_text).join('')
        const kids = b.children?.length ? `(${walk(b.children)})` : ''
        return `${name}${text ? `:${text}` : ''}${kids}`
      })
      .join(' ')
  return walk(blocks)
}

/** 정규화하고, 스키마 · 문서 계약 · 멱등을 함께 확인한다. */
function normalized(input: PmNode, seed = SEED): NormalizeResult {
  const result = normalizeBody(input, { seed })
  result.doc.check()
  assert.deepEqual(validateDoc(pmToDoc(result.doc)), [])
  const again = normalizeBody(result.doc, { seed })
  assert.deepEqual(again.fixes, [], `멱등이 아니다: ${again.fixes.join(', ')}`)
  assert.ok(again.doc.eq(result.doc))
  return result
}

const has = (result: NormalizeResult, fix: NormalizeFix): boolean => result.fixes.includes(fix)

describe('① 올바른 문서', () => {
  test('고칠 것이 없으면 입력과 같다', () => {
    const input = doc(group(container(A, para('a'), group(container(B, para('b')))), container(C, heading('c'))))
    const result = normalized(input)
    assert.deepEqual(result.fixes, [])
    assert.ok(result.doc.eq(input))
  })
})

describe('② 규칙', () => {
  test('★ 내용 노드가 둘이면 첫째만 남는다 — 타입은 병합할 수 없다', () => {
    const result = normalized(doc(group(container(A, heading('제목'), para('문단')))))
    assert.equal(shape(result.doc), 'A:제목')
    assert.ok(has(result, 'type_conflict_resolved'))
  })

  test('★ 빈 그룹은 떼어진다', () => {
    const result = normalized(doc(group(container(A, para('a'), group()))))
    assert.equal(shape(result.doc), 'A:a')
    assert.ok(has(result, 'empty_group_removed'))
  })

  test('★ 한 컨테이너의 그룹 둘은 순서대로 합쳐진다', () => {
    const result = normalized(doc(group(container(A, para('a'), group(container(B, para('b'))), group(container(C, para('c')))))))
    assert.equal(shape(result.doc), 'A:a(B:b C:c)')
    assert.ok(has(result, 'groups_merged'))
  })

  test('★ 자식을 못 갖는 타입의 자식은 뒤 형제로 올라온다 — 잃지 않는다', () => {
    const divider = S.nodes.divider.create(attrs)
    const pageRef = S.nodes.page_ref.create({ ...attrs, title: '하위' })
    const result = normalized(
      doc(group(
        container(A, heading('h'), group(container(B, para('b')))),
        container(C, divider, group(container(D, para('d')))),
      )),
    )
    assert.equal(shape(result.doc), 'A:h B:b C D:d')
    assert.ok(has(result, 'children_lifted'))

    const underRef = normalized(doc(group(container(A, pageRef, group(container(B, para('b')))))))
    assert.equal(shape(underRef.doc), 'A B:b', '하위 페이지 참조 밑은 그 페이지의 문서다')
  })

  test('내용 노드가 없는 컨테이너는 자식을 그 자리로 올린다', () => {
    const result = normalized(doc(group(container(A, para('a')), container(B, group(container(C, para('c')))), container(D, para('d')))))
    assert.equal(shape(result.doc), 'A:a C:c D:d')
    assert.ok(has(result, 'empty_container_lifted'))
  })

  test('★ 같은 id 가 두 번 나오면 문서 순서의 첫째가 갖고 나머지는 결정론적 새 id', () => {
    const input = doc(group(container(A, para('1')), container(B, para('b'), group(container(A, para('2'))))))
    const first = normalized(input)
    const blocks = pmToDoc(first.doc).blocks
    assert.equal(blocks[0].id, A)
    const renamed = blocks[1].children?.[0]?.id ?? ''
    assert.ok(isUuid(renamed) && renamed !== A, renamed)
    assert.ok(has(first, 'duplicate_id'))

    assert.equal(pmToDoc(normalized(input).doc).blocks[1].children?.[0]?.id, renamed, '다시 읽어도 같은 id')
    assert.notEqual(pmToDoc(normalized(input, randomUUID()).doc).blocks[1].children?.[0]?.id, renamed, '페이지가 다르면 다른 id')
  })

  test('★ 빈 id 는 위치와 페이지로 정한 새 id — 읽을 때마다 같다', () => {
    const input = doc(group(container(A, para('a')), container('', para('빈'))))
    const once = pmToDoc(normalized(input).doc).blocks[1].id
    assert.ok(isUuid(once))
    assert.equal(pmToDoc(normalized(input).doc).blocks[1].id, once)
    assert.notEqual(pmToDoc(normalized(input, randomUUID()).doc).blocks[1].id, once)
  })

  test('루트 — 그룹이 없으면 빈 문단 하나, 둘이면 합친다', () => {
    const empty = normalized(doc())
    assert.ok(has(empty, 'root_group_missing') && has(empty, 'empty_root_filled'))
    assert.deepEqual(pmToDoc(empty.doc).blocks, [], '빈 문단 하나는 빈 문서로 읽힌다')
    assert.equal(pmToDoc(normalized(doc()).doc).blocks.length, 0)
    assert.ok(normalized(doc()).doc.eq(empty.doc), '채운 문단의 id 도 결정론적이다')

    const twice = normalized(doc(group(container(A, para('a'))), group(container(B, para('b')))))
    assert.equal(shape(twice.doc), 'A:a B:b')
    assert.ok(has(twice, 'groups_merged'))
  })

  test('그룹 안의 그룹은 펴고, 떠도는 내용 노드는 감싸고, 떠도는 글자는 버린다', () => {
    const result = normalized(doc(group(group(container(A, para('a'))), para('떠돔'))))
    const blocks = pmToDoc(result.doc).blocks
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0].id, A)
    assert.equal(blocks[1].title[0]?.plain_text, '떠돔')
    assert.ok(has(result, 'nested_group_flattened') && has(result, 'content_wrapped'))

    const stray = normalized(doc(group(container(A, para('a')), S.text('글자'))))
    assert.equal(shape(stray.doc), 'A:a')
    assert.ok(has(stray, 'stray_dropped'))
  })

  test('텍스트 블록 안의 블록 노드 · 원자 블록 안의 자식 · 객체가 아닌 attr 은 고친다', () => {
    const badText = S.nodes.paragraph.create(attrs, [S.text('앞'), container(B, para('안'))])
    const badAtom = S.nodes.divider.create(attrs, [S.text('안')])
    const badAttrs = S.nodes.paragraph.create({ props: 'oops', format: [] }, [S.text('c')])
    const result = normalized(doc(group(container(A, badText), container(C, badAtom), container(D, badAttrs))))
    assert.equal(shape(result.doc), 'A:앞 C D:c')
    assert.ok(has(result, 'invalid_content_dropped') && has(result, 'invalid_attrs_reset'))
  })

  test(`★ 깊이 상한(${MAX_TREE_DEPTH})을 넘는 자식은 올라온다 — 블록 수는 그대로다`, () => {
    const count = MAX_TREE_DEPTH + 1
    const ids = Array.from({ length: count }, () => randomUUID())
    let inner = container(ids[count - 1], para(String(count)))
    for (let i = count - 2; i >= 0; i -= 1) inner = container(ids[i], para(String(i + 1)), group(inner))
    const result = normalized(doc(group(inner)))

    let total = 0
    let deepest = 0
    const walk = (list: readonly EditorBlock[], depth: number): void => {
      for (const b of list) {
        total += 1
        deepest = Math.max(deepest, depth)
        walk(b.children ?? [], depth + 1)
      }
    }
    walk(pmToDoc(result.doc).blocks, 1)
    assert.equal(total, count)
    assert.equal(deepest, MAX_TREE_DEPTH)
    assert.ok(has(result, 'children_lifted'))
  })
})

describe('③ 결정론적 id', () => {
  test('같은 씨앗이면 같은 uuid 모양, 다르면 다르다', () => {
    const id = derivedBlockId('page|blank:r.0')
    assert.ok(isUuid(id), id)
    assert.equal(derivedBlockId('page|blank:r.0'), id)
    const many = new Set(Array.from({ length: 5000 }, (_, i) => derivedBlockId(`seed-${i}`)))
    assert.equal(many.size, 5000)
  })
})
