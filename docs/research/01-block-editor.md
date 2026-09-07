# 01. 블록 에디터 코어

> 조사일: 2026-09-06 / 모드: DOMAIN → GAP 보완 1회차 → **GAP 보완 2회차(2026-09-06, 완료)** / 대상: 노션 클론(C:/VibeCoding/notion) 기획 단계
> 태그 규칙: `[추정]` = 공개 근거 없이 추론한 내용, `[확인필요]` = 실제 제품에서 검증이 필요한 내용
> 기준 API 버전: **2026-03-11** (블록 타입 목록·`position` 파라미터는 API 버전에 따라 변한다. 재조사 시 버전 먼저 확인할 것)
>
> **GAP 1회차에서 바뀐 것 요약**: 블록 타입 수 34→35 정정, `heading_4` API/UI 불일치 확인, 인라인 수식 단축키·`$$` 트리거 공식 확인, rich text 색상/멘션 개수 정정, 요청당 중첩 2단계 제한 추가, 난이도 4건 상향. **단 예고했던 기능 5개(F-01-18~22)는 세션 중단으로 실제로 작성되지 못했다.**
>
> **GAP 2회차에서 바뀐 것 요약**:
> 1. **F-01-18~F-01-22를 실제로 작성**(심플 테이블/캐럿·분할·병합/수식/블록 색상/대용량 렌더링) — 1회차가 남긴 미완성 상태를 마감. 총 기능 수 17 → **22**.
> 2. **블록 색상 지원 타입을 공식 열거로 확정**(12종) — `code`/`divider`/미디어/`table`에는 `color` 필드가 없다는 사실 확인. 동시에 헬프센터가 "파일·북마크에도 Color가 있다"고 서술하는 **UI/API 두 번째 불일치** 발견.
> 3. **심플 테이블 셀 병합(2026-05-26 릴리스) 확인** + `table_width`가 생성 시에만 설정 가능하다는 제약 확인 + **셀은 rich text 전용(블록 중첩 불가)** 확인.
> 4. **Notion-flavored enhanced markdown 발견** — 노션이 모든 블록 타입을 마크다운으로 직렬화하는 **공식 문법**이 존재한다(내보내기/붙여넣기 설계의 1차 출처).
> 5. **대용량 렌더링의 1차 출처 확보** — IndexedDB→SQLite 전환, WASM SQLite + OPFS, SharedWorker 단일 쓰기 탭, Web Locks 페일오버, 실측 수치(50% / 20%).
> 6. `Turn into Page`의 `[확인필요]` 해제(공식 가이드 확인), `Cmd/Ctrl+Shift+H` 색상 재적용 단축키 추가, Firefox 부분 선택 제약의 출처를 릴리스 노트로 확정.
> 7. **난이도/우선순위 재검토**: F-01-19를 P0 최소 집합에 명시, "P0에 넣지 않지만 P0 시점에 결정해야 하는 것" 표 신설, 과소평가 위험 상위 4개 지정, 요약표의 난이도 불일치 4건(F-01-13/14/15/16) 본문과 동기화.

## 요약

블록 에디터 코어는 노션의 모든 콘텐츠 저장·렌더·편집을 지배하는 단일 추상화 계층이다. 텍스트 한 줄, 이미지, 페이지, 데이터베이스 행까지 전부 동일한 `block` 레코드로 저장되며, 블록은 `content[]`(자식 ID의 순서 있는 배열)로 렌더 트리를, `parent`(상위 포인터)로 권한 상속 트리를 각각 별도로 표현한다.
편집기의 모든 조작(엔터, Tab, 드래그, turn into)은 UI 이펙트가 아니라 블록 레코드에 대한 operation 집합으로 표현되어 트랜잭션으로 서버에 전송된다.
따라서 이 도메인의 설계 결정(블록 ID 체계, 자식 순서 표현, 트랜잭션 단위)이 이후 데이터베이스/권한/실시간 협업 도메인 전체를 구속한다. 클론에서 가장 먼저, 가장 신중하게 고정해야 하는 계층이다.

출처: https://www.notion.com/blog/data-model-behind-notion , https://developers.notion.com/reference/block

---

## 핵심 개념 / 데이터 모델

### 공식적으로 확인된 노션 내부 블록 속성 5종

노션 공식 엔지니어링 블로그가 명시한 블록의 핵심 속성:

| 속성 | 설명 | 근거 |
|---|---|---|
| `id` | 블록 고유 식별자. 랜덤 생성 UUID v4 | 공식 블로그 명시 |
| `type` | 렌더 방식 + `properties` 해석 방식을 결정 | 공식 블로그 명시 |
| `properties` | 블록별 커스텀 속성 컨테이너. 가장 흔한 키는 `title` | 공식 블로그 명시 |
| `content` | **자식 블록 ID의 순서 있는 배열**(하향 포인터). 렌더 트리를 구성 | 공식 블로그 명시 |
| `parent` | 부모 블록 ID(상향 포인터). **권한 상속 전용** | 공식 블로그 명시 |

공식 블로그의 핵심 문장 두 개(설계 근거로 반드시 기억할 것):

1. 원문: *"Initially, we allowed blocks to be referenced by multiple content arrays to simplify our collaboration and concurrency model."* — 한 블록이 여러 `content` 배열에서 참조될 수 있게 두었더니 **어느 블록에서 권한을 상속받는지가 모호**해졌고, 그래서 권한 전용 상향 포인터 `parent`를 별도로 두었다. → **`content`(렌더 트리)와 `parent`(권한 트리)를 분리한 이유**
   - `[확인필요]` "Initially"라는 표현은 **현재는 다중 참조를 허용하지 않을 수도 있음**을 시사한다. 다만 synced block이 존재하는 이상 어떤 형태로든 다중 위치 렌더는 살아 있다(F-01-11). 클론은 "렌더 참조는 여러 곳 가능 / 권한 부모는 항상 1개" 규칙만 고정하면 안전하다.
2. 원문: *"In conventional word processors, indentation is presentational... In Notion, indentation is structural: it's a reflection of the structure of the render tree."* 그리고 *"pressing indent in a content block tries to add that block to the content of the nearest sibling block in the content tree."* → **들여쓰기는 스타일이 아니라 "직전 형제의 `content`로 이동"이라는 구조 연산**

출처: https://www.notion.com/blog/data-model-behind-notion

### 공개 API가 노출하는 블록 오브젝트 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `object` | string | 항상 `"block"` |
| `id` | UUID v4 | 블록 ID |
| `parent` | object | `{type: "page_id" \| "block_id" \| "database_id" \| "workspace", ...}` |
| `type` | enum | 블록 타입 |
| `created_time` / `last_edited_time` | ISO8601 | 생성/수정 시각 |
| `created_by` / `last_edited_by` | Partial User | 생성자/최종 편집자 |
| `has_children` | boolean | 자식 블록 존재 여부 |
| `in_trash` | boolean | 휴지통 여부 |
| `archived` | boolean | `in_trash`의 deprecated alias |
| `{type}` | object | 타입별 페이로드. 키 이름이 `type` 값과 동일 (예: `type:"paragraph"` → `paragraph: {...}`) |

출처: https://developers.notion.com/reference/block

> **중요**: 공개 API의 `has_children` + 별도 children 조회 방식은 내부 모델의 `content[]`를 감춘 표현이다. 공개 API는 자식 **순서**를 별도 필드가 아니라 `GET /v1/blocks/{id}/children`의 **응답 순서**로만 제공한다. 클론은 내부 모델(`content[]` 또는 `order` 키)을 직접 설계해야 한다.

### 클론용 권장 의사 스키마

```sql
-- 모든 콘텐츠의 단일 테이블. page 역시 block의 한 type이다.
CREATE TABLE block (
  id            UUID PRIMARY KEY,               -- v4 (클라이언트 생성: 오프라인/낙관적 업데이트 대비)
  workspace_id  UUID NOT NULL,
  type          TEXT NOT NULL,                  -- 'paragraph' | 'heading_1' | ... (F-01-02 표)
  properties    JSONB NOT NULL DEFAULT '{}',    -- { title: RichText[], checked: bool, language: 'python', ... }
  format        JSONB NOT NULL DEFAULT '{}',    -- { block_color, code_wrap, column_ratio, icon, page_full_width ... }
  parent_id     UUID REFERENCES block(id),      -- 권한 상속용 상향 포인터 (단일)
  parent_table  TEXT NOT NULL,                  -- 'block' | 'space' | 'collection'
  order_key     TEXT NOT NULL,                  -- fractional index (부모 내 형제 정렬용). 대안: content[] 배열
  is_alive      BOOLEAN NOT NULL DEFAULT true,  -- soft delete (휴지통 복구/undo용)
  created_by    UUID, last_edited_by UUID,
  created_at    TIMESTAMPTZ, last_edited_at TIMESTAMPTZ,
  version       BIGINT NOT NULL DEFAULT 0       -- 낙관적 동시성 제어
);
CREATE INDEX ON block (parent_id, order_key) WHERE is_alive;

-- 편집 조작의 원자 단위. 실시간 동기화 / undo / 감사 로그의 기반.
CREATE TABLE operation (
  id           BIGSERIAL PRIMARY KEY,
  tx_id        UUID NOT NULL,                   -- 트랜잭션(사용자 조작 1회) 묶음
  actor_id     UUID NOT NULL,
  block_id     UUID NOT NULL,
  op           TEXT NOT NULL,                   -- 'set' | 'update' | 'listBefore' | 'listAfter' | 'listRemove'
  path         TEXT[] NOT NULL,                 -- ['properties','title'] 등
  args         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL
);
```

**자식 순서 표현 두 갈래 (반드시 초기에 결정)**

| 방식 | 장점 | 단점 | 권장 |
|---|---|---|---|
| 부모의 `content: UUID[]` 배열 (노션 방식) | 순서가 한 레코드에 모여 읽기 단순, 노션과 동형 | 동시 삽입 시 배열 전체가 충돌 지점, 자식 1000개면 배열 갱신 비용 | 노션 원본 재현 우선 시 |
| 자식의 `order_key` fractional index (Figma/Linear 방식) | 이동 시 **한 행만** 갱신, 동시 편집 충돌 최소 | 키 길이 증가(재균형 배치 잡 필요), 순서 조회에 정렬 필요 | **클론 권장** |

fractional indexing 근거: https://www.figma.com/blog/realtime-editing-of-ordered-sequences/ , https://liveblocks.io/blog/how-crdts-and-sync-engines-keep-realtime-lists-ordered-with-fractional-indexing

### rich text 값 모델 (properties.title 등에 들어가는 타입)

공개 API 기준 rich text 오브젝트:

```ts
type RichText = {
  type: 'text' | 'mention' | 'equation';
  annotations: {
    bold: boolean; italic: boolean; strikethrough: boolean;
    underline: boolean; code: boolean;
    color: 'default'|'gray'|'brown'|'orange'|'yellow'|'green'|'blue'|'purple'|'pink'|'red'
         | `${Color}_background`;
  };
  plain_text: string;   // 서식 제거된 텍스트 (검색/인덱싱용 파생 필드)
  href: string | null;
  text?:     { content: string; link: { url: string } | null };   // type === 'text'
  equation?: { expression: string };                              // KaTeX 문자열
  mention?:  { type: 'user'|'page'|'database'|'date'|'link_preview'|'template_mention'|'custom_emoji', ... };
};
```

공개 API 제한값(클론 검증 규칙의 출발점으로 사용 가능):

| 대상 | 한계 | 클론 적용 |
|---|---|---|
| `text.content` | 2000자 | 블록 텍스트 상한 후보 |
| `link.url` / 모든 URL 필드 | 2000자 | URL 컬럼 길이 |
| `equation.expression` | 1000자 | 수식 입력 검증(F-01-20) |
| rich text 배열 | 100 요소 | span 병합 정규화 강제(F-01-03) |
| **블록 배열(children 등)** | **100 요소** | 한 번에 넣는 자식 수 상한 |
| **1요청당 자식 블록 중첩 깊이** | **2단계** (`children` 안의 `children`까지만) | 깊은 subtree는 재귀 호출로 분할 |
| 1요청당 블록 총량 / 페이로드 | 1000개 / 500KB | 붙여넣기·임포트 배치 크기 |
| 멀티셀렉트 옵션 / relation / people | 각 100 | (DB 도메인) |
| 이메일 / 전화번호 | 각 200자 | (DB 도메인) |
| API rate limit | 통합당 평균 **3 req/s**(버스트 허용), 초과 시 429/529 | 클론 API 게이트웨이 기본값 참고 |

> **요청당 중첩 2단계 제한**은 클론 설계에 직접 영향을 준다. "subtree 통째 삽입"(붙여넣기 F-01-10, 복제 F-01-08, 임포트)을 단일 API 호출로 처리할 수 없다는 뜻이므로, **클론은 처음부터 "임의 깊이 subtree를 한 트랜잭션으로 받는 내부 API"를 따로 두고 공개 API 호환 레이어에서만 2단계 제한을 흉내내는 편이 낫다.**

출처: https://developers.notion.com/reference/rich-text , https://developers.notion.com/reference/request-limits , https://developers.notion.com/reference/patch-block-children

> `[확인필요]` 위 제한은 **공개 API의 제한**이며 노션 앱 내부 편집기의 제한과 동일한지는 확인되지 않았다. (앱에서는 한 블록에 2000자 이상 입력이 가능해 보인다 — 실측 필요)

> `[추정]` 노션 내부는 rich text를 `[["문자열", [["b"],["a","https://..."]]], ...]` 형태의 배열-of-배열(decoration 튜플)로 저장하는 것으로 널리 알려져 있으며, 공개 API의 객체 형태는 이를 정규화한 표현일 가능성이 높다. 클론은 공개 API 형태(객체 배열)를 채택하는 편이 가독성/검증에 유리하다.

---

## 기능 명세

### F-01-01 블록 트리 데이터 모델 (렌더 트리 / 권한 트리 분리)

- **한 줄 정의**: 페이지의 모든 콘텐츠를 동일한 블록 레코드로 저장하고, 자식 순서(`content`)와 권한 부모(`parent`)를 별도 관계로 유지해 중첩 문서를 표현한다.
- **사용자 시나리오**:
  1. 사용자가 페이지에서 Enter를 누른다 → 새 블록 UUID 생성 → 부모의 자식 목록에서 현재 블록 바로 뒤 위치에 삽입.
  2. Tab을 누른다 → 현재 블록이 **직전 형제 블록의 자식**으로 이동(부모 변경 + 순서 재계산).
  3. 페이지를 다시 열면 서버가 루트 블록부터 자식을 재귀 조회해 트리를 복원한다.
- **동작 상세**:
  - 블록 생성 시 기본 `type`은 `paragraph`, `properties.title`은 빈 배열.
  - 새 블록은 항상 현재 블록의 **직후 형제**로 생성된다. 단, 현재 블록이 자식을 가지고 펼쳐진 상태면 첫 자식으로 들어가는 케이스가 있다 `[확인필요]`.
  - 노션 블로그가 확인해 주는 범위는 "클라이언트가 변경마다 operation을 만들고, 그 operation들을 **하나의 트랜잭션으로 묶어** `/saveTransactions` 엔드포인트로 보낸다"까지다. **Enter 1회 = operation 정확히 3개라는 수치는 블로그 본문에서 재확인되지 않았다** `[확인필요]`. 클론 설계에는 "UI 조작 1회 = 트랜잭션 1개 = operation N개(N≥2: 블록 생성 + 순서 편입)"만 전제하면 충분하다.
  - 삭제는 물리 삭제가 아니라 `alive=false` 소프트 삭제 `[추정]`(휴지통 복구/undo 존재로부터 추론).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 블록에서 Backspace | 블록 타입이 paragraph가 아니면 우선 paragraph로 되돌림 → 이미 paragraph면 블록 삭제 후 이전 블록 끝으로 커서 이동 `[확인필요]`(공식 문서 미기재 — 상세 규칙은 F-01-19) |
  | 자식이 있는 블록 삭제 | 자식 전체가 함께 삭제(부모 subtree). 노션은 자식을 승격시키지 않음 `[확인필요]` |
  | 순환 참조(A의 자식이 A) | 스키마 레벨에서 금지. 이동 시 "대상이 자기 자신의 후손인가" 검사 필수 |
  | 동시편집 — 두 사용자가 같은 부모에 동시 삽입 | fractional index 사용 시 두 블록 모두 살아남고 순서는 tie-breaker(actor id)로 결정 |
  | 삭제된 블록을 참조하는 mention / synced block | 참조는 살아있고 렌더 시 "삭제된 페이지/블록" placeholder |
  | 권한 없음 | 트리 조회 시 권한 없는 subtree는 응답에서 제외(존재 사실도 숨김) |
  | 대용량 — 블록 5000개 페이지 | 초기 로드는 뷰포트 기준 부분 로드 + 가상 스크롤 필요. 전체 트리 한 번에 직렬화 금지 |

- **데이터 모델 함의**: 위 `block` 테이블 그대로. 필수 인덱스 `(parent_id, order_key)`. `parent_table`로 space/collection 소속 구분. 트리 조회는 재귀 CTE 또는 `page_id` 비정규화 컬럼(같은 페이지 블록 일괄 조회) 중 후자가 성능상 유리 `[추정]`.
  - **삽입 위치 API 계약**: 공개 API는 `position`을 `end`(기본) / `start` / `after_block`(기준 블록 ID 지정) 3종으로 받는다(구 `after` 파라미터는 deprecated). 클론 내부 API도 **"부모 + 기준 형제 + 앞/뒤"** 형태로 받아야 fractional index 계산을 서버에서 수행할 수 있다. 클라이언트가 order_key를 직접 계산해 보내면 동시 삽입 시 키 충돌 판정을 서버가 못 한다.
  - **깊이 제한**: 공개 API는 한 요청에서 **자식 중첩 2단계까지만** 허용한다. 내부 API는 이 제약을 두지 않되, subtree 삽입은 반드시 **단일 트랜잭션**이어야 한다(중간 실패 시 고아 블록 발생).
  - **트리 무결성 불변식 3가지**(서버 검증 필수): ① 모든 살아있는 블록은 살아있는 부모를 갖는다(고아 금지) ② `parent_id` 체인에 사이클이 없다 ③ 같은 `parent_id` 안에서 `order_key`는 유일하다.
- **UI/인터랙션**: Enter=새 블록, Shift+Enter=블록 내 줄바꿈(soft break), Tab/Shift+Tab=중첩 변경, Esc=현재 블록 선택, Cmd/Ctrl+A=블록 선택→전체 선택 단계적 확장.
- **의존 기능**: 없음. 이 도메인의 루트.
- **구현 난이도**: **XL** — 트리 CRUD + 순서 키 + 소프트 삭제 + 트랜잭션 로그를 동시에 설계해야 하고 이후 모든 기능이 여기에 종속된다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: 1단계에서는 `content[] JSONB` 대신 `parent_id + order_key` 단일 방식만 채택하고, 권한 트리는 `parent_id`를 그대로 재사용(별도 분리 없이). synced block을 도입하는 시점에만 렌더/권한 분리를 실제로 구현한다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://developers.notion.com/reference/block

---

### F-01-02 블록 타입 레지스트리 (지원 타입 전수 + 타입별 페이로드)

