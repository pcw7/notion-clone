/**
 * 본문 글자에 건 앱 링크를 ZIP 안의 상대 경로로 — §7 정리 10n-66 (F-09-14)
 *
 *   ① ★ 앱 주소 → 노드 id — `/w/{ws}/{id}` · `/w/{ws}/db/{id}` · 절대 주소 · 쿼리 · 해시 · 32자리 hex · 제목-hex · 대문자
 *   ② 앱의 다른 주소 · 바깥 링크 · 망가진 주소는 null
 *   ③ ★ 상대 경로 — 같은 폴더 · 아래 · 위 · 건너편 · 루트 · `%#?` 인코딩
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { internalTargetOf, relativeHref } from './internal-links.ts'

const WS = '0f3a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const ID = '1429989f-e8ac-4eff-bc8f-57f56486db54'
const HEX = '1429989fe8ac4effbc8f57f56486db54'

describe('본문 글자의 앱 링크 (10n-66)', () => {
  test('★ ① 앱 주소 → 노드 id', () => {
    for (const url of [
      `/w/${WS}/${ID}`,
      `/w/${WS}/${ID}/`,
      `/w/${WS}/${ID}#0190a3f1-1111-7000-8000-000000000001`,
      `/w/${WS}/${ID}?p=1`,
      `https://notion.example.com/w/${WS}/${ID}`,
      `/w/${WS}/db/${ID}?v=0190a3f1-1111-7000-8000-000000000002`,
      `/w/${WS}/${HEX}`,
      `/w/${WS}/${encodeURIComponent('회의록')}-${HEX}`,
      `/w/${WS}/${ID.toUpperCase()}`,
    ]) {
      assert.equal(internalTargetOf(url), ID, url)
    }
  })

  test('② 앱의 다른 주소 · 바깥 링크 · 망가진 주소는 null', () => {
    for (const url of [
      `/w/${WS}`,
      `/w/${WS}/settings`,
      `/w/${WS}/teamspaces/${ID}`,
      `/w/${WS}/db/${ID}/templates/${ID}`,
      `/p/${HEX}`,
      'https://example.com/',
      'mailto:a@example.com',
      `/w/${WS}/%E0%A4%A`,
      'http://[::1',
    ]) {
      assert.equal(internalTargetOf(url), null, url)
    }
  })

  test('★ ③ 상대 경로 — 같은 폴더 · 아래 · 위 · 건너편 · 루트 · 인코딩', () => {
    assert.equal(relativeHref('', '가.md'), '가.md')
    assert.equal(relativeHref('', '가/나.md'), '가/나.md')
    assert.equal(relativeHref('가', '가/나.md'), '나.md')
    assert.equal(relativeHref('가/나', '가.md'), '../../가.md', '가/나 폴더의 파일에서 루트로 — 두 단계')
    assert.equal(relativeHref('가/나', '다/라.md'), '../../다/라.md')
    assert.equal(relativeHref('가/나', '가/다/라.md'), '../다/라.md')
    assert.equal(relativeHref('가', '가.md'), '../가.md', '폴더 이름과 파일 이름이 같아도 — 파일은 폴더 옆이다')
    assert.equal(relativeHref('', '50% 할인#1?.md'), '50%25 할인%231%3F.md')
  })
})
