/**
 * 익스포트 HTTP 경계 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **빈 `root` 는 워크스페이스 전체가 아니다** — 화면이 id 를 빠뜨려도 전부를 내보내지 않는다
 *   ② **파일 이름 헤더** — 한글 · 괄호 · 따옴표 제목이 그대로 돌아오고, 값에 헤더 문법 밖의 글자가 없다
 *   ③ **스트림** — 순서대로 · 당겨 쓴다 · 던지면 오류로 끝난다(닫힘으로 바꾸지 않는다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  FALLBACK_ZIP_NAME,
  contentDisposition,
  exportRejectionStatus,
  exportScopeOf,
  toReadableStream,
} from './http.ts'

describe('① 범위', () => {
  test('root 가 없으면 워크스페이스, 있으면 그 노드', () => {
    assert.deepEqual(exportScopeOf(new URL('http://x/export')), { kind: 'workspace' })
    assert.deepEqual(exportScopeOf(new URL('http://x/export?root=abc')), { kind: 'page', rootId: 'abc' })
  })

  test('★ 빈 root 는 워크스페이스 전체가 아니다', () => {
    assert.deepEqual(exportScopeOf(new URL('http://x/export?root=')), { kind: 'page', rootId: '' })
  })

  test('거부 코드 → 상태', () => {
    assert.deepEqual(
      (['not_found', 'forbidden', 'too_large'] as const).map((reason) => exportRejectionStatus(reason)),
      [404, 403, 422],
    )
  })
})

describe('② Content-Disposition', () => {
  /** RFC 5987 attr-char. ext-value 에서 %XX 를 떼고 남는 글자는 모두 이것이어야 한다. */
  const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/

  const extValueOf = (header: string): string => {
    const match = /filename\*=UTF-8''(.*)$/.exec(header)
    assert.ok(match !== null, header)
    return match[1]
  }

  test("★ 한글 · 괄호 · 작은따옴표 · 별표 제목이 filename* 로 그대로 돌아온다 — 값에는 attr-char 와 %XX 만 있다", () => {
    for (const name of ["회의록 (최종)'s * 메모.zip", '할 일 #1 100%.zip', 'plain.zip']) {
      const value = extValueOf(contentDisposition(name))
      assert.equal(decodeURIComponent(value), name)
      for (const ch of value.replace(/%[0-9A-F]{2}/g, '')) {
        assert.ok(ATTR_CHAR.test(ch), `${name} → ${value} 에 attr-char 가 아닌 글자 ${ch}`)
      }
    }
  })

  test('filename 에는 ASCII 이름만 그대로, 아니면 대체 이름', () => {
    assert.ok(contentDisposition('plain.zip').startsWith('attachment; filename="plain.zip"; '))
    assert.ok(contentDisposition('회의록.zip').startsWith(`attachment; filename="${FALLBACK_ZIP_NAME}"; `))
    // 따옴표 · 역슬래시는 quoted-string 을 깬다.
    assert.ok(contentDisposition('a"b.zip').startsWith(`attachment; filename="${FALLBACK_ZIP_NAME}"; `))
    assert.ok(contentDisposition('a\\b.zip').startsWith(`attachment; filename="${FALLBACK_ZIP_NAME}"; `))
  })
})

describe('③ 스트림', () => {
  const encoder = new TextEncoder()

  async function* parts(
    texts: readonly string[],
    progress: { yielded: number } = { yielded: 0 },
    failAt = -1,
  ): AsyncGenerator<Uint8Array, void, undefined> {
    for (let i = 0; i < texts.length; i += 1) {
      if (i === failAt) throw new Error('저장소가 죽었다')
      progress.yielded += 1
      yield encoder.encode(texts[i])
    }
  }

  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out
      out += decoder.decode(value, { stream: true })
    }
  }

  test('조각을 순서대로 이어 붙이고 닫힌다', async () => {
    assert.equal(await drain(toReadableStream(parts(['가', '나', '다']))), '가나다')
  })

  test('★ 당겨 쓴다 — 읽은 만큼만(그리고 한 조각 앞까지만) 제너레이터가 나아간다', async () => {
    const progress = { yielded: 0 }
    const reader = toReadableStream(parts(Array.from({ length: 50 }, (_, i) => String(i)), progress)).getReader()
    await reader.read()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(progress.yielded <= 2, `한 조각을 읽었는데 제너레이터가 ${progress.yielded}조각 나아갔다`)
    await reader.cancel()
  })

  test('★ 제너레이터가 던지면 스트림이 오류로 끝난다 — 닫힘으로 바꾸지 않는다', async () => {
    await assert.rejects(drain(toReadableStream(parts(['가', '나', '다'], { yielded: 0 }, 2))), /저장소가 죽었다/)
  })
})
