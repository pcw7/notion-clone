/**
 * 이미지 블록 계약 — F-01-15
 *
 * 이 파일이 지키는 것 셋.
 *
 *   ① **주소를 저장하지 않는다.** 저장하는 것은 `file_id` 이고 주소는 파생값이다
 *      (정본 불변식 FS2). 이게 깨지면 스토리지를 옮기는 날 모든 이미지가 깨진다.
 *   ② **외부 URL 은 스킴을 검사한다.** `javascript:` 가 저장되면 "원본 열기"
 *      링크가 붙는 날 XSS 가 된다.
 *   ③ **참조는 집합이 아니라 횟수다.** 같은 파일을 두 블록이 가리키면 2 여야 하고,
 *      하나를 지웠을 때 남은 하나가 깨지면 안 된다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  captionToJson,
  countFileReferences,
  fileReferenceDelta,
  imageContentPath,
  imageDisplayUrl,
  isSafeImageUrl,
  readCaption,
  readImageSource,
  validateImageProperties,
  withImageSource,
} from './image.ts'

const FILE_A = '11111111-1111-4111-8111-111111111111'
const FILE_B = '22222222-2222-4222-8222-222222222222'

const fileProps = (id: string) => ({ source: { type: 'file', file_id: id } })

describe('readImageSource — 무엇을 출처로 인정하는가', () => {
  test('업로드한 파일', () => {
    assert.deepEqual(readImageSource(fileProps(FILE_A)), { kind: 'file', fileId: FILE_A })
  })

  test('외부 URL', () => {
    assert.deepEqual(readImageSource({ source: { type: 'external', url: 'https://a.example/b.png' } }), {
      kind: 'external',
      url: 'https://a.example/b.png',
    })
  })

  test('★ 빈 이미지 블록은 오류가 아니다 — 정본 엣지 케이스 "저장은 됨"', () => {
    assert.equal(readImageSource({}), null)
    assert.equal(readImageSource(null), null)
    assert.equal(validateImageProperties({}, 'p').length, 0, '없는 것은 거부 대상이 아니다')
  })

  test('file_id 가 uuid 가 아니면 인정하지 않는다', () => {
    assert.equal(readImageSource({ source: { type: 'file', file_id: '../etc/passwd' } }), null)
    assert.equal(readImageSource({ source: { type: 'file' } }), null)
  })
})

describe('★ 외부 URL 은 스킴을 검사한다', () => {
  test('http · https 만 통과한다', () => {
    assert.equal(isSafeImageUrl('https://a.example/b.png'), true)
    assert.equal(isSafeImageUrl('http://a.example/b.png'), true)
  })

  test('javascript: 는 막는다 — img 는 실행 안 해도 a[href] 는 실행한다', () => {
    assert.equal(isSafeImageUrl('javascript:alert(1)'), false)
    // 대소문자·공백으로 우회할 수 없다 — URL 파서가 정규화한다.
    assert.equal(isSafeImageUrl('JaVaScRiPt:alert(1)'), false)
    assert.equal(isSafeImageUrl(' javascript:alert(1)'), false)
  })

  test('data: 와 file: 도 막는다', () => {
    assert.equal(isSafeImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), false)
    assert.equal(isSafeImageUrl('file:///etc/passwd'), false)
  })

  test('상대 경로도 받지 않는다 — 우리 엔드포인트를 이미지인 척 부를 수 있다', () => {
    assert.equal(isSafeImageUrl('/api/workspaces/w/files/f/content'), false)
    assert.equal(isSafeImageUrl('//evil.example/x.png'), false)
  })

  test('저장 경로에서도 거부한다 — 화면에서만 막으면 API 가 그대로 열려 있다', () => {
    const issues = validateImageProperties({ source: { type: 'external', url: 'javascript:alert(1)' } }, 'b.properties')
    assert.equal(issues.length, 1)
    assert.equal(issues[0].path, 'b.properties.source')
  })
})

describe('★ 저장하는 것은 file_id 다 — 주소가 아니다 (FS2)', () => {
  test('withImageSource 는 정본 모양으로 넣는다', () => {
    const props = withImageSource({}, { kind: 'file', fileId: FILE_A })
    assert.deepEqual(props, { source: { type: 'file', file_id: FILE_A } })
    assert.ok(!JSON.stringify(props).includes('/api/'), '주소가 저장됐다')
  })

  test('주소는 그때그때 만든다', () => {
    assert.equal(
      imageDisplayUrl('ws1', { kind: 'file', fileId: FILE_A }),
      imageContentPath('ws1', FILE_A),
    )
    assert.equal(imageDisplayUrl('ws1', { kind: 'external', url: 'https://a/b.png' }), 'https://a/b.png')
    assert.equal(imageDisplayUrl('ws1', null), null)
  })

  test('모르는 키는 보존한다 (F-01-02)', () => {
    const props = withImageSource({ 미래의키: 1 }, { kind: 'file', fileId: FILE_A })
    assert.equal(props.미래의키, 1)
  })

  test('출처를 지우면 빈 블록이 된다 — 블록 자체는 남는다', () => {
    assert.deepEqual(withImageSource(fileProps(FILE_A), null), {})
  })
})

describe('캡션 — 화면은 평문, 저장은 계약대로', () => {
  test('RichText[] 로 저장하고 평문으로 읽는다', () => {
    const props = withImageSource({}, { kind: 'file', fileId: FILE_A }, '고양이 사진')
    assert.ok(Array.isArray(props.caption))
    assert.equal(readCaption(props), '고양이 사진')
  })

  test('빈 캡션은 키를 남기지 않는다', () => {
    const props = withImageSource({ caption: captionToJson('있던 것') }, null, '')
    assert.equal('caption' in props, false)
    assert.equal(readCaption({}), '')
  })

  test('배열이 아닌 caption 은 거부한다', () => {
    assert.equal(validateImageProperties({ caption: '평문' }, 'p').length, 1)
  })
})

describe('★ 참조는 횟수다 — 집합이 아니다', () => {
  test('같은 파일을 두 블록이 가리키면 2', () => {
    const counts = countFileReferences([
      { properties: fileProps(FILE_A) },
      { properties: fileProps(FILE_A) },
      { properties: fileProps(FILE_B) },
    ])
    assert.equal(counts.get(FILE_A), 2)
    assert.equal(counts.get(FILE_B), 1)
  })

  test('외부 URL 과 빈 블록은 세지 않는다 — 우리 파일이 아니다', () => {
    const counts = countFileReferences([
      { properties: { source: { type: 'external', url: 'https://a/b.png' } } },
      { properties: {} },
      { properties: null },
    ])
    assert.equal(counts.size, 0)
  })

  test('둘 중 하나만 지우면 카운트는 2 → 1 이다. 0 이 아니다', () => {
    const before = countFileReferences([{ properties: fileProps(FILE_A) }, { properties: fileProps(FILE_A) }])
    const after = countFileReferences([{ properties: fileProps(FILE_A) }])
    assert.deepEqual([...fileReferenceDelta(before, after)], [[FILE_A, -1]])
  })

  test('안 바뀐 파일은 델타에 넣지 않는다 — 저장마다 모든 이미지 행을 건드리지 않는다', () => {
    const same = countFileReferences([{ properties: fileProps(FILE_A) }])
    assert.equal(fileReferenceDelta(same, same).size, 0)
  })

  test('새로 붙으면 +1, 통째로 사라지면 -1', () => {
    const none = new Map<string, number>()
    const one = countFileReferences([{ properties: fileProps(FILE_A) }])
    assert.deepEqual([...fileReferenceDelta(none, one)], [[FILE_A, 1]])
    assert.deepEqual([...fileReferenceDelta(one, none)], [[FILE_A, -1]])
  })
})
