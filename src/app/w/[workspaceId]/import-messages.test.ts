/**
 * 가져오기의 문구 — 잔여 묶음 8m-1 (DOM · DB 없음)
 *
 *   ① 거부 코드마다 다른 말 · 파일 이름 · 상한을 싣는다 · 모르는 코드는 일반 문구
 *   ② 옮기지 못한 것의 요약 — 있는 것만 · 없으면 빈 문자열
 *   ③ 건너뛴 항목 — 서버의 이유마다 다른 말(목록은 타입이 강제한다 · 8m-2b 의 이미지 사유 포함)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ImportSkipReason } from '../../../lib/import/import.ts'
import { importFailureMessage, importedNotice, lossesSummary, skipReasonLabel, skippedNotice } from './import-messages.ts'

test('① 거부 코드마다 다른 말 · 파일 이름 · 상한', () => {
  const codes = ['no_files', 'too_many_files', 'unsupported_type', 'too_large', 'invalid_encoding', 'invalid_zip', 'not_found', 'too_deep']
  assert.equal(new Set(codes.map((c) => importFailureMessage(c))).size, codes.length)
  assert.equal(importFailureMessage('oops'), '가져오지 못했습니다.')
  assert.ok(importFailureMessage('too_large', 'big.md', 5 * 1024 * 1024).includes('big.md — '))
  assert.ok(importFailureMessage('too_large', 'big.md', 5 * 1024 * 1024).includes('5 MB'))
  assert.equal(importedNotice(3), '3개 페이지를 가져왔습니다.')
})

test('② 옮기지 못한 것의 요약', () => {
  assert.equal(lossesSummary({ html: 0, images: 0, links: 0, formatting: 0 }), '')
  assert.equal(lossesSummary(null), '')
  assert.equal(lossesSummary({ html: 2, images: 1, links: 0, formatting: 0 }), '옮기지 못한 것: HTML 2개 · 이미지 1개')
  // 표(Phase 2 1d-3)는 이제 옮긴다 — 옛 응답에 남은 키는 말하지 않는다.
  assert.equal(lossesSummary({ tables: 3, html: 0, images: 0, links: 0, formatting: 0 }), '')
})

test('③ 건너뛴 항목(8m-2a · 8m-2b) — 이유마다 다른 말 · 모르는 이유 · 요약', () => {
  // 서버의 이유를 빠짐없이 — 이유가 늘면 이 표가 타입 검사에서 막힌다.
  const every: Record<ImportSkipReason, true> = {
    unsafe_path: true,
    encrypted: true,
    unsupported_compression: true,
    corrupt: true,
    unsupported_type: true,
    duplicate: true,
    invalid_encoding: true,
    image_too_large: true,
    unreferenced: true,
  }
  const reasons = Object.keys(every)
  assert.equal(new Set(reasons.map(skipReasonLabel)).size, reasons.length)
  assert.ok(reasons.every((r) => skipReasonLabel(r) !== '건너뜀'), '이유마다 제 말이 있다')
  assert.equal(skipReasonLabel('oops'), '건너뜀')
  assert.equal(skippedNotice(0), '')
  assert.equal(skippedNotice(3), '건너뛴 것 3개')
})
