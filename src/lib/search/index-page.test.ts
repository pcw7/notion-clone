/**
 * 색인 텍스트 조립 — W7 (F-07-06)
 *
 * 이 파일이 지키는 것 넷.
 *
 *   ① **문서 순서가 보존된다.** 스니펫이 이 문자열의 위치에서 잘리므로, 순서가
 *      어긋나면 사용자가 본 적 없는 순서의 문장이 결과에 뜬다.
 *   ② **자식 페이지의 제목은 부모 본문에 들어가지 않는다.** 쓰기자가 둘이 되면
 *      자식 이름을 바꿀 때 부모 색인이 낡는다.
 *   ③ **이미지 캡션은 색인된다.** 사용자가 쓴 글이다.
 *   ④ **상한이 실제로 막는다.** 본문 한도(1MB)가 tsvector 한도를 넘는다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildBodyText, MAX_INDEXED_BODY, type IndexableBlock } from './index-page.ts'
import { textRun } from '../contracts/rich-text.ts'

const block = (type: string, text: string): IndexableBlock => ({
  type,
  properties: { title: [textRun(text)] },
})

describe('buildBodyText', () => {
  test('문단을 문서 순서대로 잇는다', () => {
    const out = buildBodyText([
      block('paragraph', '첫 문단'),
      block('heading_1', '제목'),
      block('paragraph', '둘째 문단'),
    ])
    assert.equal(out, '첫 문단\n제목\n둘째 문단')
  })

  test('★ 줄바꿈으로 잇는다 — 공백이면 블록 경계를 넘는 없는 문장이 만들어진다', () => {
    // `ts_headline` 은 이 문자열에서 스니펫을 잘라낸다. 공백으로 이으면
    // "앞 문단 끝 + 뒤 문단 시작"이 한 구문으로 보인다.
    const out = buildBodyText([block('paragraph', '끝'), block('paragraph', '시작')])
    assert.equal(out, '끝\n시작')
  })

  test('★ 자식 페이지의 제목은 들어가지 않는다', () => {
    const out = buildBodyText([
      block('paragraph', '본문'),
      block('page', '자식 페이지 제목'),
      block('paragraph', '더 본문'),
    ])
    assert.equal(out, '본문\n더 본문')
  })

  test('★ 이미지 캡션은 색인된다', () => {
    const out = buildBodyText([
      { type: 'image', properties: { caption: [textRun('고양이 사진')] } },
    ])
    assert.equal(out, '고양이 사진')
  })

  test('텍스트를 담지 않는 타입은 건너뛴다', () => {
    const out = buildBodyText([
      block('paragraph', '앞'),
      { type: 'divider', properties: {} },
      block('paragraph', '뒤'),
    ])
    assert.equal(out, '앞\n뒤')
  })

  test('빈 블록은 빈 줄을 남기지 않는다', () => {
    const out = buildBodyText([block('paragraph', '있음'), block('paragraph', ''), block('paragraph', '또')])
    assert.equal(out, '있음\n또')
  })

  test('모르는 타입은 무시한다 — unsupported 의 원본 페이로드를 헤집지 않는다', () => {
    const out = buildBodyText([
      { type: 'unsupported', properties: { original_properties: { title: [textRun('숨은 글')] } } },
      block('paragraph', '본문'),
    ])
    assert.equal(out, '본문')
  })

  test('properties 가 null 이어도 던지지 않는다', () => {
    assert.equal(buildBodyText([{ type: 'paragraph', properties: null }]), '')
  })

  test('★ 상한을 넘으면 자른다', () => {
    // 한 블록에 1000자씩 600개 = 60만 자. 상한은 40만 자다.
    const many: IndexableBlock[] = []
    for (let i = 0; i < 600; i += 1) many.push(block('paragraph', '가'.repeat(1000)))
    const out = buildBodyText(many)
    assert.ok(
      out.length <= MAX_INDEXED_BODY,
      `상한 ${MAX_INDEXED_BODY} 를 넘었다: ${out.length}`,
    )
    // 앞부분은 살아 있어야 한다 — 잘렸다고 전부 버리면 안 된다.
    assert.ok(out.startsWith('가'.repeat(100)))
  })

  test('캡션과 제목이 함께 있으면 둘 다 들어간다', () => {
    const out = buildBodyText([
      { type: 'callout', properties: { title: [textRun('본문')], caption: [textRun('캡션')] } },
    ])
    assert.equal(out, '본문 캡션')
  })
})
