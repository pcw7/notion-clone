/**
 * 칸의 읽기 모양 · 타입 표시 — 표 화면이 쓴다.
 *
 * 글자를 만드는 규칙은 `cell-format.ts` 에 있다. 여기는 그 글자에 모양만 입힌다.
 */

import { useSyncExternalStore } from 'react'

import { cellText, formatAutoMetaTime } from '@/lib/database/cell-format'
import type { RowJson } from '@/lib/database/http'
import { isAutoMetaTimeType, type AutoMetaType } from '@/lib/database/property-types'
import { CONTACT_OPEN_LABEL, contactHref, contactLinkProps } from '@/lib/database/contact-links'
import type { PageIcon } from '@/lib/block/page-icon'
import { PageIconView } from '../../page-icon-view'
import { optionIdOf } from '@/lib/database/property-types'
import { OPTION_DOT_CLASS } from '@/lib/database/option-dot'
import { LEFT_USER } from '@/lib/database/cell-format'
import { verificationLabel, verificationTitle, type VerificationCell } from '@/lib/database/verification-cell'
import type { RollupCell, RollupColumnInfo } from '@/lib/database/rollup-functions'
import type { FormulaValue } from '@/lib/formula/formula'
import { formulaCell } from '@/lib/database/formula-plan'
import { Highlighted } from './search-term'
import { fileContentHref, isImageName } from '@/lib/database/file-chip'
import type { AppPropertyType, CellValue, ContactType, FileRef, OptionColor, RelationValue, SelectOption } from '@/lib/database/property-types'

export const TYPE_LABEL: Readonly<Record<AppPropertyType, string>> = {
  title: '제목',
  rich_text: '텍스트',
  number: '숫자',
  select: '선택',
  status: '상태',
  checkbox: '체크박스',
  date: '날짜',
  people: '사람',
  multi_select: '다중 선택',
  url: 'URL',
  email: '이메일',
  phone_number: '전화',
  files: '파일과 미디어',
  place: '장소',
  created_time: '만든 시각',
  created_by: '만든 사람',
  last_edited_time: '마지막 편집 시각',
  last_edited_by: '마지막 편집 사람',
  relation: '관계형',
  rollup: '롤업',
  formula: '수식',
  unique_id: 'ID',
  button: '버튼',
  verification: '검증',
}

/** 헤더의 타입 아이콘. 장식이다 — 스크린리더에는 `TYPE_LABEL` 이 간다. */
export const TYPE_ICON: Readonly<Record<AppPropertyType, string>> = {
  title: 'Aa',
  rich_text: '≡',
  number: '#',
  select: '▾',
  status: '◔',
  checkbox: '☑',
  date: '◷',
  people: '◉',
  multi_select: '☰',
  url: '⌁',
  email: '@',
  phone_number: '✆',
  files: '⎘',
  place: '⚲',
  created_time: '◷',
  created_by: '◉',
  last_edited_time: '◷',
  last_edited_by: '◉',
  relation: '↗',
  rollup: '∑',
  formula: 'ƒ',
  unique_id: '№',
  button: '▶',
  verification: '✓',
}

/**
 * 옵션 색 → 칩 모양. 키가 `option_color` ENUM 과 같다(`OPTION_COLORS`).
 *
 * Tailwind 가 소스에서 클래스 이름을 찾으므로 **문자열 전체를 적는다** — 조립하면
 * (`bg-${color}-100`) 스타일이 빌드에 들어가지 않는다.
 */