- **한 줄 정의**: 각 블록이 어떤 데이터를 갖고 어떻게 렌더되며 자식을 가질 수 있는지를 타입별로 정의한 레지스트리.
- **사용자 시나리오**: `/` 입력 → 타입 목록에서 선택 → 해당 타입의 빈 블록 생성 → 타입 고유 편집 UI(코드 언어 선택기, 이미지 업로더 등) 노출.
- **동작 상세** — 공개 API(버전 2026-03-11)가 문서화한 타입 전수(**35종**, 아래 표):

  > **정정(GAP 1회차)**: 이전 판은 "34종"이라고 적었다. `developers.notion.com/reference/block`의 타입 색인에 나열된 것은 34개이며 `code`가 색인에서 누락된 채 본문에만 서술되어 있다. 실제 문서화 타입은 **35종**이다. 타입 수는 API 버전마다 증가하므로(예: `meeting_notes`는 2026-03-11 버전에서 도입) **버전 고정 없이 "전수"를 말하면 안 된다** `[확인필요]`.

  | 카테고리 | type | 주요 페이로드 | 자식 가능 |
  |---|---|---|---|
  | 텍스트 | `paragraph` | `rich_text[]`, `color`, `children` | O |
  | 헤딩 | `heading_1` `heading_2` `heading_3` `heading_4` | `rich_text[]`, `color`, `is_toggleable` | `is_toggleable=true`일 때만 O |
  | 리스트 | `bulleted_list_item` | `rich_text[]`, `color` | O |
  | 리스트 | `numbered_list_item` | `rich_text[]`, `color`, `list_start_index`, `list_format`(`"numbers"`/`"letters"`/`"roman"`) | O |
  | 리스트 | `to_do` | `rich_text[]`, `checked`, `color` | O |
  | 토글 | `toggle` | `rich_text[]`, `color` | O |
  | 인용 | `quote` | `rich_text[]`, `color` | O |
  | 콜아웃 | `callout` | `rich_text[]`, `icon`, `color` | O |
  | 코드 | `code` | `rich_text[]`, `language`(enum), `caption[]` | X |
  | 수식 | `equation` | `expression`(KaTeX) | X |
  | 구분선 | `divider` | `{}` (빈 객체) | X |
  | 미디어 | `image` `video` `audio` `file` `pdf` | file object(`external`/`file`/`file_upload`), `caption[]` | X |
  | 링크 | `bookmark` | `url`, `caption[]` | X |
  | 링크 | `embed` | `url` 또는 `file_upload` | X |
  | 링크 | `link_preview` | `url` (읽기 전용, API로 생성 불가) | X |
  | 레이아웃 | `column_list` | `{}` | O (`column`만) |
  | 레이아웃 | `column` | `width_ratio` (0~1) | O |
  | 표 | `table` | `table_width`(**생성 시에만 설정 가능**), `has_column_header`, `has_row_header` | O (`table_row`만) |
  | 표 | `table_row` | `cells: RichText[][]` (**셀은 rich text 전용 — 블록 중첩 불가**) | X |
  | 동기화 | `synced_block` | `synced_from: null \| {type:'block_id', block_id}` | O |
  | 자동 파생 | `table_of_contents` | `color` | X |
  | 자동 파생 | `breadcrumb` | `{}` | X |
  | 페이지 | `child_page` | `title` | O |
  | 페이지 | `child_database` | `title` | O |
  | 기타 | `template` | `rich_text[]` | O |
  | 기타 | `meeting_notes` | `title`, `status`, `children`, `calendar_event`, `recording` | O |
  | 기타 | `transcription` | **`meeting_notes`의 구(舊) 명칭**. 2026-03-11 버전에서 `meeting_notes`가 정식 구현이고 `transcription`은 이전 네이밍 | O |
  | 폴백 | `unsupported` | `block_type` (실제 타입 식별자) | X |

  - `unsupported` 폴백 타입의 존재는 **클론에서도 반드시 따라 할 설계**다: 알 수 없는 타입이 들어와도 데이터 손실 없이 보존하고 "지원되지 않는 블록"으로 렌더한다.
  - `is_toggleable` 헤딩: heading 1~4는 플래그 하나로 접기 가능 헤딩이 된다(별도 타입 아님).
  - **`list_format`의 저장 위치가 특이하다**: `numbered_list_item.list_format`은 `"numbers"` / `"letters"` / `"roman"` 중 하나이며 **연속된 목록의 첫 항목에만 실린다**(공식 API 문서). 즉 "목록"이라는 엔티티가 따로 없고 **형제 블록의 연속 구간(run)이 곧 목록**이며, 서식은 그 run의 머리 블록이 대표한다. 클론도 같은 모델을 쓰면 목록 중간 블록을 다른 타입으로 바꿀 때 run이 자동으로 쪼개진다(별도 처리 불필요). 반대로 `list_start_index`(시작 번호)도 머리 블록에만 둔다.
  - **`heading_4`는 API에만 있고 UI에는 없다 (중요한 불일치)**: 공개 API 레퍼런스는 `heading_4`를 `heading_1~3`과 동일 구조로 문서화하고, **Notion-flavored enhanced markdown 문서도 헤딩을 "levels 1-4"로 규정하며 5~6단계는 4로 변환한다고 명시**한다(GAP 2회차 추가 확인 — 즉 H4는 API 표면 두 곳에 일관되게 존재한다). 반면 헬프센터의 헤딩 안내(`/help/columns-headings-and-dividers`)는 *"three heading levels — H1, H2, H3"*만 설명하고 슬래시 커맨드도 `/h1`·`/h2`·`/h3`만 안내한다. 즉 **API 스키마에는 4단계, 편집기 UI에는 3단계**로 어긋나 있다 `[확인필요]`(H4가 UI 미노출 상태인지, 특정 컨텍스트에서만 나오는지 확인 필요). **클론 판단**: 데이터 모델은 `heading_1..4`를 수용하되 편집기 UI는 H1~H3만 노출하고, H4는 `unsupported` 유사 폴백(H3로 렌더 + 원본 type 보존)으로 처리한다.
  - **[GAP 2회차 추가] Notion-flavored enhanced markdown**: 노션은 **모든 블록 타입과 rich text 타입을 표현하는 확장 마크다운 문법**을 공식 문서화하고 있으며, 페이지 생성·조회·수정 3개 엔드포인트가 이를 사용한다. 핵심 문법: 중첩은 **탭 들여쓰기**, 색상은 `{color="Color"}` 접미, 토글은 `<details><summary>`, 콜아웃은 `<callout icon="…" color="…">`, 컬럼은 `<columns><column>`, synced block은 `<synced_block url="…">`, 표는 `<table><tr><td>`, 빈 줄은 `<empty-block/>`. 명시된 한계: **블록 ID는 마크다운에 표현되지 않고**, **헤딩은 자식 블록을 가질 수 없으며**(→ `is_toggleable` 헤딩의 자식과 모순되는 지점 `[확인필요]`), **표 셀은 rich text만 담는다**. → **클론의 내보내기/가져오기 설계는 이 문법을 그대로 채택하는 것이 가장 저렴한 선택**이다(사양을 새로 발명하지 않아도 되고, 노션과의 상호 이전이 공짜로 따라온다). 출처: https://developers.notion.com/guides/data-apis/enhanced-markdown
  - `link_to_page`(블록 생성 요청 전용 타입)의 UI 대응물은 **`/link` 슬래시 커맨드 또는 `+` 메뉴의 "Link to page"**이며, 이렇게 추가하면 대상 페이지가 **사이드바에서 현재 페이지의 하위 페이지처럼 표시**된다(공식 확인). 조회 시 어떤 타입으로 내려오는지는 여전히 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자식 불가 타입(`code`, `divider`)에 Tab 중첩 시도 | 해당 블록이 앞 형제의 자식이 되는 것은 허용, 자기 자신은 자식을 못 가짐. 스키마 검증에서 구분 |
  | 빈 값 — `properties.title`이 빈 배열 | 플레이스홀더 렌더("텍스트를 입력하세요"), 저장은 정상 |
  | `column`이 `column_list` 밖에 존재 | 무효. 부모 타입 제약 검증 필요 |
  | `table_row`가 `table` 밖에 존재 | 무효 |
  | 알 수 없는 type 수신 | `unsupported`로 렌더하고 원본 JSON 보존(라운드트립 손실 금지) |
  | 미디어 파일 만료 URL | 노션 내부 파일 URL은 서명 URL로 만료됨 `[확인필요]`. 클론은 재서명 엔드포인트 필요 |
  | 권한 없음 | 타입별로 다르게: 코드 블록은 복사 버튼 숨김(공식 확인), 미디어는 다운로드 차단 |
  | **동시편집 — A가 `type`을 code로, B가 같은 블록에 자식을 추가** | 자식 추가가 나중이면 "자식 불가 타입에 자식이 붙은" 불법 상태가 된다. **서버가 트랜잭션 커밋 시점에 부모-자식 타입 제약을 재검증**하고 위반 시 자식을 조부모로 승격시켜 정합성 복구 |
  | **동시편집 — A가 `column_list`를 삭제, B가 그 안에 `column` 추가** | 컨테이너 자동 정리(F-01-12)와 충돌. 삭제 우선(tombstone) + 고아 `column`은 정리 배치가 회수 |
  | **스키마 버전이 다른 클라이언트가 접속(구버전 앱)** | 신규 타입을 `unsupported`로 보존만 하고 렌더는 회색 박스. **구버전이 저장할 때 원본 페이로드를 통째로 되돌려 써야** 라운드트립 손실이 없다 |
  | 대용량 — 한 페이지에 이미지 500장 | lazy loading + thumbnail 파생 필수 |

- **데이터 모델 함의**: 단일 `block` 테이블 + `type` 판별 + `properties`/`format` JSONB. 타입별 JSON Schema를 코드에 레지스트리로 두고 서버/클라이언트가 공유 검증. 부모-자식 허용 관계 표 필요(BlockSuite의 `metadata.children` 제약과 동형).
- **UI/인터랙션**: 타입별 렌더러 컴포넌트 + 타입별 hover 툴바(코드: 언어/복사/wrap, 이미지: 정렬/크기, 콜아웃: 아이콘 피커).
- **의존 기능**: F-01-01
- **구현 난이도**: **XL** — 타입 35종 전수는 각각 렌더러 + 편집 UI + 검증 스키마 + turn-into 매핑 + 내보내기 규칙 5종 세트를 요구한다(타입 1개당 대략 0.5~2일). MVP 12종으로 줄여도 **L**.
- **우선순위**: **P0**(paragraph, heading 1~3, bulleted/numbered/to_do, toggle, quote, callout, code, divider, image) / **P1**(bookmark, embed, equation, column, synced_block, table_of_contents, table) / **P2**(breadcrumb, template, meeting_notes, transcription, link_preview, audio/pdf)
- **클론 시 현실적 대안**: MVP는 12종. 나머지는 `unsupported` 폴백으로 저장만 하고 렌더는 회색 박스. 타입 추가는 레지스트리에 항목만 등록하면 되도록 플러그인 구조로.
- **참고 출처**: https://developers.notion.com/reference/block

---

### F-01-03 rich text 인라인 서식 (볼드 / 링크 / 컬러 / 인라인 코드 / 인라인 수식 / 멘션)

- **한 줄 정의**: 블록 내부 텍스트를 문자 범위 단위로 서식·링크·임베드 객체로 장식한다.
- **사용자 시나리오**:
  1. 텍스트를 드래그 선택 → 플로팅 툴바 등장 → `B` 클릭 또는 Cmd/Ctrl+B → 선택 범위에 `bold: true`.
  2. Cmd/Ctrl+K → URL 입력창 → 선택 범위에 `link.url` 설정.
  3. `@` 입력 → 사람/페이지/날짜 검색 팝업 → 선택 시 `mention` 오브젝트가 인라인 삽입(`@remind` + 날짜로 리마인더).
  4. `[[` 입력 → 페이지 링크 또는 새 페이지 생성 팝업.
  5. **`+` 입력**도 `@`/`[[`와 동일하게 페이지 멘션 팝업을 연다(공식 확인). 즉 **인라인 페이지 링크 트리거는 `@`, `[[`, `+` 세 가지**다.
  6. 인라인 수식: **`$$수식$$` 타이핑** 또는 **Cmd/Ctrl+Shift+E**, 또는 텍스트 선택 후 플로팅 툴바의 `√x` 버튼(모두 공식 확인). 상세는 F-01-20.
- **동작 상세**:
  - 서식 단축키(공식 키보드 단축키 페이지): Cmd/Ctrl+B(볼드), +I(이탤릭), +U(밑줄), +Shift+S(취소선), +E(인라인 코드), +K(링크).
  - `annotations` 필드는 정확히 6개다: `bold` `italic` `strikethrough` `underline` `code`(boolean 5개) + `color`(enum).
  - **컬러 정정(GAP 1회차)**: 이전 판은 "텍스트 10종 + 배경 10종"이라고 적었으나, 공개 API가 열거하는 값은 **텍스트 10종(`default` 포함: default/gray/brown/orange/yellow/green/blue/purple/pink/red)** + **배경 9종(`*_background`, `default_background`는 문서 열거에 없음)**이다. 즉 `color` enum 총 19개 값 `[확인필요]`(UI에서는 "기본 배경"이 배경 없음 상태로 표현되므로 `default_background`가 불필요할 뿐일 가능성). 클론은 `color: string` 하나로 텍스트/배경을 함께 표현하는 노션 방식을 그대로 쓰는 편이 API 호환에 유리하다 — **텍스트색과 배경색은 동시에 지정할 수 없다**는 제약이 이 표현에서 따라 나온다.
  - **[GAP 2회차 재검증]** 헬프센터 `/help/customize-and-style-your-content`가 열거하는 색상 목록도 `default` + 텍스트 9종 + 배경 9종 = **19개**로, 위 정정이 옳았음이 1차 출처로 재확인되었다(`default_background` 없음).
  - `/red`, `/blue background` 같은 슬래시 색상 커맨드로도 적용(공식 명시). **`Cmd/Ctrl + /` 후 색 이름 입력**, **`Cmd/Ctrl + Shift + H`(마지막 사용 색 재적용)**도 공식 단축키다(GAP 2회차 추가). 블록 전체 색상은 F-01-21에서 별도로 다룬다.
  - `annotations`는 **토글**이다: 선택 범위 전체가 bold면 해제, 일부만 bold면 전체 적용 `[확인필요]`.
  - `plain_text`는 파생 필드다 — 공개 API 문서가 "annotation을 제거한 텍스트, 서식 없는 텍스트에 접근하는 편의 수단"이라고 명시한다. 저장 시 서버가 재계산하는 것이 안전.
  - mention은 문자열이 아니라 **참조 객체**다. 대상 페이지 제목이 바뀌면 렌더 결과도 바뀐다.
  - **mention 타입 정정(GAP 1회차)**: 공개 API 문서가 열거하는 mention 타입은 **6종** — `user`, `page`, `database`, `date`, `link_preview`, `template_mention`. 이전 판이 적은 `custom_emoji`는 이 열거에 **없다** `[확인필요]`(별도 릴리스로 추가되었을 가능성). 클론은 6종 + 확장 여지를 둔 `type` 문자열로 설계한다.
  - `@` 멘션은 **backlink를 자동 생성**한다(공식). 대상 페이지에서 "{N} backlinks"로 역참조 목록을 볼 수 있고, **보는 사람이 접근 권한 없는 출처는 `Private`으로 라벨링**된다 — 클론도 backlink 목록에 권한 필터를 반드시 적용해야 한다(제목 유출 금지).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 서식만 있고 텍스트 없음 | 빈 span은 저장 전 제거 |
  | 서식 경계에 커서를 두고 타이핑 | 앞 span의 서식을 상속(노션 기본) `[확인필요]` |
  | 중첩 — 인라인 코드 + 볼드 | 두 annotation 동시 true 허용 |
  | 링크 텍스트를 부분 선택해 링크 해제 | span 분할 → 3개 span으로 정규화 |
  | 삭제된 참조 — mention 대상 페이지 삭제 | "삭제된 페이지"로 렌더, 클릭 시 휴지통 안내 |
  | 권한 없음 — mention 대상에 접근 불가 | 제목을 감추고 "권한 없는 페이지"로 렌더(**제목 유출 금지, 보안상 필수**) |
  | 동시편집 — 두 사용자가 같은 범위에 다른 서식 | 서식은 교환 가능(commutative)해 병합 가능. 텍스트 자체는 F-01-17 참고 |
  | 대용량 — 붙여넣기로 span 1만 개 | 인접 동일 annotation span 병합 정규화 필수 |

- **데이터 모델 함의**: `properties.title: RichText[]`. **정규화 규칙 필수**: (1) 인접 동일 annotation span 병합, (2) 빈 span 제거, (3) `plain_text` 재계산. mention은 `block(id)`/`user(id)`를 논리적으로 참조하지만 물리 FK는 걸지 않는다(삭제 후에도 참조 보존 필요).
  - **backlink 역인덱스 테이블이 별도로 필요하다** — rich text JSONB 안을 스캔해서 "이 페이지를 멘션한 블록"을 찾는 것은 확장되지 않는다:
    ```sql
    CREATE TABLE block_mention (
      source_block_id UUID NOT NULL,      -- 멘션이 들어 있는 블록
      source_page_id  UUID NOT NULL,      -- 권한 필터링용 (역참조 목록 렌더 시)
      target_type     TEXT NOT NULL,      -- 'page' | 'user' | 'database' | ...
      target_id       UUID NOT NULL,
      PRIMARY KEY (source_block_id, target_type, target_id)
    );
    CREATE INDEX ON block_mention (target_type, target_id);
    ```
    블록 저장 트랜잭션의 후처리 훅에서 rich text를 파싱해 이 테이블을 **전량 재작성(delete+insert)** 한다. 부분 갱신은 동시편집에서 어긋난다.
  - **검색 인덱스 파생**: `plain_text`를 이어붙인 `block.search_text` 컬럼(또는 tsvector)을 같은 훅에서 갱신. rich text JSONB를 직접 full-text 검색 대상으로 삼지 않는다.
  - **길이/개수 상한**: rich text 배열 100 요소(공개 API). 정규화 후에도 100을 넘으면 **초과분을 잘라내지 말고 블록 분할**(F-01-19)을 제안해야 데이터 손실이 없다.
- **UI/인터랙션**: 선택 시 플로팅 툴바, `@` / `[[` 트리거 팝업, 링크 hover 시 미리보기 팝오버, 컬러 서브메뉴, Cmd/Ctrl+Shift+M(코멘트).
- **의존 기능**: F-01-01, F-01-02
- **구현 난이도**: **L** — span 분할/병합 로직, 브라우저 selection ↔ 모델 오프셋 매핑, 한글 IME 조합 중 selection 보존이 각각 버그의 온상. mention까지 포함하면 backlink 역인덱스와 권한 필터가 붙어 L 상단.
- **우선순위**: **P0**(bold/italic/strikethrough/code/link) / **P1**(color, mention, 인라인 equation) / **P2**(밑줄, custom emoji mention)
- **클론 시 현실적 대안**: 직접 구현 대신 ProseMirror/Tiptap의 mark 시스템을 채택하고 저장 시 노션형 `RichText[]`로 직렬화. span 병합은 ProseMirror가 자동 처리한다.
- **참고 출처**: https://developers.notion.com/reference/rich-text , https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/writing-and-editing-basics

---

### F-01-04 슬래시(/) 커맨드 메뉴

- **한 줄 정의**: `/`를 입력하면 블록 타입·변환·색상·액션을 검색해 실행하는 명령 팔레트가 열린다.
- **사용자 시나리오**:
  1. 새 줄에서 `/` 입력 → 전체 커맨드 목록이 카테고리별로 표시.
  2. 이어서 `cal` 입력 → 목록이 `callout`으로 필터링(입력마다 실시간 필터).
  3. ↑/↓로 이동, Enter 또는 클릭으로 실행 → `/`와 뒤에 입력한 쿼리 문자열은 **삭제되고** 블록이 해당 타입으로 생성/변환됨.
  4. Esc 또는 매칭 0건 상태에서 계속 입력 → 메뉴가 닫히고 `/cal`이 평문으로 남는다.
- **동작 상세**:
  - 공식 문서가 명시한 커맨드 계열: 콘텐츠 추가(`/image`, `/quote`, `/callout`, `/web`, `/code`, `/page`, `/bullet`, `/toggle`, `/h1`, `/video`), **색상**(`/red` 등 slash color), **변환**(`/turn` 계열 — 공식 단축키 문서는 `/turn`으로 표기, 헬프 가이드는 `/turnbullet` 같은 결합형 예시), 액션(`/comment`, `/duplicate`).
  - GAP 1회차에서 개별 헬프 페이지로 추가 확인한 커맨드:

    | 커맨드 | 결과 | 출처 |
    |---|---|---|
    | `/table` | 심플 테이블 삽입(F-01-18) | `/help/columns-headings-and-dividers` |
    | `/div` | divider 삽입 | `/help/columns-headings-and-dividers` |
    | `/math` | **블록 수식** 삽입(F-01-20) | `/help/math-equations` |
    | `/link` | "Link to page" — 다른 페이지로의 블록 링크(사이드바에 하위 페이지처럼 표시) | `/help/create-links-and-backlinks` |
    | `/turn` | Turn into 메뉴 | `/help/keyboard-shortcuts` |

  - `+` 버튼(빈 줄 hover 시 좌측에 노출)은 슬래시 메뉴와 **동일한 삽입 메뉴**를 여는 마우스용 진입점이다(코드 블록·수식 블록·divider·테이블·Link to page 모두 이 경로로도 삽입 가능, 공식 확인). 즉 커맨드 레지스트리 하나를 두 UI가 공유한다.
  - 메뉴는 입력에 따라 동적으로 필터링된다(공식 명시). 필터 방식(prefix / fuzzy)은 `[확인필요]`.
  - `/` 뒤에 공백이 오면 메뉴가 닫히는 것으로 보인다 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 문장 중간의 `https://` 안 슬래시 | 메뉴가 열리면 안 됨 → **트리거 조건: `/` 앞이 줄 시작 또는 공백일 때만** |
  | 중첩 — 코드 블록 안에서 `/` | 메뉴 열리지 않음 |
  | 빈 값 — 검색 결과 0건 | 메뉴 자동 닫힘, 입력은 평문 유지 |
  | 이미 내용이 있는 블록에서 실행 | 변환형 커맨드는 텍스트 보존(F-01-06), 삽입형 커맨드는 **새 블록 삽입** |
  | 권한 없음(읽기 전용) | 메뉴 자체를 열지 않음 |
  | 동시편집 — 메뉴 열린 채 다른 사용자가 블록 삭제 | 메뉴 닫고 커서 복구 |
  | 대용량 — 커맨드 수백 개 | 최근 사용/가중치 기반 상위 N개 우선 노출 |
  | 삭제된 참조 — `/turn into` 대상 타입이 비활성화됨 | 목록에서 제외 |

- **데이터 모델 함의**: 저장 데이터 없음(순수 UI). "최근 사용 커맨드" 개인화 시 `user_preference(user_id, recent_slash_commands JSONB)` 필요. 커맨드 레지스트리는 `{id, label, aliases[], keywords[], category, group, handler}` 구조로, F-01-02의 블록 타입 레지스트리에서 자동 생성하는 것이 유지보수에 유리.
- **UI/인터랙션**: 커서 위치 기준 포지셔닝(뷰포트 하단이면 위로 뒤집기), 카테고리 헤더, 아이콘, 키보드 내비게이션, 항목 hover 시 미리보기 `[확인필요]`.
- **의존 기능**: F-01-02(타입 레지스트리), F-01-06(turn into)
- **구현 난이도**: **M** — 메뉴 UI 자체는 단순하나 트리거 조건·커서 포지셔닝·한글 IME 조합 처리에서 시간이 든다.
- **우선순위**: **P0** — 노션 편집 흐름의 주 진입점.
- **클론 시 현실적 대안**: BlockNote/Tiptap의 suggestion 플러그인을 사용하면 트리거·필터·포지셔닝이 이미 해결된다. 한글 IME 조합 중 트리거는 `compositionend` 이후 평가로 회피.
- **참고 출처**: https://www.notion.com/help/guides/using-slash-commands , https://www.blocknotejs.org/docs

---

### F-01-05 마크다운 단축 입력 (블록 / 인라인)

