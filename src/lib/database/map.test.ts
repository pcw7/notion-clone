import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_MAP_LAYOUT,
  MAX_MAP_PINS,
  mapTileUrl,
  mergeMapLayout,
  pinBounds,
  readMapLayout,
  resolveMapBy,
  selectPins,
  validateMapPatch,
} from './map.ts'

test('readMapLayout — 없거나 모르는 값이면 기본값', () => {
  assert.deepEqual(readMapLayout(null), DEFAULT_MAP_LAYOUT)
  assert.deepEqual(readMapLayout({}), DEFAULT_MAP_LAYOUT)
  assert.deepEqual(readMapLayout({ map: 'x' }), DEFAULT_MAP_LAYOUT)
  assert.deepEqual(readMapLayout({ map: { map_by: 7, height: 100 } }), DEFAULT_MAP_LAYOUT)
  assert.deepEqual(readMapLayout({ map: { map_by: 'p1', height: 720 } }), { map_by: 'p1', height: 720 })
})

test('validateMapPatch — 높이 240~960 정수 · map_by 는 글 또는 null', () => {
  assert.deepEqual(validateMapPatch({ height: 240 }), [])
  assert.deepEqual(validateMapPatch({ height: 960 }), [])
  assert.deepEqual(validateMapPatch({ map_by: null }), [])
  assert.deepEqual(validateMapPatch({ map_by: 'p1', height: 480 }), [])
  assert.equal(validateMapPatch({ height: 239 }).length, 1)
  assert.equal(validateMapPatch({ height: 961 }).length, 1)
  assert.equal(validateMapPatch({ height: 480.5 }).length, 1)
  assert.equal(validateMapPatch({ height: '480' }).length, 1)
  assert.equal(validateMapPatch({ map_by: '' }).length, 1)
  assert.equal(validateMapPatch({ map_by: 3 }).length, 1)
  assert.equal(validateMapPatch({ zoom: 3 }).length, 1)
  assert.equal(validateMapPatch({}).length, 1)
  assert.equal(validateMapPatch(null).length, 1)
  assert.equal(validateMapPatch([]).length, 1)
})

test('mergeMapLayout — 바꾸려는 키만 얹는다 · map_by 를 null 로 되돌릴 수 있다', () => {
  const cur = { map_by: 'p1', height: 600 }
  assert.deepEqual(mergeMapLayout(cur, { height: 320 }), { map_by: 'p1', height: 320 })
  assert.deepEqual(mergeMapLayout(cur, { map_by: 'p2' }), { map_by: 'p2', height: 600 })
  assert.deepEqual(mergeMapLayout(cur, { map_by: null }), { map_by: null, height: 600 })
})

test('resolveMapBy — 저장된 장소 속성 · 없거나 죽었으면 첫 장소 속성 · 하나도 없으면 null', () => {
  assert.equal(resolveMapBy('b', ['a', 'b']), 'b')
  assert.equal(resolveMapBy(null, ['a', 'b']), 'a')
  assert.equal(resolveMapBy('gone', ['a', 'b']), 'a')
  assert.equal(resolveMapBy('a', []), null)
  assert.equal(resolveMapBy(null, []), null)
})

const place = (name: string, lat: number, lng: number, address = '') => ({ type: 'place', place: { name, address, lat, lng } })
const row = (id: string, value: unknown) => ({ id, title: `행 ${id}`, properties: value === undefined ? {} : { loc: value } })

test('selectPins — 빈 칸 · 모양이 틀린 값은 건너뛴다', () => {
  const { pins, truncated } = selectPins(
    [
      row('1', place('서울', 37.5, 127)),
      row('2', undefined),
      row('3', { type: 'place', place: { name: '', address: '', lat: 1, lng: 1 } }),
      row('4', place('범위 밖', 91, 0)),
      row('5', { type: 'place', place: { name: '문자 좌표', lat: '1', lng: 1 } }),
      row('6', 'x'),
      row('7', place('부산', 35.1, 129, '부산시')),
    ],
    'loc',
  )
  assert.deepEqual(
    pins.map((p) => p.rowId),
    ['1', '7'],
  )
  assert.equal(truncated, false)
  assert.deepEqual(pins[1], { rowId: '7', title: '행 7', name: '부산', address: '부산시', lat: 35.1, lng: 129 })
})

test('selectPins — 100개에서 끊고 truncated · 질의가 더 있다고 하면 truncated', () => {
  const many = Array.from({ length: 105 }, (_, i) => row(String(i), place(`p${i}`, 10, 10)))
  const cut = selectPins(many, 'loc')
  assert.equal(cut.pins.length, MAX_MAP_PINS)
  assert.equal(cut.truncated, true)
  assert.equal(cut.pins[99]!.rowId, '99')
  const exact = selectPins(many.slice(0, 100), 'loc')
  assert.equal(exact.pins.length, 100)
  assert.equal(exact.truncated, false)
  assert.equal(selectPins(many.slice(0, 100), 'loc', true).truncated, true)
  // 다른 칸의 값은 보지 않는다
  assert.equal(selectPins(many.slice(0, 3), 'other').pins.length, 0)
})

test('pinBounds — 핀을 모두 담는 범위 · 없으면 null', () => {
  assert.equal(pinBounds([]), null)
  assert.deepEqual(pinBounds([{ lat: 10, lng: 20 }]), [
    [10, 20],
    [10, 20],
  ])
  assert.deepEqual(
    pinBounds([
      { lat: 37, lng: 127 },
      { lat: -33, lng: 151 },
      { lat: 48, lng: 2 },
    ]),
    [
      [-33, 2],
      [48, 151],
    ],
  )
})

test('mapTileUrl — 비면 기본 · off 면 null · 그 밖은 그대로', () => {
  assert.equal(mapTileUrl(undefined), 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  assert.equal(mapTileUrl('  '), 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  assert.equal(mapTileUrl('off'), null)
  assert.equal(mapTileUrl(' OFF '), null)
  assert.equal(mapTileUrl('https://t.example/{z}/{x}/{y}.png'), 'https://t.example/{z}/{x}/{y}.png')
})