const OPTION_CLASS: Readonly<Record<OptionColor, string>> = {
  // 디자인-6b(노션 앱 실측 — 바탕은 색을 띤 반투명 · 글자는 같은 계열의 짙은 색). 어두운 테마 — 디자인-8d(노션 색 변수: 바탕 `--c-<색>BacTer` ·
  // 글자 `--c-<색>TexPri` 의 어두운 값 — 그 변수의 밝은 값이 6b 의 실측과 같아 같은 자리임을 확인했다 · 보라 글자도 그때 실제 값 #553b69 로).
  // default 는 회색 한 단계 옅은 `--c-graBacSec`(`docs/design/notion-measurements.md`). 글자색은 `!` — 칩의 `data-color` 를 편집기 CSS 의
  // 블록 글자색 팔레트(`[data-color='gray']` 같은 속성 선택자)가 잡아 덮는다(같은 특정도 · 그 CSS 가 뒤에 실린다 · 어두운 테마도 같다).
  default: 'bg-[rgba(28,19,1,0.06)] text-[rgb(73,72,70)]! dark:bg-[#383836] dark:text-[#f0efed]!',
  gray: 'bg-[rgba(28,19,1,0.11)] text-[rgb(73,72,70)]! dark:bg-[#5f5e59] dark:text-[#f0efed]!',
  brown: 'bg-[rgba(127,51,0,0.157)] text-[rgb(88,68,55)]! dark:bg-[#6d5340] dark:text-[#f5ede9]!',
  orange: 'bg-[rgba(196,88,0,0.204)] text-[rgb(106,66,34)]! dark:bg-[#88522f] dark:text-[#fbebde]!',
  yellow: 'bg-[rgba(209,156,0,0.282)] text-[rgb(101,81,33)]! dark:bg-[#836426] dark:text-[#f9f3dc]!',
  green: 'bg-[rgba(0,96,38,0.157)] text-[rgb(42,83,60)]! dark:bg-[#37674c] dark:text-[#e8f1ec]!',
  blue: 'bg-[rgba(0,118,217,0.204)] text-[rgb(38,74,114)]! dark:bg-[#355f8b] dark:text-[#e5f2fc]!',
  purple: 'bg-[rgba(102,0,178,0.157)] text-[rgb(85,59,105)]! dark:bg-[#674d7b] dark:text-[#f3ebf9]!',
  pink: 'bg-[rgba(183,0,78,0.153)] text-[rgb(104,53,78)]! dark:bg-[#7b4760] dark:text-[#fae9f1]!',
  red: 'bg-[rgba(206,24,0,0.165)] text-[rgb(109,53,49)]! dark:bg-[#924943] dark:text-[#fce9e7]!',
}

/** status 칩의 점 — 같은 색 계열의 진한 쪽(노션 앱 실측 6색 · default · brown · orange · purple 은 재지 못해 가까운 값). */
const DOT_CLASS = OPTION_DOT_CLASS

/**
 * 옵션 칩. **status 옵션(그룹이 있다)은 색 점 + 둥근 알약**으로 그린다 — F-03-05: *"셀에는 색 점 + 이름 표시
 * (select 의 알약형 칩과 시각적으로 구분)."* 칩을 쓰는 곳(칸 · 편집기 목록 · 보드 열 머리 · 카드 배지)이 옵션만
 * 넘기면 모양이 따라온다.
 */
export function OptionChip({ option }: { option: SelectOption }) {
  if (option.group !== undefined) {
    return (
      <span
        data-testid="db-option-chip"
        data-status-group={option.group}
        data-color={option.color}
        // 디자인-6b(노션 실측: 높이 20px · 둥글기 10px · 왼쪽 7px · 오른쪽 9px · 14px · 점 8px 과 글자 사이 5px)
        className={`inline-flex h-5 max-w-full items-center rounded-[10px] pl-[7px] pr-[9px] text-sm leading-[1.2] ${OPTION_CLASS[option.color]}`}
      >
        <span aria-hidden className={`mr-[5px] size-2 flex-none rounded-full ${DOT_CLASS[option.color]}`} />
        <span className="truncate">{option.name}</span>
      </span>
    )
  }
  return (
    <span
      data-testid="db-option-chip"
      data-color={option.color}
      // 디자인-6b(노션 실측: 높이 20px · 둥글기 4px · 좌우 6px · 14px)
      className={`inline-block h-5 max-w-full truncate rounded px-1.5 text-sm leading-5 ${OPTION_CLASS[option.color]}`}
    >
      {option.name}
    </span>
  )
}

/** 사람 칸의 이름 지도(6g-2) — 사람 id → 이름. 활동 중인 사람만 — 지도에 없는 id 는 떠난 사람이다. */
export type PeopleNames = Readonly<Record<string, string>>

