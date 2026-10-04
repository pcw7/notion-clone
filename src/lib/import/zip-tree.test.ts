/**
 * ZIP 의 폴더 → 페이지 나무 — 잔여 묶음 8m-2a (순수)
 *
 *   ① `X.md` + 폴더 `X` — 폴더 안의 페이지는 X 의 자식 · 깊어도 · 처음 나온 순서
 *   ② md 가 없는 폴더는 폴더만의 페이지(계층이 평평해지지 않는다) · 나중에 그 md 가 오면 그 마디에 붙는다
 *   ③ 이름은 대소문자 · NFC 를 무시하고 맞춘다 · 같은 열쇠의 둘째 파일은 적는다 · 페이지가 아닌 파일은 자산으로 모은다(8m-2b)
 *   ④ 제목 — 노션의 id 접미(32자)를 뗀다 · 우리 겹침 접미(8자)는 떼지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripNotionId, titleFromFileName } from './kinds.ts'
import { buildZipTree, countNodes, type TreeNode } from './zip-tree.ts'

const e = (path: string) => ({ path, bytes: new Uint8Array() })
const shape = (nodes: readonly TreeNode[]): unknown[] =>
  nodes.map((n) => (n.children.length > 0 ? [n.name, n.file?.path ?? null, shape(n.children)] : [n.name, n.file?.path ?? null]))

test('★ ① X.md + 폴더 X — 자식 · 깊이 · 순서', () => {
  const tree = buildZipTree([e('회의록.md'), e('회의록/둘째.md'), e('회의록/첫째.md'), e('회의록/첫째/손자.txt'), e('다른.md')])
  assert.deepEqual(shape(tree.roots), [
    ['회의록', '회의록.md', [['둘째', '회의록/둘째.md'], ['첫째', '회의록/첫째.md', [['손자', '회의록/첫째/손자.txt']]]]],
    ['다른', '다른.md'],
  ])
  assert.equal(countNodes(tree.roots), 5)
})

test('★ ② md 가 없는 폴더는 폴더만의 페이지 · 나중에 온 md 가 그 마디에 붙는다', () => {
  const tree = buildZipTree([e('자료/안.md'), e('나중/자식.md'), e('나중.md')])
  assert.deepEqual(shape(tree.roots), [
    ['자료', null, [['안', '자료/안.md']]],
    ['나중', '나중.md', [['자식', '나중/자식.md']]],
  ])
})

test('③ 대소문자 · NFC 를 무시 · 둘째 파일은 적는다 · 페이지가 아닌 파일은 자산', () => {
  const nfd = '한'.normalize('NFD')
  // 찾는 쪽의 이름이 저장된 쪽과 다르게 쓰였을 때도(대문자 폴더 · 뒤에 온 NFD) 같은 마디다
  const tree = buildZipTree([e('Notes.md'), e('NOTES/child.md'), e('한.md'), e(`${nfd}.txt`), e('그림.png'), e('묶음.zip')])
  assert.deepEqual(shape(tree.roots), [['Notes', 'Notes.md', [['child', 'NOTES/child.md']]], ['한', '한.md']])
  assert.deepEqual(tree.ignored, [{ path: `${nfd}.txt`, reason: 'duplicate' }])
  assert.deepEqual(
    tree.assets.map((a) => a.path),
    ['그림.png', '묶음.zip'],
  )
})

test('④ 제목 — 노션의 id 접미(32자)를 뗀다 · 8자 접미는 떼지 않는다', () => {
  assert.equal(stripNotionId('회의록 0123456789abcdef0123456789ABCDEF'), '회의록')
  assert.equal(stripNotionId('report deadbeef'), 'report deadbeef')
  assert.equal(titleFromFileName('폴더/회의록 0123456789abcdef0123456789abcdef.md'), '회의록')
  assert.equal(titleFromFileName('.md'), '가져온 페이지')
})