- **한 줄 정의**: 특정 문자열을 입력하고 스페이스/닫는 마커를 누르면 즉시 블록 타입이나 인라인 서식으로 자동 변환된다.
- **사용자 시나리오**: 빈 줄에 `##` + 스페이스 → 즉시 heading_2로 변환되고 `##`는 사라짐. 문장 중간에 `**중요**` 입력 → 닫는 `**` 입력 순간 "중요"가 볼드로 변환되고 마커는 제거됨.
- **동작 상세** — 공식 단축키 문서 기준 전수:

  | 입력 | 트리거 | 결과 |
  |---|---|---|
  | `*` / `-` / `+` | + 스페이스 | bulleted_list_item |
  | `1.` / `a.` / `i.` | + 스페이스 | numbered_list_item |
  | `[]` | + 스페이스 | to_do |
  | `#` | + 스페이스 | heading_1 |
  | `##` | + 스페이스 | heading_2 |
  | `###` | + 스페이스 | heading_3 |
  | `>` | + 스페이스 | toggle |
  | `"` | + 스페이스 | quote |
  | `---` | 즉시 | divider |
  | `` `텍스트` `` | 닫는 백틱 | 인라인 코드 |
  | `**텍스트**` | 닫는 `**` | 볼드 |
  | `*텍스트*` | 닫는 `*` | 이탤릭 |
  | `~텍스트~` | 닫는 `~` | 취소선 |
  | `$$수식$$` | 닫는 `$$` | **인라인 수식**(공식 확인, `/help/math-equations`) |

  - GAP 1회차 재검증 + **GAP 2회차 정정**: 공식 키보드 단축키 페이지가 실제로 열거하는 것은 **인라인 4종(`**` `*` `` ` `` `~`) + 줄머리 8종(`*`/`-`/`+`, `[]`, `1.`/`a.`/`i.`, `#`, `##`, `###`, `>`, `"`)** 이다. 위 표의 나머지 두 행은 출처가 다르다: **`---` → divider는 키보드 단축키 페이지가 아니라 `/help/columns-headings-and-dividers`가 확인**해 준다(*"Type `---` (three hyphens in a row) and a divider will automatically pop up."*), **`$$…$$` → 인라인 수식은 `/help/math-equations`**가 확인해 준다. 1회차가 "전부 키보드 단축키 페이지와 일치"라고 적은 것은 부정확했다.
  - 세 개의 백틱(```)으로 코드 블록을 만드는 동작은 **여전히 어느 공식 페이지에도 없다** `[확인필요]` — 널리 관찰되지만 1차 근거 없음.
  - **[GAP 2회차] `>`의 의미가 입력 규칙과 직렬화 포맷에서 서로 다르다**: 편집기 입력 규칙에서 `>` + 스페이스는 **toggle**이지만, Notion-flavored enhanced markdown에서 `> Rich text`는 **quote**다(F-01-02 참조). 즉 **"마크다운을 붙여넣을 때"와 "마크다운을 타이핑할 때"의 `>` 처리가 달라야 노션과 동일해진다.** 클론이 이 둘을 같은 파서로 처리하면 반드시 어긋난다 — 입력 규칙(inputRules)과 붙여넣기 파서(F-01-10)를 **별개 규칙 집합**으로 분리할 것.
  - **공식 목록에 없는 흔한 오해들**(클론이 "노션에 있다"고 착각하고 넣기 쉬운 것들): `> ` → 노션에서는 **quote가 아니라 toggle**이다(quote는 `"` + 스페이스). `- [ ]` 형태가 아니라 `[]` + 스페이스가 체크박스다. `___`/`***` 구분선 변형은 공식 목록에 없다 `[확인필요]`. **이 세 가지는 마크다운 관습과 노션이 다른 지점이므로 클론에서 의도적으로 선택해야 한다.**
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 변환 직후 Cmd/Ctrl+Z | **변환만 취소**되고 원래 마커 텍스트가 복원되어야 한다(입력 전체 취소 금지) — 사용성 핵심 |
  | 중첩 — 코드 블록 내부 | 마크다운 변환 전면 비활성 |
  | 이미 heading인 줄에 `#` 재입력 | 변환하지 않고 평문 `#` 유지 `[확인필요]` |
  | `*` 하나만 입력 후 스페이스 | bulleted list로 변환(이탤릭 아님) — 규칙 우선순위 명시 필요 |
  | 한글 IME 조합 중 | `compositionend` 후에만 판정. 조합 중 판정하면 문자 유실 |
  | 빈 값 — `**` `**`처럼 내용 없는 마커 | 변환하지 않음 |
  | 줄 시작이 아닌 곳에서 `# ` | 변환 금지 |
  | `1.` 이후 이어지는 줄 | 자동 번호 증가, 중간 삭제 시 재번호 매김 |
  | 동시편집 | 변환은 로컬에서 즉시 → 결과 트랜잭션만 전송(중간 상태 전송 금지) |
  | 권한 없음 | 편집 불가이므로 해당 없음 |

- **데이터 모델 함의**: 저장 없음. 단 "변환 취소" 지원을 위해 undo 스택이 **의미 단위 트랜잭션**을 저장해야 하며(F-01-17), 이는 operation 로그 설계에 영향을 준다.
- **UI/인터랙션**: 변환 시 마커 문자 즉시 제거, 커서는 변환된 블록의 텍스트 시작 위치.
- **의존 기능**: F-01-02, F-01-06
- **구현 난이도**: **M** — 규칙 자체는 단순하나 IME·undo 상호작용이 까다롭다. 규칙 14개 × (트리거 조건 + 마커 제거 + 커서 배치 + undo 역연산) 테스트가 실질 작업량.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: ProseMirror `inputRules` / Tiptap InputRule로 선언적으로 구현. 인라인 규칙은 정규식 기반 `markInputRule`. **주의**: ProseMirror의 기본 `undoInputRule`은 "직전 입력 규칙 1개 되돌리기"만 제공하므로, 위 엣지 케이스의 "변환만 취소" 요구를 만족하는지 규칙별로 테스트해야 한다.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/writing-and-editing-basics , https://www.notion.com/help/columns-headings-and-dividers

---

### F-01-06 블록 타입 변환 (Turn into)

- **한 줄 정의**: 기존 블록의 텍스트 내용을 보존한 채 `type`만 교체한다.
- **사용자 시나리오**:
  1. 블록 왼쪽 `⋮⋮` 핸들 클릭 → 메뉴에서 `Turn into` → 하위 목록에서 대상 타입 선택.
  2. 또는 블록 선택 후 Cmd/Ctrl+`/`(공식 단축키: "edit/change blocks") → 변환 메뉴.
  3. 또는 `/turnbullet` 같은 slash turn 커맨드.
  4. 여러 블록을 선택한 상태에서도 일괄 변환 가능.
- **동작 상세**:
  - `id`, `parent`, 자식, 순서는 **유지**되고 `type`과 일부 `properties`만 바뀐다.
  - properties 매핑 규칙(클론 설계 기준):

    | 원본 → 대상 | properties 처리 |
    |---|---|
    | 텍스트류 ↔ 텍스트류(paragraph/heading/list/quote/toggle/callout) | `title` 그대로 이전 |
    | 텍스트류 → `code` | rich text를 plain_text로 평탄화(서식 손실), `language` 기본값 지정 |
    | `code` → 텍스트류 | 코드 문자열을 단일 text span으로 |
    | 텍스트류 → `divider`/`image` 등 무텍스트 타입 | 텍스트가 버려짐 → **경고 또는 undo 보장 필요** |
    | `to_do` → 다른 타입 | `checked` 값 폐기 |
    | 자식 있는 블록 → 자식 불가 타입(code 등) | 자식 처리 정책 필요: 승격 또는 변환 차단 `[확인필요]` |
  - `Turn into Page`: **공식 가이드 확인(GAP 2회차, `[확인필요]` 해제)** — *"turn a block into a separate page and choose its location"*, 그리고 *"Multiple content blocks can be turned into pages and nested elsewhere in the workspace"*. 즉 ① 블록이 독립 페이지로 승격되고 ② **승격 시 배치 위치를 사용자가 고른다** ③ 다중 블록을 한 번에 페이지들로 만들 수 있다. 원래 위치에 남는 것이 페이지 링크인지 `child_page` 블록인지는 여전히 `[확인필요]`.
  - `Turn into Synced block`: 선택 블록들을 `synced_block`으로 감싼다(F-01-11, 공식 문서에 명시된 생성 경로).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 빈 블록 변환 | 정상 변환, 플레이스홀더만 바뀜 |
  | 중첩 — 자식 있는 블록을 code로 변환 | 위 표 참조. 자식 손실 금지가 원칙 |
  | 다중 선택에 서로 다른 타입 혼재 | 전부 대상 타입으로 통일 |
  | 삭제된 참조 — 변환 중 블록이 삭제됨 | 트랜잭션 실패 처리 |
  | 동시편집 | type은 별도 필드라 텍스트 편집과 병합 가능. type 자체 충돌은 LWW |
  | 권한 없음 | 메뉴 비활성 |
  | 대용량 — 1000블록 일괄 변환 | 단일 트랜잭션 배치 + 진행 표시 |

- **데이터 모델 함의**: `block.type` UPDATE + `properties` 재작성 1건. operation 로그: `{op:'update', path:['type']}` + `{op:'update', path:['properties']}`. 변환 전 properties 스냅샷을 undo 스택에 보관.
- **UI/인터랙션**: `⋮⋮` 메뉴 → Turn into 서브메뉴(검색 가능), Cmd/Ctrl+`/`, slash turn 커맨드.
- **의존 기능**: F-01-01, F-01-02, F-01-09(다중 선택 시)
- **구현 난이도**: **M** — 변환 매트릭스(타입 N×N) 정의가 실질 작업량. N=12면 관리 가능.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: N×N 매트릭스 대신 **중간 표현 1개**를 둔다: 모든 타입이 `{ text: RichText[], children: Block[], extra: {} }`로 내려갔다가 대상 타입으로 올라온다. 규칙이 N개(타입별 to/from)로 줄어든다.
- **참고 출처**: https://www.notion.com/help/writing-and-editing-basics , https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/guides/using-slash-commands , https://www.notion.com/help/synced-blocks

---

### F-01-07 중첩 (들여쓰기 / 내어쓰기)

- **한 줄 정의**: Tab / Shift+Tab으로 블록의 부모를 바꿔 트리 깊이를 조절한다.
- **사용자 시나리오**: 리스트 항목에서 Tab → 직전 형제의 자식으로 들어가며 시각적으로 들여쓰기됨. Shift+Tab → 부모의 다음 형제로 올라감.
- **동작 상세**:
  - 노션 공식 블로그: "들여쓰기는 스타일이 아니라 블록과 content의 관계 조작"이며, "현재 선택된 블록이 직전 블록의 content 배열로 이동한다".
  - **Tab 가능 조건**: 직전 형제 블록이 존재하고, 그 블록이 자식을 가질 수 있는 타입이어야 한다. 페이지 첫 블록에서 Tab은 무효.
  - Shift+Tab: 현재 블록이 부모의 **다음 형제**가 된다. 현재 블록 뒤에 있던 형제들의 처리(현재 블록의 자식으로 승계하는지)는 `[확인필요]`.
  - 렌더 방식은 타입마다 다르다(공식 블로그): 텍스트/불릿/투두는 자식을 들여쓰기해 항상 표시, 토글은 펼쳤을 때만 표시.
  - 최대 중첩 깊이는 공식적으로 명시되지 않음 `[확인필요]`. 다만 **공개 API는 한 요청에서 자식 중첩을 2단계까지만 허용**한다(`/reference/patch-block-children`: *"For blocks that allow children, we allow up to two levels of nesting in a single request."*). 이는 저장 깊이 제한이 아니라 **요청 단위 제한**이므로, 실제 문서 깊이 제한과는 별개다.
  - `Tab` 가능 조건에 관한 블로그 원문은 *"pressing indent in a content block tries to add that block to the content of the **nearest sibling** block"* 이다. "직전 형제"가 정확히 **직전 형제 하나**인지 "가장 가까운 형제(위쪽 탐색)"인지는 원문만으로 확정되지 않는다 `[확인필요]`. 클론 권장 규칙: **직전 형제 하나만** 후보로 삼고, 그 형제가 자식 불가 타입이면 Tab을 무효 처리(탐색을 위로 계속 올라가지 않음) — 예측 가능성이 높다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 페이지 첫 블록에서 Tab | 무시(변화 없음) |
  | 빈 값 — 빈 블록 Tab | 정상 중첩(내용 무관) |
  | 중첩 — 코드 블록 안에서 Tab | 들여쓰기가 아니라 **탭 문자 삽입**(컨텍스트 분기 필수) |
  | 다중 선택 상태 Tab | 선택된 **최상위** 블록들만 이동, 상대 구조 유지 |
  | 이미 자식을 가진 블록을 Tab | subtree 전체가 함께 이동 |
  | 자기 자신의 후손으로 이동 시도(드래그 경유) | 차단 |
  | 삭제된 참조 — 직전 형제가 방금 삭제됨 | 새 직전 형제 기준 재계산 또는 무시 |
  | 동시편집 — 두 사용자가 같은 블록을 각각 Tab/Shift+Tab | 마지막 트랜잭션 승리. 트리 무결성(고아 블록 없음)만 보장 |
  | 권한 없음 | 동작 안 함 |
  | 대용량 — 깊이 50단계 | 렌더 성능/가독성 문제. 클론은 **최대 깊이(예: 20)** 제한 권장 `[추정]`. 재귀 렌더는 스택 대신 반복문 + 플랫 리스트로 구현할 것 |
  | **API를 통한 깊은 subtree 생성** | 공개 API 호환 레이어는 요청당 2단계까지만 허용하고 초과 시 400 반환. 내부 API는 제한 없음(단일 트랜잭션 보장) |
  | **동시편집 — A가 부모를 삭제하는 동안 B가 그 아래로 Tab** | Tab 트랜잭션이 참조하는 새 부모가 tombstone이면 **거부하고 로컬 롤백**. 살아있는 조상으로 자동 재배치하면 사용자가 블록을 잃어버린 것처럼 느낀다 |
  | column 안 블록에서 Shift+Tab 반복 | column 밖으로 나가지 않도록 경계 처리 |

- **데이터 모델 함의**: `parent_id` UPDATE + `order_key` 재계산. `content[]` 방식이면 두 부모의 배열 2건 UPDATE. 트랜잭션 원자성 필요(중간 상태에서 블록이 트리에서 사라지면 안 됨).
- **UI/인터랙션**: Tab / Shift+Tab. 들여쓰기는 좌측 패딩 + (리스트/토글의 경우) 가이드 라인.
- **의존 기능**: F-01-01, F-01-02(자식 허용 여부)
- **구현 난이도**: **M** — 규칙은 명확하나 다중 선택·경계(column/table) 조합에서 케이스가 늘어난다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: MVP에서는 "직전 형제의 마지막 자식으로 이동" 단일 규칙만 구현하고, Shift+Tab 시 후속 형제 승계는 v1로 미룬다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://www.notion.com/help/keyboard-shortcuts

---

### F-01-08 드래그 앤 드롭 재정렬 + 블록 핸들 메뉴

- **한 줄 정의**: `⋮⋮` 핸들로 블록을 잡아 페이지 어디로든 옮기고, 같은 핸들의 메뉴로 블록 단위 액션을 수행한다.
- **사용자 시나리오**:
  1. 블록에 hover → 좌측 여백에 `⋮⋮`(그립)와 `+` 버튼 등장.
  2. `⋮⋮`를 드래그 → **파란 가이드 라인**이 드롭 위치를 표시(가로선 = 위/아래 삽입, 세로선 = 컬럼 생성).
  3. 마우스를 놓으면 해당 위치로 이동.
  4. `⋮⋮` 클릭 → 메뉴: `Turn into`, `Color`, `Copy link to block`, `Duplicate`, `Move to`, `Delete`, `Comment`, `Suggest edits`, `Ask AI`, `Word and character count`(공식 문서 기준).
  - 키보드 대안: 블록 선택 후 Cmd/Ctrl+Shift+↑/↓로 이동, Cmd/Ctrl+D로 복제.
- **동작 상세**:
  - 공식 문서: "모든 콘텐츠 블록(텍스트 줄 포함)은 드래그 앤 드롭 가능하며, 파란 가이드가 이동 위치를 보여준다." 테이블 행/데이터베이스 카드도 같은 핸들 UX를 공유.
  - 드롭 존 3종: **형제 삽입(위/아래)**, **자식 삽입(들여쓴 위치)**, **컬럼 생성(좌/우 측면)** — 마지막이 F-01-12의 주 컬럼 생성 경로다.
  - 드래그 대상은 subtree 전체(자식 포함).
  - `Move to`는 드래그 없이 다른 페이지로 블록을 이송하는 별도 액션.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자기 자신 또는 후손 위로 드롭 | 차단(드롭 존 비활성) |
  | 빈 값 — 빈 페이지에 드롭 | 첫 블록으로 삽입 |
  | 중첩 — 접힌 토글 위로 드래그 | hover 지연 후 자동 펼침(spring-loaded) |
  | 다중 선택 드래그 | 선택 subtree들이 상대 순서를 유지한 채 이동 |
  | 삭제된 참조 — 드래그 중 대상 위치 블록이 삭제됨 | 위치 재계산 또는 드롭 실패 롤백 |
  | 동시편집 — 두 사용자가 동시에 같은 블록 이동 | fractional index면 마지막 이동이 최종 위치. 블록은 소실되지 않음 |
  | 권한 없음 | 핸들 자체를 노출하지 않음 |
  | 대용량 — 긴 페이지 드래그 | 가장자리 자동 스크롤 + 드롭 타겟 계산을 뷰포트 내로 제한 |
  | 터치/모바일 | 롱프레스 후 드래그. 컬럼 생성은 폰에서 미지원(공식: 컬럼은 태블릿까지) |

- **데이터 모델 함의**: 이동은 `parent_id` + `order_key` UPDATE 1건(fractional index 채택 시). `content[]` 방식이면 원부모 배열 제거 + 새 부모 배열 삽입 2건. `Duplicate`는 subtree 깊은 복사(모든 자손에 **새 UUID 발급**) — 재귀 복사 함수 필요. `Copy link to block`은 `/{pageId}#{blockId}` 형태 URL.
- **UI/인터랙션**: hover 시 좌측 gutter 노출, 드래그 고스트, 파란 가이드, Cmd/Ctrl+Shift+↑/↓, Cmd/Ctrl+D.
- **의존 기능**: F-01-01, F-01-09
- **구현 난이도**: **L** — 드롭 존 히트테스트(특히 컬럼 생성 판정)와 중첩 트리 좌표 계산이 난점.
- **우선순위**: **P0**(단순 상하 이동) / **P1**(컬럼 생성 드롭, Move to)
- **클론 시 현실적 대안**: dnd-kit 또는 드래그 핸들이 내장된 BlockNote를 사용. 컬럼 생성 드롭은 v1로 미루고 `/columns` 커맨드로 대체.
- **참고 출처**: https://www.notion.com/help/writing-and-editing-basics , https://www.notion.com/help/columns-headings-and-dividers , https://www.notion.com/help/keyboard-shortcuts

---

### F-01-09 멀티 블록 선택 및 일괄 조작

- **한 줄 정의**: 여러 블록을 동시에 선택해 이동·삭제·변환·색상·복제를 한 번에 수행한다.
- **사용자 시나리오** (모두 공식 문서 확인):
  - 페이지 좌/우 여백에서 드래그 → 지나간 블록들이 전체 선택.
  - 블록 편집 중 `Esc` → 현재 블록 전체 선택 상태로 전환.
  - `Shift+↑/↓` → 선택 범위 확장.
  - `Shift+클릭` → 클릭한 블록과 그 사이 모든 블록 선택.
  - `Cmd+Shift+클릭`(Mac) / `Alt+Shift+클릭`(Win/Linux) → 개별 블록 선택/해제(비연속 선택).
  - `Cmd/Ctrl+A` → 블록 선택 → 반복 시 상위 범위로 확장.
  - 선택 상태에서 Backspace(삭제), Cmd/Ctrl+D(복제), Cmd/Ctrl+Shift+↑↓(이동), Cmd/Ctrl+`/`(변환).
- **동작 상세**:
  - **블록 전체 선택**과 **텍스트 부분 선택**은 별개 모드다. 공식 문서: 블록 내부에서 드래그하면 여러 문단·불릿·콜아웃에 걸쳐 부분 텍스트를 선택·잘라내기·복사·붙여넣기 할 수 있다. **단 Firefox에서는 블록 간 부분 텍스트 선택이 동작하지 않는다(공식 명시)** — 출처는 2022-01-19 릴리스 노트로 확정되었다(GAP 2회차): 해당 기능이 *"available on all platforms except Firefox"*이며 Mozilla와 협업 중이라고 명시. 즉 **4년 넘게 미해결 상태**이므로 클론도 동일 제약을 감수해도 된다.
  - 자식이 있는 블록을 선택하면 자식도 암묵적으로 포함된다 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 선택 0개에서 액션 | 액션 비활성 |
  | 중첩 — 부모와 자식을 함께 선택 후 이동 | 자식 중복 이동 금지 → **최상위 노드만 추출(top-level normalization)** 필수 |
  | 서로 다른 컬럼에 걸친 선택 | 허용하되 이동 시 대상 컨테이너 결정 규칙 필요 |
  | 삭제된 참조 — 선택 중 다른 사용자가 해당 블록 삭제 | 선택 집합에서 자동 제외 |
  | 동시편집 — 협업자에게 내 선택 표시 | awareness 채널로 브로드캐스트(선택) |
  | 비연속 선택 후 Turn into | 각 블록 개별 변환 |
  | 권한 없음 | 선택은 허용(복사 목적), 변경 액션은 비활성 |
  | 대용량 — 1000블록 선택 후 삭제 | 단일 트랜잭션 배치 + 진행 표시 |

- **데이터 모델 함의**: 선택 상태는 클라이언트 전용(저장 X). 협업 선택 공유 시 `presence` 채널에 `{userId, selectedBlockIds[]}` 브로드캐스트. 일괄 조작은 **단일 tx_id**로 묶어 undo 1회에 되돌아가게 한다.
- **UI/인터랙션**: 선택 블록에 파란 오버레이, 선택 개수 배지 `[확인필요]`, 선택 상태 전용 툴바.
- **의존 기능**: F-01-01, F-01-06, F-01-08
- **구현 난이도**: **L** — top-level normalization, 비연속 선택, 텍스트↔블록 선택 모드 전환이 각각 별도 로직.
- **우선순위**: **P0**(연속 선택 + 삭제/이동) / **P1**(비연속 선택, Cmd+A 단계 확장)
- **클론 시 현실적 대안**: MVP는 연속 범위 선택만(anchor/head 인덱스 두 개). 비연속 선택은 v2. Firefox 부분 선택 문제는 노션조차 미해결이므로 클론도 동일 제약을 감수 가능.
- **참고 출처**: https://www.notion.com/help/writing-and-editing-basics , https://www.notion.com/help/keyboard-shortcuts

---

### F-01-10 복사 / 붙여넣기 시 구조 보존

- **한 줄 정의**: 블록 트리를 클립보드에 다중 포맷으로 싣고, 외부에서 들어온 HTML/마크다운/URL을 블록 구조로 파싱해 삽입한다.
- **사용자 시나리오**:
  1. 블록 여러 개 선택 → Cmd/Ctrl+C → 같은 앱 다른 페이지에 Cmd/Ctrl+V → **중첩 구조와 서식이 그대로** 복원.
  2. 노션 밖(에디터/메모장)에 붙여넣기 → 마크다운 또는 서식 있는 텍스트로 붙는다.
  3. 웹페이지에서 복사한 HTML 붙여넣기 → 헤딩/리스트/링크/이미지가 대응 블록으로 변환.
  4. URL 붙여넣기 → 어떤 형태로 넣을지 선택하는 프롬프트가 뜬다. **선택지 중 "Paste as mention"은 공식 문서로 확인**되며, 이 형태는 "아이콘 + 출처 + 페이지 제목"으로 렌더된다(`/help/create-links-and-backlinks`). 나머지 선택지(평문 링크 / bookmark / embed)의 **정확한 라벨과 개수는 여전히** `[확인필요]`.
  5. Cmd/Ctrl+Shift+V → 서식 없는 평문 붙여넣기 `[확인필요]`.
- **동작 상세**:
  - 클립보드에 최소 3종 페이로드를 동시에 기록해야 한다:

    | MIME | 용도 |
    |---|---|
    | `text/plain` | 외부 평문 |
    | `text/html` | 외부 서식 유지 |
    | `application/x-{app}-blocks+json` (커스텀) | **앱 내부 무손실 라운드트립** — 블록 트리 JSON |
  - 내부 붙여넣기: 커스텀 MIME이 있으면 그것으로 subtree를 복제하며 **모든 블록에 새 UUID 재발급**(원본 ID 재사용 금지 — 중복 ID 사고 방지).
  - **[GAP 2회차 — 2022-01-19 릴리스 내역 확정, `[확인필요]` 해제]** 해당 릴리스의 텍스트/복붙 관련 내역은 정확히 다음 두 가지다: ① *"Click & drag to select, cut, copy & paste partial text across paragraphs, bullet lists, callouts & more — without having to select each block"*(데스크톱) ② 모바일에서 더블탭 후 드래그로 **여러 블록에 걸친 선택/복붙**. 그리고 이 기능은 **Firefox를 제외한 모든 플랫폼**에서 동작한다고 명시된다. → 클론 함의: **"블록 경계를 넘는 부분 텍스트 선택"이 복붙 설계의 1급 요구사항**이며, 이는 `contenteditable`을 블록마다 따로 두는 구현(블록 단위 격리)과 정면으로 충돌한다. **페이지 전체를 하나의 `contenteditable`로 두거나(ProseMirror 방식) 브라우저 selection을 직접 다뤄야** 한다 — F-01-19·F-01-17의 아키텍처 선택과 같은 지점에서 결정된다. 출처: https://www.notion.com/releases/2022-01-19
  - **[GAP 2회차] 내보내기/가져오기 포맷의 1차 출처 확보**: 노션은 모든 블록 타입을 표현하는 **Notion-flavored enhanced markdown**을 공식 문서화한다(F-01-02 참조). 클론의 `text/plain`·`text/markdown` 클립보드 페이로드를 이 문법으로 맞추면 **노션 ↔ 클론 상호 붙여넣기가 상당 부분 무손실**이 된다. 특히 컬럼(`<columns>`)·토글(`<details>`)·콜아웃(`<callout>`)·synced block처럼 표준 마크다운에 대응물이 없는 것들이 여기서 해결된다. 출처: https://developers.notion.com/guides/data-apis/enhanced-markdown
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 클립보드가 비어 있음 | 무동작 |
  | 중첩 — 3단계 중첩 subtree 복사 | 구조 그대로 재현. 붙여넣는 위치의 깊이에 더해짐 |
  | synced block 복사 | 붙여넣은 것도 동일 원본을 가리키는 sync 사본이어야 함(F-01-11) |
  | 이미지/파일 블록 복사 | 파일 복제 vs 참조 공유 결정 필요. 참조 공유 시 원본 삭제로 깨짐 → **참조 카운트** 권장 `[추정]` |
  | 삭제된 참조 — 복사 후 원본 삭제, 그 뒤 붙여넣기 | 클립보드 JSON에 스냅샷이 있으므로 정상 삽입 |
  | 다른 워크스페이스로 붙여넣기 | 파일 재업로드, 권한 밖 mention은 plain_text로 강등 |
  | 권한 없음 — 붙여넣기 대상이 읽기 전용 | 차단 + 안내 |
  | 동시편집 — 붙여넣는 사이 대상 위치 변경 | 삽입 위치 재계산 |
  | 대용량 — 수천 노드 HTML | 파싱 시간 제한 + 1회 블록 수 상한(예: 5000) |
  | 붙여넣기 대상이 텍스트 중간 | 첫 블록은 인라인 병합, 나머지는 새 블록으로 분리 |
  | 코드 블록 안에 붙여넣기 | 항상 평문 삽입(구조 파싱 금지) |
  | 스프레드시트 표 붙여넣기 | `table` 블록으로 변환 `[확인필요]` |

- **데이터 모델 함의**: subtree 직렬화 포맷 정의(`{blocks: Block[], rootIds: string[]}` — 부모 참조는 로컬 인덱스). 붙여넣기 시 ID 리매핑 테이블(`oldId -> newId`)로 내부 참조(자식, `synced_from`) 일괄 치환. 파일 블록은 `file(id, url, size, ref_count)` 별도 테이블.
- **UI/인터랙션**: Cmd/Ctrl+C/V/X, Cmd/Ctrl+Shift+V(평문), URL 붙여넣기 시 선택 팝오버.
- **의존 기능**: F-01-01, F-01-03, F-01-09
- **구현 난이도**: **L** — HTML→블록 파서가 실질 작업량(외부 사이트마다 마크업이 제각각).
- **우선순위**: **P0**(내부 복붙 + plain text) / **P1**(HTML/마크다운 파싱) / **P2**(URL 붙여넣기 형태 선택)
- **클론 시 현실적 대안**: HTML 파서를 직접 만들지 말고 `turndown`(HTML→Markdown) + `remark`(Markdown→AST) 2단계로 처리해 규칙 수를 줄인다. 내부 라운드트립만 우선 완벽하게.
- **참고 출처**: https://www.notion.com/help/writing-and-editing-basics , https://www.notion.com/releases/2022-01-19

---

### F-01-11 Synced Block (동기화 블록)

- **한 줄 정의**: 하나의 블록 subtree를 여러 페이지에 동일하게 표시하고, 어느 위치에서 수정해도 모든 위치에 반영한다.
- **사용자 시나리오** (공식 문서 기준):
  1. 블록 여러 개를 선택 → `⋮⋮` → `Turn into` → `Synced block` → 선택 블록이 테두리로 감싸진다.
  2. 블록 상단의 복사 아이콘 클릭 → 다른 페이지에서 붙여넣기 → 동기화된 사본 생성.
  3. 사본에서 텍스트를 수정 → 원본과 다른 모든 사본에 반영.
  4. 상단에 "Editing in ↙ N other pages"가 표시되고 클릭하면 다른 인스턴스로 이동 가능. 원본 위치에는 `ORIGINAL` 표시.
  5. `⋮⋮` → `Unsync` → 해당 사본만 독립 블록이 됨. `Unsync all` → 모든 연결 해제.
- **동작 상세**:
  - 공개 API 모델: `synced_block.synced_from`이 `null`이면 **원본**, `{type:'block_id', block_id: '...'}`이면 **참조 사본**이다. 자식은 원본에만 존재하고 사본은 참조만 갖는다.
  - 권한(공식 명시): 사본을 수정하려면 **원본에 대한 편집 권한**이 필요하다. 원본 페이지 접근 권한이 없는 사용자는 사본의 내용을 볼 수 없고 접근 요청만 할 수 있다. → 렌더 트리와 권한 트리가 분리되어야만 성립하는 기능(F-01-01의 설계 이유).
  - **삭제 위험(공식 명시)**: 사본이 10개를 넘는 synced block의 원본을 삭제하면 모든 인스턴스가 삭제되며 undo로 복구되지 않는다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 빈 synced block | 플레이스홀더 렌더, sync 관계는 유지 |
  | 삭제된 참조 — 원본 삭제(사본 ≤10) | 공식 문서에 명시 없음 `[확인필요]`. 클론 권장: 사본을 "원본 삭제됨" 상태로 렌더하고 unsync 유도 |
  | 삭제된 참조 — 원본 삭제(사본 >10) | 전부 삭제, undo 불가(공식) — 클론은 **삭제 전 경고 모달** 권장 |
  | 중첩 — 순환 sync(A가 B를, B가 A를 포함) | 무한 렌더. **삽입 시 조상 체인 검사로 차단 필수** |
  | 중첩 — 사본 안에서 Tab 들여쓰기 | 원본 subtree 구조가 바뀌므로 모든 위치에 반영 |
  | 권한 없음 — 사본 페이지만 공유된 뷰어 | 내용 숨김 + 접근 요청 UI(공식) |
  | 동시편집 — 서로 다른 페이지의 두 사본을 동시 편집 | 원본 블록에 대한 동시편집과 동일하게 처리(F-01-17) |
  | 원본이 휴지통에 있음 | 사본에 "휴지통의 블록" 안내 `[추정]` |
  | 대용량 — 사본 100개 | 원본 변경 이벤트를 구독 중인 클라이언트에만 push, 나머지는 다음 로드 시 반영 |

- **데이터 모델 함의**:
  ```sql
  -- block.type = 'synced_block'
  -- properties: { synced_from: null | { block_id: UUID } }
  CREATE INDEX ON block ((properties->>'synced_from')) WHERE type = 'synced_block';
  ```
  렌더 시 사본은 `synced_from`을 따라가 원본의 자식을 조회한다. **원본 블록의 `parent`는 여전히 원본 페이지**이므로 권한은 원본 기준으로 평가된다. "이 원본을 참조하는 사본 목록"을 역인덱스로 유지해야 "N other pages" 표시와 원본 삭제 경고가 가능하다.
- **UI/인터랙션**: 테두리 하이라이트, 상단 "Editing in N other pages" 바, 복사 아이콘, `⋮⋮` 메뉴의 Unsync / Unsync all.
- **의존 기능**: F-01-01(렌더/권한 트리 분리), F-01-06(Turn into), F-01-10(복사)
- **구현 난이도**: **XL** — 참조 렌더, 권한 평가 우회, 순환 방지, 역인덱스, 다중 위치 실시간 반영이 모두 얽힌다.
- **우선순위**: **P1** — MVP에는 없어도 되지만 노션 차별성의 핵심.
- **클론 시 현실적 대안**: v1에서는 **읽기 전용 transclusion**으로 축소 구현 — 사본은 원본을 렌더만 하고 편집은 원본 페이지에서만. 양방향 편집은 v2.
- **참고 출처**: https://www.notion.com/help/synced-blocks , https://developers.notion.com/reference/block

---

### F-01-12 컬럼 레이아웃 (column_list / column)

- **한 줄 정의**: 블록을 좌우로 나란히 배치하는 2계층 컨테이너 구조.
- **사용자 시나리오** (공식 문서 기준):
  1. 블록의 `⋮⋮`를 잡아 다른 블록의 **오른쪽 옆**으로 드래그 → 파란 **세로** 가이드가 나타남 → 드롭하면 두 블록이 나란히 배치되고 `column_list` + `column` 2개가 생성된다.
  2. 컬럼 경계에 hover → 회색 세로 가이드가 나타나고 드래그해 폭 조절.
  3. 오른쪽 컬럼 콘텐츠를 다시 페이지 폭 전체로 드래그(파란 가로 가이드가 폭 전체를 덮을 때 드롭) → 컬럼 해제. 빈 컬럼은 `⋮⋮` → Delete.
- **동작 상세**:
  - 구조: `column_list`(자식은 `column`만) → `column`(자식은 임의 블록). **2계층 고정**.
  - `column.width_ratio`는 0~1 실수(공개 API). 합이 1이 되도록 유지.
  - 컬럼 개수: 공식 문서상 "페이지 폭이 허용하는 만큼 얼마든지" — 상한 명시 없음.
  - 컬럼 중첩(컬럼 안의 컬럼): 공식 문서에 언급 없음 `[확인필요]`.
  - 반응형(공식 명시): 컬럼은 **태블릿까지 지원되고 폰에서는 지원되지 않아**, 오른쪽 컬럼 콘텐츠가 왼쪽 컬럼 아래로 세로 배치된다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 컬럼 안의 마지막 블록 삭제 | 빈 컬럼 유지 vs 자동 제거 정책 필요 `[확인필요]`. 클론 권장: 빈 컬럼 유지(사용자가 다시 채울 수 있게) |
  | 컬럼이 1개만 남음 | `column_list`를 해제하고 자식을 부모로 승격(빈 컨테이너 방지) — 자동 정리 로직 필수 |
  | 중첩 — 컬럼 안에 또 다른 column_list | 스키마로 명시 필요(권장: 금지) `[확인필요]` |
  | 중첩 — 컬럼 안에 synced block / toggle | 허용 |
  | 컬럼 폭 합이 1이 아님 | 정규화(비율 재분배) |
  | 삭제된 참조 — 고아 `column`(부모 없는 컬럼) | 스키마 검증에서 차단 + 정리 배치 |
  | 동시편집 — 두 사용자가 동시에 폭 조절 | LWW로 마지막 비율 적용 |
  | 권한 없음 | 리사이즈 핸들 미노출 |
  | 대용량 — 컬럼 10개 + 좁은 화면 | 최소 폭 이하로 줄이지 않고 가로 스크롤 또는 세로 스택 |
  | 마크다운/HTML 내보내기 | 컬럼은 표현 불가 → 순차 나열로 평탄화 |

- **데이터 모델 함의**: `type='column_list'` 블록 + `type='column'` 자식들. `format.column_ratio`(또는 `width_ratio`) 저장. 부모-자식 타입 제약을 스키마 검증에 하드코딩. 컨테이너 자동 정리(자식 0개/1개)는 트랜잭션 후처리 훅으로.
- **UI/인터랙션**: 드래그 시 세로 파란 가이드, 경계 hover 시 리사이즈 핸들, `/columns` 계열 커맨드 `[확인필요]`(공식 슬래시 가이드에는 미명시).
- **의존 기능**: F-01-01, F-01-02, F-01-08(드롭 존)
- **구현 난이도**: **L** — 드롭 존 판정 + 컨테이너 생성/해체 자동화 + 반응형 붕괴 처리.
- **우선순위**: **P1**
- **클론 시 현실적 대안**: 드래그 생성 대신 `/2 columns`, `/3 columns` 커맨드로 명시 생성만 지원. 폭 조절은 프리셋(50/50, 33/67 등)으로 시작하고 자유 리사이즈는 v2. 모바일은 무조건 세로 스택(노션과 동일).
- **참고 출처**: https://www.notion.com/help/columns-headings-and-dividers , https://developers.notion.com/reference/block

---

### F-01-13 접기/펼치기 컨테이너 (toggle, toggle heading, callout)

- **한 줄 정의**: 자식 블록의 표시 여부를 접기 상태로 제어하는 컨테이너 블록군.
- **사용자 시나리오**:
  - `>` + 스페이스 또는 `/toggle` → 토글 블록 생성 → 제목 입력 → Enter/Tab으로 내부에 자식 추가.
  - 헤딩의 `⋮⋮` → `Turn into` → 토글 헤딩(H1/H2/H3) 선택 → 헤딩 아래 콘텐츠가 접기 가능해진다(공식 명시).
  - 삼각형 아이콘 클릭으로 접기/펼치기.
- **동작 상세**:
  - 공식 블로그: "토글 리스트 블록은 펼쳤을 때만 content를 표시하고, 그렇지 않으면 title 속성만 표시한다."
  - 토글 헤딩은 별도 타입이 아니라 `heading_N.is_toggleable = true`(공개 API).
  - 접힘 상태의 저장 위치가 설계 쟁점이다: **문서 데이터**로 저장하면 모든 사용자에게 공유되고, **로컬 UI 상태**면 사용자별이다. 노션은 사용자별로 보이나 공식 근거는 확인되지 않음 `[확인필요]`.
  - 콜아웃은 자식을 가질 수 있으나(공개 API) 접기 기능은 없다 `[확인필요]`.
  - 토글 헤딩 생성 경로는 공식 확인됨: 헤딩에 hover → `⋮⋮` → `Turn into` → 토글 옵션 선택. 공식 문서는 토글 헤딩에 대해 *"you'll need to open and close toggles manually"*라고만 서술하며 **접힘 상태의 저장 주체는 언급하지 않는다** `[확인필요]`.
  - 헬프센터의 헤딩 설명은 **H1·H2·H3 세 단계만** 다룬다. 공개 API의 `heading_4`에 대응하는 토글 헤딩 UI는 확인되지 않음 `[확인필요]`(F-01-02 참조).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 자식 없는 토글 | "비어 있음" 플레이스홀더, 삼각형은 비활성 |
  | 중첩 — 토글 안의 토글 | 각각 독립 접힘 상태 |
  | 접힌 토글을 삭제 | 숨겨진 자식까지 함께 삭제 → 체감상 데이터 손실. **undo 보장 필수** |
  | 접힌 토글 내부 텍스트 검색 | 결과에 포함되고 클릭 시 자동 펼침 |
  | 접힌 토글 위로 드래그 | hover 지연 후 자동 펼침(spring-loaded) |
  | 토글 헤딩 → 일반 헤딩 변환 시 자식 존재 | 자식이 사라지지 않게 부모로 승격 또는 항상 표시로 전환 `[확인필요]` |
  | 삭제된 참조 — 접힘 상태 레코드가 가리키는 블록 삭제 | 상태 레코드 정리(가비지 컬렉션) |
  | 동시편집 — 접힘 상태 공유 여부 | 문서 데이터로 저장하면 상대 화면이 멋대로 접힘 → **로컬 저장 권장** |
  | 권한 없음 | 읽기 전용에서도 접기/펼치기는 허용해야 자연스러움 |
  | 인쇄/PDF 내보내기 | 접힌 내용 포함 여부 옵션 필요 |

- **데이터 모델 함의**: `toggle` 타입 + `heading_N.is_toggleable` 플래그. 접힘 상태는 **문서 데이터가 아니라 뷰어별 상태**로 두는 것을 권장 `[추정]`:
  ```sql
  CREATE TABLE user_block_state (
    user_id    UUID NOT NULL,
    block_id   UUID NOT NULL,
    collapsed  BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, block_id)
  );
  ```
  이 테이블은 **블록 수 × 사용자 수**로 커질 수 있으므로 (1) 기본값(펼침)과 다른 행만 저장, (2) 블록 삭제 시 CASCADE 또는 주기적 GC, (3) MVP에서는 아예 `localStorage`(키: `collapsed:{pageId}` → blockId 배열)로 대체한다.
- **UI/인터랙션**: 삼각형 디스클로저(hover 시 노출), 클릭 토글, 빈 상태 플레이스홀더, 드래그 hover 시 spring-loaded 자동 펼침.
- **의존 기능**: F-01-01, F-01-02, F-01-07, F-01-08(드래그 중 자동 펼침), F-01-22(접힌 subtree의 지연 로드)
- **구현 난이도**: **M** *(GAP 1회차에서 S → M 상향)* — "렌더 조건 분기"만 보면 S지만, 실제로는 ① 사용자별 접힘 상태 저장·동기화 ② 검색 히트 시 자동 펼침 + 스크롤 ③ 드래그 hover 자동 펼침(타이머·취소) ④ 토글 헤딩 변환 시 자식 보존 ⑤ 접힌 subtree를 렌더 트리에서 빼되 검색/내보내기에서는 포함 — 다섯 갈래가 각각 별도 로직이다. 특히 ⑤는 F-01-22의 부분 로드와 상호작용해 "접혀 있으니 안 불러왔는데 검색은 걸려야 한다"는 모순을 만든다.
- **우선순위**: **P0**(toggle) / **P1**(toggle heading)
- **클론 시 현실적 대안**: 접힘 상태는 MVP에서 localStorage, 서버 저장(기기 간 동기화)은 v2.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://www.notion.com/help/columns-headings-and-dividers , https://developers.notion.com/reference/block

---

### F-01-14 코드 블록

- **한 줄 정의**: 문법 강조와 언어 선택, 줄바꿈 옵션, 복사 버튼, 캡션을 갖춘 코드 전용 블록.
- **사용자 시나리오** (공식 문서 기준):
  1. 새 줄 hover 시 나타나는 `+` 클릭 → `Code` 선택 후 Enter, 또는 `/code`.
  2. 좌상단 언어 이름 클릭 → 검색 → Enter로 언어 선택 → 문법 강조 적용.
  3. 블록 hover → 우상단 `Copy`(클립보드 복사), `Caption`(설명 추가) 버튼.
  4. `•••` 또는 `⋮⋮` 메뉴 → `Wrap code` 켜면 가로 스크롤 대신 자동 줄바꿈.
- **동작 상세**:
  - 공개 API 페이로드: `rich_text[]`(코드 본문), `language`(enum), `caption[]`. 자식 블록 불가.
  - **`Can view` 권한 사용자에게는 복사/캡션 버튼이 숨겨진다(공식 명시)**.
  - Tab 키 동작, 코드 블록 탈출 방법, 지원 언어 전체 목록은 헬프 페이지에 명시되어 있지 않다 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 빈 코드 블록 | 플레이스홀더, 복사 버튼은 비활성 |
  | 중첩 — 코드 안에서 Tab | 탭 문자 삽입. **블록 중첩으로 해석 금지** |
  | 중첩 — 코드 안의 `/`, `#`, `**` | 슬래시 메뉴/마크다운 변환 전면 비활성 |
  | 코드 안에서 Enter | 새 블록이 아니라 줄바꿈 |
  | 코드 블록 탈출 | 마지막 줄에서 ↓ 또는 Cmd/Ctrl+Enter `[확인필요]`. 클론은 블록 하단 클릭 영역 제공 권장 |
  | 언어 미지정 | `plain text` 기본값 |
  | 코드 내부 인라인 서식(볼드 등) | rich_text 배열이긴 하나 서식은 무시하는 편이 안전 |
  | 삭제된 참조 — 지원 목록에서 빠진 언어 값 | plain text로 폴백하되 원본 값 보존 |
  | 동시편집 | 텍스트 병합은 F-01-17. `language`/`wrap`은 LWW |
  | 권한 없음 | 복사/캡션 버튼 숨김(공식) |
  | 대용량 — 10000줄 코드 붙여넣기 | 하이라이팅 가상화 또는 임계 초과 시 하이라이팅 비활성 |

- **데이터 모델 함의**: `properties.title: RichText[]`(사실상 단일 plain span), `properties.language: string`, `properties.caption: RichText[]`, `format.code_wrap: boolean`. **`language`는 enum이 아니라 문자열로 저장**하고 지원 목록은 코드 레지스트리에 둔다 — 하이라이터 교체나 언어 추가 때 마이그레이션이 필요 없어진다. 지원 목록에서 빠진 값이 들어와도 원본을 보존해야 라운드트립이 깨지지 않는다.
- **UI/인터랙션**: 언어 선택 드롭다운(검색형), 복사 버튼, 캡션, wrap 토글, 라인 번호 `[확인필요]`.
- **의존 기능**: F-01-02, F-01-05(코드 블록 안에서 마크다운 규칙 전면 비활성), F-01-04(슬래시 메뉴 비활성), F-01-10(코드 블록 안 붙여넣기는 항상 평문), F-01-19(Enter/Tab/탈출 키 분기)
- **구현 난이도**: **M** *(GAP 1회차에서 S~M → M 확정)* — 하이라이터 연동 자체는 S지만, "코드 블록 안에서는 에디터의 기본 키/입력 규칙을 전부 꺼야 한다"는 **컨텍스트 분기가 4개 기능(F-01-04·05·10·19)에 침투**한다. 이 교차 비용이 단일 렌더러 작업보다 크다.
- **우선순위**: **P0** — 개발자 대상 클론에서 사실상 필수.
- **클론 시 현실적 대안**: 언어 20종으로 시작(js/ts/py/java/go/rust/sql/json/yaml/bash/html/css/md 등), 하이라이터는 Shiki 지연 로드.
- **참고 출처**: https://www.notion.com/help/code-blocks , https://developers.notion.com/reference/block

---

### F-01-15 미디어 · 파일 · 북마크 · 임베드 블록

- **한 줄 정의**: 외부/업로드 리소스를 블록으로 삽입해 페이지에 렌더한다.
- **사용자 시나리오**:
  - `/image` → 업로드 / URL 입력 / 스톡 이미지 탭 → 이미지 블록 생성 → 좌우 드래그로 크기 조절, 캡션 추가.
  - `/web`(bookmark, 공식 명시) → URL 입력 → 제목·설명·썸네일 카드 렌더.
  - `/embed` → URL 입력 → iframe 임베드.
  - 파일 드래그 앤 드롭 → 타입에 따라 image/video/audio/pdf/file 블록 자동 선택.
- **동작 상세**:
  - 공개 API 파일 오브젝트 3종: `external`(외부 URL), `file`(노션 호스팅, **만료되는 서명 URL**), `file_upload`(업로드 세션).
  - `bookmark`: `url` + `caption`. `embed`: `url` 또는 `file_upload`. `link_preview`: `url`만 있고 **API로 생성 불가(읽기 전용)**.
  - 북마크 카드 메타데이터(제목/설명/썸네일)는 서버가 OG 태그를 크롤링해 만드는 것으로 보인다 `[추정]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — URL 미입력 상태 | "이미지 추가" 빈 상태 블록으로 유지(저장은 됨) |
  | 삭제된 참조 — 서명 URL 만료 | 렌더 시점에 재서명. 캐시 HTML에 URL 하드코딩 금지 |
  | 삭제된 참조 — 존재하지 않는/차단된 URL | 깨진 이미지 대신 "불러올 수 없음" + 원본 링크 |
  | OG 태그 없는 사이트 | URL 자체를 제목으로, 썸네일 없음 |
  | X-Frame-Options로 임베드 거부 | iframe 실패 감지 → 북마크 카드로 폴백 제안 |
  | 중첩 — 컬럼/토글 안의 이미지 | 컨테이너 폭 기준으로 리사이즈 |
  | 동시편집 — 두 사용자가 같은 블록에 다른 파일 업로드 | LWW. 이전 파일은 ref_count 감소 |
  | 권한 없음 | 다운로드/원본 열기 차단, 썸네일 노출 여부는 정책 결정 |
  | 대용량 — 수백 MB 업로드 | 청크/멀티파트 업로드 + 플랜별 용량 제한 |
  | 보안 — 악성 파일 | 콘텐츠 타입 검증, 실행 파일 차단, **별도 도메인에서 서빙(XSS 격리)**, iframe에 `sandbox` 필수, `Content-Disposition: attachment` |
  | **보안 — OG 크롤러 SSRF** | 사용자가 넣은 URL을 서버가 fetch하므로 내부망(`169.254.169.254`, `10.0.0.0/8`, `localhost`)·리다이렉트 체인·DNS rebinding을 전부 차단해야 한다. 아웃바운드 전용 프록시 경유 권장 |
  | **삭제된 참조 — 서명 URL이 외부에 유출된 뒤 권한 회수** | 서명 URL은 만료 전까지 권한 변경을 반영하지 못한다. 민감 워크스페이스는 **짧은 만료(예: 1시간) + 요청 시마다 권한 재확인 후 재서명** |
  | 같은 파일을 여러 블록이 참조 | 참조 카운트로 물리 삭제 제어 |

- **데이터 모델 함의**:
  ```sql
  CREATE TABLE file (
    id UUID PRIMARY KEY, workspace_id UUID, storage_key TEXT,
    mime TEXT, size_bytes BIGINT, original_name TEXT, ref_count INT DEFAULT 0,
    uploaded_by UUID, created_at TIMESTAMPTZ
  );
  ```
  블록 `properties.source = {type:'file'|'external', file_id|url}`, `properties.caption`, `format.block_width` / `block_aspect_ratio`. 북마크 메타는 `link_metadata(url_hash, title, description, image_url, fetched_at)` 캐시 테이블로 분리 `[추정]`.
- **UI/인터랙션**: 드래그 앤 드롭 업로드, 붙여넣기 업로드, 크기 조절 핸들, 정렬(좌/중/우), 캡션, 원본 열기, 다운로드.
- **의존 기능**: F-01-02, 파일 스토리지 인프라(도메인 외부)
- **구현 난이도**: **L~XL** *(GAP 1회차에서 L → L~XL 상향)* — 하나의 기능처럼 보이지만 실제로는 **독립된 서브시스템 5개**다: ① 청크/재개 가능 업로드 + 진행률 ② 오브젝트 스토리지 + 만료 서명 URL 재발급 경로(캐시·CDN·내보내기 각각에서 다시 필요) ③ OG 메타데이터 크롤러(타임아웃·리다이렉트·robots·SSRF 방어) ④ 임베드 보안(iframe sandbox, 화이트리스트, X-Frame-Options 실패 감지) ⑤ 파일 참조 카운트와 GC. 그중 ②③④는 **보안 사고가 나면 되돌릴 수 없는 종류**라 과소평가하기 가장 쉬운 항목이다. 특히 OG 크롤러는 **SSRF 취약점의 교과서적 진입점**(내부망 URL·리다이렉트 체인·DNS rebinding)이므로 아웃바운드 프록시 + IP 대역 차단이 필수다.
- **우선순위**: **P0**(image 업로드) / **P1**(file, bookmark, video) / **P2**(embed, pdf, audio, link_preview)
- **클론 시 현실적 대안**: S3 호환 스토리지 + presigned PUT 업로드. OG 크롤러는 별도 마이크로서비스로 분리하고 실패 시 URL 평문 폴백. 임베드는 화이트리스트(YouTube/Figma/CodeSandbox 등)로 제한해 보안 리스크 축소.
- **참고 출처**: https://developers.notion.com/reference/block , https://developers.notion.com/reference/request-limits , https://www.notion.com/help/guides/using-slash-commands

---

### F-01-16 자동 파생 블록 (목차 / breadcrumb / 구분선)

- **한 줄 정의**: 저장된 콘텐츠가 아니라 페이지 구조로부터 **렌더 시점에 계산되는** 블록.
- **사용자 시나리오**: `/table of contents` 삽입 → 현재 페이지의 모든 heading이 계층 목록으로 자동 표시 → 항목 클릭 시 해당 헤딩으로 스크롤. `/breadcrumb` 삽입 → 페이지의 조상 경로가 링크로 표시. `---` 입력 또는 `/div`로 구분선 삽입(공식 명시).
- **동작 상세**:
  - 공개 API: `table_of_contents`는 페이로드가 `color`뿐, `breadcrumb`와 `divider`는 빈 객체 `{}`. 즉 **콘텐츠를 저장하지 않는다**는 사실이 스키마로 확인된다.
  - 목차가 수집하는 헤딩 범위(H4 포함 여부, 토글 헤딩 포함 여부, 컬럼 내부 헤딩 포함 여부)는 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 헤딩이 하나도 없음 | "헤딩을 추가하세요" 플레이스홀더 |
  | 헤딩 편집 중 | 목차가 실시간(디바운스) 갱신 |
  | H1 없이 H3만 존재 | 최상위 레벨로 평탄화 |
  | 동일 제목 헤딩 다수 | 앵커는 제목 텍스트가 아니라 **block id** 사용 |
  | 중첩 — 목차 자신이 접힌 토글 안에 있음 | 여전히 전체 헤딩 수집 |
  | 삭제된 참조 — 목차가 가리키던 헤딩 삭제 | 다음 렌더에서 자동 제거(저장된 참조가 없으므로 무해) |
  | 권한 없음 — breadcrumb의 조상 페이지에 접근 불가 | 제목 숨김 처리 |
  | 동시편집 | 파생값이라 충돌 자체가 없음 |
  | 대용량 — 헤딩 1000개 | 가상 스크롤 또는 깊이 제한 |
  | 내보내기(MD/HTML) | 내보내기 시점에 동일 계산을 수행해 정적 목차 생성 |

- **데이터 모델 함의**: 저장은 블록 1행(properties 거의 비어 있음). 렌더러가 같은 페이지의 heading 블록을 조회해 파생. 앵커 URL은 `#{blockId}`. 서버 렌더/내보내기에서도 동일 계산 필요.
- **UI/인터랙션**: 목차 항목 hover 하이라이트, 현재 스크롤 위치 헤딩 강조 `[확인필요]`, 클릭 시 부드러운 스크롤.
- **의존 기능**: F-01-02, 페이지 계층(다른 도메인)
- **구현 난이도**: **S**(divider) / **M**(목차·breadcrumb) *(GAP 1회차에서 일괄 S → 분리)* — divider는 진짜 S다. 그러나 목차는 ① 헤딩 수집 범위 규칙(컬럼/토글/synced block 내부 포함 여부) ② 스크롤 스파이(현재 위치 강조) ③ 앵커 스크롤 + URL 해시 동기화 ④ 편집 중 디바운스 재계산 ⑤ 내보내기 시 동일 계산 재구현이 붙고, breadcrumb는 ⑥ **조상 경로 조회 + 경로상 각 페이지의 권한 필터링**이 붙는다. ⑥은 권한 도메인과 결합하는 지점이라 S로 볼 수 없다.
- **우선순위**: **P1**(목차, divider는 P0) / **P2**(breadcrumb)
- **클론 시 현실적 대안**: 클라이언트에서 블록 배열을 순회해 계산. 서버 계산 불필요.
- **참고 출처**: https://developers.notion.com/reference/block , https://www.notion.com/help/columns-headings-and-dividers

---

### F-01-17 편집 트랜잭션 · Undo/Redo · 동시편집 충돌 처리

- **한 줄 정의**: 모든 편집 조작을 operation 목록으로 표현해 트랜잭션 단위로 적용·전송·되돌린다.
- **사용자 시나리오**: 타이핑/Tab/드래그 → 클라이언트가 즉시 로컬 상태에 반영(낙관적 업데이트) → operation을 큐에 넣어 서버로 전송 → 다른 클라이언트에 브로드캐스트. Cmd/Ctrl+Z를 누르면 마지막 **사용자 조작 단위** 하나가 되돌아간다.
- **동작 상세**:
  - 공식 블로그가 실제로 확인해 주는 것: 클라이언트가 단일 레코드 변경을 나타내는 operation을 생성하고, *"All these individual change operations are grouped into a transaction"*, 그 트랜잭션을 `/saveTransactions` 엔드포인트로 보낸다. 즉 **UI 조작 1회 = 트랜잭션 1개 = operation N개**, **undo 단위 = 트랜잭션**.
  - `[확인필요]` **"Enter 1회 = operation 정확히 3개"는 근거 없음** — 이전 판이 단정했으나 블로그 본문 재확인에서 그 수치를 찾지 못했다. 설계상 최소 2개(블록 레코드 생성 + 부모 순서에 편입)이며 정확한 개수는 노션 내부 구현 세부사항이라 클론 설계에 필요하지 않다.
  - **충돌 처리 방식 — GAP 1회차 반증 조사 결과**:

    | 조사한 곳 | 결과 |
    |---|---|
    | `notion.com/blog/data-model-behind-notion` 본문 재확인 | 동시성/충돌/CRDT/OT/오프라인에 관한 서술 **전혀 없음**. operation·transaction 모델까지가 공개 범위 |
    | `notion.com/blog/topic/tech`(엔지니어링 블로그 색인) | 게시된 기술 글은 검색 리인덱서, DLQ 관측성, 멀티리전, 스키마 변경 감지, 벡터 검색, Spark/K8s 등이며 **에디터·실시간 협업·오프라인 동기화·CRDT를 다룬 글은 색인에 없음** |
    | `notion.com/help/offline-mode`, `/help/using-notion-offline` | **둘 다 404** — 해당 슬러그의 공식 헬프 페이지 확인 실패 |

    → **결론: 노션의 텍스트 동시편집 병합 알고리즘은 2026-09 시점 공개 1차 출처로 확인 불가** `[확인필요]`. "노션은 CRDT를 쓴다"는 서술은 전부 3자 추측이므로 **클론 설계의 근거로 인용해서는 안 된다.** 다만 블로그가 명시한 사실 두 가지 — (a) 편집이 블록 단위 operation으로 쪼개진다 (b) `content` 배열 조작과 텍스트 편집이 서로 다른 operation이다 — 로부터, **서로 다른 블록에 대한 동시 편집은 구조적으로 충돌하지 않는다**는 것만은 확실하게 따라 나온다.
    → **클론에 주는 함의**: 노션을 모방할 근거가 없으므로 **직접 선택해야 한다.** 블록 단위 분리 덕분에 "블록 간 = 자동 병합 / 블록 내 텍스트 = 별도 알고리즘" 2층 구조를 취할 수 있고, 아래 대안 항목의 Yjs 채택은 이 2층 구조를 그대로 구현한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — undo 스택 비어 있음 | 무동작 |
  | 동시편집 — 같은 블록의 같은 문자 위치 | 텍스트 병합 전략 필요(CRDT/OT). LWW면 한쪽 입력 소실 |
  | 동시편집 — 서로 다른 블록 | 항상 병합 성공(블록 단위 분리의 이점) |
  | 삭제된 참조 — A가 삭제한 블록을 B가 편집 | 삭제 우선(tombstone)인지 편집이 부활시키는지 정책 결정 필요 |
  | 중첩 — subtree 삭제 후 undo | subtree 전체가 원래 부모/순서로 복원되어야 함(inverse op 필요) |
  | 오프라인 편집 후 재접속 | 큐에 쌓인 트랜잭션을 순서대로 재전송, 충돌 시 재적용 |
  | 다른 사용자의 변경을 내가 undo 할 수 있는가 | **금지**. undo 스택은 actor별로 필터링 |
  | 마크다운 자동 변환 undo | 변환만 되돌리고 입력 텍스트는 유지(F-01-05) |
  | 권한 없음 | 트랜잭션 서버 거부 → 로컬 롤백 + 안내 |
  | 대용량 — 1000블록 붙여넣기 트랜잭션 | 청크 분할 전송 + undo는 논리적으로 1회로 묶음 |
  | 트랜잭션 전송 실패 | 재시도 + 지수 백오프. 영구 실패 시 로컬 변경 상태 표시 |

- **데이터 모델 함의**: 위 `operation` 테이블. 클라이언트는 `{undoStack: Transaction[], redoStack: Transaction[]}`과 각 트랜잭션의 inverse operation을 보관. 서버는 `block.version`으로 낙관적 동시성 제어. 실시간 채널(WebSocket)로 트랜잭션 브로드캐스트.
- **UI/인터랙션**: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z. 협업자 커서/아바타, "저장 중" 인디케이터.
- **의존 기능**: F-01-01 (모든 편집 기능이 여기에 의존)
- **구현 난이도**: **XL** — 텍스트 동시편집 병합은 이 프로젝트 전체에서 가장 어려운 문제이며, **가장 과소평가되는 항목**이기도 하다. 흔한 착각 3가지: ① "WebSocket으로 diff만 브로드캐스트하면 된다" → 두 클라이언트가 같은 오프셋을 다르게 해석해 문자가 유실된다 ② "LWW로 충분하다" → 블록 단위 LWW는 타이핑 중 상대 입력을 통째로 덮어쓴다 ③ "나중에 CRDT로 갈아끼우면 된다" → **저장 포맷(Yjs 바이너리 vs 관계형 JSONB)과 undo 구현이 여기에 묶여 있어 사후 교체 비용이 사실상 재작성**이다. 그래서 이 항목은 F-01-01과 **같은 시점에** 결정해야 한다.
- **왜 P0인가 재검토**: "실시간 브로드캐스트 = P1"은 *제품 관점*에서만 맞다. *아키텍처 관점*에서는 **동기화 전략 결정 자체가 P0**이다. MVP에서 실시간을 켜지 않더라도, 켤 때 스키마를 갈아엎지 않으려면 저장 포맷을 지금 고정해야 한다.
- **우선순위**: **P0**(트랜잭션 + 로컬 undo) / **P1**(실시간 브로드캐스트, 텍스트 병합)
- **클론 시 현실적 대안**: **Yjs를 채택한다.** BlockSuite(AFFiNE)와 Tiptap/BlockNote 모두 Yjs 기반이며, `Y.Map`(블록 props) + `Y.Text`(블록 텍스트) + `Y.Array`(자식 순서) 조합으로 블록 트리를 그대로 표현할 수 있다. OT/CRDT를 직접 구현하지 않는다. 단 Yjs 도입 시 서버 저장 포맷이 "Yjs update 바이너리 + 파생 관계형 뷰" 2중 구조가 되므로 **F-01-01 스키마 확정 전에 결정**해야 한다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://blocksuite.io/guide/block-schema , https://github.com/toeverything/blocksuite

---

### F-01-18 심플 테이블 (table / table_row / 셀 병합)

- **한 줄 정의**: 데이터베이스가 아닌 **순수 표시용 표**를 블록으로 삽입해 rich text 셀을 격자로 배치한다.
- **사용자 시나리오** (공식 문서 기준):
  1. 새 줄 hover → `+` 클릭 후 `Table` 선택, 또는 `/table` 입력 후 첫 번째 항목 선택.
  2. 삽입 직후 표의 **오른쪽 아래 모서리를 드래그** → 바깥쪽으로 끌면 열 추가, 아래로 끌면 행 추가(동시에 가능).
  3. 셀 안에서 `Tab` → 다음 셀로 이동(수평 이동).
  4. 행/열 핸들(첫 셀 hover 시 나타나는 6점 아이콘) → 위/아래/좌/우로 행·열 추가, 행·열 드래그 이동, 삭제.
  5. `Options` 메뉴에서 **행 헤더 / 열 헤더 토글** → 헤더 배경색 + 굵은 글씨로 시각 구분.
  6. 셀 우측 `•••` → 셀 텍스트/배경 색 변경, 셀 내용 비우기.
  7. 사각형 범위의 셀 선택 → 셀 메뉴 → `Merge cells`(2026-05-26 릴리스). 병합 시 **좌상단(anchor) 셀만 내용을 유지**하고 나머지 셀은 비워진다. `Unmerge cells` 하면 anchor는 텍스트를 유지하고 덮여 있던 셀들이 **빈 셀로 복원**된다.
  8. `Turn into database` 버튼 → 심플 테이블을 데이터베이스로 승격(필터·정렬·property·다중 뷰 활성화).
- **동작 상세**:
  - 구조는 `column_list`/`column`과 같은 **2계층 고정 컨테이너**다: `table`(자식은 `table_row`만) → `table_row`(자식 불가, `cells`에 rich text만).
  - 공개 API 페이로드: `table.table_width`(int, 열 개수), `table.has_column_header`(bool), `table.has_row_header`(bool), `table_row.cells`(**rich text 배열의 배열**, 가로 표시 순서).
  - **`table_width`는 표 생성 시점에만 지정 가능**하며 Update block 엔드포인트로 변경하면 실패한다(공식 명시). 즉 열 개수는 "행을 통째로 다시 쓰는" 연산으로만 바뀐다. → 클론도 **열 추가/삭제는 모든 `table_row.cells` 길이를 동시에 갱신하는 단일 트랜잭션**이어야 한다.
  - **셀은 블록을 담을 수 없다**. Enhanced markdown 문서가 *"Table cells support only rich text (no nested blocks)"*라고 명시한다. 심플 테이블 셀 안에 이미지·토글·중첩 리스트를 넣을 수 없다는 뜻이며, 이는 데이터베이스 table view와의 핵심 차이다.
  - 헤더는 **별도 블록 타입이 아니라 `table`의 boolean 플래그 2개**다. 즉 첫 행/첫 열이 데이터로서는 일반 셀과 동일하고 렌더만 달라진다.
  - **셀 병합의 API 표현은 문서화되어 있지 않다** `[확인필요]` — `table_row.cells`는 평평한 배열이라 rowspan/colspan을 표현할 자리가 없다. 2026-05-26 UI 기능이 공개 API 스키마에 아직 반영되지 않았거나, 별도 필드로 존재하는데 레퍼런스에 누락된 상태다. **클론은 처음부터 병합을 표현할 자리를 스키마에 남겨 두는 편이 낫다**(아래 데이터 모델).
  - 심플 테이블이 **할 수 없는 것**(공식 명시, 데이터베이스와의 경계): 행을 전체 페이지로 열기, property(날짜·사람·URL) 부여, relation, formula/rollup, 다중 뷰(보드·캘린더·타임라인), 통합(integration) 연결. → 클론에서 "표"를 요청받았을 때 **어느 쪽인지 반드시 구분**해야 하는 이유.
  - `color` 필드는 `table`/`table_row`에 없다(공개 API의 color 지원 타입 목록에 미포함). 셀 단위 색은 셀 rich text의 `annotations.color` 또는 별도 셀 포맷으로 표현된다 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 모든 셀이 비어 있음 | 정상 저장. 각 셀은 빈 rich text 배열 `[]` |
  | `cells` 길이 ≠ `table_width` | **불법 상태**. 서버가 커밋 시 짧으면 빈 셀로 패딩, 길면 거부. 열 삭제/추가 트랜잭션이 원자적이지 않으면 반드시 발생한다 |
  | 중첩 — 셀 안에 블록 삽입 시도 | 차단(셀은 rich text 전용). 붙여넣기로 블록이 들어오면 **plain text로 평탄화** |
  | 중첩 — 컬럼/토글 안의 표 | 허용. 폭은 컨테이너 기준으로 축소 |
  | 중첩 — 표 안의 표 | 셀이 rich text 전용이므로 **구조적으로 불가능** |
  | 삭제된 참조 — 병합 anchor 셀이 있는 행 삭제 | 병합 영역이 깨진다. 행 삭제 시 그 행을 덮던 병합을 **자동 해제(unmerge)** 후 삭제 |
  | 동시편집 — A가 열 추가, B가 같은 표의 셀 편집 | 열 추가는 전 행을 건드리므로 셀 편집과 충돌 지점이 겹친다. **셀 텍스트는 셀 단위 CRDT, `table_width`는 LWW**로 분리해야 B의 타이핑이 유실되지 않는다 |
  | 동시편집 — A가 3행 삭제, B가 3행에 입력 | tombstone 우선. B의 로컬 변경은 롤백하고 안내 |
  | 동시편집 — 두 사용자가 겹치는 범위를 각각 병합 | 병합 영역은 겹칠 수 없다 → 나중 트랜잭션을 **거부**(LWW로 덮으면 격자가 깨진다) |
  | 권한 없음 | 표 렌더는 하되 행/열 핸들·셀 메뉴·모서리 드래그 미노출 |
  | 대용량 — 200행 × 20열 | 4000개 셀 rich text. **행 단위 가상 스크롤** + 셀 렌더러 메모이제이션. 심플 테이블은 필터가 없으므로 전량 렌더가 기본이라 데이터베이스보다 오히려 위험하다 |
  | 스프레드시트에서 붙여넣기 | `text/html`의 `<table>`을 파싱해 `table` + `table_row`로 변환. 열 수는 최대 행의 열 수로 고정하고 부족한 행은 빈 셀 패딩 |
  | 마크다운 내보내기 | GFM 파이프 테이블로는 **병합 셀을 표현할 수 없다**. Notion의 enhanced markdown은 `<table><tr><td>` XML 태그를 쓴다 → 클론도 무손실 내보내기는 XML/JSON, 호환 내보내기는 GFM(병합 해제)로 **2트랙** |
  | `Turn into database` | 각 행이 데이터베이스 페이지가 되고 첫 행이 property 이름이 된다 `[확인필요]`(변환 규칙 세부는 미문서화). **비가역인지 여부도 확인 필요** |

- **데이터 모델 함의**:
  ```sql
  -- type='table'      properties: { table_width: int, has_column_header: bool, has_row_header: bool }
  -- type='table_row'  properties: { cells: RichText[][] }   -- 길이는 항상 부모의 table_width
  --                   format:     { merges: [{r, c, rowspan, colspan}] }  -- 병합은 표 단위로 두는 편이 안전
  ```
  - **병합 표현 권장**: 셀마다 `rowspan/colspan`을 두면 "덮여 있는 셀"의 상태가 중복 저장되어 동시편집에서 어긋난다. **`table.format.merges`에 사각 영역 목록을 두고 렌더 시 덮인 좌표를 계산**하는 편이 불변식 검증(영역 겹침 금지 / 표 범위 초과 금지)이 쉽다 `[추정]`.
  - **불변식(서버 검증)**: ① 모든 `table_row.cells.length === table.table_width` ② `merges`의 어떤 두 영역도 겹치지 않는다 ③ `merges` 영역이 `[0, row_count) × [0, table_width)` 안에 있다.
  - 셀 텍스트를 **행 단위 JSONB 하나**에 담으면 동시편집 충돌 단위가 행 전체가 된다. 실시간을 켤 계획이면 `Y.Array<Y.Array<Y.Text>>` 또는 `table_cell(row_id, col_index, rich_text)` 별도 테이블로 쪼갤지를 **F-01-17과 같은 시점에** 결정해야 한다.
- **UI/인터랙션**: `/table`, 우하단 모서리 드래그(행·열 동시 증감), 행/열 6점 핸들(추가·이동·삭제), 열 경계 드래그(폭 조절), `Options` 메뉴(헤더 토글, 페이지 폭 맞춤 `←→`), 셀 `•••`(색·비우기·병합), Tab/Shift+Tab 셀 이동, 방향키 셀 이동.
- **의존 기능**: F-01-01, F-01-02(부모-자식 타입 제약), F-01-03(셀 rich text), F-01-09(범위 선택 — 셀 사각 선택은 블록 선택과 **별개 모드**), F-01-10(외부 표 붙여넣기), F-01-17(셀 단위 동시편집)
- **구현 난이도**: **L** — 렌더는 `<table>` 하나지만 ① 열 개수 변경이 전 행을 건드리는 원자적 연산 ② 셀 사각 범위 선택(블록 선택과 다른 세 번째 선택 모드) ③ 병합/해제와 행·열 삭제의 상호작용 ④ 외부 표 붙여넣기 파싱 ⑤ 무손실/호환 2트랙 내보내기가 각각 별도 작업이다. **병합 셀까지 넣으면 XL**.
- **우선순위**: **P1** — 문서형 클론에서 표는 사실상 필수지만 MVP 없이도 동작한다. 병합 셀은 **P2**.
- **클론 시 현실적 대안**: MVP는 **병합 없는 고정 격자**만 지원(행·열 추가/삭제 + 헤더 플래그). 셀 선택은 사각 범위 대신 단일 셀만. 외부 표 붙여넣기는 `text/html` `<table>` 파싱만 지원하고 CSV는 v2. Tiptap의 `@tiptap/extension-table`은 셀 선택·행열 조작·병합(colspan/rowspan)이 이미 구현되어 있어 이 기능만은 라이브러리 채택 이득이 가장 크다 — 단 저장 포맷이 ProseMirror 노드라 `table_row.cells` 형태로 직렬화하는 어댑터가 필요하다.
- **참고 출처**: https://www.notion.com/help/guides/simple-tables-vs-databases , https://developers.notion.com/reference/block , https://www.notion.com/releases/2026-05-26 , https://www.notion.com/releases/2021-11-16 , https://developers.notion.com/guides/data-apis/enhanced-markdown

---

### F-01-19 캐럿 이동 · 블록 분할 · 블록 병합

- **한 줄 정의**: 텍스트 커서(캐럿)가 블록 경계를 넘나들고, Enter가 블록을 둘로 쪼개고, 시작 위치의 Backspace가 이전 블록과 합치는 **에디터의 가장 기본적인 편집 원자 연산**.
- **사용자 시나리오**:
  1. 문장 중간에 캐럿을 두고 Enter → 캐럿 앞 텍스트는 원래 블록에, 뒤 텍스트는 **새 블록**에 들어간다.
  2. 블록 맨 앞에서 Backspace → 이전 블록 끝에 현재 블록 텍스트가 이어붙고 현재 블록은 사라진다. 캐럿은 이어붙은 경계에 남는다.
  3. 블록 첫 줄에서 ↑ → 이전 블록의 같은 x좌표 위치로 캐럿 이동. 마지막 줄에서 ↓ → 다음 블록으로.
  4. Shift+Enter → 블록을 쪼개지 않고 블록 **안에서** 줄바꿈(soft break).
- **동작 상세**:
  - 공식 근거는 두 줄뿐이다: *"Press `enter` to insert a line of text."*, *"Press `shift` + `enter` to create a line break within a block of text."*(공식 키보드 단축키). **Enter가 캐럿 위치에서 블록을 분할한다는 것, Backspace가 병합한다는 것은 공식 헬프 문서에 명시되어 있지 않다** `[확인필요]` — 널리 관찰되는 동작이지만 1차 출처로 확인되지 않았다. 다만 F-01-01의 "빈 블록에서 Backspace" 항목과 함께 **클론이 반드시 스스로 정의해야 하는 규칙**이다.
  - 2022-01-19 릴리스가 확인해 주는 인접 사실: *"Click & drag to select, cut, copy & paste partial text across paragraphs, bullet lists, callouts & more — without having to select each block"* — 즉 **캐럿/선택은 블록 경계를 넘어 연속적으로 동작해야 한다**는 것이 노션의 명시적 설계 목표다(Firefox 제외).
  - **분할 시 결정해야 할 것 3가지**(클론 규칙 권장안):

    | 쟁점 | 권장 규칙 | 근거 |
    |---|---|---|
    | 새 블록의 `type` | 원본과 동일(리스트에서 Enter → 리스트 계속). 단 `heading_*`/`quote`/`callout`은 **`paragraph`로** | 헤딩 뒤에 본문을 쓰는 것이 압도적으로 흔한 흐름 `[추정]` |
    | 자식의 귀속 | **원본 블록에 남긴다**(뒤 블록은 자식 없이 생성). 단 캐럿이 텍스트 **끝**이면 새 블록이 자식보다 앞에 오므로 새 블록을 첫 자식으로 넣을지 형제로 넣을지 분기 | 자식이 순서상 뒤 블록과 원본 사이에 끼어 시각적으로 어긋나는 것을 피함 |
    | `to_do.checked` / `format` | 새 블록은 `checked=false`, `block_color`는 상속 | 완료 표시가 복제되면 잘못된 상태 |
  - **병합 시 결정해야 할 것 3가지**:

    | 쟁점 | 권장 규칙 |
    |---|---|
    | 서로 다른 타입의 병합(heading + paragraph) | **앞 블록의 타입이 이긴다.** 뒤 블록 텍스트는 rich text로 이어붙임 |
    | 뒤 블록에 자식이 있음 | 자식을 **앞 블록의 자식 끝으로 이관**. 자식 불가 타입이면 병합 자체를 차단하고 대신 "빈 블록이면 삭제" 동작으로 폴백 |
    | 앞 블록이 자식 불가/무텍스트 타입(divider, image) | 병합 불가 → Backspace는 **앞 블록을 선택 상태로 전환**(삭제 대기)하는 편이 안전 |
  - 컨텍스트 분기: `code` 블록 안에서는 Enter가 분할이 아니라 줄바꿈이고 Backspace가 병합을 일으키지 않는다(F-01-14). `table_row` 셀 안에서도 Enter는 블록 분할이 아니다(F-01-18).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 빈 블록에서 Enter | 타입이 리스트/투두면 **리스트 탈출**(paragraph로 되돌림), paragraph면 새 빈 블록 |
  | 빈 값 — 빈 블록에서 Backspace | 타입 되돌림 → 이미 paragraph면 삭제 + 이전 블록 끝으로 캐럿(F-01-01) |
  | 서식 경계에서 분할 | rich text 배열을 캐럿 오프셋 기준으로 **span 단위 분할**. 경계에 걸친 span은 둘로 쪼갬 → 양쪽 모두 정규화(빈 span 제거, 인접 동일 annotation 병합) |
  | 멘션 객체 한가운데 캐럿 | mention은 **원자 단위**다. 오프셋이 mention 내부로 계산되면 앞 또는 뒤로 스냅 |
  | 병합 결과 rich text 배열이 100 요소 초과 | 공개 API 상한 초과. **잘라내지 말고** 정규화 후에도 초과하면 병합을 거부하고 안내(F-01-03) |
  | 병합 결과 텍스트가 2000자 초과 | 동일. 상한은 앱 실측 필요 `[확인필요]` |
  | 중첩 — 자식 있는 블록의 텍스트 중간에서 Enter | 위 표의 "자식의 귀속" 규칙 적용. **자식이 사라지는 구현이 가장 흔한 버그** |
  | 중첩 — 접힌 토글 뒤에서 Backspace | 토글 subtree 전체와 병합되는 것처럼 보이면 안 된다. 접힌 토글 제목과 병합하되 **자식은 그대로 토글에 남긴다** |
  | 삭제된 참조 — 병합 대상 이전 블록이 방금 삭제됨 | 새로운 이전 블록을 재계산. 없으면 무동작 |
  | 동시편집 — A가 블록을 분할, B가 같은 블록 뒷부분을 편집 | 분할은 **"블록 생성 + 두 블록의 텍스트 교체"**라 CRDT 텍스트 병합과 잘 맞지 않는다. Yjs 채택 시 분할을 `Y.Text`의 **삭제+삽입 조합이 아니라 트랜잭션 1개**로 묶고, B의 편집이 어느 쪽에 귀속될지는 CRDT 위치 정보에 맡긴다. **직접 구현하면 여기서 문자가 유실된다** |
  | 동시편집 — A가 병합, B가 사라질 블록을 편집 | 병합은 뒤 블록을 tombstone으로 만든다. B의 미전송 편집은 병합된 블록으로 재타깃하거나 롤백 |
  | 한글 IME 조합 중 Enter | `compositionend` 전에 분할하면 조합 문자가 유실된다. **조합 확정 후 처리**. macOS/Windows/Android IME마다 `keydown` 순서가 다르므로 `isComposing` 플래그 필수 |
  | 권한 없음 | 캐럿 이동·선택은 허용(복사 목적), 분할/병합은 차단 |
  | 대용량 — 5000블록 페이지에서 방향키 연타 | 블록 경계 이동마다 DOM 조회를 하면 프레임 드랍. **평탄화된 블록 인덱스 배열**을 별도로 유지해 O(1) 이웃 조회 |
  | 캐럿 x좌표 유지(↑↓ 반복) | 워드프로세서처럼 "목표 x좌표"를 기억해야 짧은 줄을 지날 때 캐럿이 왼쪽으로 밀리지 않는다 |

- **데이터 모델 함의**:
  - **분할** = 트랜잭션 1개 안의 operation 3~4개: ① 원본 `properties.title` = 앞부분 ② 새 블록 INSERT(같은 `parent_id`, `order_key`는 원본과 다음 형제 사이) ③ 새 블록 `title` = 뒷부분 ④ (필요 시) 자식 `parent_id` 재지정.
  - **병합** = operation 2~3개: ① 앞 블록 `title` = concat ② 뒤 블록 자식들의 `parent_id`를 앞 블록으로 ③ 뒤 블록 `is_alive=false`.
  - **undo는 이 트랜잭션 전체가 1단위**여야 한다. 분할을 2개 트랜잭션으로 쪼개면 Cmd+Z 두 번을 눌러야 원상복구되어 사용성이 무너진다 → F-01-17의 트랜잭션 경계 설계에 직접 영향.
  - 캐럿 위치 자체는 **저장하지 않는다**(클라이언트 상태). 단 협업 커서 표시를 하려면 `presence` 채널에 `{userId, blockId, offset}`을 브로드캐스트해야 하며, 이때 offset은 **문자 인덱스가 아니라 CRDT relative position**이어야 상대가 편집해도 커서가 어긋나지 않는다.
- **UI/인터랙션**: Enter(분할), Shift+Enter(soft break), Backspace(시작 위치에서 병합), Delete(끝 위치에서 다음 블록 병합), ↑↓(블록 경계 넘기 + 목표 x좌표 유지), Home/End, Cmd/Ctrl+←→(줄 끝 이동).
- **의존 기능**: F-01-01, F-01-02(타입별 분기), F-01-03(rich text span 분할), F-01-13(접힌 토글 경계), F-01-14(코드 블록 예외), F-01-17(트랜잭션 경계·CRDT 위치)
- **구현 난이도**: **L** — "Enter 누르면 새 줄" 한 줄로 보이지만 실제로는 ① DOM selection ↔ 모델 오프셋 양방향 매핑 ② rich text span 분할/정규화 ③ 자식 귀속 규칙 ④ 타입별 예외(code/table/list 탈출) ⑤ IME 조합 처리 ⑥ 동시편집 시 위치 유실 방지가 전부 얽힌다. **직접 구현 시 이 도메인에서 버그 밀도가 가장 높은 항목**이다.
- **우선순위**: **P0** — 이게 없으면 에디터가 아니다.
- **클론 시 현실적 대안**: **직접 구현하지 않는다.** ProseMirror의 `splitBlock` / `joinBackward` 커맨드와 selection 매핑을 그대로 쓰고(Tiptap/BlockNote 경유), 노션식 예외(리스트 탈출, 헤딩 뒤 paragraph, 자식 귀속)만 커맨드를 덮어써 조정한다. 여기서 라이브러리를 쓰지 않기로 결정하면 **이 항목 하나가 XL로 뛴다**.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/releases/2022-01-19 , https://www.notion.com/help/writing-and-editing-basics

---

### F-01-20 수식 (인라인 equation / 블록 equation)

- **한 줄 정의**: KaTeX 문법 문자열을 저장하고 렌더 시점에 수식으로 그린다. 인라인(rich text의 한 조각)과 블록(독립 블록) 두 형태가 있다.
- **사용자 시나리오** (모두 공식 문서 확인):
  - **블록 수식**: 새 줄 hover → `+` → `Block equation` 선택, 또는 `/math` 입력 후 Enter(`/latex`도 동일). 블록 안을 클릭하면 편집 입력창이 열린다.
  - **인라인 수식** 3경로: ① `$$` 입력 → 수식 → `$$`로 닫으면 즉시 변환 ② `Cmd/Ctrl+Shift+E`로 수식 입력창 열기 → 입력 후 Enter ③ 텍스트를 선택한 뒤 플로팅 툴바의 `√x` 버튼(또는 같은 단축키).
  - 인라인 수식을 클릭하면 입력창이 열려 **라이브 편집**된다. 방향키로 이동하다 캐럿이 수식에 닿아도 입력창이 열린다.
  - `Turn into` 메뉴로 **인라인 수식 ↔ 블록 수식 상호 변환** 가능.
- **동작 상세**:
  - 렌더 엔진은 **KaTeX**다(공식 명시). *"KaTeX spans most, but not all mathematical notation supported by LaTeX"* — 즉 **LaTeX 전체가 아니라 KaTeX 지원 범위**가 계약이다. 클론도 KaTeX를 쓰면 호환성이 자동으로 맞는다.
  - **mhchem 확장의 `\ce`, `\pu` 매크로를 지원**한다(공식 명시). KaTeX 기본 빌드에는 mhchem이 포함되지 않으므로 클론은 `katex/contrib/mhchem`을 별도 로드해야 동일 동작이 된다.
  - 데이터 표현이 두 곳으로 나뉜다:
    - **블록**: `type='equation'`, 페이로드는 `expression`(KaTeX 문자열) 하나뿐. `rich_text` 없음, 자식 없음, `color` 없음.
    - **인라인**: rich text 오브젝트의 `type='equation'` + `equation.expression`. `annotations`(볼드/색 등)는 여전히 붙는다.
  - `equation.expression`의 공개 API 상한은 **1000자**.
  - 인라인 수식은 "equation font"로 렌더되므로 위첨자/아래첨자 용도로 남용하면 본문 폰트와 어긋난다(공식이 caveat로 언급). 여러 문자를 첨자에 넣으려면 중괄호로 묶어야 한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 빈 `expression` | 블록은 "수식을 입력하세요" 플레이스홀더. 인라인 빈 수식은 **저장 전 제거**(빈 span 규칙과 동일) |
  | 문법 오류 LaTeX | KaTeX `throwOnError: false`로 **원본 문자열을 붉게 표시**하고 렌더 실패를 사용자에게 보이되 저장은 유지. 절대 블록을 통째로 날리지 않는다 |
  | KaTeX 미지원 명령(`\usepackage` 등) | 위와 동일 처리 + "KaTeX 미지원" 안내 |
  | **보안 — XSS** | KaTeX의 `\href`, `\url`, `\includegraphics`는 URL을 받는다. **`trust: false`(기본값)를 유지**하고 절대 `trust: true`로 열지 않는다. 서버 렌더 시에도 동일. `strict` 모드 설정도 고정 |
  | **보안 — ReDoS/무한 확장** | `\def`/매크로 재귀로 렌더러를 멈추게 할 수 있다. KaTeX의 `maxExpand`(기본 1000) 및 `maxSize` 유지, 서버 렌더는 타임아웃 |
  | 검색 — 수식 내용 검색 | rich text의 `plain_text`에 수식이 어떻게 반영되는지는 `[확인필요]`. 클론 권장: `expression` 원문을 검색 인덱스에 넣되 별도 필드로 구분(본문 검색 결과를 오염시키지 않게) |
  | 중첩 — 인라인 수식에 볼드/색 적용 | `annotations`는 유지하되 KaTeX 출력 색만 바꾸고 굵기는 무시 `[추정]` |
  | 중첩 — 코드 블록 안의 `$$` | 변환 금지(F-01-14의 컨텍스트 분기) |
  | 삭제된 참조 | 수식은 외부 참조가 없어 해당 없음 |
  | 동시편집 — 같은 수식을 두 사람이 편집 | `expression`은 단일 문자열이므로 **LWW가 현실적**. 입력창이 열려 있는 동안은 상대 변경을 즉시 덮어쓰지 말고 "변경됨" 배지 표시 |
  | 권한 없음 | 렌더만, 입력창 열지 않음 |
  | 대용량 — 한 페이지에 수식 500개 | KaTeX 렌더는 동기 CPU 작업이다. **뷰포트 진입 시 렌더(IntersectionObserver) + 결과 HTML 캐시**. 서버 사이드 렌더 결과를 캐시하면 초기 페인트가 크게 빨라진다 |
  | 내보내기(MD/HTML/PDF) | 마크다운은 `$...$` / `$$...$$`로, HTML/PDF는 KaTeX가 만든 정적 HTML + CSS 임베드. **PDF에서 폰트 누락이 흔한 실패 지점** |

- **데이터 모델 함의**:
  ```sql
  -- 블록 수식:  block.type = 'equation'
  --             block.properties = { expression: TEXT }          -- ≤1000자 검증
  -- 인라인 수식: RichText[] 안의 { type:'equation', equation:{ expression }, annotations, plain_text }
  ```
  - **저장은 원문 문자열만** 한다. 렌더 결과(HTML/MathML)를 저장하면 KaTeX 버전 업그레이드 때 전 페이지 마이그레이션이 필요해진다. 캐시가 필요하면 `equation_render_cache(expression_hash, katex_version, html)` **별도 테이블**로 분리해 언제든 버릴 수 있게 한다.
  - 인라인 수식은 rich text 배열의 한 요소이므로 **F-01-19의 블록 분할/병합에서 원자 단위**로 취급된다(오프셋 계산 시 길이 1로 셀지, `plain_text` 길이로 셀지 규칙을 하나로 고정할 것).
- **UI/인터랙션**: `/math`·`/latex`, `+` 메뉴의 Block equation, `$$…$$` 자동 변환, `Cmd/Ctrl+Shift+E`, 플로팅 툴바 `√x`, 클릭 시 라이브 편집 입력창(입력 중 실시간 프리뷰), Esc로 닫기, `Turn into`로 인라인↔블록 전환.
- **의존 기능**: F-01-02(블록 타입), F-01-03(rich text 요소로서의 인라인 수식), F-01-04(`/math`), F-01-05(`$$` 입력 규칙), F-01-06(인라인↔블록 turn into), F-01-19(원자 단위 오프셋)
- **구현 난이도**: **M** — KaTeX 연동 자체는 S지만 ① 인라인/블록 2중 표현 ② `$$` 입력 규칙과 코드 블록 예외 ③ 라이브 편집 입력창(캐럿이 닿으면 열림)이라는 비표준 인터랙션 ④ 렌더 캐시 ⑤ `trust`/`maxExpand` 보안 설정 ⑥ 내보내기 3종이 붙는다. **③이 실질 작업량의 절반**이다.
- **우선순위**: **P1** — 개발자/학술 사용자에게는 차별점이지만 MVP 필수는 아니다. 다만 KaTeX는 의존성 추가만으로 큰 인상을 주는 **가성비 높은 P1**이다.
- **클론 시 현실적 대안**: v1은 **블록 수식만** 지원(`/math` + 클릭 편집 + 실시간 프리뷰). 인라인 수식은 rich text 모델에 `type:'equation'` 자리만 미리 만들어 두고 UI는 v2. mhchem은 필요할 때 지연 로드.
- **참고 출처**: https://www.notion.com/help/math-equations , https://developers.notion.com/reference/block , https://developers.notion.com/reference/rich-text , https://developers.notion.com/reference/request-limits , https://www.notion.com/releases/2020-06-09

---

### F-01-21 블록 레벨 색상 (block color / 하이라이트)

- **한 줄 정의**: 블록 **전체**에 글자색 또는 배경색을 지정한다. 문자 범위 단위인 rich text `annotations.color`(F-01-03)와는 **별개의 두 번째 색상 계층**이다.
- **사용자 시나리오** (모두 공식 문서 확인):
  1. 블록 좌측 `⋮⋮` 클릭 → `Color` → 팔레트에서 선택.
  2. 텍스트 블록의 시작 또는 끝에서 `/색상이름`(예: `/red`, `/blue background`) 입력 → 블록 전체가 그 색이 된다.
  3. `Cmd/Ctrl + /` → 색상 이름 입력 → Enter.
  4. `Cmd/Ctrl + Shift + H` → **마지막으로 사용한 텍스트/하이라이트 색을 재적용**.
  5. 텍스트를 선택한 상태에서는 플로팅 툴바의 `A` 드롭다운 → 이 경우는 **선택 범위만**(F-01-03의 인라인 색상).
- **동작 상세**:
  - **`color`를 가지는 블록 타입은 공식적으로 열거되어 있다**: `paragraph`, `heading_1`, `heading_2`, `heading_3`, `heading_4`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`, `callout`, `quote`, `table_of_contents`. (2022-03-03 API 체인지로그가 `heading_4`를 뺀 11종을 열거했고, 현행 블록 레퍼런스는 `heading_4`를 포함해 열거한다.) → **`code`, `divider`, `image`/미디어, `column`, `table`, `synced_block`, `equation`에는 `color` 필드가 없다.**
  - 그런데 헬프센터는 *"The Color option only appears for certain types of blocks... like text, files, and web bookmarks"*라고 하여 **파일/북마크에도 Color가 있다고 서술한다.** 공개 API의 `file`/`bookmark` 스키마에는 `color` 필드가 없다 → **UI와 API가 어긋나는 두 번째 지점**이다 `[확인필요]`(F-01-02의 `heading_4`에 이은 사례). **클론 판단**: `format.block_color`를 **모든 블록 타입이 가질 수 있는 공통 포맷 필드**로 두고, 어느 타입에 색상 UI를 노출할지는 렌더러 레지스트리에서 결정한다. 그러면 API 스키마 변경 없이 지원 타입을 넓힐 수 있다.
  - **색상 값은 19개**다: `default` + 텍스트 9종(`gray` `brown` `orange` `yellow` `green` `blue` `purple` `pink` `red`) + 배경 9종(`*_background`). 헬프센터가 열거하는 목록에도 `default_background`는 **없다**(공식 확인 — F-01-03의 GAP 1회차 정정이 옳았음이 재확인됨).
  - **하나의 `color` 필드가 텍스트색과 배경색을 겸한다** → 구조적으로 **한 블록에 글자색과 배경색을 동시에 지정할 수 없다**. 이는 노션의 의도적 단순화이며, 클론이 "둘 다 되게" 바꾸면 공개 API 호환이 깨진다.
  - callout은 특수하다: 공식 문서가 *"블록 자체의 색 또는 블록 안 텍스트의 색"*을 구분해 안내하며, **글자색을 기본(검정) 아닌 색으로 바꾸면 블록 배경이 흰색 + 연회색 테두리가 된다**(공식 명시). 즉 callout에서는 `color`가 배경 스타일까지 함께 바꾸는 파생 규칙이 있다.
  - 블록 색과 인라인 색은 **중첩된다**: 블록이 `red`이고 그 안 일부 span이 `blue`면 span 색이 이긴다 `[추정]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — `color` 미지정 | `"default"`로 취급. 저장 시 `default`는 아예 기록하지 않는 편이 페이로드가 작다 |
  | 색상 미지원 타입에 `color` 지정 | API는 무시 또는 400. **클론은 저장은 허용하되 렌더에서 무시**(라운드트립 손실 방지) |
  | 중첩 — 블록 색 + 인라인 색 충돌 | 인라인(더 좁은 범위)이 우선 |
  | 중첩 — 부모 블록 색이 자식에 상속되는가 | **상속되지 않는다**(각 블록이 자기 `color`를 가짐). 콜아웃 배경은 컨테이너 배경일 뿐 자식 텍스트색이 아니다 |
  | 다크 모드 | 같은 `color` 토큰이 라이트/다크에서 **다른 실제 색으로 렌더**되어야 한다. 하드코딩된 HEX를 저장하면 다크 모드에서 가독성이 무너진다 → **색은 반드시 토큰(enum)으로 저장** |
  | 접근성 — 대비 | `yellow` 텍스트는 흰 배경에서 WCAG AA를 못 넘긴다. 팔레트를 라이트/다크별로 별도 조정하고, 색만으로 의미를 전달하지 않도록 문서화 |
  | 블록 분할/병합(F-01-19) | 분할 시 새 블록은 색을 **상속**, 병합 시 **앞 블록의 색이 이긴다** |
  | Turn into(F-01-06) | 대상 타입이 색을 지원하면 유지, 아니면 폐기하되 **원본 값은 `format`에 남겨** 되돌릴 때 복원 |
  | 삭제된 참조 | 해당 없음(값 타입) |
  | 동시편집 — 두 사용자가 다른 색 지정 | LWW. 색은 교환 가능하지 않지만 손실이 사소하다 |
  | 권한 없음 | `Color` 메뉴 항목 미노출 |
  | 대용량 — 1000블록 일괄 색 변경 | 단일 트랜잭션 + 단일 undo |
  | 내보내기 | 마크다운에는 색 개념이 없다. Notion의 enhanced markdown은 `{color="Color"}` 접미 문법으로 표현한다 → 클론도 **무손실 트랙에서만** 색을 싣고 표준 MD에서는 버린다 |
  | 붙여넣기 — 외부 HTML의 `style="color:#..."` | 임의 HEX를 19개 토큰 중 **가장 가까운 값으로 스냅**하거나 버린다. HEX를 그대로 저장하면 다크 모드가 깨진다 |

- **데이터 모델 함의**:
  ```sql
  -- 권장: 타입별 properties가 아니라 공통 format에 둔다
  -- block.format = { block_color: 'default' | 'red' | ... | 'red_background', ... }
  -- 공개 API 호환 레이어에서만 타입별 {type}.color 로 투영한다
  ```
  - `block_color`는 **enum 문자열**로 저장하고 HEX는 절대 저장하지 않는다(다크 모드·테마 교체·접근성 조정을 모두 렌더 시점 결정으로 미룰 수 있다).
  - 인라인 색(`RichText.annotations.color`)과 **같은 enum 도메인을 공유**한다 → 팔레트 정의를 코드 한 곳에 두고 양쪽이 참조.
  - "마지막 사용 색"(`Cmd/Ctrl+Shift+H`)은 사용자별 클라이언트 상태다: `user_preference.last_used_color`. 서버 저장은 불필요(localStorage로 충분).
- **UI/인터랙션**: `⋮⋮` → `Color` 서브메뉴(텍스트 색 9 + 배경 색 9 + 기본), `/red` 계열 슬래시 커맨드, `Cmd/Ctrl + /` + 색 이름, `Cmd/Ctrl+Shift+H`(마지막 색 재적용), 선택 시 플로팅 툴바 `A` 드롭다운.
- **의존 기능**: F-01-02(어느 타입이 색을 갖는가), F-01-03(인라인 색과 도메인 공유), F-01-04(`/red` 커맨드), F-01-06(변환 시 색 처리), F-01-09(다중 선택 일괄 적용)
- **구현 난이도**: **S~M** — 값 하나를 저장하고 CSS 클래스를 붙이는 일이라 S에 가깝지만, ① 라이트/다크 2벌 팔레트 + 접근성 대비 검증 ② 블록 색과 인라인 색의 우선순위 규칙 ③ callout의 파생 스타일 규칙 ④ 붙여넣기 시 임의 HEX 스냅 ⑤ 내보내기 2트랙 때문에 M으로 넘어간다.
- **우선순위**: **P1** — MVP 없이도 편집이 성립한다. 단 **팔레트 enum과 `format.block_color` 자리는 P0 시점에 스키마에 넣어 두어야** 나중에 마이그레이션이 없다.
- **클론 시 현실적 대안**: 19색 전체 대신 **6색 + 배경 6색**으로 시작(gray/red/orange/yellow/green/blue). CSS 변수(`--nc-red`, `--nc-red-bg`)로 정의해 다크 모드는 변수 재정의만으로 처리. `Cmd/Ctrl+Shift+H`는 v2.
- **참고 출처**: https://www.notion.com/help/customize-and-style-your-content , https://developers.notion.com/changelog/block-colors-are-now-supported-in-the-api , https://developers.notion.com/reference/block , https://www.notion.com/help/keyboard-shortcuts , https://developers.notion.com/guides/data-apis/enhanced-markdown

---

### F-01-22 대용량 페이지 렌더링 · 클라이언트 캐시 · 부분 로드

- **한 줄 정의**: 블록 수천 개짜리 페이지를 즉시 열고 끊김 없이 스크롤·편집하기 위한 로딩·캐싱·렌더 전략. 개별 UI 기능이 아니라 **에디터 전체를 가로지르는 비기능 요구**다.
- **사용자 시나리오**: 사용자가 사이드바에서 긴 페이지를 클릭 → 상단 뷰포트 분량이 즉시 그려짐 → 아래로 스크롤하면 나머지가 이어서 나타남 → 두 번째 방문에서는 네트워크 응답을 기다리지 않고 **로컬 캐시에서 즉시** 그려지고 서버 응답이 도착하면 차이만 반영된다.
- **동작 상세** — 노션이 **1차 출처로 공개한 사실**:

  | 사실 | 내용 | 출처 |
  |---|---|---|
  | 클라이언트 저장소를 IndexedDB → SQLite로 교체 | *"Before SQLite, we relied on IndexedDB for client-side storage. But we encountered storage quotas, a number of bugs, and performance concerns on Windows machines in particular."* | `/blog/faster-page-load-navigation` |
  | 종합 효과 | 대부분 사용자 기준 **초기 페이지 로드 50%, 페이지 간 이동 50% 단축** | 같은 글 |
  | 코드 스플리팅 | 핵심 번들 먼저 로드, 비핵심은 지연 | 같은 글 |
  | 브라우저에서의 SQLite | **WASM SQLite + OPFS**(Origin Private File System)에 영속화. 브라우저 스토리지 쿼터를 우회 | `/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite` |
  | 멀티탭 동시성 | 탭마다 Web Worker를 두되 **SharedWorker가 "쓰기 가능한 탭"을 1개만 지정**. 여러 탭이 동시에 쓰면 DB가 손상되었기 때문 | 같은 글 |
  | 탭 종료 감지 | **Web Locks API**로 탭이 닫힌 것을 감지해 다른 탭으로 페일오버 | 같은 글 |
  | VFS 선택 | *"OPFS SyncAccessHandle Pool VFS"* — **cross-origin isolation 헤더가 필요 없어서** 선택(그 헤더가 서드파티 스크립트와 충돌) | 같은 글 |
  | 측정 결과 | 모던 브라우저 전반 **탐색 시간 20% 개선**, 지역별로 호주 28% / 중국 31% / 인도 33% | 같은 글 |
  | 느린 기기 전략 | SQLite 읽기와 API 호출을 **경주(race)**시켜 먼저 오는 쪽을 쓴다 | 같은 글 |
  | **페이지 로드 API의 이름과 동작** | *"The API method for loading the data for a page is called `loadPageChunk` — it descends from a starting point (likely the block ID of a page block) down the content tree, and returns the blocks in the content tree **plus any dependent records needed to properly render those blocks**."* | `/blog/data-model-behind-notion` |
  | 로드 결과의 보관 | *"All data loaded by `loadPageChunk` is put into memory (and saved in the RecordCache if you're using the app)."* | 같은 글 |

  - **[GAP 2회차 — 반증 조사 결과] 노션이 페이지를 "청크 단위"로 로드한다는 것은 1차 출처로 확인된다.** 메서드 이름이 `loadPage`가 아니라 **`loadPageChunk`**이고, "시작 지점(starting point)에서 아래로 내려간다"고 명시되어 있다 → **시작 지점을 옮겨 가며 여러 번 호출하는 구조**다. 다만 **청크의 단위가 무엇인지(블록 개수 고정 / 뷰포트 / subtree)는 공개되어 있지 않다** `[확인필요]`. 클론 설계에는 "시작 커서 + 개수 상한"이면 충분하다.
  - 이 인용에서 클론이 가져가야 할 두 번째 사실은 **"dependent records"**다. 블록만 주는 것이 아니라 **그 블록을 렌더하는 데 필요한 다른 레코드(멘션 대상 페이지의 제목, 사용자 정보, synced block 원본, 파일 메타 등)를 함께 실어 보낸다.** → 클론의 부분 로드 응답도 `{blocks: [], dependencies: {pages: [], users: [], files: []}}` 형태여야 하며, 그렇지 않으면 **블록 1개를 그릴 때마다 N번의 추가 왕복(N+1 문제)**이 발생한다. 이것이 부분 로드 API 설계에서 가장 흔히 빠뜨리는 부분이다.

  - 관련 상한(공식): 데이터베이스당 **250,000행**, 데이터베이스 페이지 1개의 전체 property 데이터 합계 **2.5MB**. 무료 플랜에서 소유자가 2명 이상인 워크스페이스는 **1,000 블록 제한**이며 **블록을 지우거나 휴지통을 비워도 카운트가 줄지 않는다**(3일 유예 존재).
  - **"페이지당 최대 블록 수" 공식 상한은 확인되지 않았다** `[확인필요]`. 위 1,000 블록은 워크스페이스 과금 한도이지 렌더 한계가 아니다.
  - **클론에 주는 함의(설계 결정)**:
    1. **서버는 "페이지 전체 트리"를 한 번에 주지 않는다.** 노션의 `loadPageChunk`와 동형인 **커서 기반 부분 로드 + 의존 레코드 동봉** 계약을 F-01-01 단계에서 확정한다: `GET /pages/{id}/chunk?cursor={order_key}&limit=N` → `{blocks: [], dependencies: {pages, users, files}, next_cursor, page_version}`. 나중에 붙이려면 클라이언트 상태 관리를 다시 짜야 한다.
    2. **로컬 캐시 계층을 처음부터 인터페이스로 분리**한다. MVP는 메모리 + IndexedDB, 필요하면 WASM SQLite로 교체 — 단 **멀티탭 쓰기 조정(SharedWorker + Web Locks)** 없이 여러 탭에서 쓰면 노션조차 DB를 손상시켰다는 사실을 기억할 것.
    3. **가상 스크롤과 블록 트리는 궁합이 나쁘다.** 가변 높이 + 중첩 + 접힘 때문에 인덱스↔픽셀 매핑이 안정적이지 않다 → 실무적으로는 **뷰포트 밖 블록을 언마운트하지 않고 `content-visibility: auto` + `contain-intrinsic-size`로 렌더 비용만 건너뛰는 편**이 캐럿/선택/찾기를 깨지 않는다 `[추정]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 — 캐시가 비어 있음(첫 방문/시크릿 창) | 네트워크만으로 렌더. 캐시는 **최적화이지 정합성의 원천이 아니다** |
  | 캐시가 서버보다 오래됨 | 캐시로 즉시 그리고 서버 응답 도착 시 diff 반영. **낙관적 렌더 중 사용자가 편집했다면 그 편집을 잃지 않게** 로컬 미전송 트랜잭션을 서버 스냅샷 위에 재적용 |
  | 멀티탭 — 두 탭에서 동시 편집 | 쓰기 권한 탭 1개 + 나머지는 브로드캐스트 채널로 읽기. **조정 없이 두 탭이 쓰면 로컬 DB 손상**(노션이 실제 겪은 문제) |
  | 탭 강제 종료 | Web Locks 해제를 감지해 다른 탭이 쓰기 권한 인수 |
  | 중첩 — 접힌 토글 안의 블록을 안 불러왔는데 검색에 걸려야 함 | **F-01-13에서 지적한 모순.** 해결: 검색은 **서버 인덱스**(`block.search_text`, F-01-03)로 수행하고, 히트한 블록의 조상 체인만 온디맨드 로드해 펼친다. 클라이언트 로컬 검색만으로 만들면 반드시 누락된다 |
  | 대용량 — 이미지 500장 | `loading="lazy"` + 썸네일 파생 + `aspect-ratio` 사전 지정(레이아웃 시프트 방지) |
  | 대용량 — 수식 500개 / 코드 블록 200개 | 뷰포트 진입 시 렌더(F-01-20, F-01-14). 하이라이터·KaTeX는 동기 CPU 작업이라 초기 페인트를 막는다 |
  | 동시편집 — 뷰포트 밖 블록이 변경됨 | 로드되지 않은 구간의 변경은 **적용하지 않고 버전만 무효화**. 그 구간을 로드할 때 최신을 가져온다 |
  | undo — 아직 로드되지 않은 블록에 대한 undo | undo 스택의 inverse op가 참조하는 블록이 메모리에 없을 수 있다 → **inverse op는 블록 스냅샷을 자체 보관**해야 안전 |
  | Ctrl+F(브라우저 찾기) | 언마운트된 블록은 브라우저 찾기에 안 걸린다 → 앱 자체 찾기(Quick Find)를 제공하거나 `content-visibility` 방식을 택한다 |
  | 인쇄 / PDF 내보내기 | **전량 로드가 필수**다. 부분 로드 상태로 인쇄하면 내용이 잘린다. 내보내기는 서버 사이드에서 전체 트리를 렌더 |
  | 권한 없음 | 부분 로드 응답에서 권한 없는 subtree를 제외해도 `order_key` 커서가 어긋나지 않게 **커서는 서버가 발급**한다 |
  | 오프라인 | 캐시된 페이지는 읽기 가능, 편집 트랜잭션은 큐에 적재(F-01-17) |
  | 저장소 압박(OPFS/IndexedDB 쿼터 초과) | LRU로 오래된 페이지 캐시 제거. **미전송 트랜잭션 큐는 절대 제거 대상에 넣지 않는다** |

- **데이터 모델 함의**:
  - 부분 로드가 성립하려면 **`(page_id, order_key)`로 정렬된 평평한 조회**가 가능해야 한다. F-01-01의 "재귀 CTE vs `page_id` 비정규화 컬럼" 선택에서 **`page_id` 비정규화가 사실상 강제**된다(재귀 CTE로는 커서 페이징이 어렵다). → 블록 이동 시 subtree 전체의 `page_id`를 갱신하는 비용을 감수한다.
  - 서버 응답에 **페이지 단위 버전(`page.version` 또는 최신 `operation.id`)**을 실어야 캐시 무효화가 O(1)이 된다. 블록별 버전만으로는 "내 캐시가 최신인가"를 한 번에 판단할 수 없다.
  - 클라이언트 캐시 스키마(브라우저 SQLite/IndexedDB 채택 시):
    ```sql
    CREATE TABLE cached_block (id TEXT PRIMARY KEY, page_id TEXT, order_key TEXT,
                               json TEXT, server_version INTEGER, fetched_at INTEGER);
    CREATE TABLE cached_page  (id TEXT PRIMARY KEY, version INTEGER, fully_loaded INTEGER, fetched_at INTEGER);
    CREATE TABLE pending_tx   (tx_id TEXT PRIMARY KEY, ops TEXT, created_at INTEGER, retry_count INTEGER);
    CREATE INDEX ON cached_block (page_id, order_key);
    ```
  - `pending_tx`는 **캐시가 아니라 데이터**다. 캐시 삭제·LRU 축출·버전 업그레이드 어디에서도 함께 지워지면 안 된다.
- **UI/인터랙션**: 스켈레톤 플레이스홀더(높이를 미리 잡아 레이아웃 시프트 방지), 스크롤 시 점진 로드, 오프라인/동기화 실패 인디케이터, "이 페이지가 큽니다" 경고 `[추정]`.
- **의존 기능**: F-01-01(부분 로드 가능한 API 계약과 `page_id`/`order_key`), F-01-13(접힘과 지연 로드의 상호작용), F-01-17(미전송 트랜잭션 큐, undo 스냅샷), F-01-03(서버 검색 인덱스)
- **구현 난이도**: **L~XL** — 기능이 아니라 **아키텍처 제약**이라 사후 도입 비용이 크다. ① 커서 기반 부분 로드 API ② 클라이언트 캐시 계층 + 무효화 ③ 멀티탭 쓰기 조정 ④ 부분 로드 상태에서의 검색/undo/인쇄 정합성 ⑤ 렌더 비용 절감(content-visibility/가상화)이 각각 독립 작업이고, ④는 **다른 5개 기능의 동작 정의를 바꾼다**. 노션조차 전담 성능 팀이 이 작업을 했고 브라우저 SQLite 도입에는 DB 손상이라는 실제 사고가 있었다.
- **우선순위**: **P1**(실제 최적화 구현) / **하지만 API 계약과 `page_id` 비정규화 결정은 P0** — F-01-01·F-01-17과 같은 시점에 고정하지 않으면 나중에 스키마와 클라이언트 상태 관리를 함께 재작성해야 한다. **이 도메인에서 가장 과소평가되기 쉬운 항목 3개(F-01-17, F-01-15, F-01-22) 중 하나.**
- **클론 시 현실적 대안**: MVP는 **페이지당 블록 상한(예: 2,000)을 두고 전량 로드**한다. 그 대신 ① API는 처음부터 커서 파라미터를 받고(무시해도 됨) ② `page_id` 컬럼을 처음부터 둔다 ③ 캐시는 메모리 Map + `localStorage` 스냅샷으로 시작. WASM SQLite/OPFS는 실제로 느려진 뒤에 도입한다. 가상 스크롤보다 `content-visibility: auto`를 먼저 시도할 것 — 비용 대비 효과가 압도적이다.
- **참고 출처**: https://www.notion.com/blog/faster-page-load-navigation , https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite , https://www.notion.com/help/understanding-block-usage , https://www.notion.com/help/optimize-database-load-times-and-performance

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-01-01 | 블록 트리 데이터 모델(렌더/권한 분리) | XL | P0 | — |
| F-01-02 | 블록 타입 레지스트리(35종) | XL (MVP 12종 = L) | P0 | F-01-01 |
| F-01-03 | rich text 인라인 서식 | L | P0 | F-01-01, F-01-02 |
| F-01-04 | 슬래시(/) 커맨드 | M | P0 | F-01-02, F-01-06 |
| F-01-05 | 마크다운 단축 입력 | M | P0 | F-01-02, F-01-06 |
| F-01-06 | 블록 타입 변환(Turn into) | M | P0 | F-01-01, F-01-02, F-01-09 |
| F-01-07 | 중첩(들여쓰기/내어쓰기) | M | P0 | F-01-01, F-01-02 |
| F-01-08 | 드래그 앤 드롭 + 핸들 메뉴 | L | P0 / P1(컬럼 드롭) | F-01-01, F-01-09 |
| F-01-09 | 멀티 블록 선택 | L | P0 / P1(비연속) | F-01-01, F-01-06, F-01-08 |
| F-01-10 | 복사/붙여넣기 구조 보존 | L | P0(내부) / P1(HTML) | F-01-01, F-01-03, F-01-09 |
| F-01-11 | Synced block | XL | P1 | F-01-01, F-01-06, F-01-10 |
| F-01-12 | 컬럼 레이아웃 | L | P1 | F-01-01, F-01-02, F-01-08 |
| F-01-13 | 토글 / 토글 헤딩 / 접기 | M | P0(toggle) / P1(toggle heading) | F-01-01, F-01-02, F-01-07, F-01-22 |
| F-01-14 | 코드 블록 | M | P0 | F-01-02, F-01-04, F-01-05, F-01-10, F-01-19 |
| F-01-15 | 미디어/파일/북마크/임베드 | L~XL | P0(image) / P1 / P2 | F-01-02 + 스토리지 |
| F-01-16 | 목차 / breadcrumb / divider | S(divider) / M(목차·breadcrumb) | P0(divider) / P1(목차) / P2(breadcrumb) | F-01-02 |
| F-01-17 | 트랜잭션 / Undo / 동시편집 | XL | P0(로컬) / P1(실시간) | F-01-01 |
| F-01-18 | 심플 테이블 (table / table_row / 병합) | L (병합 포함 시 XL) | P1 / P2(병합) | F-01-01, F-01-02, F-01-03, F-01-09, F-01-17 |
| F-01-19 | 캐럿 이동 / 블록 분할 / 병합 | L (라이브러리 미사용 시 XL) | **P0** | F-01-01, F-01-03, F-01-13, F-01-14, F-01-17 |
| F-01-20 | 수식 (인라인 / 블록 equation) | M | P1 | F-01-02, F-01-03, F-01-05, F-01-06, F-01-19 |
| F-01-21 | 블록 레벨 색상 | S~M | P1 (스키마 자리는 P0) | F-01-02, F-01-03, F-01-04, F-01-06 |
| F-01-22 | 대용량 렌더링 / 클라이언트 캐시 | L~XL | P1 (API 계약은 P0) | F-01-01, F-01-03, F-01-13, F-01-17 |

**P0 최소 집합(MVP)**: F-01-01, F-01-02(12종), F-01-03(기본 서식), F-01-04, F-01-05, F-01-06, F-01-07, F-01-08(상하 이동), F-01-09(연속 선택), F-01-10(내부 복붙), F-01-13(toggle), F-01-14, F-01-15(image), F-01-16(divider), F-01-17(로컬 undo), **F-01-19(분할·병합)**

> **GAP 2회차 정정**: F-01-19(Enter/Backspace로 블록을 쪼개고 합치는 동작)는 이전 판에서 F-01-01의 하위 서술로만 흩어져 있었으나, **이것이 없으면 에디터가 성립하지 않으므로 P0 최소 집합에 명시**한다. 반대로 F-01-21(블록 색상)과 F-01-22(부분 로드)는 기능 자체는 P1이지만 **스키마·API 계약의 자리만은 P0 시점에 고정**해야 하는 유형이다 — 아래 "P0에 넣지 않지만 P0 시점에 결정해야 하는 것" 참조.

**P0에 넣지 않지만 P0 시점에 결정해야 하는 것**(사후 변경 비용이 재작성급인 항목)

| 결정 사항 | 관련 기능 | 미루면 생기는 일 |
|---|---|---|
| 동기화 스택(Yjs vs 자체 OT vs LWW) | F-01-17 | 저장 포맷과 undo 구현이 여기에 묶여 있어 교체가 사실상 재작성 |
| 자식 순서 표현(`content[]` vs `order_key`) | F-01-01 | 동시 삽입 충돌 처리와 부분 로드 커서가 모두 여기서 파생 |
| `page_id` 비정규화 컬럼 | F-01-01, F-01-22 | 없으면 커서 기반 부분 로드가 불가능(재귀 CTE로는 페이징이 어렵다) |
| `format.block_color` 자리와 색상 enum | F-01-21 | 나중에 넣으면 전 블록 마이그레이션 |
| 셀 텍스트의 동시편집 단위(행 JSONB vs 셀 단위) | F-01-18, F-01-17 | 행 단위로 두면 표에서 상대 입력이 통째로 유실 |
| 커스텀 클립보드 MIME과 subtree 직렬화 포맷 | F-01-10 | 포맷을 바꾸면 이전 버전 클립보드가 깨진다 |

**빌드 순서 권장**: F-01-01 → F-01-02 → F-01-03 → **F-01-19** → F-01-07 / F-01-13 → F-01-06 → F-01-04 / F-01-05 → F-01-09 → F-01-08 → F-01-10 → F-01-14 / F-01-15 → F-01-21 → F-01-17(실시간) → F-01-12 / F-01-18 → F-01-20 → F-01-16 → F-01-22 → F-01-11

**난이도 XL 항목과 근거**

| ID | 왜 XL인가 |
|---|---|
| F-01-01 | 트리 CRUD + 순서 키 + 소프트 삭제 + 렌더/권한 이중 관계 + 트랜잭션 로그를 한 번에 확정해야 하고, 이후 모든 기능이 종속되어 되돌리는 비용이 가장 크다 |
| F-01-02 | 타입 35종 각각이 렌더러 + 편집 UI + 검증 스키마 + turn-into 매핑 + 내보내기 규칙을 요구한다 |
| F-01-11 | 참조 렌더 + 원본 기준 권한 평가 + 순환 방지 + 역인덱스 + 다중 위치 실시간 반영 + 원본 삭제 정책이 모두 얽힌 유일한 기능 |
| F-01-15 (L~XL) | 청크 업로드 / 만료 서명 URL 재발급 / OG 크롤러(SSRF) / 임베드 sandbox / 파일 GC — 독립 서브시스템 5개이며 3개가 보안 사고 유형 |
| F-01-17 | 텍스트 동시편집 병합(CRDT/OT)은 이 프로젝트 전체에서 가장 난도가 높고, 잘못 고르면 저장 포맷 전체를 다시 설계해야 한다 |
| F-01-19 (라이브러리 미사용 시) | DOM selection ↔ 모델 오프셋 매핑 + rich text span 분할 + 자식 귀속 + 타입별 예외 + IME + CRDT 위치 유실 방지가 한 지점에 겹친다. 버그 밀도가 가장 높다 |
| F-01-22 (L~XL) | 기능이 아니라 아키텍처 제약이라 사후 도입 비용이 크고, 부분 로드 상태에서의 검색·undo·인쇄 정합성이 **다른 5개 기능의 동작 정의를 바꾼다** |

**과소평가 위험 상위 4개**(난이도 재검토 결과): **F-01-17**(동기화) > **F-01-22**(부분 로드·캐시) > **F-01-15**(미디어·크롤러 보안) > **F-01-19**(분할·병합). 공통점은 *"화면에 보이는 UI는 작은데 되돌리는 비용이 재작성급"* 이라는 점이다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 스택 | 문서 모델 | 차용 가능한 것 |
|---|---|---|---|
| **BlockSuite** (AFFiNE의 에디터 엔진) | TypeScript, Yjs 네이티브 | `defineBlockSchema({flavour, props, metadata:{version, role, parent, children}})`. `role`은 `root`/`hub`/`content` 3종으로 트리 구조를 강제(root는 문서당 1개, hub는 여러 자식, content는 리프성). `props`는 `internal.Text()`(=`Y.Text`)와 `Boxed`(raw Y.Map) 지원, `undefined`/`null` 금지. `children`은 `['flavour']`, `['*']`, glob(`['my-data-*']`, minimatch), `[]`로 제약 선언 | **블록 스키마 레지스트리 설계를 거의 그대로 차용 가능.** `role`로 컨테이너/리프를 구분하고 `children` glob으로 부모-자식 제약을 선언하는 방식은 노션의 column_list/column, table/table_row 제약을 깔끔하게 표현한다. `metadata.version`으로 스키마 마이그레이션 경로 확보 |
| **AFFiNE** | TypeScript + Rust, y-octo(네이티브 Yjs 구현) | CRDT 기반 local-first | 서버/클라이언트가 동일 CRDT 구현을 공유하는 구조. 오프라인 우선이 요구사항이면 참고 |
| **AppFlowy** | Rust 백엔드 + Flutter 프론트 | 노션 구조에 가장 근접한 "클론" 성격 | 데이터 모델 대조군. 웹 기반 클론에는 스택이 맞지 않음 |
| **BlockNote** | React + ProseMirror + Tiptap + Yjs | ProseMirror 스키마 위에 블록 추상화 | **슬래시 메뉴(suggestion menu), 버블 메뉴, 드래그 핸들, 중첩 블록, 블록 재정렬, 실시간 동기화가 이미 구현되어 있다.** 노션형 편집 UX의 상당 부분을 즉시 확보하는 가장 빠른 경로. 커스텀 블록 정의 API 제공 |
| **Novel** | Tiptap + Vercel AI SDK | ProseMirror | 슬래시 메뉴 + 버블 메뉴 + AI 자동완성 레퍼런스 |
| **Figma / Linear (일반 패턴)** | — | fractional indexing | 자식 순서를 배열 대신 정렬 키로 표현해 동시 재정렬 충돌을 회피(F-01-01 순서 표현 결정의 근거) |

**권장 조합(이 프로젝트 기준)**

1. 편집기 렌더/입력 레이어: **ProseMirror 계열(BlockNote 또는 Tiptap 직접)** — 슬래시 메뉴, inputRules, 드래그 핸들, selection 처리를 직접 만들지 않는다.
2. 동기화/충돌: **Yjs** — `Y.Map`(블록 props) + `Y.Text`(텍스트) + fractional index 또는 `Y.Array`(순서).
3. 스키마 정의: **BlockSuite식 선언적 레지스트리**를 자체 구현(flavour/role/children/version).
4. 영속화: Yjs update 바이너리 + 관계형 파생 테이블(`block`) 이중 저장 — 검색·권한·공개 API는 관계형 뷰에서 처리.

**주의(아키텍처 분기점)**: ProseMirror는 **블록 배열이 아니라 하나의 문서 트리**를 다룬다. 노션식 "블록별 독립 권한 / synced block / 블록 단위 코멘트"와는 모델 간극이 있으며, "페이지 = 1개 ProseMirror 문서" 전제는 F-01-11(synced block)과 블록 단위 권한에서 깨진다. 이 간극을 어떻게 메울지(문서 안에 참조 노드를 두고 별도 문서를 렌더할지 등)가 최대 설계 리스크다 `[추정]`.

출처: https://blocksuite.io/guide/block-schema , https://github.com/toeverything/blocksuite , https://github.com/toeverything/affine , https://www.blocknotejs.org/docs , https://www.figma.com/blog/realtime-editing-of-ordered-sequences/

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| 1 | 노션 앱 편집기의 실제 텍스트 길이 제한(공개 API의 2000자와 동일한가) | 블록 분할 정책 결정 | 앱에서 장문 입력 실측 |
| 2 | 노션의 실제 동시편집 충돌 해결 방식(CRDT / OT / LWW) | 클론의 동기화 스택 선택 — 가장 비싼 되돌리기 비용 | 공식 발표·컨퍼런스 자료 추가 조사. 현재는 3자 서술만 존재 |
| 3 | 최대 블록 중첩 깊이 | 재귀 렌더/쿼리 한계 설정 | 앱에서 Tab 반복 실측 |
| 4 | Shift+Tab 시 후속 형제 블록의 승계 규칙 | 아웃라이너 동작의 핵심 | 앱 실측 |
| 5 | 자식 있는 블록 삭제 시 자식 처리(함께 삭제 vs 승격) | 데이터 손실 정책 | 앱 실측 |
| 6 | synced block 원본 삭제(사본 ≤10) 시 사본의 상태 | 데이터 보전 정책 | 앱 실측 (사본 >10 케이스만 공식 문서화됨) |
| 7 | column_list 중첩 허용 여부 및 최대 컬럼 수, 빈 컬럼 자동 제거 여부 | 스키마 제약 확정 | 앱 실측 |
| 8 | 토글 접힘 상태가 사용자별인지 문서 공유인지 | 저장 위치 결정 | 두 계정으로 동시 접속해 확인 |
| 9 | URL 붙여넣기 시 나타나는 선택지(bookmark/embed/mention/평문)의 정확한 목록 | F-01-10 구현 범위 | 앱 실측 |
| 10 | 코드 블록의 Tab 동작, 탈출 단축키, 지원 언어 전체 목록 | F-01-14 구현 | 앱 실측 |
| 11 | 목차가 수집하는 헤딩 범위(H4? 토글 헤딩? 컬럼 내부?) | F-01-16 구현 | 앱 실측 |
| 12 | `link_to_page` 블록 타입의 조회 시 표현 | 공개 API 호환성 | 공개 API로 생성 후 재조회 |
| 13 | 노션 내부 rich text 저장 포맷(decoration 튜플 배열)의 실제 형태 | 마이그레이션/호환 | 노션 내보내기 데이터 관찰 |
| 14 | `transcription` / `meeting_notes` 블록의 상세 스키마 | 타입 전수 완성 | 공개 API 문서 재확인(현재 문서화 부족) |
| 15 | 서식 경계에서 타이핑 시 annotation 상속 규칙 | F-01-03 구현 | 앱 실측 |
| 16 | 슬래시 메뉴의 필터 방식(prefix vs fuzzy)과 `/` 트리거 종료 조건 | F-01-04 구현 | 앱 실측 |
| 17 | **심플 테이블 셀 병합의 공개 API 표현**(`table_row.cells`에 rowspan/colspan 자리가 없음) | F-01-18 스키마 확정 — 병합 표현을 스스로 설계할지, 노션 표현을 따를지 | 병합된 표를 공개 API로 조회해 응답 관찰 |
| 18 | `Turn into database`의 변환 규칙(첫 행이 property 이름이 되는가, 비가역인가) | F-01-18 ↔ DB 도메인 경계 | 앱 실측 |
| 19 | **UI/API 불일치 2건의 성격** — ① `heading_4`가 API·enhanced markdown에는 있고 편집기 UI에는 없음 ② 헬프센터는 파일·북마크에 Color가 있다고 하나 API 스키마에는 `color` 필드 없음 | F-01-02·F-01-21의 스키마 결정 | 앱에서 파일/북마크 블록의 Color 메뉴 확인, API로 재조회 |
| 20 | Enter의 블록 분할 / Backspace의 블록 병합 세부 규칙(자식 귀속, 타입 승계, 리스트 탈출) | F-01-19 — 공식 문서에 전혀 없음. 이 도메인에서 버그 밀도가 가장 높은 지점 | 앱 실측(자식 있는 블록 중간에서 Enter, 이종 타입 병합) |
| 21 | `is_toggleable` 헤딩의 자식과 enhanced markdown의 *"Headings cannot contain child blocks"* 진술의 모순 | F-01-13 내보내기 정합성 | 토글 헤딩이 있는 페이지를 markdown 조회 엔드포인트로 받아 관찰 |
| 22 | 인라인 수식이 `plain_text`/검색 인덱스에 어떻게 반영되는가 | F-01-20 검색 설계 | 수식 포함 블록을 API로 조회, 앱에서 수식 내용 검색 |
| 23 | 페이지 1개당 블록 수의 실질 한계(공식 상한 없음. 1,000 블록은 무료 플랜 과금 한도이지 렌더 한계가 아님) | F-01-22의 MVP 상한 결정 | 대용량 페이지 생성 후 로드 시간 실측 |
| 24 | ~~노션이 페이지 콘텐츠를 부분 로드하는가~~ → **확인됨**(공식 블로그의 `loadPageChunk`). 남은 미확인: **청크의 단위**(고정 블록 수 / 뷰포트 / subtree)와 **다음 청크 요청의 커서 형태** | F-01-22의 API 계약 파라미터 확정 | 네트워크 탭 관찰(단위·커서는 공개 자료로 확인 불가) |
| 25 | 심플 테이블의 최대 행/열 수 | F-01-18 검증 규칙 | 앱 실측(공식 문서에 상한 명시 없음) |

---

## 출처

**1차 출처 (공식)**

1. Notion 공식 엔지니어링 블로그 — 블록 데이터 모델: https://www.notion.com/blog/data-model-behind-notion
2. Notion 공개 API — Block 오브젝트 레퍼런스: https://developers.notion.com/reference/block
3. Notion 공개 API — Rich text 오브젝트: https://developers.notion.com/reference/rich-text
4. Notion 공개 API — Request limits(크기/속도 제한): https://developers.notion.com/reference/request-limits
5. Notion 헬프센터 — 키보드 단축키 / 마크다운 단축 입력: https://www.notion.com/help/keyboard-shortcuts
6. Notion 헬프센터 — 쓰기 & 편집 기본(블록 핸들, 다중 선택, 드래그 앤 드롭): https://www.notion.com/help/writing-and-editing-basics
7. Notion 헬프센터 — Synced blocks: https://www.notion.com/help/synced-blocks
8. Notion 헬프센터 — 컬럼, 헤딩, 구분선: https://www.notion.com/help/columns-headings-and-dividers
9. Notion 헬프센터 — 코드 블록: https://www.notion.com/help/code-blocks
10. Notion 헬프 가이드 — 슬래시 커맨드 사용: https://www.notion.com/help/guides/using-slash-commands
11. Notion 릴리스 노트 2022-01-19(텍스트 편집 & 복사/붙여넣기 개선, Firefox 예외 명시): https://www.notion.com/releases/2022-01-19

**1차 출처 — GAP 2회차에서 추가 확인**

12. Notion 헬프 가이드 — 심플 테이블 vs 데이터베이스(생성·행열 조작·헤더·병합·폭·DB 변환·한계): https://www.notion.com/help/guides/simple-tables-vs-databases
13. Notion 릴리스 노트 2026-05-26 — 심플 테이블 셀 병합: https://www.notion.com/releases/2026-05-26
14. Notion 릴리스 노트 2021-11-16 — 심플 테이블 도입(2.14): https://www.notion.com/releases/2021-11-16
15. Notion 헬프센터 — 수식(KaTeX, mhchem, `$$` 트리거, `Cmd/Ctrl+Shift+E`, `/math`·`/latex`, 인라인↔블록 turn into): https://www.notion.com/help/math-equations
16. Notion 릴리스 노트 2020-06-09 — 인라인 수식 도입: https://www.notion.com/releases/2020-06-09
17. Notion 헬프센터 — 페이지 스타일 & 커스터마이즈(블록 색상 메뉴 경로, `/color`, `Cmd/Ctrl+Shift+H`, 색상 19종, callout 색 파생 규칙, 폰트/전체 폭/작은 텍스트): https://www.notion.com/help/customize-and-style-your-content
18. Notion API 체인지로그 — 블록 색상 API 지원(색상을 갖는 블록 타입 열거, 2022-03-03): https://developers.notion.com/changelog/block-colors-are-now-supported-in-the-api
19. Notion API 가이드 — Enhanced markdown(Notion-flavored Markdown, 전 블록 타입 직렬화 문법과 한계): https://developers.notion.com/guides/data-apis/enhanced-markdown
20. Notion 헬프 가이드 — 콘텐츠 블록 변환(Turn into, `turn into page`의 다중 변환·위치 선택): https://www.notion.com/help/guides/transforming-content-blocks-in-notion
21. Notion 헬프센터 — 블록 사용량(무엇이 블록으로 계산되는가, 플랜별 1,000 블록 한도, 삭제해도 감소 안 함): https://www.notion.com/help/understanding-block-usage
22. Notion 엔지니어링 블로그 — 페이지 로드/탐색 50% 단축(IndexedDB → SQLite, 코드 스플리팅, 캐시 인프라): https://www.notion.com/blog/faster-page-load-navigation
23. Notion 엔지니어링 블로그 — 브라우저에서 WASM SQLite로 속도 개선(OPFS, SharedWorker 단일 쓰기 탭, Web Locks 페일오버, VFS 선택, 실측 20~33%): https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite
24. Notion 헬프센터 — 데이터베이스 성능 최적화(250,000행 한도, 페이지당 property 2.5MB): https://www.notion.com/help/optimize-database-load-times-and-performance
25. Notion 헬프 가이드 — 블록 기본(블록 개념, 슬래시 커맨드, `⋮⋮` 드래그·Turn into): https://www.notion.com/help/guides/block-basics-build-the-foundation-for-your-teams-pages

**오픈소스 / 기술 레퍼런스**

26. BlockSuite — Block Schema 가이드: https://blocksuite.io/guide/block-schema
27. BlockSuite GitHub: https://github.com/toeverything/blocksuite
28. AFFiNE GitHub: https://github.com/toeverything/affine
29. BlockNote 문서: https://www.blocknotejs.org/docs
30. Figma 엔지니어링 블로그 — 순서 있는 시퀀스의 실시간 편집(fractional indexing): https://www.figma.com/blog/realtime-editing-of-ordered-sequences/
31. Liveblocks — CRDT와 sync engine의 fractional indexing: https://liveblocks.io/blog/how-crdts-and-sync-engines-keep-realtime-lists-ordered-with-fractional-indexing
