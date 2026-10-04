/**
 * 가져오기의 문구 — 잔여 묶음 8m-1 (DOM · DB 없음)
 *
 *   ① 거부 코드마다 다른 말 · 파일 이름 · 상한을 싣는다 · 모르는 코드는 일반 문구
 *   ② 옮기지 못한 것의 요약 — 있는 것만 · 없으면 빈 문자열
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { importFailureMessage, importedNotice, lossesSummary } from './import-messages.ts'

test('① 거부 코드마다 다른 말 · 파일 이름 · 상한', () => {
  const codes = ['no_files', 'too_many_files', 'unsupported_type', 'too_large', 'invalid_encoding', 'not_found', 'too_deep']
  assert.equal(new Set(codes.map((c) => importFailureMessage(c))).size, codes.length)
  assert.equal(importFailureMessage('oops'), '가져오지 못했습니다.')
  assert.ok(importFailureMessage('too_large', 'big.md', 5 * 1024 * 1024).includes('big.md — '))
  assert.ok(importFailureMessage('too_large', 'big.md', 5 * 1024 * 1024).includes('5 MB'))
  assert.equal(importedNotice(3), '3개 페이지를 가져왔습니다.')
})

test('② 옮기지 못한 것의 요약', () => {
  assert.equal(lossesSummary({ tables: 0, html: 0, images: 0, links: 0, formatting: 0 }), '')
  assert.equal(lossesSummary(null), '')
  assert.equal(lossesSummary({ tables: 2, html: 0, images: 1, links: 0, formatting: 0 }), '옮기지 못한 것: 표(문단으로 남김) 2개 · 이미지 1개')
})