/** 사람 칸 — 이름 칩(떠난 사람은 "떠난 사용자" · 흐리게). */
export function PeopleChips({ ids, names }: { ids: readonly string[]; names: PeopleNames }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1 overflow-hidden" data-testid="db-people">
      {ids.map((id) => {
        const known = Object.hasOwn(names, id)
        return (
          <span
            key={id}
            data-testid="db-person-chip"
            data-left={known ? undefined : 'true'}
            className={`max-w-full truncate rounded px-1.5 py-0.5 text-xs ${
              known ? 'bg-neutral-100 dark:bg-neutral-800' : 'bg-neutral-50 italic text-neutral-400 dark:bg-neutral-900'
            }`}
          >
            {known ? names[id] : LEFT_USER}
          </span>
        )
      })}
    </span>
  )
}

function ContactCell({ type, text }: { type: ContactType; text: string }) {
  const href = contactHref(type, text)
  // 단추를 누르는 것은 고치는 동작이 아니다 — 칸의 누름 · 두 번 누름 · 키 처리로 번지지 않게 한다
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid={`db-${type}`}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {href !== null && (
        <a
          {...contactLinkProps(type, href)}
          aria-label={`${CONTACT_OPEN_LABEL[type]}: ${text}`}
          data-testid="db-contact-open"
          className="flex-none rounded px-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800"
          onClick={stop}
          onMouseDown={stop}
          onDoubleClick={stop}
          onKeyDown={stop}
        >
          <span aria-hidden>↗</span>
        </a>
      )}
    </span>
  )
}

/** 장소 칸(MP-1) — 핀 아이콘 + 이름 한 줄. 주소는 `title` 로(마우스를 올리면). */
export function PlaceCell({ name, address }: { name: string; address: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="db-place" {...(address === '' ? {} : { title: address })}>
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 flex-none text-neutral-500" fill="currentColor">
        <path d="M8 1a4.5 4.5 0 0 0-4.5 4.5C3.5 9 8 15 8 15s4.5-6 4.5-9.5A4.5 4.5 0 0 0 8 1zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" />
      </svg>
      <span className="min-w-0 flex-1 truncate" data-testid="db-place-name">
        {name}
      </span>
    </span>
  )
}

/**
 * 파일 칸의 칩들(PT-4) — 이름 · 그림이면 작은 미리보기. 누르면 그 파일의 주소로(새 탭 · 파일 블록과 같은 `/content` 길 — 세션이 판정한다).
 * 칩을 누르는 것은 고치는 동작이 아니다 — 칸의 누름 · 키 처리로 번지지 않게 한다. 워크스페이스를 모르면(카드 배지) 이름만 그린다.
 */
export function FileChips({ files, workspaceId }: { files: readonly FileRef[]; workspaceId?: string }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <span className="flex min-w-0 flex-wrap gap-1" data-testid="db-files">
      {files.map((file) => {
        const label = <span className="min-w-0 truncate">{file.name}</span>
        if (workspaceId === undefined) {
          return (
            <span key={file.id} data-testid="db-file-chip" className="inline-flex max-w-full items-center rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
              {label}
            </span>
          )
        }
        const href = fileContentHref(workspaceId, file.id)
        return (
          <a
            key={file.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="db-file-chip"
            data-file-id={file.id}
            aria-label={`파일 열기: ${file.name}`}
            className="inline-flex max-w-full items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            onClick={stop}
            onMouseDown={stop}
            onDoubleClick={stop}
            onKeyDown={stop}
          >
            {isImageName(file.name) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt=""
                loading="lazy"
                data-testid="db-file-thumb"
                className="size-4 flex-none rounded-sm object-cover"
                onError={(e) => e.currentTarget.remove()}
              />
            )}
            {label}
          </a>
        )
      })}
    </span>
  )
}

const subscribeNothing = () => () => {}
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const serverTimeZone = () => null

/**
 * 만든 · 고친 시각과 사람 칸(PT-3) — 날짜 칸과 같은 글(상대 시각 없음) · 사람 칸과 같은 칩. 시각은 보는 사람의 시간대로 — 서버 렌더는
 * 그 시간대를 몰라(쿠키는 "오늘" 에만 읽는다) 마운트 뒤에 그린다. 사람은 이름표 지도(`labels` — 게스트에게는 "멤버")가 올 때까지, 만든
 * 사람이 없는 행(익명 폼)은 빈 칸.
 */
