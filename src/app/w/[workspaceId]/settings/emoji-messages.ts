/**
 * 설정의 이모지 절 — 문구 · 올리기 전 검사 (인접 제품 7c-2b · F-13-16 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑥ — 화면은 **파일을 올리기 전에** 같은 규칙으로 먼저 거른다(올리기는 두 번의
 * 요청이라 이모지 단계에서 거부되면 올린 파일이 참조 0 으로 남는다). 규칙은 명령과 같은 모듈(`custom-emoji-rules.ts`)이다.
 */

// 상대 경로 — `node --test` 가 이 파일을 그대로 읽는다(별칭 `@/` 를 모른다).
import { MAX_CUSTOM_EMOJI, MAX_EMOJI_BYTES, normalizeEmojiName } from '../../../../lib/emoji/custom-emoji-rules.ts'
import { ALLOWED_IMAGE_MIME } from '../../../../lib/file/limits.ts'

const MB = Math.round(MAX_EMOJI_BYTES / 1024 / 1024)

export const EMOJI_PANEL_NOTE = `올린 그림은 이 워크스페이스의 누구나 페이지 · 데이터베이스 아이콘으로 씁니다. PNG · JPEG · GIF · WebP, ${MB}MB 까지 — 정사각형이 잘 맞습니다.`

export const EMOJI_OWNERS_ONLY_NOTE = '지금은 소유자만 커스텀 이모지를 올립니다(설정 → 보안).'

export const EMOJI_DELETE_CONFIRM = '지울까요? 이 이모지를 쓴 아이콘은 기본 아이콘으로 바뀝니다. 되돌릴 수 없습니다.'

export const EMOJI_NAME_HINT = '영문 소문자 · 숫자 · 밑줄(_) · 하이픈(-) 40자까지'

/** 명령의 거부 코드 → 문장. `action` 은 무엇을 하다 거부되었는가(권한 문장이 다르다). 모르는 코드는 일반 문장. */
export function emojiFailureMessage(code: unknown, action: 'create' | 'manage'): string {
  switch (code) {
    case 'invalid_name':
      return `이름은 ${EMOJI_NAME_HINT}입니다.`
    case 'duplicate_name':
      return '같은 이름의 이모지가 이미 있습니다.'
    case 'too_many':
      return `이모지는 워크스페이스마다 ${MAX_CUSTOM_EMOJI}개까지입니다.`
    case 'invalid_file':
      return '이 워크스페이스에 올린 이미지가 아닙니다.'
    case 'too_large':
      return `이모지 그림은 ${MB}MB 까지 올릴 수 있습니다.`
    case 'forbidden':
      return action === 'create' ? '커스텀 이모지를 올릴 권한이 없습니다.' : '이 이모지는 올린 사람이나 소유자만 바꿀 수 있습니다.'
    case 'not_found':
      return '이미 지운 이모지입니다.'
    default:
      return '이모지를 저장하지 못했습니다.'
  }
}

/** 고른 파일을 올리기 전에 — 형식 · 크기. 받을 수 있으면 null. */
export function emojiFileProblem(file: { readonly type: string; readonly size: number }): string | null {
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) return 'PNG · JPEG · GIF · WebP 그림만 올릴 수 있습니다.'
  if (file.size === 0) return '빈 파일은 올릴 수 없습니다.'
  if (file.size > MAX_EMOJI_BYTES) return emojiFailureMessage('too_large', 'create')
  return null
}

/** 이름 칸을 저장하기 전에 — 받는 모양(소문자 · 양 끝의 `:` 를 걷는다) 또는 문장. */
export function emojiNameOrProblem(raw: string): { readonly name: string } | { readonly problem: string } {
  const name = normalizeEmojiName(raw)
  return name === null ? { problem: emojiFailureMessage('invalid_name', 'create') } : { name }
}
