/**
 * 코드 블록의 값 — 잔여 묶음 8a-1 (F-01-14 · DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { codeLanguageOf, fenceInfo, fencedCode, markdownFence, validateCodeProperties } from './code.ts'

test('★ 언어 — 고르지 않았거나 plain text 면 null · 목록 밖의 값도 그대로 보존한다', () => {
  assert.equal(codeLanguageOf(undefined), null)
  assert.equal(codeLanguageOf({}), null)
  assert.equal(codeLanguageOf({ language: '' }), null)
  assert.equal(codeLanguageOf({ language: 'Plain Text' }), null)
  assert.equal(codeLanguageOf({ language: 42 }), null)
  assert.equal(codeLanguageOf({ language: 'typescript' }), 'typescript')
  assert.equal(codeLanguageOf({ language: 'my weird lang' }), 'my weird lang', '목록 밖의 값을 버렸다')
})

test('★ 울타리는 코드 안의 가장 긴 백틱 줄보다 길다 — 셋 이상', () => {
  assert.equal(markdownFence('print(1)'), '```')
  assert.equal(markdownFence('a `b` c'), '```')
  assert.equal(markdownFence('```\nx\n```'), '````', '코드 안의 ``` 에서 울타리가 닫힌다')
  assert.equal(markdownFence('`````'), '``````')
})

test('정보 문자열은 울타리를 깨지 않는다 — 백틱을 빼고 공백은 잇는다', () => {
  assert.equal(fenceInfo(null), '')
  assert.equal(fenceInfo('python'), 'python')
  assert.equal(fenceInfo('my weird lang'), 'my-weird-lang')
  assert.equal(fenceInfo('a`b'), 'ab')
})

test('울타리로 감싼 줄들 — 줄마다 들여 쓴다', () => {
  assert.deepEqual(fencedCode('a\nb', 'ts'), ['```ts', 'a', 'b', '```'])
  assert.deepEqual(fencedCode('x', null, '  '), ['  ```', '  x', '  ```'])
})

test('properties 검사 — 언어는 64자까지의 문자열 · 캡션은 배열', () => {
  assert.deepEqual(validateCodeProperties({ language: 'rust', caption: [] }, 'p'), [])
  assert.deepEqual(validateCodeProperties(undefined, 'p'), [])
  assert.deepEqual(validateCodeProperties({ language: 1 }, 'p').map((i) => i.path), ['p.language'])
  assert.deepEqual(validateCodeProperties({ language: 'x'.repeat(65) }, 'p').map((i) => i.path), ['p.language'])
  assert.deepEqual(validateCodeProperties({ caption: 'c' }, 'p').map((i) => i.path), ['p.caption'])
})