export function AutoMetaDisplay({ type, row, labels }: { type: AutoMetaType; row: RowJson; labels: PeopleNames }) {
  const timeZone = useSyncExternalStore(subscribeNothing, browserTimeZone, serverTimeZone)
  if (isAutoMetaTimeType(type)) {
    const iso = type === 'created_time' ? row.createdAt : row.lastEditedAt
    return (
      <span className="block truncate" data-testid="db-auto-time" data-iso={iso}>
        {timeZone === null ? '' : formatAutoMetaTime(iso, timeZone)}
      </span>
    )
  }
  const id = type === 'created_by' ? row.createdBy : row.lastEditedBy
  const label = id === null ? '' : (labels[id] ?? '')
  return (
    <span className="flex min-w-0 flex-wrap gap-1 overflow-hidden" data-testid="db-auto-person">
      {label !== '' && <span className="max-w-full truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">{label}</span>}
    </span>
  )
}

export function CellDisplay({
  value,
  options,
  names = {},
  workspaceId,
}: {
  value: CellValue
  options: readonly SelectOption[]
  names?: PeopleNames
  /** 파일 칸이 파일의 주소를 만들 때 쓴다(PT-4) — 없으면 이름만 그린다. */
  workspaceId?: string
}) {
  switch (value.type) {
    case 'files':
      return value.files.length === 0 ? null : <FileChips files={value.files} {...(workspaceId === undefined ? {} : { workspaceId })} />
    // 장소(MP-1) — 핀 아이콘과 이름. 주소는 마우스를 올리면(`title`)
    case 'place':
      return value.place.name === '' ? null : <PlaceCell name={value.place.name} address={value.place.address} />
    case 'people':
      return <PeopleChips ids={value.people.map((p) => p.id)} names={names} />
    case 'checkbox':
      return (
        <span
          role="img"
          aria-label={cellText(value)}
          className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
            value.checkbox
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-neutral-300 dark:border-neutral-600'
          }`}
        >
          {value.checkbox ? '✓' : ''}
        </span>
      )
    case 'select':
    case 'status': {
      const id = optionIdOf(value)
      const option = id === null ? undefined : options.find((o) => o.id === id)
      return option ? <OptionChip option={option} /> : null
    }
    // 다중 선택(PT-1) — 고른 차례의 칩 · 넘치면 줄바꿈. 지운 옵션(목록에 없는 id)은 그리지 않는다
    case 'multi_select': {
      const picked = value.multi_select.flatMap((ref) => options.find((o) => o.id === ref.id) ?? [])
      if (picked.length === 0) return null
      return (
        <span className="flex min-w-0 flex-wrap gap-1" data-testid="db-multi-select">
          {picked.map((option) => (
            <OptionChip key={option.id} option={option} />
          ))}
        </span>
      )
    }
    case 'number':
      return <span className="block truncate text-right tabular-nums">{cellText(value)}</span>
    // URL · 이메일 · 전화(PT-2) — 글을 누르면 고치고, 옆의 작은 단추가 링크를 연다(걸 수 없는 글은 단추 없이 글만)
    case 'url':
    case 'email':
    case 'phone_number':
      return <ContactCell type={value.type} text={cellText(value)} />
    default:
      // 제목 · 글 · 날짜 · URL 류 — 검색 중이면 맞은 글자를 강조한다(V-3 · 화면의 글자만 감싼다)
      return (
        <span className="block truncate">
          {value.type === 'title' || value.type === 'rich_text' ? <Highlighted text={cellText(value, options)} /> : cellText(value, options)}
        </span>
      )
  }
}

/** 연결된 행의 제목 맵 — `relation.ts` `loadRelationLabels` 의 답. 제목 · `null`(볼 수 없다) · 키 없음(휴지통). */
export type RelationLabels = Readonly<Record<string, string | null>>

/** 연결된 행의 아이콘 맵(8c-3a) — 볼 수 있고 아이콘이 있는 행만. 없으면 칩은 `↗` 를 그린다. */
export type RelationIcons = Readonly<Record<string, PageIcon>>

/**
 * relation 칸 (relation 5b-1) — 캐시의 id(`RelationValue`)에 제목 맵을 입혀 그린다.
 *
 *   제목이 있는 id    칩
 *   `null`            칩을 그리지 않고 "볼 수 없는 연결 N개"로 센다 — 제목도 id 도 화면에 없다
 *   맵에 없는 id      그리지 않는다(휴지통 · 아직 제목을 못 받았다)
 *   캐시 밖(25개 뒤)  `+N`
 *
 * ★ 캐시의 id 로 제목을 **직접** 읽는 경로를 만들지 않는다 — 권한과 휴지통을 거르는 곳은 서버의 제목 맵 하나다.
 */
export function RelationChips({ value, labels, icons = {} }: { value: RelationValue; labels: RelationLabels; icons?: RelationIcons }) {
  const titled = value.relation.filter((ref) => typeof labels[ref.id] === 'string')
  const hidden = value.relation.filter((ref) => labels[ref.id] === null).length
  const beyond = Math.max(0, value.count - value.relation.length)
  if (titled.length === 0 && hidden === 0 && beyond === 0) return null
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-relation">
      {titled.map((ref) => (
        <span
          key={ref.id}
          data-testid="db-relation-chip"
          className="max-w-[10rem] flex-none truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {/* 그 행의 아이콘이 있으면 그것을, 없으면 "연결"의 표시(↗)를 — 칩은 이미 다른 행을 가리키는 꼴이라 문서 글리프를 겹쳐 세우지 않는다. */}
          {icons[ref.id] !== undefined ? (
            <PageIconView icon={icons[ref.id]} className="mr-1" />
          ) : (
            <span aria-hidden className="mr-1 text-neutral-400">
              ↗
            </span>
          )}
          {labels[ref.id] || '제목 없음'}
        </span>
      ))}
      {beyond > 0 && (
        <span data-testid="db-relation-more" className="flex-none text-xs text-neutral-400">
          +{beyond}
        </span>
      )}
      {hidden > 0 && (
        <span data-testid="db-relation-hidden" className="flex-none text-xs text-neutral-400">
          볼 수 없는 연결 {hidden}개
        </span>
      )}
    </span>
  )
}

// ── rollup (5c-2) ────────────────────────────────────────────────────

const NOTE = 'flex-none text-xs text-neutral-400'

// ── 수식 (2i-3a) ─────────────────────────────────────────────────────

/**
 * 수식 칸 — 읽기 전용이다. 값은 화면이 그 행의 칸으로 계산한다(`formula-plan.ts`).
 *
 * 칸을 그리는 함수(`CellDisplay`)로 그린다 — 수는 오른쪽 · 날짜는 날짜 칸의 모양 · 참거짓은 체크 표시. 빈 값은 그리지 않는다(0 이 아니다).
 * 식이 읽히지 않으면(읽던 속성이 지워졌다 · 타입이 바뀌었다) **말한다** — 조용히 비우면 "값이 없다"와 구분되지 않는다(03 *"셀에 에러 표시"*).
 */
/**
 * 검증 칸(VF-1 · F-03-23 · 정본 [보강 VF-1] ⑥) — 읽기 전용. 검증됨 "✓ 검증됨 · N일 남음" 또는 "무기한" · 만료(경고) · 없음(빈 칸).
 * 머리말(title)에 누가 · 언제 · 언제까지. 사람 이름은 이미 받아 둔 것만 쓴다(없으면 "구성원" — 이름 찾기는 VF-2).
 */
export function VerificationDisplay({ cell, names = {} }: { cell: VerificationCell | null; names?: PeopleNames }) {
  if (cell === null) return null
  const now = new Date()
  return (
    <span
      data-testid="db-verification"
      data-state={cell.expired ? 'expired' : 'verified'}
      title={verificationTitle(cell, names[cell.verified_by] ?? '구성원')}
      className={`truncate ${cell.expired ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}
    >
      {verificationLabel(cell, now)}
    </span>
  )
}

