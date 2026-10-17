/**
 * 지원 브라우저 — 기능 감지 (플랫폼 잔여 10i-1 · F-12-15 · 정본 §3.10 끝 [보강] 지원 브라우저)
 *
 *   ① 표 — 다섯 · 키가 서로 다르다 · 까닭이 있다
 *   ② ★ 스크립트를 가짜 창에서 돌린다 — 다 있으면 아무것도 붙이지 않는다 · 하나라도 없으면 안내 띠(무엇이 없는지 · role=alert) · 던지는 식은
 *      없는 것으로 · 몸이 서기 전이면 DOMContentLoaded 에 · 두 번 세우지 않는다
 *   ③ ES5 — 화살표 · const · let · 템플릿 글이 없다 · `</script>` 로 끊기지 않는다
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { SUPPORT_CHECKS, UNSUPPORTED_MESSAGE, UNSUPPORTED_NOTICE_ID, supportCheckScript } from './browser-support.ts'

type FakeElement = { id: string; attrs: Record<string, string>; textContent: string; style: { cssText: string }; setAttribute(n: string, v: string): void }

/** 가짜 창 — 있는 기능을 고르고, 몸이 섰는지 고른다. 붙인 것 · 기다리는 것을 돌려준다. */
function run(options: { readonly without?: readonly string[]; readonly bodyReady?: boolean; readonly throwing?: string } = {}) {
  const appended: FakeElement[] = []
  const listeners: Record<string, () => void> = {}
  const without = new Set(options.without ?? [])
  const body = { appendChild: (el: FakeElement) => appended.push(el) }
  const document = {
    body: options.bodyReady === false ? null : body,
    getElementById: (id: string) => appended.find((el) => el.id === id) ?? null,
    createElement: (): FakeElement => ({
      id: '', attrs: {}, textContent: '', style: { cssText: '' },
      setAttribute(n: string, v: string) { this.attrs[n] = v },
    }),
    addEventListener: (type: string, fn: () => void) => { listeners[type] = fn },
  }
  const ArrayCtor = function () {} as unknown as { prototype: Record<string, unknown> }
  ArrayCtor.prototype = without.has('array-at') ? {} : { at() {} }
  const ObjectCtor = without.has('object-hasown') ? {} : { hasOwn() {} }
  const CSS = {
    supports: (a: string, b?: string) => {
      if (options.throwing === 'css') throw new Error('boom')
      const value = `${a} ${b ?? ''}`
      if (value.includes('color-mix')) return !without.has('css-color-mix')
      if (value.includes(':where')) return !without.has('css-where')
      return false
    },
  }
  const context: Record<string, unknown> = { document, Array: ArrayCtor, Object: ObjectCtor, CSS }
  if (!without.has('structuredClone')) context.structuredClone = () => null
  vm.runInNewContext(supportCheckScript(), context)
  return { appended, listeners, document }
}

test('① 표 — 다섯 · 키가 서로 다르다 · 까닭이 있다', () => {
  assert.equal(SUPPORT_CHECKS.length, 5)
  assert.equal(new Set(SUPPORT_CHECKS.map((c) => c.key)).size, SUPPORT_CHECKS.length)
  for (const c of SUPPORT_CHECKS) assert.ok(c.why.length > 0 && c.test.length > 0, c.key)
})

test('② ★ 다 있으면 아무것도 붙이지 않는다 · 하나라도 없으면 안내 띠', () => {
  assert.deepEqual(run().appended, [], '다 있다')
  for (const { key } of SUPPORT_CHECKS) {
    const { appended } = run({ without: [key] })
    assert.equal(appended.length, 1, key)
    assert.equal(appended[0].id, UNSUPPORTED_NOTICE_ID)
    assert.equal(appended[0].attrs.role, 'alert')
    assert.equal(appended[0].attrs['data-missing'], key)
    assert.equal(appended[0].textContent, UNSUPPORTED_MESSAGE)
  }
  assert.equal(run({ without: ['structuredClone', 'css-where'] }).appended[0].attrs['data-missing'], 'structuredClone,css-where', '없는 것을 모두')
})

test('② 던지는 식은 없는 것으로 · 몸이 서기 전이면 DOMContentLoaded 에 · 두 번 세우지 않는다', () => {
  assert.equal(run({ throwing: 'css' }).appended[0].attrs['data-missing'], 'css-color-mix,css-where')
  const early = run({ without: ['array-at'], bodyReady: false })
  assert.equal(early.appended.length, 0, '아직 몸이 없다')
  assert.equal(typeof early.listeners.DOMContentLoaded, 'function')
  ;(early.document as { body: unknown }).body = { appendChild: (el: FakeElement) => early.appended.push(el) }
  early.listeners.DOMContentLoaded()
  early.listeners.DOMContentLoaded()
  assert.equal(early.appended.length, 1, '몸이 서면 한 번')
})

test('③ ES5 — 화살표 · const · let · 템플릿 글이 없다 · </script> 로 끊기지 않는다', () => {
  const script = supportCheckScript()
  assert.ok(!/=>/.test(script), '화살표')
  assert.ok(!/\b(const|let)\s/.test(script), 'const · let')
  assert.ok(!script.includes('`'), '템플릿 글')
  assert.ok(!script.toLowerCase().includes('</script'), '</script>')
  assert.doesNotThrow(() => new vm.Script(script), '문법')
})
