/**
 * 파일과 미디어 속성 — 값 검사 · 칩 도우미 · 글 모양 (순수) — PT-4조각 (F-03-04)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { publicCell } from '../../app/p/public-cells.ts'
import { cellText, defaultColumnWidth, draftOf, parseDraft, readCell } from './cell-format.ts'
import { fileContentHref, fileDisplayName, isImageName } from './file-chip.ts'
import { deriveSidecars, emptyValue, fileIdsOf, isEmptyValue, validateCellValue, MAX_FILES_PER_CELL, type CellValue } from './property-types.ts'
import { cellPlainText } from '../export/csv.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const files = (...refs: [string, string][]): CellValue => ({ type: 'files', files: refs.map(([id, name]) => ({ id, name })) })

test('값 검사 — {id, name} 배열 · 중복 · 20개 · 이름 길이 · 모양', () => {
  assert.deepEqual(validateCellValue('files', files([A, 'a.png'], [B, 'b.pdf'])), [])
  assert.deepEqual(validateCellValue('files', files()), [], '빈 목록은 비운 칸')
  assert.equal(validateCellValue('files', files([A, 'a'], [A.toUpperCase(), 'b'])).length, 1, '같은 파일(대소문자 달라도)')
  assert.equal(validateCellValue('files', files([A, ''])).length, 1, '빈 이름')
  assert.equal(validateCellValue('files', files([A, 'n'.repeat(255)])).length, 0, '255자')
  assert.equal(validateCellValue('files', files([A, 'n'.repeat(256)])).length, 1, '256자')
  assert.equal(validateCellValue('files', files(['abc', 'x'])).length, 1, 'uuid 가 아니다')
  assert.equal(validateCellValue('files', { type: 'files', files: 'x' }).length, 1)
  assert.equal(validateCellValue('files', { type: 'files', files: [{ id: A }] }).length, 1, '이름이 없다')
  assert.equal(validateCellValue('files', { type: 'multi_select', multi_select: [] }).length, 1, '봉투 타입이 다르다')

  const many = Array.from({ length: MAX_FILES_PER_CELL + 1 }, (_, i): [string, string] => [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `f${i}`])
  assert.equal(validateCellValue('files', files(...many.slice(0, MAX_FILES_PER_CELL))).length, 0, '20개')
  assert.equal(validateCellValue('files', files(...many)).length, 1, '21개')
})

test('빈 값 · 사이드카 · 파일 id', () => {
  assert.deepEqual(emptyValue('files'), { type: 'files', files: [] })
  assert.equal(isEmptyValue(files()), true)
  assert.equal(isEmptyValue(files([A, 'a'])), false)
  assert.deepEqual(deriveSidecars(files()).text, null)
  assert.equal(deriveSidecars(files([A, 'a'], [B, 'b'])).text, `${A} ${B}`)
  assert.deepEqual(fileIdsOf(files([A, 'a'], [B, 'b'])), [A, B])
  assert.deepEqual(fileIdsOf({ type: 'url', url: 'x' }), [])
})

test('글 모양 — 이름을 쉼표로 · 입력칸으로 고치지 않는다 · 잘못된 캐시는 빈 값', () => {
  assert.equal(cellText(files([A, '가.png'], [B, '나.pdf'])), '가.png, 나.pdf')
  assert.equal(draftOf(files([A, 'a'])), '')
  assert.equal(parseDraft('files', 'x', files()).ok, false)
  assert.deepEqual(readCell('files', { type: 'files', files: 5 }), { type: 'files', files: [] })
  assert.equal(defaultColumnWidth('files'), 200, '칩이 여럿 서는 폭')
  assert.equal(cellPlainText({ type: 'files' } as never, files([A, '가.png'], [B, '나.pdf'])), '가.png, 나.pdf', 'CSV')
})

test('칩 도우미 — 그림 이름 · 주소 · 보일 이름', () => {
  for (const name of ['a.png', 'A.JPG', 'b.jpeg', 'c.gif', 'd.webp']) assert.equal(isImageName(name), true, name)
  for (const name of ['a.pdf', 'png', 'a.png.txt', 'a.svg', '']) assert.equal(isImageName(name), false, name)
  assert.equal(fileContentHref('w1', 'f1'), '/api/workspaces/w1/files/f1/content')
  assert.equal(fileDisplayName('  보고서.pdf '), '보고서.pdf')
  assert.equal(fileDisplayName(null), '파일')
  assert.equal(fileDisplayName('x'.repeat(400)).length, 255)
})

test('공개 칸 — 이름만(링크 없이) · 파일 id 는 싣지 않는다', () => {
  const column = { id: 'p', name: '첨부', type: 'files', options: [], prefix: null } as const
  assert.deepEqual(publicCell(column, { type: 'files', files: [{ name: '가.png' }, { name: '나.pdf' }] }, null), { kind: 'files', names: ['가.png', '나.pdf'] })
  assert.deepEqual(publicCell(column, { type: 'files', files: [] }, null), { kind: 'empty' })
  assert.deepEqual(publicCell(column, undefined, null), { kind: 'empty' })
})