export function FormulaDisplay({ value, error }: { value: FormulaValue | undefined; error: string | null }) {
  if (error !== null) {
    return (
      <span data-testid="db-formula-error" title={error} className={NOTE}>
        ⚠ 수식 오류
      </span>
    )
  }
  const cell = formulaCell(value)
  if (cell === null) return null
  return (
    <span data-testid="db-formula" className="block min-w-0 flex-1">
      <CellDisplay value={cell} options={[]} />
    </span>
  )
}

/**
 * rollup 칸 — 읽기 전용이다.
 *
 * 값은 행에 없다(읽을 때 계산한다 · `use-rollup-values.ts`). 그래서 받지 못한 칸(`undefined`)은 **빈 칸**이지 0 이 아니다 —
 * 숫자 `null` 도 마찬가지다(연결이 0개인 평균 · 최소 · 최대 · 진행률 · 날짜 · `rollup-functions.ts` 머리말). 0 을 그리면
 * "작업이 없는 프로젝트의 진행률 0%" 가 되어 "아무것도 안 끝났다"로 읽힌다.
 *
 * 그릴 수 없는 세 가지는 **말한다.** 조용히 비워 두면 "값이 없다"와 구분되지 않는다:
 *
 *   설정이 끊겼다    관계형 · 대상 속성이 지워졌다(복원하면 돌아온다)
 *   너무 많다        한 칸의 연결이 상한을 넘었다 — 앞의 것만 더한 틀린 합 대신 그렇다고 말한다
 *   볼 수 없는 항목  집계에서 뺀 연결의 수(정본: "N개 항목 접근 불가"). 값이 아니라 **개수만** 말한다
 */
