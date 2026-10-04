/**
 * ZIP 읽기 — 가져오기의 ZIP (잔여 묶음 8m-2a · F-09-12 · 순수 · DB 없음)
 *
 * 정본: 09-api-integrations.md F-09-12 *"ZIP 안의 심볼릭 링크나 `../` 경로는 zip-slip 취약점 … 반드시 정규화 후 루트 밖 경로를 거부 … ZIP 내
 *       숨김 파일(`__MACOSX`, `.DS_Store`)이 실패 원인이 되는 사례"* · 00-canonical-data-model.md §3.4 [보강] 가져오기 ⑥
 *
 * 의존성 없이 `node:zlib`(raw inflate · crc32)로 읽는다 — 쓰기(`export/zip.ts`)가 그렇듯. 파일 시스템에 풀지 않는다(메모리의 바이트만).
 *
 *   · 중앙 디렉터리를 믿는다 — 끝 레코드(EOCD)를 뒤에서 찾고, 항목마다 로컬 헤더로 데이터 자리를 찾는다. ZIP64 · 여러 조각은 받지 않는다
 *   · **항목 하나의 문제는 그 항목만 건너뛰고 적는다**(부분 성공) — 안전하지 않은 경로(`..` · 절대 · 콜론 · 제어 문자) · 암호 · 모르는 압축 ·
 *     깨진 데이터(CRC). 폴더 · `__MACOSX` · `.DS_Store` · `Thumbs.db` 는 조용히 지나간다(내용이 아니다)
 *   · **ZIP 폭탄을 막는다** — 선언된 풀린 크기의 합이 상한을 넘으면 통째로 거부하고, 풀 때도 선언 크기를 넘는 출력은 멈춘다(헤더가 거짓말해도)
 *   · 항목 수 상한(노션 *"파일 10,000개 이상이면 실패하거나 부분 임포트"* — 우리는 1,000)
 *   · 이름 — UTF-8 표시(비트 11)가 있으면 UTF-8, 없으면 UTF-8 로 먼저 읽고 안 되면 **CP949**(Windows 의 "압축(ZIP) 폴더"는 시스템 코드 페이지로
 *     쓴다) · 역슬래시는 구분자로 바꾼다(그렇게 쓰는 도구가 있다)
 */

import { crc32, inflateRawSync } from 'node:zlib'

import { assertSafeEntryPath } from '../export/zip.ts'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const END_RECORD = 22
const MAX_COMMENT = 0xffff
const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

export type ZipLimits = {
  /** 항목 수 상한(폴더 포함). */
  readonly maxEntries: number
  /** 선언된 풀린 크기의 합 상한. */
  readonly maxTotalBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 1000, maxTotalBytes: 500 * 1024 * 1024 }

export type ZipEntry = { readonly path: string; readonly bytes: Uint8Array }
export type ZipSkipReason = 'unsafe_path' | 'encrypted' | 'unsupported_compression' | 'corrupt'
export type ZipSkip = { readonly path: string; readonly reason: ZipSkipReason }

export type ZipReadResult =
  | { readonly ok: true; readonly entries: readonly ZipEntry[]; readonly skipped: readonly ZipSkip[] }
  | { readonly ok: false; readonly reason: 'not_zip' | 'unsupported_zip' | 'too_many_entries' | 'too_large' }

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/** 끝 레코드의 자리 — 뒤에서부터 찾는다(주석이 붙을 수 있다). 없으면 -1. */
function findEnd(view: DataView): number {
  const last = view.byteLength - END_RECORD
  const first = Math.max(0, last - MAX_COMMENT)
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === SIG_END) return at
  }
  return -1
}

export function readZip(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReadResult {
  if (data.byteLength < END_RECORD) return { ok: false, reason: 'not_zip' }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const end = findEnd(view)
  if (end === -1) return { ok: false, reason: 'not_zip' }

  const disk = view.getUint16(end + 4, true)
  const total = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  // 여러 조각 · ZIP64(값이 0xFFFF · 0xFFFFFFFF 로 막혀 있다)는 받지 않는다.
  if (disk !== 0 || total === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    return { ok: false, reason: 'unsupported_zip' }
  }
  if (centralOffset + centralSize > end) return { ok: false, reason: 'not_zip' }
  if (total > limits.maxEntries) return { ok: false, reason: 'too_many_entries' }

  type Header = { path: string; flags: number; method: number; crc: number; packed: number; size: number; local: number }
  const headers: Header[] = []
  let at = centralOffset
  let declared = 0
  for (let i = 0; i < total; i += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== SIG_CENTRAL) return { ok: false, reason: 'not_zip' }
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    if (at + 46 + nameLength > end) return { ok: false, reason: 'not_zip' }
    const name = decodeName(data.subarray(at + 46, at + 46 + nameLength), (flags & FLAG_UTF8) !== 0)
    headers.push({ path: name.replace(/\\/g, '/'), flags, method, crc, packed, size, local })
    declared += size
    at += 46 + nameLength + extraLength + commentLength
  }
  if (declared > limits.maxTotalBytes) return { ok: false, reason: 'too_large' }

  const entries: ZipEntry[] = []
  const skipped: ZipSkip[] = []
  for (const h of headers) {
    if (h.path.endsWith('/') || JUNK.test(h.path)) continue
    try {
      assertSafeEntryPath(h.path)
    } catch {
      skipped.push({ path: h.path, reason: 'unsafe_path' })
      continue
    }
    if ((h.flags & FLAG_ENCRYPTED) !== 0) {
      skipped.push({ path: h.path, reason: 'encrypted' })
      continue
    }
    if (h.method !== METHOD_STORE && h.method !== METHOD_DEFLATE) {
      skipped.push({ path: h.path, reason: 'unsupported_compression' })
      continue
    }
    if (h.local + 30 > data.byteLength || view.getUint32(h.local, true) !== SIG_LOCAL) {
      skipped.push({ path: h.path, reason: 'corrupt' })
      continue
    }
    const start = h.local + 30 + view.getUint16(h.local + 26, true) + view.getUint16(h.local + 28, true)
    if (start + h.packed > data.byteLength) {
      skipped.push({ path: h.path, reason: 'corrupt' })
      continue
    }
    const raw = data.subarray(start, start + h.packed)
    let bytes: Uint8Array
    try {
      // 선언 크기보다 많이 나오면 멈춘다 — 헤더가 거짓말하는 폭탄.
      bytes = h.method === METHOD_STORE ? raw : new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(1, h.size) }))
    } catch {
      skipped.push({ path: h.path, reason: 'corrupt' })
      continue
    }
    if (bytes.byteLength !== h.size || (crc32(bytes) >>> 0) !== h.crc >>> 0) {
      skipped.push({ path: h.path, reason: 'corrupt' })
      continue
    }
    entries.push({ path: h.path, bytes })
  }
  return { ok: true, entries, skipped }
}
