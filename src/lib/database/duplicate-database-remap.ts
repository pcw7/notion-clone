/**
 * 데이터베이스 복제의 id 다시 매기기 (29번 트랙 D-1 · F-04-xx 복제 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1] ②
 *
 * 사본은 원본의 소스 · 속성 · 옵션 · 상태 그룹 · 뷰를 **새 id** 로 만든다. 설정(속성의 config · 뷰의 필터 · 정렬 · 묶기 · 설정 · 폼의 조건 · 레이아웃)은
 * 그 id 들을 글자로 담는다 — 지도(옛 id → 새 id)로 훑어 바꾼다. 안 바꾸면 사본의 rollup 이 원본 표를 모으고 사본의 필터가 원본의 옵션을 본다
 * (HANDOFF §7 "복제에 아직 없는 것" 이 적은 함정).
 *
 *   - **값이 id 와 같은 글자** — 그대로 바꾼다. id 는 무작위(uuid · 21자 base62)라 다른 글자와 겹치지 않는다.
 *   - **객체의 키가 id** — 키도 바꾼다(옵션별 · 속성별 표시 설정 같은 것).
 *   - **수식의 토큰** — 수식은 속성을 `⟦id⟧` 로 가리킨다(`formula-schema.ts`). 글자 안의 토큰을 바꾼다.
 *
 * 지도에 없는 id(다른 데이터베이스의 속성 · 소스)는 **그대로 둔다** — 바깥을 가리키는 것은 원본과 같은 바깥을 가리킨다(rollup 의 대상 속성 ·
 * 바깥 표를 가리키는 relation 의 대상).
 */

export type IdMap = ReadonlyMap<string, string>

const TOKEN = /⟦([^⟧]+)⟧/g

/** 값 하나를 지도로 다시 매긴다 — 글자 · 배열 · 객체(키 포함)를 훑는다. 원본은 건드리지 않는다. */
export function remapIds<T>(value: T, ids: IdMap): T {
  return walk(value, ids) as T
}

function walk(value: unknown, ids: IdMap): unknown {
  if (typeof value === 'string') return remapString(value, ids)
  if (Array.isArray(value)) return value.map((item) => walk(item, ids))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[ids.get(key) ?? key] = walk(item, ids)
    return out
  }
  return value
}

function remapString(text: string, ids: IdMap): string {
  const exact = ids.get(text)
  if (exact !== undefined) return exact
  if (!text.includes('⟦')) return text
  return text.replace(TOKEN, (whole, id: string) => {
    const next = ids.get(id)
    return next === undefined ? whole : `⟦${next}⟧`
  })
}

/**
 * relation 속성의 config — 대상이 사본 안(같은 데이터베이스가 소유한 소스)이면 대상과 짝을 사본의 것으로, **바깥이면 한쪽 relation 으로**
 * 바꾼다(짝을 뗀다). 바깥의 짝 속성은 그 표의 것이라 사본이 함께 쓸 수 없다(짝은 하나다) — 남의 표에 새 짝을 만들지 않는다(정본 [보강 D-1] ③).
 */
export function remapRelationConfig(config: Readonly<Record<string, unknown>>, ids: IdMap): Record<string, unknown> {
  const target = typeof config.target_data_source_id === 'string' ? config.target_data_source_id : null
  const remapped = remapIds({ ...config }, ids)
  if (target !== null && !ids.has(target)) {
    const oneWay: Record<string, unknown> = { ...remapped }
    delete oneWay.synced_property_id
    return oneWay
  }
  return remapped
}