export function RollupDisplay({ cell, info }: { cell: RollupCell | undefined; info: RollupColumnInfo | undefined }) {
  if (info !== undefined && info.state !== 'ok') {
    return (
      <span
        data-testid="db-rollup-broken"
        title={info.state === 'relation_missing' ? '관계형 속성이 지워졌습니다' : '대상 속성이 지워졌습니다'}
        className={NOTE}
      >
        설정이 끊겼습니다
      </span>
    )
  }
  if (cell === undefined) return null
  if (cell.state === 'too_many') {
    return (
      <span data-testid="db-rollup-many" title="연결이 너무 많아 계산하지 않습니다" className={NOTE}>
        연결이 너무 많습니다
      </span>
    )
  }

  const { result } = cell
  const hidden =
    cell.hidden > 0 ? (
      <span data-testid="db-rollup-hidden" className={NOTE}>
        볼 수 없는 항목 {cell.hidden}개
      </span>
    ) : null

  // 값 목록(show_original)은 칩으로. 옵션 id 는 대상 표의 이름으로 그린다(볼 수 있는 표일 때만 옵션이 온다).
  if (result.kind === 'values') {
    const beyond = result.count - result.values.length
    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-rollup">
        {result.values.map((value, at) => (
          <span
            key={at}
            data-testid="db-rollup-chip"
            className="max-w-[10rem] flex-none truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <CellDisplay value={value} options={info?.state === 'ok' ? info.targetOptions : []} />
          </span>
        ))}
        {beyond > 0 && (
          <span data-testid="db-rollup-more" className={NOTE}>
            +{beyond}
          </span>
        )}
        {hidden}
      </span>
    )
  }

  const text =
    result.kind === 'number'
      ? result.number === null
        ? ''
        : String(result.number)
      : result.kind === 'percent'
        ? result.percent === null
          ? ''
          : `${Math.round(result.percent * 1000) / 10}%`
        : result.kind === 'days'
          ? result.days === null
            ? ''
            : `${result.days}일`
          : result.date === null
            ? ''
            : cellText({ type: 'date', date: { start: result.date } })

  if (text === '' && hidden === null) return null
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="db-rollup">
      {text !== '' && (
        <span
          data-testid="db-rollup-value"
          className={`min-w-0 truncate ${result.kind === 'date' ? '' : 'tabular-nums'}`}
        >
          {text}
        </span>
      )}
      {hidden}
    </span>
  )
}
