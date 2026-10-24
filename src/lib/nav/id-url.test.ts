/**
 * 주소의 id 정규화 — §7 정리 10n-58 (F-07-17)
 *
 *   ① ★ 32자리 hex · `제목-32자리 hex` · 대문자 → 하이픈 있는 uuid(소문자)
 *   ② 하이픈 있는 uuid · 정적 조각 · 모양이 틀린 hex(31 · 33자리 · hex 아닌 글자)는 그대로(null)
 *   ③ ★ `/w/` 주소는 조각마다 · 바꿀 것이 없거나 `/w/` 밖이면 null — 옮기지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { canonicalIdSegment, canonicalWorkspacePath } from './id-url.ts'

const ID = '1429989f-e8ac-4eff-bc8f-57f56486db54'
const HEX = '1429989fe8ac4effbc8f57f56486db54'
const WS = '0f3a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const WS_HEX = '0f3a1c2e5b6d4e7f8a9b0c1d2e3f4a5b'

describe('주소의 id 정규화 (10n-58)', () => {
  test('★ ① 32자리 hex · 제목-hex · 대문자 → 하이픈 있는 uuid', () => {
    assert.equal(canonicalIdSegment(HEX), ID)
    assert.equal(canonicalIdSegment(HEX.toUpperCase()), ID)
    assert.equal(canonicalIdSegment(`Meeting-notes-${HEX}`), ID)
    assert.equal(canonicalIdSegment(`${encodeURIComponent('회의록')}-${HEX}`), ID)
    assert.equal(canonicalIdSegment(`-${HEX}`), ID)
  })

  test('② 정본 · 정적 조각 · 모양이 틀린 hex 는 그대로', () => {
    for (const segment of [ID, ID.toUpperCase(), 'db', 'settings', '', HEX.slice(1), `${HEX}0`, `${HEX.slice(1)}g`, `x${HEX}`, `${HEX}-notes`]) {
      assert.equal(canonicalIdSegment(segment), null, segment)
    }
  })

  test('★ ③ /w/ 주소는 조각마다 — 바꿀 것이 없거나 /w/ 밖이면 null', () => {
    assert.equal(canonicalWorkspacePath(`/w/${WS}/${HEX}`), `/w/${WS}/${ID}`)
    assert.equal(canonicalWorkspacePath(`/w/${WS_HEX}/db/${HEX}`), `/w/${WS}/db/${ID}`)
    assert.equal(canonicalWorkspacePath(`/w/${WS_HEX}`), `/w/${WS}`)
    assert.equal(canonicalWorkspacePath(`/w/${WS}/notes-${HEX}/`), `/w/${WS}/${ID}/`)
    assert.equal(canonicalWorkspacePath(`/w/${WS}/${ID}`), null)
    assert.equal(canonicalWorkspacePath(`/w/${WS}/settings`), null)
    assert.equal(canonicalWorkspacePath(`/p/${HEX}`), null, '/w/ 밖(공개 주소의 토큰)은 건드리지 않는다')
    assert.equal(canonicalWorkspacePath(`/api/workspaces/${WS}/pages/${HEX}`), null)
  })
})
