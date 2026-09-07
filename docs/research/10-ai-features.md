# 10. Notion AI

## 요약

Notion AI는 별도 앱이 아니라 에디터·데이터베이스·검색 세 곳에 각각 다른 진입점으로 박혀 있는 기능군이다. (1) 에디터 안에서 선택 영역/현재 페이지를 컨텍스트로 텍스트를 생성·변환하고, (2) 데이터베이스 row 단위로 프로퍼티 값을 자동 생성(autofill)하며, (3) 워크스페이스 전체 + 외부 커넥터를 임베딩 인덱스로 검색해 인용이 붙은 답변을 만든다. 여기에 (4) **외부 AI 에이전트가 워크스페이스에 들어오는 진입점**(hosted MCP 서버 + Agent/Session 공개 API + Skills), (5) **에이전트 표면 자체**(사용자 권한을 그대로 쓰는 개인 Notion Agent + Instructions 페이지 메모리 + Claude/Cursor 같은 External Agent를 보드에서 팀메이트로 부리는 경로)가 더해져 다섯 표면을 이룬다. 이 전부를 떠받치는 공통 인프라는 **권한 인지(permission-aware) 벡터 인덱스**와 **스트리밍 생성 파이프라인**이며, 클론 구현에서 실제로 어려운 부분도 UI가 아니라 이 두 가지다. 과금은 seat 단가 + rolling/monthly 사용 할당량 + Notion credits(초과분·프리미엄 모델·에이전트용) 3층 구조다.

> **2026년 갱신 반영**: 본 문서는 2026-09-06 기준으로 Notion 3.2(2026-01) / 3.4(2026-03·04) / 3.6(2026-07) 릴리스 노트와 개발자 changelog를 재확인해 갱신했다. 이 기간에 AI 도메인에 실제로 추가된 것: 모델 선택 + Auto 라우팅, 관리자 AI 사용량 분석, Notion Agent 모바일 패리티/음성 입력, Agent Instructions(메모리) 페이지, Custom Agent 비용 35~50% 절감, External Agents(Claude·Cursor), 에이전트 생성 인터랙티브 HTML 블록, Agent APIs public beta(2026-08), MCP 세션 도구(2026-08). 아래 F-10-21~F-10-26이 이 갱신분이다.

> **중요 정정 (GAP 점검 결과)**: 이 문서는 초판에서 "Notion 내부 AI 스키마는 전부 비공개"라고 전제했으나 이는 **부분적으로 틀렸다**. Notion은 **Agent APIs(public beta)** 를 통해 session / session event / agent 객체의 **필드명과 상태 enum을 공식 문서로 공개**하고 있다. 아래 데이터 모델에서 해당 부분은 `[추정]`을 떼고 **공식 확인값**으로 교체했다. 출처: https://developers.notion.com/guides/notion-agent-apis/overview , https://developers.notion.com/reference/notion-agent-apis/update-session

---

## 핵심 개념 / 데이터 모델

이 도메인 전체를 관통하는 엔티티. 대부분은 공개 동작에서 역산한 **[추정]** 모델(클론 구현용 권고 스키마)이지만, **`ai_session.status`와 세션 이벤트 타입은 Notion Agent APIs가 실제로 공개한 값**이므로 그대로 채택했다(아래 `-- [공식 확인]` 주석 표시).

```
ai_session                      -- AI 대화/생성 1건의 컨테이너
  id                uuid PK
  workspace_id      uuid FK
  user_id           uuid FK            -- 권한 필터의 주체. 절대 생략 불가
  surface           enum(inline_editor, ai_block, db_property, chat_qa, research, agent_run)
  context_page_id   uuid FK NULL       -- 인라인/블록일 때의 앵커 페이지
  model_id          text
  mode              enum(fast, research)
  web_search        bool
  created_at, ended_at
  status            enum(queued, in_progress, requires_action,
                         completed, failed, canceled, terminated)
                    -- [공식 확인] Notion Agent APIs가 공개한 실제 세션 상태 enum.
                    --   requires_action = 휴먼 승인 대기(HITL). 초판의 (streaming,done,
                    --   cancelled,error) 추정 enum은 이 값으로 교체한다.
  required_actions  jsonb NULL         -- [공식 확인] requires_action일 때 채워짐:
                                       --   [{action_id, options:[{option_id,label}]}]

ai_message
  id, session_id FK, role enum(user, assistant, tool, system)
  content_richtext  jsonb              -- 블록 트리 그대로 저장(마크다운 아님)
  token_in, token_out int
  finish_reason     enum(stop, length, cancelled, filtered, tool_calls)
  seq               int

ai_session_event                -- 세션 타임라인 1건 (스트리밍/재생/감사 로그 공용)
  id, session_id FK
  type              enum(user.message, agent.message, agent.thinking,
                         agent.tool_use, agent.tool_result, session.status)
                    -- [공식 확인] Notion Agent APIs의 실제 이벤트 타입 목록
  sequence          int                -- 단조 증가. SSE 재접속 시 continue_from 앵커
  payload           jsonb
  created_at
  -- 필터 가능 축(공식): id / type / sequence / created_at (and·or 중첩 조합)

ai_citation                     -- 답변 문장 ↔ 근거 span 매핑
  id, message_id FK
  source_kind       enum(notion_block, connector_doc, web)
  source_ref        text               -- block_id | connector_doc_id | url
  span_start, span_end int             -- assistant 텍스트 내 인용 범위
  title, url, snippet

ai_block                        -- 페이지에 영구 존재하는 AI 결과 블록
  block_id          uuid PK  (blocks 테이블의 서브타입)
  ai_kind           enum(summary, action_items, custom)
  prompt            text NULL          -- custom일 때만
  generated_content jsonb              -- 자식 블록 트리
  source_page_id    uuid
  last_generated_at timestamptz
  stale             bool               -- 소스 페이지가 이후 수정되었는가

ai_property_config              -- DB 컬럼 정의에 붙는 AI 설정
  property_id       uuid PK FK -> db_property
  ai_kind           enum(summary, key_info, translation, custom)
  prompt            text
  target_lang       text NULL
  scope             enum(page_only, workspace_search, web)   -- basic vs custom-agent autofill
  trigger           enum(manual, on_create, on_edit, scheduled)
  output_type       enum(text, select, multi_select, number, date, checkbox, relation)

ai_property_value               -- row별 생성 결과 (일반 프로퍼티 값과 분리 저장 권장)
  page_id + property_id PK
  value             jsonb
  generated_at, source_hash text       -- 입력 변화 감지용
  state             enum(empty, queued, generating, filled, error, stale)

-- 검색 인프라
embedding_span                  -- 청크 1개
  id, workspace_id, source_kind, source_id (block_id|connector_doc_id)
  page_id, parent_path
  text, text_hash bigint               -- xxHash64
  meta_hash bigint                     -- 권한/작성자 등 메타 해시
  vector    vector(N)
  acl_principals text[]                -- 이 청크를 볼 수 있는 principal id 목록
  updated_at

connector_account
  id, workspace_id, provider enum(slack, gdrive, sharepoint, github, linear, jira, gmail, outlook, gcal)
  installed_by_user_id, oauth_token_ref
  scope_config jsonb                   -- 예: slack이면 대상 채널 집합
  initial_sync_state enum(pending, running, done), last_synced_at

identity_mapping                -- Notion user ↔ 외부 앱 계정
  workspace_id, user_id, provider, external_user_id, verified_at

ai_usage_ledger
  id, workspace_id, user_id, session_id
  feature_key text, model_id text
  credit_multiplier numeric          -- [2026 추가] 모델별 배수는 시간에 따라 변한다
  raw_units jsonb                    -- {tokens_in, tokens_out, images, compute_ms, steps, recording_sec}
  credits numeric, counted_against enum(rolling_6h, monthly, rolling_24h, rolling_30d, credits)
  created_at

-- [2026 갱신분: F-10-21~26에서 도출]
model_registry                  -- 모델 능력·단가·상태를 데이터로 (코드 상수 금지)
  model_id PK, provider, display_name
  tier enum(standard, premium), context_window int
  supports_tools bool, supports_vision bool
  credit_multiplier numeric, status enum(active, retired), effective_from

workspace_allowed_model(workspace_id, model_id, enabled_by, enabled_at)

user_ai_instructions            -- 개인 에이전트 메모리 (한 번에 하나 = user_id PK로 강제)
  user_id PK, workspace_id, page_id FK, activated_at, updated_at

instructions_snapshot(user_id, page_version, rendered_text, token_count)  -- 매 요청 재렌더 방지

agent_action_policy             -- "무엇을 할 때 사람 승인을 받는가"
  action_kind enum(page_write, db_write, file_op, email_send, calendar_write, external_tool)
  requires_confirmation bool, scope

agent_audit_event               -- append-only. 에이전트 삭제해도 남긴다
  id, agent_id, session_id, actor_user_id NULL, trigger_kind
  resource_ref text, change_summary jsonb, created_at

external_artifact(session_id, kind enum(pull_request, file, page), url, created_at)

html_block_meta                 -- AI가 만든 실행 코드의 출처 추적
  block_id PK, source_session_id NULL, generated_by enum(user, agent)
  sandbox_policy jsonb, height_px, last_rendered_at

ai_usage_rollup(workspace_id, day, user_id NULL, feature_key NULL, model_id NULL,
                requests, credits, tokens_in, tokens_out)   -- 분석용. 원장과 분리
```

관계 요약:
- `ai_session 1..N ai_message 1..N ai_citation`
- `ai_session 1..N ai_session_event` — **메시지 테이블과 별도로 이벤트 테이블을 두는 것이 Notion의 실제 구조다.** 메시지만 저장하면 tool_use/thinking 단계가 사라져 재생·감사·부분복구가 불가능해진다. 클론도 이 분리를 따를 것을 권고한다.
- `page 1..N ai_block` (AI 블록은 일반 block 트리의 한 노드이자 별도 메타를 가짐)
- `db_property 1..1 ai_property_config`, `(page, property) 1..1 ai_property_value`
- `block/connector_doc 1..N embedding_span` (청크 분할)
- 모든 검색 경로는 `embedding_span.acl_principals ∩ 요청자 principal 집합 ≠ ∅` 필터를 **retrieval 단계에서** 적용한다. 생성 단계 필터링은 금지(누출 위험).
- `user 1..1 user_ai_instructions 1..1 page` — **PK를 `user_id`로 두어 "한 번에 하나"를 스키마로 강제**한다(공식 제약).
- `agent 1..N agent_audit_event`, `agent 1..N ai_session`(에이전트 실행도 세션이다), `ai_session 1..N external_artifact`.
- `ai_message N..1 model_registry` — **모델은 세션이 아니라 메시지에 붙는다**(세션 중간 모델 전환이 공식 지원 동작).
- `ai_usage_ledger ──(배치 집계)──> ai_usage_rollup` — 원장은 불변·정산용, 롤업은 탐색·분석용. **같은 테이블로 겸하지 않는다.**
- 행위 주체는 세 종류이며 권한 모델이 서로 다르다: **사용자 위임**(F-10-21, 사용자 권한 그대로) / **자율 에이전트**(F-10-13, 명시 부여 리소스만) / **외부 실행 에이전트**(F-10-23, 자율 + 외부 보존 정책). `actor_kind`와 `agent.runtime`으로 구분하고 **정책을 런타임별로 분기**한다.

---

## 기능 명세

### F-10-01 인라인 AI 작성 (Ask AI / 빈 줄 프롬프트)

- **한 줄 정의**: 페이지 안에서 프롬프트를 입력해 현재 위치에 새 콘텐츠를 생성한다.
- **사용자 시나리오**:
  1. 빈 줄에서 스페이스바를 누르거나 `/ai`(또는 `/ask`) 입력 → 프롬프트 입력창이 해당 줄에 인라인으로 열림.
  2. "Q3 마케팅 회고 초안 써줘" 입력 + `@`로 다른 페이지/사람/날짜 멘션해 컨텍스트 추가 → Enter.
  3. 결과가 페이지 위에 **직접 스트리밍**되며 그려짐. 하단에 액션 바(Accept/Replace, Discard, Try again, 이어서 지시) 노출.
  4. Accept → 생성 블록이 일반 블록으로 확정. Discard → 생성 블록 전부 제거하고 원상 복구.
- **동작 상세**:
  - 상태 전이: `idle → prompting → streaming → review → (accepted | discarded)`; `streaming` 중 Esc 또는 Stop으로 `cancelled`.
  - 생성 결과는 마크다운 텍스트가 아니라 **블록 트리**로 파싱되어 삽입된다(heading/list/table/code 유지).
  - `review` 상태의 블록은 "가생성(ghost)" 상태이며 아직 확정 블록이 아니다. [추정] 실제로는 문서에 임시 삽입 후 discard 시 트랜잭션 롤백하는 형태.
  - 후속 지시("더 짧게")는 같은 세션에 이어져 이전 출력이 컨텍스트로 유지된다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 프롬프트 제출 | 요청 전송 안 함, 입력창 유지 |
  | 스트리밍 중 다른 사용자가 같은 위치 편집 | ghost 블록은 별도 영역이므로 충돌 없음. Accept 시점에 CRDT/OT로 머지 [추정] |
  | 스트리밍 중 페이지 이탈/새로고침 | 세션 취소, ghost 블록 미확정 → 사라짐. [확인필요] 재접속 시 복구 여부 |
  | 사용 할당량 초과 | 요청 거부 + "리셋까지 대기 또는 credits 사용" 안내 |
  | 읽기 권한만 있는 페이지 | 인라인 생성 진입점 자체 비노출 |
  | 매우 긴 페이지 | 컨텍스트 윈도우 초과 → 앞부분 절삭 또는 요약 후 투입 [추정] |
  | 멘션한 페이지에 접근 권한 없음 | 해당 컨텍스트 제외 (권한 없는 내용은 절대 프롬프트에 포함 금지) |

- **데이터 모델 함의**:
  - `ai_session(id, workspace_id, user_id, surface='inline_editor', context_page_id, anchor_block_id, model_id, status, created_at, ended_at)` — `anchor_block_id`는 결과가 삽입될 위치이며, **동시 편집으로 앵커가 사라질 수 있으므로 FK가 아니라 soft reference**로 두고 Accept 시점에 존재 검증한다.
  - `ai_message(id, session_id, role, content_richtext jsonb, model_id, token_in, token_out, finish_reason, seq)` — `model_id`는 세션이 아니라 **메시지 단위**(F-10-26 참조).
  - ghost 블록: 두 가지 선택지. ① 서버 저장형 — `blocks.draft_of_session_id uuid NULL` + 부분 인덱스, 일반 조회 쿼리에서 `draft_of_session_id IS NULL` 필터 필수(**이 필터를 한 군데라도 빠뜨리면 미확정 콘텐츠가 다른 사용자에게 보인다** — 서버 저장형의 실질 위험은 롤백이 아니라 이 누락이다). ② 클라이언트 로컬형 — DB에 아무것도 쓰지 않고 Accept 때 한 번에 INSERT. **클론은 ②를 권고**.
  - 컨텍스트 추적: `ai_session_context(session_id, kind enum(page, block_range, mention_page, mention_user, date), ref_id, included bool, excluded_reason enum(no_permission, too_large, empty) NULL)` — **권한 때문에 제외한 멘션을 기록해 두어야** "왜 그 페이지를 안 봤나"에 답할 수 있고, 누출 감사도 가능하다.
  - Accept 시 트랜잭션: 블록 INSERT + `ai_session.status='completed'` + `ai_usage_ledger` 기록을 **한 트랜잭션**으로. 과금만 따로 커밋하면 실패 시 유령 청구가 남는다.
- **UI/인터랙션**: 빈 줄 Space, `/ai`·`/ask` 슬래시 커맨드, `@` 멘션 컨텍스트 추가, 스트리밍 중 Stop 버튼, 결과 하단 Accept/Discard/Try again, Esc = discard.
- **의존 기능**: 블록 에디터, 슬래시 커맨드 메뉴, 멘션 시스템, 스트리밍 API, 권한 시스템.
- **구현 난이도**: **L** — LLM 호출 자체는 쉽지만 스트리밍 텍스트를 블록 트리로 증분 파싱해 에디터에 실시간 반영하고, 취소/롤백까지 일관성 있게 처리하는 게 어렵다.
- **우선순위**: **P0** — AI 도메인의 최소 진입점.
- **클론 시 현실적 대안**: 스트리밍 파싱 대신 **문단 단위 버퍼링**(줄바꿈 2회마다 블록 커밋)으로 시작. ghost 블록은 DB에 쓰지 말고 클라이언트 로컬 상태로만 두고 Accept 때 한 번에 삽입 → 롤백 로직이 사라진다.
- **참고 출처**: https://www.notion.com/help/guides/notion-ai-for-docs , https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai

---

### F-10-02 선택 영역 AI 편집 액션 프리셋 (요약·톤 변경·길이·문법·액션아이템)

- **한 줄 정의**: 선택한 텍스트에 미리 정의된 변환 프롬프트를 적용해 그 자리에서 치환한다.
- **사용자 시나리오**:
  1. 텍스트 드래그 선택 → 플로팅 툴바에 "Ask AI" / "Edit with AI" 노출.
  2. 클릭 시 액션 메뉴: Improve writing, Fix spelling & grammar, Make shorter, Make longer, Change tone ▸ (Professional / Casual / Friendly / Straightforward), Summarize, Translate ▸ (언어 목록), Find action items, Explain this, Continue writing, 그리고 자유 프롬프트 입력.
  3. 선택 → 결과가 원문 아래 미리보기로 스트리밍.
  4. `Replace selection` / `Insert below` / `Discard` / `Try again` 선택.
- **동작 상세**:
  - 각 액션 = 서버측 고정 시스템 프롬프트 템플릿 + 선택 텍스트. 클라이언트가 자유 프롬프트 문자열을 만들지 않는다(프롬프트 인젝션·품질 일관성 때문). [추정]
  - "Find action items"의 출력 타입은 **to-do 체크박스 블록 리스트**로 고정된다.
  - 기본 동작은 `Replace`가 아니라 `review` 후 명시적 선택. 자동 치환 없음.
  - Change tone은 하위 메뉴로 톤 값을 받아 같은 템플릿의 파라미터로 전달.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 선택 영역이 여러 블록에 걸침 | 블록 경계를 유지한 채 전체를 하나의 입력으로 처리, 출력도 다중 블록 |
  | 선택 영역에 이미지/DB 뷰 포함 | 텍스트 아닌 노드는 제외하거나 placeholder 처리 [확인필요] |
  | 선택 영역이 1~2 단어 | 요청은 되지만 결과 품질 낮음 — 최소 길이 가드 권장 |
  | Replace 후 Undo | 단일 Undo로 원문 복구되어야 함 (생성 전체가 1 트랜잭션) |
  | 동시 편집 중 원문이 바뀜 | Replace 대상 range가 무효 → 치환 거부하고 "Insert below"로 폴백 권장 |
  | 코드 블록 선택 | 언어 힌트를 프롬프트에 포함, 출력도 코드 블록 유지 |

- **데이터 모델 함의**: `ai_prompt_template(key, version, system_prompt, output_format, params_schema)` 테이블을 두고 액션 키를 참조. `ai_session.surface=inline_editor`, `selection_range{block_ids[], start, end}`를 세션 메타로 저장.
- **UI/인터랙션**: 텍스트 선택 시 플로팅 툴바, 계층형 메뉴(톤/언어는 서브메뉴), 결과 diff 미리보기, Replace/Insert below/Discard/Try again.
- **의존 기능**: F-10-01(생성 라이프사이클), 리치텍스트 selection 모델, Undo 스택.
- **구현 난이도**: **M** — F-10-01이 있으면 프롬프트 템플릿 테이블 + 메뉴 추가 수준. selection range 무효화 처리만 주의. 2~4일.
- **우선순위**: **P0** — 사용자가 "AI 있다"고 체감하는 가장 흔한 경로.
- **클론 시 현실적 대안**: 액션 8~10개만 하드코딩(Docmost가 쓰는 목록이 사실상 업계 표준). diff 미리보기 대신 결과 전문 미리보기로 시작.
- **참고 출처**: https://www.notion.com/help/guides/notion-ai-for-docs , https://docmost.com/docs/user-guide/ai

---

### F-10-03 페이지 전체 번역

- **한 줄 정의**: 현재 페이지 전체를 지정 언어로 번역하되 블록 구조와 서식을 보존한다.
- **사용자 시나리오**: 페이지 우상단 `•••` → Translate → 언어 선택. 또는 우하단 Notion AI 아이콘 → translate. 또는 AI 패널에서 "이 페이지 번역해줘".
- **동작 상세**:
  - 블록 트리를 순회하며 텍스트 노드만 번역하고 블록 타입·중첩·서식(bold/link/inline code)은 그대로 유지한다(공식 문서상 "포맷을 유지한 채 변환").
  - 큰 페이지는 블록 묶음 단위로 분할 호출 후 재조립. [추정]
  - 결과 반영 방식(원본 치환 vs 새 결과 제시)은 **[확인필요]**. 공식 문서는 "부분 또는 전체를 번역할 수 있다"까지만 명시한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 코드 블록 / 수식 | 번역 제외 (주석만 번역하는 것은 과설계) |
  | 인라인 링크·멘션 | 링크 URL과 멘션 대상 ID 보존, 표시 텍스트만 번역 |
  | DB 뷰가 임베드된 페이지 | 뷰 자체는 번역 불가, row 콘텐츠는 F-10-05로 분리 |
  | 이미 대상 언어인 페이지 | 사실상 no-op이지만 비용은 발생 → 사전 언어 감지로 스킵 권장 |
  | 매우 긴 페이지 | 부분 실패 시 어느 블록까지 성공했는지 표시하고 재시도 지점 제공 |
  | 번역 중 다른 사용자가 편집 | 블록 버전이 바뀐 부분은 적용 스킵 |
  | 빈 페이지 | 요청 전송 안 함 |

- **데이터 모델 함의**: 블록별 `source_block_id → translated_text` 임시 매핑. 원본 보존 모드라면 `page_translation(page_id, lang, target_page_id, created_at)` + `page.translation_of` 역참조. 블록 버전 비교용 `block.version`.
- **UI/인터랙션**: 페이지 `•••` 메뉴, 언어 피커(최근 사용 언어 상단), 진행률 표시(블록 n/m), 취소 버튼.
- **의존 기능**: 블록 트리 순회/재조립, F-10-02의 번역 프롬프트 템플릿.
- **구현 난이도**: **M** — 블록 단위 청킹과 서식 보존 재조립이 작업량의 핵심. 2~4일.
- **우선순위**: **P1** — MVP는 아니지만 다국어 팀에서 체감 가치가 크고 구현 비용이 낮다.
- **클론 시 현실적 대안**: "원본 치환" 대신 **번역본을 새 하위 페이지로 생성**. 롤백·동시편집 충돌 문제가 통째로 사라진다.
- **참고 출처**: https://www.notion.com/product/ai/use-cases/translate-your-content , https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai

---

### F-10-04 AI 블록 (Summary / Action items / Custom AI block)

- **한 줄 정의**: 페이지에 영구적으로 존재하면서 그 페이지 내용을 입력으로 결과를 생성·갱신하는 블록.
- **사용자 시나리오**:
  1. `/` → "Summary" / "Action items" / "Custom AI block" 선택.
  2. Custom인 경우 프롬프트 입력("이 페이지를 3개 불릿으로 요약", "이 회의록에서 액션아이템 전부 뽑아줘").
  3. Generate → 블록 내부에 결과 스트리밍.
  4. 이후 페이지 내용이 바뀌면 블록의 Regenerate로 재생성.
  - 대표 사용법: **데이터베이스 템플릿 상단에 배치**해 새 row(예: 회의록)마다 요약·액션아이템이 자동으로 생기게 한다.
- **동작 상세**:
  - 입력 컨텍스트 = **해당 블록이 놓인 페이지의 나머지 콘텐츠**. 워크스페이스 전체가 아니다(공식 한계: AI 블록은 Notion 내부 콘텐츠만 접근, 외부 앱 실시간 데이터 불가).
  - 3종: `summary`, `action_items`(체크박스 리스트 출력), `custom`(임의 프롬프트).
  - 자동 재생성이 아니라 **명시적 트리거** 기반 → 소스가 바뀌면 결과가 stale해질 수 있다. [추정] stale 배지 유무는 **[확인필요]**.
  - 결과가 자유 편집 가능한 일반 블록인지 읽기 전용인지 **[확인필요]**. 클론에서는 "편집 가능 + 재생성 시 덮어쓰기 경고" 권장.
  - Notion 공개 API에서 `ai_block` 타입은 **`unsupported`로 반환**되며 생성·수정 불가(실측 이슈 존재).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 페이지가 거의 비어 있음 | 생성 거부 + "요약할 내용이 부족합니다" |
  | AI 블록이 자기 자신을 컨텍스트에 포함 | 반드시 제외 (자기 참조 루프) |
  | 한 페이지에 AI 블록 여러 개 | 서로의 출력을 컨텍스트에서 제외 |
  | 소스 페이지 수정 후 | stale 플래그 + "Update" CTA |
  | 사용자가 결과를 수정한 뒤 재생성 | 수동 편집 유실 경고 필수 |
  | 페이지 열람 가능하지만 AI 미허용 유저 | 블록은 보이되 재생성 버튼 비활성 |
  | 템플릿에서 복제된 row 수백 개 | 일괄 생성 시 큐잉 + 동시성 제한 |
  | AI 블록 포함 페이지를 API로 읽음 | `unsupported` 반환 — 외부 연동 설계 시 고려 |

- **데이터 모델 함의**: 위 `ai_block` 스키마 + `source_content_hash`(stale 판정용). 결과 자식 블록은 `parent_id = ai_block.block_id`. 템플릿 연동을 위해 `template_block`에서 ai_block도 복제 대상에 포함.
- **UI/인터랙션**: 슬래시 커맨드 3종, 블록 호버 시 Regenerate / Edit prompt / Delete, 생성 중 스켈레톤, 프롬프트 인라인 편집.
- **의존 기능**: 블록 시스템, 페이지 템플릿, F-10-01 스트리밍.
- **구현 난이도**: **M** — 블록 타입 추가 + 컨텍스트 수집 + 재생성. 자기 참조 배제와 stale 감지가 함정. 3~5일.
- **우선순위**: **P1** — DB 템플릿과 결합될 때 가치가 크지만 MVP엔 불필요.
- **클론 시 현실적 대안**: `custom` 하나만 만들고 summary/action_items는 프리셋 프롬프트로 제공(코드 1/3). stale 감지는 `page.updated_at > ai_block.last_generated_at` 비교로 단순화.
- **참고 출처**: https://www.notion.com/help/ai-meeting-notes , https://developers.notion.com/reference/block , https://github.com/run-llama/LlamaIndexTS/issues/253

---

### F-10-05 AI 데이터베이스 프로퍼티 (Autofill)

- **한 줄 정의**: 데이터베이스 컬럼을 AI가 채우게 하여, 각 row의 페이지 내용·프로퍼티를 입력으로 값을 생성한다.
- **사용자 시나리오**:
  1. DB에서 `+` → 프로퍼티 타입에서 AI 계열 선택: **AI Summary / AI Key Info / AI Translation / AI Custom Autofill**.
  2. Custom이면 프롬프트 작성("이 문서의 마감일을 YYYY-MM-DD로만 출력").
  3. 실행 시점 설정: **수동 / 페이지 생성 시 / 페이지 편집 시 / 스케줄(Custom Agent autofill 한정)**.
  4. 저장 → row들이 순차 처리됨. 컬럼 헤더 메뉴 → "Autofill all pages"로 전체 일괄 실행.
- **동작 상세**:
  - **Basic Autofill**: 해당 row/페이지 콘텐츠만 컨텍스트, 웹 검색 없음, 워크스페이스 검색 없음. Business/Enterprise에 포함되며 **credits 미소모**. 공식 표현상 "요약, 태깅, 번역 같은 단순 채움에 적합".
  - **Custom Agent Autofill**: **워크스페이스 검색으로 관련 컨텍스트 수집**, 웹 검색 가능, **조건부 로직**("Status가 In Progress일 때만 채움"), **여러 프로퍼티 동시 갱신** 가능. **credits 소모**.
  - 프리셋 4종 의미: Summary(요약) / Key Info(이름·날짜 등 특정 정보 추출) / Translation(번역) / Custom(임의 지시).
  - 명시적 제약: autofill은 **DB에 페이지를 생성할 수 없고**, database automation·form·chart·DB 페이지 템플릿도 만들 수 없다.
  - 대량 실행은 즉시 완료되지 않고 백그라운드에서 순차 처리.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | row 페이지가 비어 있음 | 값을 비워두거나 "N/A" — **환각 금지 가드가 필수** |
  | `on_edit` 트리거 + 잦은 편집 | 디바운스(마지막 편집 후 N분) 없으면 비용 폭발 |
  | AI 값 갱신이 다시 `on_edit`을 유발 | **자기 유발 루프 차단**(AI 프로퍼티 변경은 트리거 소스에서 제외) |
  | row 1만 개 일괄 실행 | 큐 + 동시성 제한 + 진행률/중단 UI |
  | 출력 타입이 select인데 없는 옵션 생성 | 기존 옵션 집합을 프롬프트에 주입, 미매칭 시 빈 값 |
  | 사용자가 값을 수동 수정 | 다음 autofill이 덮어쓸지 정책 필요 **[확인필요]** — 2026-09 `notion.com/help/autofill` 본문을 재확인했으나 **덮어쓰기 정책에 대한 언급이 전혀 없다**(문서가 설정 절차와 Basic/Custom 비교에만 집중). 공식 미공개로 확정. 클론 권고: `ai_property_value.manually_edited=true`면 기본 스킵 + 컬럼 옵션으로 "수동 편집도 덮어쓰기" 제공 |
  | 참조 페이지에 권한 없음 | 컨텍스트에서 제외 |
  | 생성 실패 | `state=error` + 셀에 재시도 아이콘 |
  | 뷰 필터가 걸린 상태에서 "all pages" | 필터된 것만인지 전체인지 명확히 표기 |

- **데이터 모델 함의**: `ai_property_config` / `ai_property_value`(위). **AI 값은 일반 프로퍼티 값과 분리 저장**하거나 최소한 `generated_by_ai`, `source_hash`, `state` 컬럼을 붙여야 수동 편집 구분·재생성 판단이 가능하다. 트리거는 `db_trigger(property_id, event, condition_expr, debounce_sec)`. 잡은 `autofill_job(page_id, property_id, state, attempts)`.
- **UI/인터랙션**: 프로퍼티 타입 피커, 프롬프트 편집 사이드패널, 실행 시점 라디오, 컬럼 헤더 메뉴 "Autofill all pages", 셀 내 생성 중 스피너, 셀 호버 시 Regenerate.
- **의존 기능**: 데이터베이스/프로퍼티 시스템, 백그라운드 잡 큐, (Custom 모드) F-10-06 워크스페이스 검색.
- **구현 난이도**: **L** — LLM 호출보다 **잡 큐, 디바운스, 루프 차단, 대량 실행 제어**가 작업량의 대부분. 1~2주.
- **우선순위**: **P1** — 데이터베이스 도메인이 선행되어야 성립. 다만 "노션다움"을 만드는 차별 기능.
- **클론 시 현실적 대안**: v1은 **수동 트리거 + row 단위 실행**만. `on_create`/`on_edit` 자동 트리거와 워크스페이스 검색 스코프는 v2. 출력 타입은 text로만 제한(select/date 매핑 문제 회피).
- **참고 출처**: https://www.notion.com/help/autofill

---

### F-10-06 AI Q&A (워크스페이스 검색 기반 답변)

- **한 줄 정의**: 자연어 질문에 대해 사용자가 접근 권한을 가진 워크스페이스 콘텐츠에서 근거를 찾아 인용이 붙은 답변을 생성한다.
- **사용자 시나리오**:
  1. 사이드바 Search, 우하단 AI 아이콘, 또는 단축키(검색계 `Cmd/Ctrl+Shift+K`, 채팅 `Shift+Cmd/Ctrl+J`)로 진입.
  2. "우리 팀 온보딩 체크리스트 어디 있어?" 입력.
  3. "All sources" 드롭다운 또는 `@` 멘션으로 소스 범위를 특정 페이지/DB/커넥터로 좁힘.
  4. 답변 스트리밍 + 원본 링크 인용 표시. 클릭 시 해당 페이지 이동.
- **동작 상세**:
  - retrieval → generation 파이프라인. **권한 필터는 retrieval 단계에서 적용**되며, 권한 없는 문서는 애초에 LLM 프롬프트에 들어가지 않는다(공식: "LLM은 해당 사용자가 이미 접근 권한을 갖지 않은 정보를 보거나 사용할 수 없다").
  - 참조 대상은 사용자가 생성자이거나, 초대되었거나, 워크스페이스 전체 공유된 페이지.
  - **페이지 콘텐츠에 강하고 데이터베이스 콘텐츠에는 상대적으로 약하다**(공개된 한계).
  - 커넥터가 활성화되어 있으면 외부 소스도 후보, 관리자가 허용하면 웹 결과도 포함.
  - **[공식 확인] Notion은 검색 경로를 둘로 나눠 운영한다.** hosted MCP 서버가 노출하는 도구가 그 증거다: `notion-ai-search`(Notion + 연결된 앱 전반의 **시맨틱** 검색)와 `notion-search`(**키워드**·필터·사용자 조회용, 문서상 "AI 검색을 쓸 수 없을 때만" 사용). 즉 벡터 검색이 키워드 검색을 대체한 것이 아니라 **두 경로가 병존**하며, 레이트리밋도 다르다(일반 180 req/min/user vs 키워드 `notion-search` 30 req/min). 클론도 "벡터로 전부 대체" 대신 이 이원화를 따르는 편이 안전하다 — 고유명사·ID·정확일치 질의는 벡터가 구조적으로 약하다.
  - 근거를 못 찾았을 때의 실제 폴백 동작은 **[확인필요]** — 공식 블로그에 명시 없음. 클론에서는 "근거 없음"을 명시하고 일반 지식으로 채우지 않는 것을 기본값으로 할 것.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 신규 워크스페이스(인덱스 미완) | "색인 중" 상태 표시 |
  | 방금 만든/수정한 페이지 질문 | 인덱싱 지연으로 미반영 가능(커넥터 기준 최대 3시간) |
  | 권한이 방금 회수된 문서 | **ACL 갱신 지연 = 누출 창**. 쿼리 시점 권한 재검증 필수 |
  | 근거 페이지가 삭제됨 | 인용 링크 깨짐 → 렌더 시 존재 확인 |
  | 게스트 사용자 | 커넥터 소스 접근 제외 |
  | 중복 문서 다수 | dedupe + 최신 우선 랭킹 |
  | 질문이 검색이 아니라 잡담 | 검색 스킵하고 일반 응답 |
  | 초장문 답변 | 인용 앵커가 텍스트 offset과 어긋나지 않도록 스트리밍 중 offset 재계산 |

- **데이터 모델 함의**: `embedding_span`(+`acl_principals`), `ai_session(surface=chat_qa)`, `ai_citation`. 품질 개선용 `ai_retrieval_log(session_id, span_id, score, rank, used bool)`은 초기부터 넣어야 나중에 랭킹을 고칠 수 있다.
- **UI/인터랙션**: 사이드바 검색 통합, 단축키, 소스 범위 드롭다운, `@` 소스 지정, 인용 칩(hover 시 스니펫 미리보기), 후속 질문.
- **의존 기능**: **F-10-08 임베딩 인덱스(하드 의존)**, 권한 시스템, F-10-09 스트리밍.
- **구현 난이도**: **XL** — 인덱싱·ACL 필터·랭킹 품질·인용 정합성이 묶인 서브시스템이지 단일 기능이 아니다.
- **우선순위**: **P1** — 노션 AI의 핵심 경쟁력이지만 MVP에 넣으면 프로젝트가 여기서 정체된다.
- **클론 시 현실적 대안**: v1은 **Postgres FTS(tsvector) 상위 N개 → LLM 요약 + 인용**. 벡터는 pgvector로 나중에 하이브리드 추가. ACL을 인덱스에 복제하지 말고 **쿼리를 권한 테이블 JOIN으로 제한**하면(단일 DB이므로 가능) ACL 동기화 문제가 원천적으로 사라진다.
- **참고 출처**: https://www.notion.com/blog/introducing-q-and-a , https://www.notion.com/help/notion-ai-security-practices

---

### F-10-07 AI 커넥터 (Slack / Google Drive 등 외부 소스 검색)

- **한 줄 정의**: 외부 SaaS 콘텐츠를 색인해 Notion AI가 원 앱의 권한을 존중한 채 함께 검색·요약하게 한다.
- **사용자 시나리오**:
  1. 워크스페이스 소유자가 Settings → Notion AI → 커넥터에서 OAuth 연결(대상 앱의 관리자 권한 필요).
  2. Slack이면 **공개 채널 전체 또는 특정 공개 채널 집합**을 선택.
  3. 초기 인덱싱 — 데이터 양에 따라 **최대 72시간**.
  4. 이후 Q&A/Research가 외부 문서를 근거로 사용하고 출처 링크를 표시.
- **동작 상세**:
  - 커넥터 카테고리: Chat(Slack, MS Teams) / Knowledge(Google Drive, SharePoint·OneDrive, GitHub, Linear) / Projects(Jira) / Mail·Calendar(Gmail, Outlook, Notion Mail, Google Calendar, Notion Calendar).
  - **[2026 갱신] 커넥터가 두 갈래로 분화했다.** (a) *검색 인덱스형 커넥터* — 위 목록. Q&A/Research의 근거가 되도록 임베딩 인덱스에 들어간다. (b) *에이전트 도구형 MCP 커넥션* — 2026-04에 Salesforce·Box, 2026-07에 **Mercury, Mixpanel, Miro, Box, ClickHouse**가 추가됐고, 이쪽은 "색인해 두는 것"이 아니라 **에이전트가 실행 시점에 호출하는 도구**에 가깝다. 클론 설계에서 이 둘을 한 테이블로 뭉개면 안 된다: 전자는 `connector_account + embedding_span`(사전 동기화·ACL 복제), 후자는 `agent_tool + oauth_grant`(쿼리 시점 위임 호출)로 **저장 전략과 권한 모델이 정반대**다. 출처: https://www.notion.com/releases/2026-07-01 , https://www.notion.com/releases/2026-04-14
  - **[정정 / 2026-04]** "Slack은 공개 채널만"이 더 이상 무조건 참이 아니다. 2026-04 릴리스에 **Custom Agents의 private Slack 채널 지원**이 명시됐다. 다만 이는 *에이전트 경로*의 변화이며, **AI 커넥터(검색 인덱스) 경로가 비공개 채널을 색인하는지는 [확인필요]** — 커넥터 헬프 문서는 여전히 공개 채널 기준으로 서술한다. 두 경로의 권한 경계가 다르므로 하나의 근거로 다른 쪽을 추론하지 말 것.
  - 3rd-party 커넥터는 **Business/Enterprise 전용**. Notion Mail·Calendar는 전 플랜.
  - **신규 콘텐츠 색인 지연: 최대 3시간**(대용량은 더). Slack 신규 메시지도 동일.
  - 과거 데이터는 일반적으로 **설정 시점 기준 1년 전까지**(커넥터별 상이).
  - 권한 매핑: 각 앱 권한을 Notion 사용자에 매핑, Notion·외부 양쪽 권한으로 **쿼리 시점 필터링**. 사용자 매핑은 지속적으로 재검증. **권한 변경은 1시간 내 반영**(대규모는 더 소요). 원본 삭제 시 **약 30분~1시간 내 검색 불가**.
  - 커넥터 해제 시 데이터 **24시간 내 삭제**. 원본/워크스페이스 삭제 시 임베딩 **60일 내 삭제**.
  - 커넥터 콘텐츠는 **OpenAI zero-retention embeddings API**로 임베딩되어 **Turbopuffer**(SOC 2 Type 2)에 저장, 워크스페이스 단위로 격리.
  - **게스트는 커넥터 접근에서 명시적으로 제외**. 설치한 소유자가 퇴사해도 커넥터는 수동 해제 전까지 유지.
  - 명시적 한계: 커넥터는 **검색·요약용**이며 복잡한 계산이나 데이터 분석용이 아니다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Slack 비공개 채널 / DM | 커넥터 색인 경로에서는 대상 아님(공개 채널 기준). 단 **에이전트 도구 경로는 2026-04부터 private 채널 지원** — 같은 워크스페이스에서 "검색엔 안 뜨는데 에이전트는 읽는" 비대칭이 생기므로 사용자 고지 필요 |
  | 외부 계정 ↔ Notion 계정 매핑 실패 | 해당 소스 결과 미노출(안전 기본값) |
  | 외부에서 권한 회수 | 최대 1시간 노출 창 존재 → 민감 워크스페이스는 쿼리 시점 원본 권한 재확인 |
  | OAuth 토큰 만료/revoke | 동기화 중단 + 관리자 알림. 기존 인덱스 처리 **[확인필요]** |
  | 초기 동기화 중 검색 | 부분 결과 + "색인 진행 중" 표시 |
  | 대형 PDF/스프레드시트 | 청킹 후 색인, 계산·집계는 미지원 |
  | 같은 문서가 여러 소스에 존재 | dedupe 필요 |
  | 커넥터 해제 후 재연결 | 전체 재색인(최대 72시간) 다시 발생 |

- **데이터 모델 함의**: `connector_account`, `identity_mapping`, `connector_document(id, account_id, external_id, title, url, mime, updated_at, acl_principals[], deleted_at)`, `embedding_span(source_kind=connector_doc)`, 증분 동기화용 `sync_cursor(account_id, cursor, last_full_sync_at)`. **삭제 tombstone 전파**가 필수.
- **UI/인터랙션**: 설정 내 커넥터 목록/연결 상태/마지막 동기화 시각, Slack 채널 선택 다이얼로그, 검색 결과의 소스 아이콘 필터, Disconnect(= 삭제 요청).
- **의존 기능**: F-10-08 인덱스, OAuth 인프라, 잡 스케줄러, 권한 매핑.
- **구현 난이도**: **XL** — 커넥터 1개당 OAuth + 증분 동기화 + ACL 매핑 + 삭제 전파 = 사실상 개별 프로젝트. 앱마다 권한 모델이 전부 다르다.
- **우선순위**: **P2** — 클론 초기 가치와 무관. 엔터프라이즈 판매 단계 기능.
- **클론 시 현실적 대안**: 전체 색인 대신 **쿼리 시점 위임 검색(federated search)** — 사용자의 OAuth 토큰으로 Slack/Drive 검색 API를 그때 호출하면 ACL 동기화·삭제 전파·인덱스 저장이 전부 불필요해진다(대신 지연 증가, 시맨틱 검색 불가). 커넥터는 Google Drive 1개만 먼저.
- **참고 출처**: https://www.notion.com/help/notion-ai-connectors , https://www.notion.com/help/enterprise-search-security-and-privacy-practices , https://www.notion.com/help/notion-ai-connectors-for-slack , https://www.notion.com/releases/2026-07-01 , https://www.notion.com/releases/2026-04-14

---

### F-10-08 권한 인지 임베딩 인덱스 파이프라인 (구현 기반 기능)

- **한 줄 정의**: 워크스페이스·커넥터 콘텐츠를 청크로 쪼개 임베딩하고, ACL 메타와 함께 벡터 저장소에 유지하며 변경분만 증분 갱신한다.
- **사용자 시나리오**: 사용자에게 직접 노출되지 않는다. 관측 가능한 표면은 "새 콘텐츠가 검색에 뜨기까지의 지연", "온보딩 시 초기 색인 진행률"뿐.
- **동작 상세** (Notion 공개 엔지니어링 자료 기반, 수치는 실측치):
  - **이중 경로**: (a) *offline* — 배치 잡(Apache Spark)이 기존 문서를 청킹·임베딩·벌크 로드. (b) *online* — **Kafka 컨슈머**가 개별 페이지 편집을 실시간 처리.
  - 페이지는 메타데이터(작성자·권한)가 함께 임베드된 **span** 단위로 분할.
  - **Page State 최적화(2025-07)**: span마다 해시 2개 — 본문 텍스트 해시 + 메타데이터 필드 해시(**xxHash 64bit**). 이전 상태를 **DynamoDB**에 캐시해 텍스트가 바뀐 span만 재임베딩하고, 메타만 바뀐 경우 임베딩 없이 메타만 패치. → **처리 데이터량 70% 감소**.
  - 벡터 저장소 변천: pod 기반 → 서버리스(비용 50%↓, 2024-05) → **turbopuffer**(오브젝트 스토리지 기반, 2024말~2025-01). 결과: 검색엔진 비용 **60%↓**, AWS EMR 컴퓨트 **35%↓**, p50 지연 **70~100ms → 50~70ms**.
  - **workspace_id를 파티션 키**로 range 기반 파티셔닝. turbopuffer는 **네임스페이스마다 독립 인덱스**로 다뤄 샤딩/제너레이션 라우팅 부담 제거. 용량 임계 시 새 인덱스 세트에 generation ID를 부여해 재샤딩 없이 트래픽 전환.
  - 임베딩 생성: 외부 API → **Ray/Anyscale에 오픈소스 임베딩 모델 self-host**(Ray Serve가 GPU에 상주, 동적 배칭·오토스케일). 임베딩 인프라 비용 **90%+ 절감**, 서드파티 API 홉 제거로 체감 지연 감소. turbopuffer 이전 시 임베딩 모델도 교체하며 **전체 재색인** 수행.
  - 규모: 2년간 **10배 확장 / 비용 1/10**, **100억+ 벡터**, 수백만 네임스페이스, 활성 워크스페이스 15배, 일일 온보딩 처리량 600배.
  - 삭제: 페이지/워크스페이스 삭제 시 임베딩 **60일 내 삭제**.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 페이지 이동으로 권한 상속 변경 | 텍스트 불변 → 메타 해시만 변경 → **재임베딩 없이 ACL 패치** |
  | 대량 권한 변경(팀스페이스 멤버 삭제) | 수만 span ACL 일괄 갱신 → 벌크 메타 패치 경로 필수 |
  | 편집 폭주(초당 다수 저장) | 디바운스/코얼레싱 후 색인 |
  | 임베딩 모델 교체 | 전체 재색인 필요(Notion도 실제 수행) → generation 전환 전략 필요 |
  | 색인 실패 span | 재시도 큐 + DLQ, 부분 인덱스 상태 노출 |
  | 삭제 직후 검색 | tombstone을 읽기 경로에서 우선 반영 |
  | 빈 블록 / 이미지-only 페이지 | 임베딩 스킵(비용) |
  | 워크스페이스가 비정상적으로 큼 | 네임스페이스 용량 초과 → generation 분할 |

- **데이터 모델 함의**: `embedding_span(text_hash, meta_hash, acl_principals[], generation_id, workspace_id=namespace)`, `page_state_cache(page_id → span_ids + hashes)`, `index_generation(workspace_range, generation_id, status)`, `index_job(source_id, state, attempts, error)`.
- **UI/인터랙션**: 없음. 관리자용 "AI 색인 상태/진행률" 화면 정도.
- **의존 기능**: 블록 저장소 변경 스트림(CDC/Kafka), 권한 시스템, 잡 인프라, 벡터 저장소.
- **구현 난이도**: **XL** — 이 문서에서 가장 비싼 항목. 정확성(ACL)과 비용(재임베딩) 두 축을 동시에 만족해야 한다.
- **우선순위**: **P1** — F-10-06/07의 전제. 단 아래 대안으로 대폭 축소 가능.
- **클론 시 현실적 대안**:
  1. **v1: 벡터 없이 Postgres FTS**(`tsvector` + GIN) + 권한 JOIN → ACL 동기화 문제 0.
  2. **v2: pgvector(HNSW)**. 임베딩은 트랜잭션 후 잡 큐로 비동기 생성. 청크 경계는 "heading + 하위 블록".
  3. **text_hash 재임베딩 스킵은 규모와 무관하게 처음부터 넣어라** — 구현 비용은 낮고 API 비용 절감이 즉각적이다(Notion 실측 70% 감소).
  4. ACL은 인덱스에 복제하지 말고 매 쿼리에서 permission 테이블 JOIN(단일 DB이므로 가능).
- **참고 출처**: https://www.notion.com/blog/two-years-of-vector-search-at-notion , https://www.notion.com/help/notion-ai-security-practices , https://www.notion.com/help/enterprise-search-security-and-privacy-practices

---

### F-10-09 스트리밍 응답 및 생성 라이프사이클

- **한 줄 정의**: LLM 출력이 토큰 단위로 도착하는 동안 UI에 점진 렌더링하고 취소·재시도·확정을 일관되게 처리한다.
- **사용자 시나리오**: 프롬프트 제출 → 즉시 커서/스켈레톤 → 텍스트가 흘러나옴 → 중간 Stop 가능 → 완료 후 Accept / Discard / Try again.
- **동작 상세**:
  - 전송 방식은 **SSE**다. 이는 업계 관행 추론이 아니라 **1차 출처로 확인된 사실**: Notion Agent API는 `POST /v1/sessions`에 **`Accept: text/event-stream` 헤더를 붙이면 JSON 대신 server-sent events를 반환**한다고 공식 명시한다. (초판은 Vercel/AFFiNE이라는 2차 근거만 들었으나, 이제 Notion 자체 문서로 대체 가능하다.)
  - **[공식 확인] 실제 Notion 이벤트 타입 6종**: `user.message` / `agent.message` / `agent.thinking` / `agent.tool_use` / `agent.tool_result` / `session.status`. 초판의 권고 스키마(`start`/`delta`/`citation`/`done`)보다 **의미 축이 낫다** — Notion은 "텍스트 조각"이 아니라 **"누가 무엇을 했는가"** 를 이벤트 단위로 삼고, 각 이벤트에 단조 증가 `sequence`를 붙인다. 클론도 이 taxonomy를 그대로 채택할 것을 권고한다(`agent.thinking`을 별도 타입으로 두면 reasoning 표시/숨김이 UI 토글 하나로 끝난다).
  - **[공식 확인] 스트림 재개**: `continue_from` 파라미터로 **특정 이벤트 이후부터 재생(replay)** 할 수 있으며, 이 필드는 SSE 응답에서만 유효하다. → 재연결이 "처음부터 다시"가 아니다.
  - **[공식 확인] 휴먼 승인 게이트**: 세션이 `requires_action` 상태가 되면 `required_actions[]`(각 `action_id` + approve/reject 류 `option_id` 선택지)가 실리고, 클라이언트가 `session_id` + `actions[]`를 제출해야 재개된다. 스트리밍 라이프사이클은 "생성→완료" 단선이 아니라 **중간에 사용자 입력을 요구하며 멈출 수 있는 상태 기계**다.
  - **[공식 확인] 입력 상한**: 세션 메시지 `message` 필드 **maxLength 10000**.
  - 상태 전이(공식 enum 기준): `queued → in_progress → (requires_action ⇄ in_progress) → completed | failed | canceled | terminated`.
  - 클라이언트는 delta를 누적하며 **증분 블록 파싱**. 닫히지 않은 코드펜스·표 등 불완전 마크다운을 안전 처리해야 한다.
  - **취소**: SSE 연결을 끊는 것만으로는 부족 — 서버가 upstream LLM 요청을 abort해야 과금이 멈춘다.
  - 호출 전 **토큰 카운팅**으로 컨텍스트 초과를 사전 차단(AFFiNE은 tiktoken-rs 사용).
  - Try again은 같은 프롬프트로 새 message 실행, 직전 결과는 폐기 또는 히스토리 보관.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 네트워크 끊김 | **[정정]** 초판은 "자동 이어받기는 과설계"라고 단정했으나 **틀렸다.** Notion은 `continue_from`으로 마지막 수신 `sequence` 이후를 재생한다. 이벤트에 단조 sequence만 있으면 재개 비용은 낮다 → **이어받기를 기본값으로 설계할 것** |
  | 재접속했는데 서버가 이미 세션 종료 | 이벤트 히스토리를 `sequence` 오름차순으로 재생해 최종 상태 복원(폴링 폴백) |
  | `requires_action`에서 사용자가 응답 없이 이탈 | 세션은 승인 대기로 잔존 → **승인 TTL 필요**. 만료 시 `canceled`로 정리하고 크레딧 정산 |
  | 승인 요청을 두 번 제출(더블클릭·재시도) | `action_id` 기준 멱등 처리. 두 번째는 무시하고 현재 상태 반환 |
  | 메시지가 10000자 초과 | 전송 전 클라이언트에서 차단(서버 400 왕복 낭비 방지) |
  | 프록시/브라우저 버퍼링 | 주기적 heartbeat(`:ping`) 전송, 응답 압축·버퍼링 비활성 |
  | 토큰 한도 초과 절삭 | `finish_reason=length` 표시 + "이어서 쓰기" 제공 |
  | 동시 다중 AI 세션 | 세션별 독립 스트림 + 사용자당 동시 실행 수 제한 |
  | Stop 직후 Accept | 부분 결과라도 확정 가능해야 함 |
  | 서버 재시작 | 진행 중 세션 `status=error`로 정리(고아 세션 방지) |
  | 콘텐츠 필터 차단 | `finish_reason=filtered` + 사용자 안내, 과금 미기록 |
  | 업스트림 429/5xx | 지수 백오프 재시도 후 사용자에게 명확한 실패 표시 |

- **데이터 모델 함의**: `ai_session.status`(위 공식 7값 enum) + `required_actions jsonb`, `ai_session_event(session_id, type, sequence, payload, created_at)`, `ai_message.finish_reason/token_in/token_out`. **[정정]** 초판은 "스트림 중간 상태는 Redis/메모리로 충분(영속화 불필요)"이라 했으나, `continue_from` 재생과 `requires_action` 대기를 지원하려면 **이벤트는 영속화해야 한다**. 권고: 이벤트는 DB에 append-only로 쓰고, 활성 세션의 최근 N개만 Redis에 캐시. 과금은 종료 상태(`completed`/`canceled`/`failed`) 시점의 실제 usage로 `ai_usage_ledger` 기록.
- **UI/인터랙션**: 타이핑 커서, Stop 버튼, 진행 중 입력 비활성, 완료 후 액션 바, 소모량 표시(선택).
- **의존 기능**: 없음 — **가장 먼저 만들어야 하는 기반**.
- **구현 난이도**: **L** *(초판 M에서 상향)* — SSE 파이프 자체는 하루짜리지만, 여기에 딸린 것이 **(a) upstream abort 전파, (b) 증분 블록 파싱, (c) 프록시 버퍼링 회피, (d) 이벤트 영속화 + `sequence` 기반 재생, (e) `requires_action` 승인 게이트 상태기계, (f) 원자적 usage 정산**까지 6개다. 이 중 (d)(e)는 초판에서 아예 누락됐던 요구사항이고 둘 다 상태 저장이 필요해 "M(3~5일)"에 들어가지 않는다. 6~9일.
- **우선순위**: **P0** — 없으면 모든 AI 기능이 "10초 멈춤 후 텍스트 뭉텅이"가 된다.
- **클론 시 현실적 대안**: Vercel AI SDK(`streamText` + `useChat`)를 그대로 채택하되, **와이어 이벤트 타입은 Notion의 6종 taxonomy로 고정**하라(나중에 tool use / reasoning을 붙일 때 스키마를 갈아엎지 않아도 된다). v1에서 잘라도 되는 것: `requires_action` 승인 게이트(에이전트를 안 만들면 불필요), `continue_from` 재생(단, `sequence` 컬럼만은 처음부터 넣어라 — 나중에 재생을 붙이는 비용이 0에 수렴한다).
- **참고 출처**: https://developers.notion.com/reference/notion-agent-apis/update-session , https://developers.notion.com/reference/notion-agent-apis/query-session-events , https://vercel.com/blog/ai-sdk-5 , https://deepwiki.com/toeverything/AFFiNE/1.1-architecture-overview

---

### F-10-10 Research Mode (멀티스텝 조사 + 보고서 생성)

- **한 줄 정의**: 하나의 질문에 대해 워크스페이스·커넥터·웹을 여러 번 연쇄 검색하며 조사한 뒤, 인용이 달린 문서 초안을 생성한다.
- **사용자 시나리오**:
  1. 사이드바 Notion AI에서 Research Mode 토글 ON.
  2. 웹 검색 on/off 선택.
  3. 질문 입력 + `@`로 특정 DB/페이지 지정, PDF·이미지 첨부.
  4. 백그라운드 실행 중 다른 작업 가능. **보통 최대 5분, 복잡한 질의는 최대 10분**.
  5. 완료 시 하이퍼링크 인용이 포함된 문서 초안 생성.
- **동작 상세**:
  - 단발 retrieval이 아니라 **검색 → 읽기 → 분석 → 추가 검색**의 연쇄(에이전틱 검색).
  - 소스: Notion 페이지·데이터베이스·업로드 파일 + 활성 커넥터(Slack, Google Drive, Teams, Jira, Zendesk, Asana, GitHub 등), 사용자의 권한 범위 내.
  - 웹 검색 off면 내부 소스만. **HIPAA 워크스페이스는 웹 검색 불가**(외부 소스 비활성).
  - `@`로 특정 DB를 지정하면 그 DB를 우선 조회. 템플릿을 넘겨 보고서 구조를 지정할 수 있다.
  - **모든 보고서에 하이퍼링크 인용**이 붙는다. Business/Enterprise 전용.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 5~10분 타임아웃 도달 | 그 시점까지의 결과로 부분 보고서 생성 |
  | 사용자 중간 취소 | 부분 결과 저장 여부 선택 |
  | 검색 결과 0건 | "근거를 찾지 못함" 명시, 웹 지식으로 채우지 않기 |
  | 웹 소스 신뢰 불가 | 인용 URL을 반드시 노출해 판단을 사용자에게 이전 |
  | 에이전트 루프 발산 | 최대 스텝 수 / 토큰 예산 / 데드라인 하드 리밋 |
  | 첨부 PDF가 큼 | 청킹 후 부분 참조, 전체 투입 금지 |
  | 세션 중 브라우저 종료 | 백그라운드 실행이므로 완료 후 알림 + 결과 페이지 잔존 |
  | 크레딧 소진 | 실행 시작 전 차단(중간 중단은 최악) |

- **데이터 모델 함의**: `ai_session(mode=research)` + `ai_step(session_id, seq, kind enum(search, fetch, read, synthesize), query, result_ref, tokens, duration_ms)`. 결과가 실제 페이지로 저장되므로 `page.created_by_ai_session_id`. 예산 제어용 `session_budget(max_steps, max_tokens, deadline_at)`.
- **UI/인터랙션**: Research Mode 토글, 웹 검색 토글, `@` 소스 지정, 파일 첨부, **진행 단계 로그 실시간 표시**(무엇을 검색 중인지), 완료 알림, 결과 문서의 인용 각주.
- **의존 기능**: F-10-06(검색), F-10-09(스트리밍/장기 실행), 백그라운드 잡, 알림 시스템.
- **구현 난이도**: **XL** — 장기 실행 에이전트 루프 + 예산 제어 + 부분 결과 복구 + 백그라운드 잡 인프라.
- **우선순위**: **P2** — 인상적이지만 클론 초기 ROI가 낮다.
- **클론 시 현실적 대안**: 멀티스텝 에이전트 대신 **고정 3단계 파이프라인**(질의 확장 → 병렬 top-k 검색 → 1회 종합). 백그라운드 잡 없이 동기 30초 내 완료. 웹 검색은 단일 검색 API 1회 호출로 제한.
- **참고 출처**: https://www.notion.com/help/research-mode , https://www.notion.com/help/guides/power-your-deep-work-using-research-mode-in-notion

---

### F-10-11 AI Meeting Notes (녹음 → 전사 → 요약)

- **한 줄 정의**: 회의 오디오를 캡처해 전사하고 페이지에 요약·액션아이템·참석자를 생성한다.
- **사용자 시나리오**:
  1. 페이지에서 `/meet` 입력 또는 새 페이지 하단의 "Meet" 칩 클릭.
  2. "Start transcribing" 클릭(참석자 동의 확인 의미).
  3. 회의 중 실시간 전사 표시, 수동 메모 병행.
  4. 종료 → 요약 / 액션아이템 / 참석자 목록 자동 생성.
- **동작 상세**:
  - 오디오 캡처: **데스크톱 앱 = 마이크 + 시스템 오디오**(Zoom/Meet/Teams를 봇 없이 캡처), **브라우저 = 마이크만**(시스템 오디오는 스피커 미차단 필요), **모바일 = 폰 마이크만**.
  - 요약 생성 최소 조건 **음성 1분 이상**.
  - 오디오는 전사 서브프로세서(OpenAI, Anthropic, AssemblyAI 등)로 전송. 로컬 임시 복사본은 처리 후 **24시간 내 삭제**. 전사 실패 시 재시도용으로 업로드 오디오가 서버에 **최대 3일** 보관.
  - 화자 구분: 오디오 전환 감지 + 캘린더 등 비오디오 컨텍스트 활용. **1:1 화상회의에서 가장 정확**하며 화자 라벨은 **영어만 지원**.
  - **[2026-07 갱신]** 화자 식별 방식이 바뀌었다: Notion 3.6부터 **"누구의 마이크가 활성인지"를 근거로 화자를 식별**하고, 그 결과로 후속 액션아이템을 올바른 담당자에게 배정한다. 즉 순수 오디오 diarization이 아니라 **참가자별 오디오 채널/디바이스 신호를 1차 신호로 쓰는 방식**이다 — 클론에서도 "한 트랙을 분리"하려 들지 말고 **참가자별 스트림을 따로 받는 설계**가 정확도·구현비용 양쪽에서 유리하다. 출처: https://www.notion.com/releases/2026-07-01
  - 요약 지시문 커스터마이징 가능(sales call / standup / team meeting 프리셋 또는 자유 지시). **[2026-04 갱신]** 사용자 지정 커스텀 지시문("원하는 포맷으로 요약")과 **워크스페이스 컨텍스트를 요약 품질에 반영**하는 경로가 추가됐다. 출처: https://www.notion.com/releases/2026-04-14
  - **[공식 확인 / API]** 회의 노트는 더 이상 API 사각지대가 아니다. 공개 API 버전 **`2026-03-11`에서 블록 타입 `transcription`이 `meeting_notes`로 개명**됐고(모든 block 엔드포인트 공통), MCP에는 `notion-query-meeting-notes` 도구가 있다. → F-10-04의 "AI 결과 블록은 `unsupported`" 원칙에서 **회의 노트만은 예외로 정식 타입을 얻었다**. 클론 설계 시사점: AI 산출물 블록을 영구히 `unsupported`로 두면 결국 외부 연동 요구에 밀려 타입을 열게 된다 — 처음부터 **읽기 가능한 정식 블록 타입 + 쓰기 제한**으로 설계하는 편이 낫다. 출처: https://developers.notion.com/page/changelog
  - 권한: 노트는 **기본 비공개**, 페이지 공유 설정을 따름. **오디오 파일은 녹음자의 로컬 기기에만** 남고 그 사람만 다운로드 가능. 워크스페이스 소유자가 내부 캘린더 참석자 자동 공유를 켤 수 있다.
  - 제약: **사용자당 1일 10시간**, 업로드 포맷 **AAC/M4A/MP3/WAV**(MOV/MP4/Loom 미지원), **15개 언어 지원**, **macOS 13+ 또는 최신 Windows** 필요. VDI 환경은 Notion VDI 플러그인 없이는 로컬 마이크만 캡처.
  - Zoom/Meet 등 통화 시작 자동 감지 → 전사 시작 알림 발송.
  - 전사는 수동 삭제 가능하며 Enterprise 워크스페이스 정책에 따라 자동 삭제. 업로드 오디오는 AI Meeting Notes 블록이 존재하는 동안 보존되고, 부모 페이지 삭제 후에는 워크스페이스 데이터 보존 설정을 따른다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 1분 미만 녹음 | 요약 생성 안 함 |
  | 전사 실패 | 오디오 3일 보관 후 재시도 경로 제공 |
  | 다국어 혼용 회의 | 전사는 되나 화자 라벨 정확도 하락(영어 외 미지원) |
  | 참석자 동의 없음 | 제품이 강제 불가 → 시작 시 동의 확인 문구가 법적 방어선 |
  | 페이지 삭제 | 워크스페이스 보존 정책에 따라 오디오/전사 삭제 |
  | 1일 10시간 한도 초과 | 신규 녹음 차단 |
  | 오프라인 | 로컬 녹음 후 온라인 시 업로드 **[확인필요]** |
  | 미지원 포맷 업로드(MP4) | 명시적 거부 메시지 |

- **데이터 모델 함의**: `meeting_note(block_id, page_id, started_at, ended_at, duration_sec, lang, status)`, `transcript_segment(note_id, seq, start_ms, end_ms, speaker_label, text, confidence)`, `audio_file(note_id, storage_ref, retention_until, owner_user_id)`, 생성물은 F-10-04의 `ai_block`(summary / action_items) 재사용. 한도용 `usage_meter(user_id, kind=recording_seconds, window=1d)`.
- **UI/인터랙션**: `/meet` 슬래시 커맨드, 페이지 하단 Meet 칩, 녹음 인디케이터/일시정지, 실시간 전사 패널, 전사 ↔ 요약 탭, 전사 텍스트 클릭 시 오디오 위치 점프.
- **의존 기능**: 데스크톱 앱(시스템 오디오 캡처), STT 서비스, 파일 스토리지, F-10-04 AI 블록, 캘린더 연동(화자 추정).
- **구현 난이도**: **XL** — 시스템 오디오 캡처가 OS별 네이티브 작업(macOS ScreenCaptureKit / Windows WASAPI loopback)이고 실시간 스트리밍 STT + 화자 분리까지 필요.
- **우선순위**: **P2** — 웹 클론이면 사실상 범위 밖.
- **클론 시 현실적 대안**: 실시간 캡처 포기. **오디오 파일 업로드 → Whisper 계열 배치 전사 → 요약**만 지원. 화자 분리는 생략하거나 pyannote 등으로 후처리. 브라우저 `getDisplayMedia({audio:true})`로 탭 오디오만 캡처하는 절충안도 가능(OS/브라우저 제약 큼). **화자 라벨이 필요하면 diarization 모델을 붙이지 말고 Notion 3.6과 같은 길을 택하라** — 화상회의 참가자별 스트림(또는 "지금 말하는 사람" 신호)을 받아 라벨링하면 정확도가 근본적으로 높고 모델 비용이 0이다.
- **참고 출처**: https://www.notion.com/help/ai-meeting-notes , https://www.notion.com/releases/2026-07-01 , https://www.notion.com/releases/2026-04-14 , https://developers.notion.com/page/changelog

---

### F-10-12 요금·사용 한도·크레딧 (AI 거버넌스)

- **한 줄 정의**: AI 사용량을 플랜별 할당량과 크레딧으로 제한·과금하고 관리자에게 통제권을 준다.
- **사용자 시나리오**:
  1. 사용자가 AI를 계속 쓰다 할당량 소진 → "리셋 대기 또는 credits 사용" 안내.
  2. Settings → Notion AI → Usage에서 rolling / monthly 사용량 확인.
  3. 관리자가 크레딧을 구매하고 워크스페이스에 배분, 멤버별 지출 한도 설정.
- **동작 상세**:
  - **3층 구조**: (a) 플랜 seat에 포함된 기본 AI, (b) **rolling 6시간 창 + 월 청구주기 할당량**, (c) 초과분·프리미엄 모델·Custom Agent/Worker용 **Notion credits**.
  - rolling 할당량은 6시간 창 갱신 시 0으로 리셋. 월 할당량은 청구주기 시작에 일괄 리셋.
  - 크레딧 가격: **월간 $10 / 1,000 credits**(미사용분 이월 없음), **연간 $13 / 1,000 credits**(구독 갱신 시 만료). 소진 순서 **free → monthly → annual**.
  - 결제 실패 시 지불 금액 초과분 크레딧은 hold, 기존 크레딧·구독은 유지.
  - **Basic Autofill은 크레딧 미소모**, Custom Agent Autofill / 프리미엄 모델은 소모.
  - 이미지 생성 한도: **사용자당 24시간 10개, 30일 30개**(개수 기반).
  - Notion AI 전체는 **Business/Enterprise 전용**(Free/Plus는 제한적 무료 응답).
  - 관리자 통제: 웹 검색 on/off, 외부 사이트 접근 전 확인 요구, 커넥터 관리, **모델 선택**(프리미엄 모델은 문서상 "off until you turn them on" — 기본 비활성, 관리자가 활성화), 멤버별 크레딧 지출 한도, 오디오 저장·전사 설정, 데이터 공유 설정, (Enterprise) **AI 프롬프트/출력 대상 DLP 경보**.
  - **[공식 확인] 크레딧 거버넌스는 UI 토글이 아니라 정식 Admin API 표면이다.** 공개된 엔드포인트만으로도 한도 모델의 층위가 드러난다: `update-workspace-credit-limit`(워크스페이스 상한), `list/create/update/expire-credit-limit-policy`(**만료 가능한 정책 객체** — 단일 숫자가 아니라 기간이 있는 정책), `update-agent-credit-limit` + `get-agent-credit-usage` / `get-agents-credit-usage`(**에이전트 단위** 한도·사용량). 즉 한도 주체가 **workspace / member / agent** 3축이고, 정책은 버전·만료를 갖는다.
  - **[공식 확인] 한도 값 자체가 권한 대상이다.** Agent API 문서상 full access가 없으면 크레딧 한도 필드는 **`hidden`으로 반환**된다. 한도는 "읽으면 되는 숫자"가 아니라 권한 검사를 통과해야 보이는 값.
  - **[공식 확인] 파일 산출물 과금 축**: Notion AI는 "create files you can download and preview within Notion"(스프레드시트·PDF·슬라이드덱)을 지원한다 → 토큰/이미지장수 외에 **컴퓨트 작업 단위**라는 세 번째 계량 축이 존재한다(F-10-16).
  - **[2026 재확인] 크레딧 단가는 그대로다** — 2026-09-06 `what-are-notion-credits` 본문 재확인 결과 월간 **$10/1,000**, 연간 **$13/1,000**, 이월 없음, 소진 순서 free→monthly→annual이 모두 유지. 소모 대상은 *"Custom Agents, Workers, premium AI models, and additional Notion AI usage beyond the usage allowance"*. **플랜별 포함 할당량의 구체 수치는 이 문서에 없다**(별도 usage allowance 문서로 위임) → 수치를 인용할 때 주의.
  - **[2026-04 갱신] 단가가 아니라 소비량이 내려갔다.** Custom Agent 실행 비용 **35~50% 절감**, 신규 모델은 **최대 10배 적은 크레딧** 사용. 시사점: 크레딧은 "고정 환율"이 아니라 **모델별 배수(multiplier)** 로 계량되며 그 배수가 릴리스마다 바뀐다 → 원장에 `credits`만 적으면 사후 재계산이 불가능하다. **`model_id` + `credit_multiplier_at_time` + 원시 usage(토큰/장수/작업수)를 함께 적어라.**
  - **[2026 갱신] 모델 선택이 정식 사용자 기능이 됐다**(F-10-26 참조): 3.2에서 GPT-5.2 / Claude Opus 4.5 / Gemini 3 + **Auto**, 3.6에서 Opus 4.8 / Grok 4.3 / GLM 5.2. 프리미엄 모델은 **크레딧 + 관리자 승인** 필요("off until you turn them on"이 2026에도 유지).
  - **[2026-01 갱신] 관리자 관측 표면 추가**: Settings → **Analytics → AI**에서 AI 채택률 추이·사용자별 사용량·기능별 활용도를 확인(Enterprise). 2026-07에는 **Custom Agent 감사 로그**(런·변경 내역·트리거한 사용자)가 추가. → 과금 원장과 별개로 **관측/감사 스키마가 필요**하다(F-10-25).
  - 데이터 보존: **Enterprise는 LLM 프로바이더 zero data retention**, 비Enterprise는 **30일 이하** 보관 후 삭제. 모든 서브프로세서는 고객 데이터로 모델 학습 금지 계약. 전송 구간 TLS 1.2+.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 스트리밍 중 한도 소진 | 진행 중 요청은 완료시키고 다음 요청부터 차단 |
  | 요청 실패했는데 과금 | `error`/`filtered`면 usage 미기록 또는 입력 토큰만 기록 |
  | 크레딧 0 + 할당량 0 | AI 진입점 비활성화 + 사유 표시 |
  | 동시 요청으로 한도 초과 | **원자적 카운터(Redis INCR)** 필요. 낙관적 체크는 초과 허용 |
  | 관리자가 프리미엄 모델 비활성화 | 진행 중 세션 유지, 신규는 기본 모델 폴백 |
  | 워크스페이스 이전/병합 | 크레딧 귀속 **[확인필요]** |
  | 게스트/외부 협업자 | AI 사용 가능 범위 **[확인필요]**(커넥터 제외만 공식 확인됨) |
  | 크레딧 정책 만료 시점에 실행 중인 세션 | 정책이 expire되면 진행 중 런을 죽일지 유예할지 결정 필요. 권고: 진행 중은 완료, 신규만 차단 |
  | 에이전트 한도와 멤버 한도가 충돌 | **더 엄격한 쪽이 이긴다**를 명문화(3축 한도는 우선순위를 안 정하면 반드시 버그가 난다) |
  | full access 없는 사용자가 한도 조회 | 값 노출 금지 — `hidden` 반환(공식 동작). 클론도 0이나 null로 뭉개지 말 것 |
  | 파일 생성(컴퓨트) 작업 | 토큰 기준으로 계량 불가 → **작업 단위 과금**을 별도 축으로 설계 |

- **데이터 모델 함의**: `ai_usage_ledger`, `ai_quota(workspace_id, user_id, window enum(rolling_6h, monthly, rolling_24h, rolling_30d), kind, used, limit, window_start)`, `credit_balance(workspace_id, kind enum(free, monthly, annual), amount, expires_at)`, `ai_admin_settings(workspace_id, web_search_enabled, require_confirm_external, allowed_models[], dlp_enabled, audio_retention_days)`. **[정정]** 초판의 `credit_policy(workspace_id, user_id NULL, max_spend)`는 실제 API 표면보다 단순하다 → **`credit_policy(id, workspace_id, subject_type enum(workspace, member, agent), subject_id, max_spend, effective_from, expires_at, status)`** 로 확장할 것. 3축 주체 + 만료가 공식 API에 존재한다. 한도 조회 시 요청자 권한에 따라 값 대신 `hidden` 센티널을 반환하는 경로도 필요. **[2026 추가]** 원장은 `ai_usage_ledger(..., model_id, credit_multiplier, raw_units jsonb {tokens_in, tokens_out, images, compute_ms, steps}, credits_charged)`로 확장할 것 — 2026-04에 모델별 크레딧 소비가 최대 10배 변동한 사실이 보여주듯 **배수는 시간에 따라 바뀌는 값**이며, 원시 단위를 함께 남기지 않으면 요금 분쟁·사후 재계산·모델 전환 비용 분석이 전부 불가능해진다.
- **UI/인터랙션**: 설정 내 Usage 대시보드(rolling/monthly 게이지), 크레딧 구매 플로우 + Auto Adjust, 한도 도달 배너, 모델 선택 드롭다운(허용 모델만), 멤버별 한도 테이블.
- **의존 기능**: 인증/워크스페이스, 결제 시스템, 모든 AI 기능의 usage 계측 훅.
- **구현 난이도**: **L** *(초판 M에서 상향)* — 초판은 "카운터 하나 + 계측 훅"으로 봤지만 과소평가다. 실제로는 **(a) 3축(workspace/member/agent) 한도의 우선순위 해석, (b) 만료되는 정책 객체의 시간 축, (c) 한도 값 자체에 대한 권한 검사(`hidden`), (d) 토큰·이미지장수·컴퓨트작업 3종 계량 축, (e) 스트리밍 중단·필터링 시의 정산 정확성, (f) 동시 요청 원자성** 이 얽힌다. 특히 (a)(d)는 나중에 끼워넣으면 원장 스키마를 갈아엎게 된다. 5~8일.
- **우선순위**: **P0** — LLM API는 직접 현금 비용이다. 무제한 클론은 즉시 파산한다. **최소한 레이트리밋은 MVP 필수.**
- **클론 시 현실적 대안**: 크레딧 경제 없이 **사용자당 일일 요청 수 + 일일 토큰 상한** 두 개만 Redis 카운터로. 모델 1개 고정. 관리자 통제는 워크스페이스 단위 on/off 토글 하나.
- **참고 출처**: https://www.notion.com/help/what-are-notion-credits , https://www.notion.com/help/manage-your-usage-allowance-for-notion-ai , https://www.notion.com/help/notion-ai-faqs , https://www.notion.com/help/notion-ai-security-practices , https://www.notion.com/releases/2026-04-14 , https://www.notion.com/releases/2026-01-20 , https://www.notion.com/releases/2026-07-01

---

### F-10-13 Custom Agents (트리거 기반 자동 실행)

- **한 줄 정의**: 지시문·트리거·도구·권한을 가진 저장된 에이전트가 이벤트나 스케줄에 따라 워크스페이스에서 작업을 자동 수행한다.
- **사용자 시나리오**:
  1. 에이전트 생성 → 이름, Instructions(무엇을·어떻게·어떤 일을 맡을지), 접근 가능한 페이지·DB·외부 도구, 모델 선택.
  2. 트리거 설정: 반복 스케줄 또는 이벤트.
  3. 저장 → 트리거 발생 시 백그라운드 실행, Activity 로그에 실행 원인과 수행 액션 기록.
- **동작 상세**:
  - **반복 스케줄**: 일 / 주 / 월 / 연 단위, 시각·타임존 지정.
  - **Notion 트리거**: 페이지에 댓글 추가 / DB에 페이지 추가·제거 / DB 프로퍼티 업데이트 / AI Meeting Note 완료.
  - **Slack 트리거**: 채널에 메시지 게시 / 이모지 리액션 추가 / 에이전트 멘션 — 키워드 필터 옵션.
  - **권한 모델의 핵심**: 에이전트는 특정 사용자 신원으로 동작하지 않고 **자율 백그라운드 프로세스**이며, 명시적으로 부여된 리소스에서만 동작한다.
  - 공유 권한 3단계: **Full Access**(지시문 설정·활동 확인·실행) / **Can Edit**(설정 수정) / **Can View and Interact**(실행·대화만).
  - Business/Enterprise 전용. 기본적으로 워크스페이스 전원이 생성 가능(Enterprise 관리자는 제한 가능).
  - 크레딧은 모델별 단가로 소모. 실패 시 Activity 로그에 단계별 오류 표시 → 지시문 수정 후 재실행.
  - **Workers**: 커스텀 코드를 에이전트 도구로 붙여 내장 액션/MCP를 넘어선 동작을 확장. 에이전트 복제 시 Workers 설정은 **자동 이관되지 않아 재구성 필요**.
  - **[공식 확인] 에이전트는 UI 기능이 아니라 공개 API 객체다** (Notion Agent APIs, *public beta*). 객체 3종: **Agent**(메타·상태·크레딧), **Session**(에이전트와의 대화 1건), **Session Event**(세션 내 이벤트 이력). 제공 동작: 세션 시작 / 메시지 전송 / **액션 제출** / 턴 스트리밍 / 세션 취소 / 이벤트 히스토리 페이징.
  - **[공식 확인] 휴먼 인 더 루프가 프로토콜에 내장돼 있다.** 세션이 `requires_action`이 되면 `required_actions[]`가 실리고 사용자가 approve/reject 계열 `option_id`를 골라 제출해야 진행된다. → 에이전트에 쓰기 권한을 주는 것과 **"위험한 쓰기 직전에 멈춰 세우는 것"** 은 별개 기능이며, 후자가 실제 안전장치다.
  - **[공식 확인] 권한 3단계가 API 동작에 그대로 매핑된다**: read = 에이전트·세션 조회 / edit = 상태 변경·삭제 / full = 크레딧 한도 관리(없으면 한도 `hidden`). 인증은 personal access token 또는 **"Interact with agents" capability**를 가진 connection token.
  - **[공식 확인] 관리자 표면**: `update-agent-creation-policy`(누가 에이전트를 만들 수 있는가), `get/update-agent-permissions`, `batch-manage-agent`, `retrieve-agent-insights`(크레딧 사용량·완료 런 수), `get-workflows-metadata-for-space`.
  - **[2026-07 갱신] Enterprise 감사 로그**: 에이전트 **런 / 변경 내역 / 트리거한 사용자**를 기록하는 전용 감사 로그가 추가됐다. 자율 프로세스에 쓰기 권한을 주는 순간 "누가 시켰고 무엇이 바뀌었나"는 컴플라이언스 필수 항목이 된다 → 클론도 `agent_audit_event`를 에이전트와 **동시에** 만들어야 한다(나중에 붙이면 과거 런을 복원할 수 없다). 출처: https://www.notion.com/releases/2026-07-01
  - **[2026-04 갱신] 실행 단가 인하 + 커넥션 확장**: 에이전트 실행 비용 35~50% 절감, 신규 모델 최대 10배 적은 크레딧, **private Slack 채널 지원**, 크레딧 대시보드. 출처: https://www.notion.com/releases/2026-04-14
  - **[2026 갱신] 에이전트 종류가 둘로 갈렸다**: (a) Notion이 자체 실행하는 Custom Agent, (b) **Claude·Cursor 같은 외부 모델 제공자가 실행하는 External Agent**(F-10-23). 후자는 같은 "Agents → New Agent" 진입점을 쓰지만 **데이터 보존 정책·실행 인프라·능력 제약이 다르다**(예: Claude 에이전트는 세션 중 웹 브라우징 불가, ZDR 미지원). 클론 시사점: `agent.runtime enum(internal, external)` 컬럼을 두고 **보존·권한·능력 정책을 런타임별로 분기**해야 한다.
  - **[2026 갱신] 배치 진입점**: Custom Agent 채팅을 **임의의 Notion 페이지에 임베드**할 수 있다 → 에이전트는 사이드바 전용 객체가 아니라 **블록으로 배치되는 객체**이기도 하다(`block.type=agent_chat` 상당의 서브타입이 필요).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 에이전트 액션이 다시 트리거를 발생 | **무한 루프 차단 필수** — 에이전트 유발 변경은 트리거 소스에서 제외 |
  | 지시문이 모호해 잘못된 페이지 수정 | 실행 로그 + 되돌리기 경로, 쓰기 권한 최소화 |
  | 생성자가 워크스페이스 탈퇴 | 권한 승계 정책 **[확인필요]** |
  | 동일 트리거 동시 다발 | 동시 실행 수 제한 + 큐잉 + 멱등성 키 |
  | 외부 도구 인증 만료 | 실행 실패 로그 + 소유자 알림 |
  | 크레딧 소진 | 실행 스킵 + 알림 |
  | Slack에서 타이핑 인디케이터만 뜨고 응답 없음 | 실제 관측되는 실패 모드 — 타임아웃 후 명시적 실패 처리 필요 |
  | 승인 대기(`requires_action`) 중 트리거가 또 발생 | 같은 에이전트의 세션이 쌓임 → 에이전트당 대기 세션 수 상한 + 오래된 것부터 만료 |
  | 승인자가 권한을 잃은 뒤 승인 제출 | 제출 시점 권한 재검증 필수(요청 시점 권한을 신뢰하면 권한 우회) |
  | 에이전트 삭제 중 실행 중 세션 존재 | `canceled`/`terminated`로 정리 후 삭제. 고아 세션은 크레딧 정산 누락으로 직결 |
  | 에이전트가 자기 자신을 트리거하는 페이지를 수정 | 이벤트에 `actor_type=agent` 태그를 붙여 트리거 소스에서 제외(루프 차단의 유일하게 견고한 방법) |

- **데이터 모델 함의**: `agent(id, workspace_id, name, instructions, model_id, created_by, enabled, status)`, `agent_trigger(agent_id, kind, config jsonb, filter jsonb)`, `agent_grant(agent_id, resource_type, resource_id, permission)`, `agent_tool(agent_id, kind enum(builtin, mcp, worker), config)`, `agent_share(agent_id, principal_id, level enum(full, edit, view_interact))`. **[정정]** 초판의 `agent_run` / `agent_run_step`은 **`ai_session` / `ai_session_event`와 통합하라** — Notion은 별도 "run" 객체를 두지 않고 **Session + Session Event 하나로 대화와 자동 실행을 모두 표현**한다(수동 대화와 트리거 실행이 같은 타임라인 모델을 쓴다). 통합하면 스트리밍·재생·감사 로직을 두 벌 만들 필요가 없다. 추가: `agent_credit_policy`(F-10-12의 `credit_policy`에 `subject_type=agent`로 흡수), `agent_insight(agent_id, window, credits_used, runs_completed)`. **[2026 추가]** `agent.runtime enum(internal, external)` + `agent.external_provider text NULL`(claude, cursor …) + `agent.data_retention_mode enum(zdr, provider_retained)` — External Agent가 ZDR을 지원하지 않는다는 공식 서술 때문에 **보존 정책이 에이전트 행(row) 속성**이 된다. 감사용 `agent_audit_event(id, agent_id, session_id, actor_user_id NULL, trigger_kind, resource_ref, change_summary jsonb, created_at)`는 append-only.
- **UI/인터랙션**: 에이전트 빌더(지시문 에디터, 트리거 선택 UI, 리소스 피커, 모델 선택), Activity 탭(런 히스토리·단계별 로그), 수동 Run 버튼, 공유 다이얼로그.
- **의존 기능**: F-10-09(특히 `requires_action` 승인 게이트 — 이게 없으면 에이전트에 쓰기 권한을 줄 수 없다), 이벤트 버스(DB/댓글 변경 이벤트), 잡 스케줄러, 권한 시스템(비인간 principal), F-10-12 크레딧(3축 한도), F-10-18 MCP/도구 계층, F-10-19 Skills(지시문 재사용).
- **구현 난이도**: **XL** — 이벤트 소싱 + 워크플로 엔진 + 비인간 principal용 권한 모델을 새로 세워야 한다.
- **우선순위**: **P2** — 클론 v2+ 영역.
- **클론 시 현실적 대안**: "에이전트" 대신 **스케줄 1종(cron) + 트리거 1종(DB row 생성) + 액션 1종(프로퍼티 채우기)**만 갖춘 최소 자동화 — 사실상 F-10-05의 자동 트리거와 통합하는 것이 합리적이다.
- **참고 출처**: https://www.notion.com/help/custom-agents , https://www.notion.com/help/run-custom-code-with-workers , https://www.notion.com/blog/introducing-custom-agents

---

### F-10-14 이미지 생성 및 편집

- **한 줄 정의**: 텍스트 프롬프트로 이미지를 만들거나 기존 이미지를 반복 편집해 페이지에 삽입한다.
- **사용자 시나리오**: AI 패널 또는 슬래시 커맨드에서 이미지 생성 선택 → 프롬프트 입력 → 결과 미리보기 → 페이지 삽입, 또는 추가 지시로 반복 편집.
- **동작 상세**:
  - 생성 이미지는 워크스페이스 파일 스토리지에 업로드되어 **일반 image 블록**으로 삽입된다 — 별도 "AI 이미지 블록" 타입이 아니다. 따라서 이후 이동·복제·삭제·권한은 전부 기존 파일/블록 경로를 그대로 탄다.
  - 한도는 **사용자당 24시간 10개, 30일 30개**로 토큰이 아닌 **개수 기반**으로 별도 관리된다. 공식 문언은 *"While in Beta, image generation has the following limits per user"* — **2026-09 현재도 Beta 표기가 유지**되며, 이 한도가 정식 출시 시 바뀔 수 있음을 뜻한다(수치를 상수로 박지 말고 쿼터 테이블 값으로 둘 것). "생성 **또는 편집**"을 함께 세므로 **편집 1회도 1개를 소모**한다. → 쿼터 시스템(F-10-12)이 **단일 축이 아니라 다축**이어야 하는 근거가 여기서 나온다(토큰 / 이미지 장수 / 컴퓨트 작업 / 녹음 시간이 각각 다른 창과 단위를 가진다).
  - "편집"은 새 이미지를 만드는 것이지 원본 파일을 in-place 수정하는 것이 아니다 **[추정]** — 그래서 아래 데이터 모델에서 `parent_image_id` 체인을 권고한다. 원본 버전 보존 여부는 **[확인필요]**.
  - 사용 모델·해상도·종횡비 선택지는 **[확인필요]**(헬프 문서에 명시 없음). 2026 릴리스 노트의 모델 추가(F-10-26)는 텍스트 모델 목록이며 이미지 모델은 별도 언급이 없다.
  - 실패·정책 거부 시 카운트 미차감이 원칙 — **개수 기반 쿼터에서 실패 차감은 사용자 체감이 즉각적**(10개 중 1개를 날린 것이 바로 보인다)이므로 토큰 쿼터보다 정산 정확성 요구가 높다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 정책 위반 프롬프트 | 거부 문구 노출, 카운트 미차감 |
  | 생성 실패 | 크레딧·카운트 미차감 |
  | 편집 반복 | 원본 버전 보존 여부 **[확인필요]** — 클론에서는 `parent_image_id` 체인으로 보존 권장 |
  | 대량 생성으로 스토리지 압박 | 워크스페이스 파일 쿼터와 연동 |
  | 이미지 블록 삭제 | 스토리지 GC 대상 등록(즉시 삭제 금지, 되돌리기 고려) |
  | 24시간/30일 한도 동시 도달 | 더 엄격한 쪽 기준으로 차단 + 리셋 시각 안내 |

- **데이터 모델 함의**: `ai_image(id, session_id, prompt, parent_image_id NULL, file_ref, created_by, created_at)`, 개수 기반 쿼터는 `ai_quota(window=rolling_24h | rolling_30d, kind=image)`.
- **UI/인터랙션**: 슬래시 커맨드, 프롬프트 입력, 결과 그리드, "이 이미지 편집" 후속 프롬프트, 삽입 / 재생성 / 폐기.
- **의존 기능**: 파일 업로드·스토리지, image 블록, F-10-12 쿼터.
- **구현 난이도**: **S** — 이미지 생성 API 호출 + 업로드 + 블록 삽입. 1일 내.
- **우선순위**: **P2** — 노션의 핵심 가치와 무관하고 사용 빈도 대비 비용이 크다.
- **클론 시 현실적 대안**: v1 생략. 필요하면 생성 API 1개만 붙이고 image-to-image 편집은 제외.
- **참고 출처**: https://www.notion.com/help/notion-ai-faqs , https://www.notion.com/help/create-and-edit-images-with-notion-ai

---

### F-10-15 Build with AI (프롬프트로 데이터베이스·뷰·페이지 구축)

- **한 줄 정의**: 자연어 설명만으로 데이터베이스와 그 프로퍼티·뷰, 또는 페이지 구조를 생성한다.
- **사용자 시나리오**:
  1. AI 진입점에서 "만들기" 의도의 프롬프트 입력 — 공식 문언: *"When you build with AI, all you need to do is provide a description."*
  2. AI가 스키마를 제안: 프로퍼티 집합(이름·타입·select 옵션)과 뷰(테이블/보드/캘린더 등).
  3. 사용자가 확인/수정 → 실제 DB가 워크스페이스에 생성됨.
  4. 변형 진입점: 기존 페이지를 참조해 *"Create a meeting notes doc inspired by this one"* 처럼 **예시 기반 생성**.
- **동작 상세**:
  - 생성 대상은 **구조**다(텍스트 생성인 F-10-01과 근본적으로 다르다). 출력이 산문이 아니라 **스키마 + 뷰 정의**이므로 자유 텍스트가 아니라 **제약된 JSON**으로 받아야 한다.
  - MCP 도구 목록이 이 기능의 내부 액션 집합을 사실상 노출한다: `notion-create-database`(프로퍼티 지정 DB 생성), `notion-create-view`(table/board/list/calendar 등 뷰 생성), `notion-update-data-source`(데이터소스 프로퍼티 수정), `notion-create-pages`(템플릿 옵션 포함), `notion-create-folder`. → **AI가 하는 일은 "이 도구들의 호출 시퀀스를 짜는 것"** 이다.
  - 대규모 생성은 동기 완료가 아니다: create/update 계열 도구가 **`allow_async: true`** 를 받고 `notion-get-async-task`로 폴링한다. [공식 확인]
  - F-10-05의 명시적 제약과 대비: **autofill은 페이지·자동화·폼·차트·DB 템플릿을 만들 수 없다.** 즉 "생성"은 Build 경로에만 있고 autofill 경로에는 없다 — 두 기능의 경계가 여기서 갈린다.
  - **[해소됨 / 2026-09 확인] 생성 가능 범위의 경계가 공식 문서에 존재한다.** `notion.com/help/notion-agent` 본문은 Notion Agent가 **페이지·데이터베이스를 만들고 수정하며 여기에 view·form·property가 포함**되지만, **automation / template / formula 같은 advanced property는 만들 수 없다**고 명시한다. 초판의 "[확인필요] 폼·차트·automation 포함 여부"는 이로써 **폼=가능 / automation=불가 / formula 프로퍼티=불가**로 확정된다(차트는 여전히 명시 없음 → **[확인필요]** 유지). 출처: https://www.notion.com/help/notion-agent
  - 이 경계는 우연이 아니다. **formula·automation은 "실행되는 것"이고 view·form은 "선언되는 것"** 이다. LLM이 산출한 실행 로직은 검증 없이는 부작용을 낳으므로, 클론도 같은 선을 그어라 — **선언적 스키마는 AI 생성 허용, 실행 로직(수식·자동화·코드)은 사람이 승인**.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 모호한 설명("프로젝트 관리용 DB") | 기본 스키마 제안 후 **생성 전 확인 단계** 필수. 즉시 생성은 워크스페이스 오염 |
  | 기존 DB에 적용 요청 | 신규 생성 vs 기존 스키마 변경은 **파괴성이 다르다**. 기존 변경은 프로퍼티 삭제를 절대 자동 수행하지 말 것(추가만 허용) |
  | 존재하지 않는 프로퍼티 타입 생성 | 스키마 검증 후 거부. LLM 출력을 그대로 DDL로 흘리지 말 것 |
  | relation 프로퍼티 제안 | 대상 DB가 없으면 무효 → 생성 순서 위상 정렬 필요(**순환 relation 주의**) |
  | 수백 개 프로퍼티/뷰 생성 요청 | 상한 강제 + async 잡 + 진행률 |
  | 생성 중 실패(3번째 뷰에서 오류) | **부분 생성물이 남는다** → 트랜잭션 또는 보상 삭제(rollback) 경로 필요 |
  | 권한 없는 상위 페이지 지정 | 생성 거부 |
  | 동시에 같은 이름 DB 생성 | 이름 유니크 제약이 없으므로 중복 허용하되 사용자에게 경고 |

- **데이터 모델 함의**: 신규 엔티티는 거의 필요 없고 **DB 도메인 스키마를 그대로 재사용**한다. 필요한 것은 생성 이력·롤백용 `ai_build_run(id, session_id, spec jsonb, created_object_refs jsonb[], status, rolled_back_at)`와 비동기용 `async_task(id, kind, state, result_ref, error)`. **`spec`(LLM이 낸 구조 제안)을 원문 그대로 저장**해야 실패 재현과 부분 롤백이 가능하다.
- **UI/인터랙션**: 프롬프트 입력 → **스키마 미리보기 카드**(프로퍼티 표 + 뷰 탭) → Create / Edit / Discard, 생성 진행률, 완료 후 새 DB로 이동. 기존 페이지 `@` 참조로 예시 지정.
- **의존 기능**: 데이터베이스·프로퍼티·뷰 도메인(하드 의존), F-10-09 스트리밍, 구조화 출력(JSON schema/tool calling), 비동기 잡.
- **구현 난이도**: **L** — LLM에게 tool calling으로 스키마를 뽑는 것 자체는 쉽다. 비용은 **스키마 검증·생성 순서 위상 정렬·부분 실패 롤백**에 있다. DB 도메인이 이미 있다는 전제에서 5~8일.
- **우선순위**: **P2** — 데모 임팩트는 최상급이지만, DB 도메인이 완성된 뒤에야 의미가 있고 없어도 제품이 성립한다.
- **클론 시 현실적 대안**: 자유 생성 대신 **템플릿 카탈로그 + LLM 매칭**("이 설명에 가장 가까운 사전 정의 템플릿 3개 제시 → 사용자가 선택 → 프로퍼티만 LLM이 조정"). 검증·롤백 문제가 대부분 사라지고 결과 품질은 오히려 안정적이다.
- **참고 출처**: https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai , https://developers.notion.com/guides/mcp/mcp-supported-tools , https://www.notion.com/help/autofill , https://www.notion.com/help/notion-agent

---

### F-10-16 파일·이미지 입력 분석 및 산출물 파일 생성

- **한 줄 정의**: PDF·이미지 등을 AI에 입력으로 주고, 반대로 스프레드시트·PDF·슬라이드덱 같은 **다운로드 가능한 파일**을 결과물로 받는다.
- **사용자 시나리오**:
  1. *입력*: AI 채팅/Research에 PDF 첨부 후 *"What are the main points from this Q3 sales report PDF?"*, 또는 제품 패키징 사진을 올리고 디자인 개선 질문.
  2. *출력*: "이 데이터를 스프레드시트로 만들어줘" → AI가 **컴퓨터 워크스페이스를 사용해 작업**하고 Notion 안에서 미리보기·다운로드 가능한 파일을 돌려준다. 공식 문언: *"create files you can download and preview within Notion"*, 대상 포맷으로 *spreadsheet, PDF, slide deck* 명시.
- **동작 상세**:
  - 입력 축과 출력 축이 다른 기술이다. **입력** = 파싱/OCR/비전 모델 + 청킹. **출력** = **샌드박스 컴퓨트 환경에서 코드를 실행해 실제 파일을 만드는 것**(텍스트 생성이 아님).
  - MCP 표면에도 파일 경로가 정식으로 존재한다: `notion-create-file-upload`(임시 업로드 URL 발급, **최대 20 MiB**), `notion-create-attachment`(텍스트/공개 URL/완료된 업로드로 첨부 생성, **텍스트 최대 200 KiB**), `notion-download-attachment`(UTF-8 텍스트 회수). [공식 확인]
  - 첨부 PDF는 F-10-10에서 이미 언급된 대로 **청킹 후 부분 참조**하며 전체를 프롬프트에 넣지 않는다.
  - **[2026-07 갱신] 포맷 범위가 Microsoft Office까지 확장됐다**: 에이전트가 **PPTX / XLSX / DOCX / PDF를 읽고 쓴다**. 공식 예시로 *"페이지를 PowerPoint로 변환"*, *"데이터베이스를 Excel 모델로 전환"*, 문서 요약이 명시된다. → 산출물 생성은 "텍스트를 파일로 저장"이 아니라 **구조 변환(블록 트리 → 슬라이드/시트 모델)** 이다. 클론 시사점: LLM에게 PPTX 바이너리를 만들게 하지 말고, **LLM은 중간 표현(슬라이드 배열·시트 행)만 산출하고 파일 조립은 결정적 라이브러리**(pptxgenjs / exceljs / docx)가 담당하게 하라 — 이 분리가 F-10-16의 XL을 M으로 낮추는 유일한 지렛대다. 출처: https://www.notion.com/releases/2026-07-01
  - 컴퓨트 실행 환경의 격리 수준·실행 시간 상한·네트워크 허용 여부는 **[확인필요]**(공식 미공개).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 20 MiB 초과 업로드 | 사전 차단(공식 상한). 클라이언트에서 크기 검사 |
  | 스캔 PDF(텍스트 레이어 없음) | OCR 필요 → 미지원이면 명시적 실패. 빈 텍스트로 조용히 진행하면 환각 |
  | 암호 걸린 PDF / 손상 파일 | 파싱 실패를 사용자에게 노출, 재시도 경로 제공 |
  | 이미지에 개인정보·얼굴 포함 | 비전 모델 전송 전 워크스페이스 데이터 공유 정책(F-10-12) 확인 |
  | 생성된 파일이 매우 큼 | 워크스페이스 파일 쿼터와 연동, 초과 시 생성 전 차단 |
  | 컴퓨트 작업이 무한 루프 | **실행 시간·CPU·메모리 하드 리밋 + 네트워크 차단**이 필수(임의 코드 실행이다) |
  | 생성 파일에 잘못된 데이터 | 출처 데이터 링크를 파일과 함께 제시해 검증 가능하게 |
  | 첨부 원본이 삭제된 뒤 재생성 | 참조 무효 → 재업로드 요구 |
  | 동시 다수 파일 생성 요청 | 컴퓨트 슬롯 큐잉 + 사용자당 동시 실행 제한 |

- **데이터 모델 함의**: `ai_attachment(id, session_id, kind enum(input, output), storage_ref, mime, bytes, page_ref NULL, expires_at)`, `ai_compute_run(id, session_id, code_ref, state, exit_code, stdout_ref, wall_ms, cpu_ms, produced_file_ids[])`. 입력 파일은 **텍스트 추출 결과를 별도 캐시**(`extracted_text_ref`, `text_hash`)해야 같은 파일 재질의 시 재파싱 비용이 0이 된다. 생성 파일은 일반 file 블록/스토리지 재사용.
- **UI/인터랙션**: 채팅 입력창의 클립 아이콘·드래그앤드롭, 첨부 칩(파일명·크기·제거), 이미지 인라인 썸네일, 결과 파일 카드(미리보기 + 다운로드), 컴퓨트 진행 표시.
- **의존 기능**: 파일 업로드·스토리지, F-10-09 스트리밍, F-10-12 쿼터(**컴퓨트 작업 단위 계량**), (출력) 샌드박스 실행 인프라.
- **구현 난이도**: 입력 분석 **M**(파서 + 비전 API + 청킹, 3~5일) / **출력 파일 생성 XL**(임의 코드 실행 샌드박스는 보안 경계를 새로 세우는 일이다 — 격리, 리소스 리밋, 네트워크 차단, 아티팩트 회수). **두 축을 하나의 난이도로 묶지 말 것.**
- **우선순위**: 입력 분석 **P1**(첨부 질의는 사용자 기대치가 이미 형성돼 있고 비용이 낮다) / 출력 파일 생성 **P2**(보안 위험 대비 초기 ROI 최저).
- **클론 시 현실적 대안**: 입력은 `pdf-parse`/`unstructured` + 비전 API 1개로 충분. **출력은 샌드박스를 직접 만들지 말고 라이브러리 직접 호출로 좁혀라** — "CSV/XLSX 생성"만 서버 코드로 고정 구현(LLM은 데이터 JSON만 산출, 파일 조립은 결정적 코드가 담당). 임의 코드 실행을 피하면 XL이 S로 내려간다.
- **참고 출처**: https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai , https://www.notion.com/help/notion-ai-faqs , https://developers.notion.com/guides/mcp/mcp-supported-tools

---

### F-10-17 AI 채팅 표면 (세션·히스토리·소스 범위)

- **한 줄 정의**: Q&A와 생성이 이어지는 **대화 컨테이너** 자체 — 진입점, 이전 대화 재방문, 소스 범위 지정, 모델 선택을 담당한다.
- **사용자 시나리오**:
  1. 우하단 원형 아이콘 또는 사이드바로 진입. 단축키 `Shift + Cmd + J`(Mac) / `Shift + Ctrl + J`(Windows).
  2. 질문 입력 → 답변 → **후속 질문이 같은 컨텍스트로 이어짐**.
  3. **"View History"** 클릭 → 이전 대화 목록에서 과거 세션 재개. [공식 확인]
  4. 소스 드롭다운("All sources")이나 `@`로 범위를 특정 페이지/DB/커넥터로 좁힘.
  5. 관리자가 허용한 모델 중 선택(프리미엄 모델은 기본 비활성).
- **동작 상세**:
  - 이 항목은 F-10-06(검색·답변 **파이프라인**)과 구분된다. F-10-06은 "어떻게 답을 찾는가", 이 기능은 "**대화가 어디에 살고 어떻게 다시 열리는가**"다. 초판은 이 둘을 하나로 묶어 **세션 영속화·히스토리 UI가 명세에서 누락**돼 있었다.
  - 세션은 서버 영속 객체다 — Agent API가 `query-sessions`, `retrieve-session`, `query-session-events`, `cancel-session`을 공개하는 것이 그 증거. [공식 확인]
  - MCP 도구에도 `notion-query-sessions` 계열이 있어 **외부 에이전트가 세션 이력을 조회**할 수 있다.
  - **[2026-01 갱신] 모델 전환이 세션을 깨지 않는다**: 모델 피커에서 GPT-5.2 / Claude Opus 4.5 / Gemini 3 / **Auto**를 고를 수 있고, 공식 문언상 **"Context and memory persist when switching between models"**. → 대화 컨텍스트는 특정 프로바이더 포맷이 아니라 **중립 표현으로 저장**되어야 하고, `model_id`는 **세션 속성이 아니라 턴(메시지) 속성**이어야 한다. 초판 스키마의 `ai_session.model_id`는 이 요구를 만족하지 못하므로 **`ai_message.model_id`로 내려라**(세션 레벨은 "기본값"으로만 유지). 출처: https://www.notion.com/releases/2026-01-20
  - **[2026-04 갱신] 입력·출력 표면 확장**: 프롬프트 **음성 입력**(마이크 버튼으로 받아쓰기), **문서 인라인 편집**(채팅에서 선택 영역을 직접 고치는 경로), Calendar·Mail·Slack 연결. 출처: https://www.notion.com/releases/2026-04-14
  - **[2026-01 갱신] 모바일 패리티**: 폼 생성·DB 생성·워크스페이스 검색을 포함해 **데스크톱과 동일 기능**을 모바일에서 수행. 클론 시사점: AI 진입점을 데스크톱 전용 사이드패널로 설계하면 나중에 통째로 다시 만들게 된다.
  - 대화 히스토리의 보존 기간·삭제 정책은 **[확인필요]**(FAQ 본문에 retention 언급 없음 — 2026-09 재확인. 릴리스 노트·크레딧 문서에도 언급 없음).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 과거 세션 재개 시 근거 페이지가 삭제됨 | 인용 칩을 "삭제됨"으로 렌더, 링크 비활성. 답변 본문은 보존 |
  | 과거 세션 재개 시 사용자 권한이 축소됨 | **저장된 답변에 이미 기밀이 들어 있다** → 세션 열람 권한은 세션 소유자로 한정하고, 재질의 시 권한 재평가 |
  | 대화가 수백 턴 | 컨텍스트 윈도우 초과 → 오래된 턴 요약 압축(rolling summary) |
  | 여러 기기에서 같은 세션 동시 사용 | `sequence` 기반 이벤트 스트림이므로 양쪽이 같은 순서를 봄. 동시 전송은 서버가 순서 확정 |
  | 세션 중간에 모델이 비활성화됨 | 진행 중 세션 유지, 다음 턴부터 기본 모델 폴백(F-10-12와 동일 규칙) |
  | 소스 범위로 지정한 DB가 삭제됨 | 범위에서 제거 + 사용자 고지 |
  | 세션 삭제 | 이벤트·인용까지 캐스케이드. 단 `ai_usage_ledger`는 **과금 기록이므로 남긴다**(감사 요구) |
  | 게스트 사용자 | 커넥터 소스 제외(공식 확인), 그 외 범위 **[확인필요]** |
  | 세션 도중 모델을 바꿈 | 컨텍스트·메모리 유지가 공식 동작 → 프로바이더별 원문 포맷으로 저장했다면 유지 불가. 중립 메시지 표현 + 턴별 `model_id` 필수 |
  | 새 모델의 컨텍스트 윈도우가 더 작음 | 전환 시 초과분을 요약 압축한 뒤 진행. 조용한 앞부분 절삭은 사용자가 눈치채지 못하는 품질 저하 |
  | 이전 턴이 tool_use를 포함하는데 새 모델이 해당 도구 미지원 | 도구 호출 이력은 텍스트 요약으로 강등해 전달 |
  | 음성 입력 중 마이크 권한 거부 | 텍스트 입력으로 폴백, 재요청 경로 제공 |
  | 음성 받아쓰기 오인식 | 전송 전 편집 가능한 텍스트로 먼저 삽입(즉시 전송 금지) |

- **데이터 모델 함의**: `ai_session`(위, `title` 자동요약 필드 추가 권고), `ai_session_event`, `ai_session_scope(session_id, source_kind enum(all, page, database, connector, web), source_id)` — **범위 지정은 세션 속성이지 메시지 속성이 아니다**(턴마다 바뀌면 별도 이력 필요). 목록 UI용 인덱스: `(user_id, workspace_id, updated_at DESC)`. 세션 소프트 삭제 `deleted_at`.
- **UI/인터랙션**: 우하단 플로팅 아이콘, 사이드바 패널, `Shift+Cmd/Ctrl+J`, View History 목록(제목 자동 생성·검색), 소스 드롭다운, `@` 멘션, 모델 피커, 세션 이름 변경·삭제, 답변별 복사/페이지에 삽입.
- **의존 기능**: F-10-09(이벤트·스트리밍), F-10-06(검색), F-10-12(모델 허용 목록), 권한 시스템.
- **구현 난이도**: **M** — 세션 CRUD + 히스토리 목록 + 범위 지정. F-10-09가 이벤트를 영속화해 두면 대부분 조회 UI다. 3~5일.
- **우선순위**: **P1** — Q&A(F-10-06)를 만들기로 했다면 히스토리 없는 챗은 즉시 불만이 나온다. 다만 F-10-06 자체가 P1이므로 동반 상승.
- **클론 시 현실적 대안**: 세션 제목은 첫 사용자 메시지 앞 40자로 자르고(LLM 요약 호출 생략), 범위 지정은 v1에서 "전체 / 현재 페이지" 2택으로 축소. 히스토리는 페이지네이션 없이 최근 50건.
- **참고 출처**: https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai , https://developers.notion.com/guides/notion-agent-apis/overview , https://www.notion.com/help/notion-ai-faqs , https://www.notion.com/releases/2026-01-20 , https://www.notion.com/releases/2026-04-14

---

### F-10-18 Notion MCP 서버 (외부 AI 에이전트의 워크스페이스 접근)

- **한 줄 정의**: Notion이 호스팅하는 원격 MCP 서버로, 외부 AI 클라이언트가 **사용자 권한 범위 안에서** 워크스페이스를 검색·읽기·쓰기 한다.
- **사용자 시나리오**:
  1. 사용자가 MCP 클라이언트(Claude 등)에서 Notion 커넥터를 추가 → **OAuth 인가**.
  2. 공식 문언: *"After you authorize a connection with OAuth, the MCP client can use Notion MCP tools to read and update content that you can access."* → **권한은 인가한 사용자의 권한을 그대로 상속**하며 그 이상은 불가.
  3. 이후 외부 에이전트가 도구를 조합해 검색·페이지 생성·DB 조회 등을 수행.
  4. 워크스페이스 소유자는 Settings → Connections에서 관리하고, Admin API(`list-mcp-client-connections`, `revoke-mcp-client-connection`, `update-mcp-client-connection-enterprise-managed-access`)로 조직 차원 통제.
- **동작 상세** ([공식 확인] 도구 목록):
  - **검색**: `notion-ai-search`(Notion + 연결 앱 시맨틱 검색), `notion-search`(키워드·필터·사용자 조회), `notion-search-skills`.
  - **읽기**: `notion-fetch`(URL/ID로 페이지·DB·데이터소스), `notion-query-data-sources`(**SQL 질의 / 행 읽기 / 저장된 뷰 실행**), `notion-query-meeting-notes`, `notion-get-comments`, `notion-get-teams`, `notion-get-users`.
  - **쓰기**: `notion-create-pages`, `notion-update-page`, `notion-move-pages`, `notion-duplicate-page`(비동기), `notion-create-database`, `notion-create-folder`, `notion-update-data-source`, `notion-create-view`, `notion-update-view`, `notion-create-comment`.
  - **파일**: `notion-create-file-upload`(≤20 MiB), `notion-create-attachment`(텍스트 ≤200 KiB), `notion-download-attachment`.
  - **비동기**: create/update 계열은 `allow_async: true` 지원 → `notion-get-async-task`로 폴링.
  - **레이트리밋**: 평균 **180 req/min/user**, 키워드 `notion-search`는 **30 req/min**.
  - **포맷**: 리치텍스트 프로퍼티는 **Notion 마크다운**을 사용해 멘션·링크·서식·인라인 날짜를 보존한다. → 순수 마크다운이 아니라 **왕복 손실이 없는 확장 문법**이 별도로 정의돼 있다는 뜻.
  - **플랜 의존**: AI 검색·Custom Agents·일부 질의 기능은 **Business/Enterprise + Notion AI** 필요.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 외부 에이전트가 권한 밖 페이지 요청 | 존재 자체를 숨긴 404 (403은 존재를 누설한다) |
  | 인가 사용자의 권한이 사후 축소 | **토큰이 아니라 매 호출 시점의 권한으로 평가** — 토큰 발급 시점 권한 캐시는 금지 |
  | 프롬프트 인젝션이 담긴 페이지를 에이전트가 읽음 | **페이지 본문은 데이터이지 지시가 아니다.** 쓰기 도구는 사용자 확인을 거치게 하고, 읽은 콘텐츠의 지시문을 실행하지 않도록 시스템 프롬프트에서 분리 |
  | 레이트리밋 초과 | 429 + `Retry-After`. 클라이언트는 지수 백오프 |
  | 대량 페이지 복제/이동 | 비동기 태스크 + 폴링. 동기 타임아웃으로 처리하면 부분 이동 상태가 남음 |
  | 토큰 유출 | Admin API로 즉시 revoke 가능해야 함. 커넥션 단위 취소가 최소 단위 |
  | 20 MiB / 200 KiB 초과 | 사전 거부 |
  | Notion 마크다운을 모르는 클라이언트가 평문 전송 | 멘션·인라인 날짜가 평문으로 굳음 → 손실. 왕복 시 원본 포맷 보존 규칙 필요 |

- **데이터 모델 함의**: `mcp_connection(id, workspace_id, user_id, client_name, oauth_grant_ref, scopes[], enterprise_managed bool, created_at, revoked_at)`, `mcp_call_log(connection_id, tool_name, args_digest, resource_refs[], result_status, latency_ms, created_at)` — **감사 로그는 선택이 아니다**(외부 에이전트의 쓰기를 사후 추적할 유일한 수단). 레이트리밋용 `rate_bucket(connection_id|user_id, tool_class, window, count)`. 도구 정의 자체는 `tool_registry(name, input_schema jsonb, required_capability, plan_requirement)`로 두면 플랜별 노출 필터링이 선언적으로 끝난다.
- **UI/인터랙션**: Settings → Connections(연결된 클라이언트 목록·마지막 사용 시각·Revoke), OAuth 동의 화면(요청 스코프 명시), Enterprise 관리자용 승인 정책, 쓰기 작업 확인 프롬프트.
- **의존 기능**: OAuth 서버, 권한 시스템(호출 시점 평가), 공개 API 도메인, 레이트리밋 인프라, F-10-06(ai_search 노출 시).
- **구현 난이도**: **L** — MCP 프로토콜 자체는 얇다(도구 스키마 + JSON-RPC). 비용은 **기존 API를 에이전트가 쓰기 좋은 입도로 재설계**하는 데 있다(도구 25개는 REST 엔드포인트의 단순 래핑이 아니라 의도 단위로 재구성된 것). 기존 REST API가 있다면 5~10일.
- **우선순위**: **P2** — 클론의 자체 가치와 무관. 단 **에코시스템 확장 시 가장 레버리지가 큰 단일 기능**이며, 자체 AI 모델 운영 비용이 0이다(연산은 외부 클라이언트가 부담).
- **클론 시 현실적 대안**: 25개 다 만들지 말고 **`search` / `fetch` / `create-page` / `update-page` 4개로 시작**. `@modelcontextprotocol/sdk`로 원격 서버를 세우고 인증은 기존 OAuth 재사용. **읽기 전용으로 먼저 출시**하면 프롬프트 인젝션 위험이 거의 사라진다.
- **참고 출처**: https://developers.notion.com/guides/mcp/mcp-supported-tools , https://developers.notion.com/docs/mcp , https://developers.notion.com/guides/mcp/mcp-security-best-practices

---

### F-10-19 Notion Skills (재사용 가능한 워크플로 지시문)

- **한 줄 정의**: **일반 페이지에 `is_skill` 플래그를 세워** 반복 워크플로의 지시문으로 삼고, 에이전트가 이를 검색해 따르게 한다.
- **사용자 시나리오**:
  1. 사용자가 "주간 리포트 작성 절차" 같은 페이지를 평소처럼 작성.
  2. 그 페이지를 Skill로 전환 — `notion-convert-page-to-skill`에 페이지 URL 전달(**편집 권한 필요**), 또는 생성 시 `notion-create-pages`에 `is_skill: true`. 해제는 `notion-update-page`에 `is_skill: false`.
  3. 이후 사용자가 "주간 리포트 만들어줘"라고 하면, 에이전트가 `notion-search-skills`(이름 또는 **작업 설명**으로 검색, 질의 생략 시 최근 목록)로 해당 Skill을 찾는다.
  4. 검색 결과에는 **이름·URL·설명만** 오고 전문은 오지 않는다 → 에이전트가 `notion-fetch`로 본문을 읽은 뒤 절차를 따른다.
- **동작 상세** ([공식 확인]):
  - 공식 정의: *"a page you own with instructions for a repeatable workflow"*. 별도 엔티티가 아니라 **페이지의 불리언 속성**이라는 점이 설계상 핵심 — 권한·버전·협업·검색이 전부 페이지 시스템에서 공짜로 따라온다.
  - **검색과 로딩이 2단계로 분리**돼 있다(메타데이터 검색 → 본문 fetch). 컨텍스트 윈도우 절약 + 무관한 지시문의 프롬프트 오염 방지.
  - **안전 규칙이 명문화돼 있다**: Skill은 사용자 요청이 그 워크플로에 실제로 부합할 때만 따라야 하며, **Skill을 편집·검토·설정하는 맥락에서는 실행 가능한 지시가 아니라 일반 콘텐츠로 취급**한다. → 프롬프트 인젝션 방어의 핵심 원칙(같은 텍스트를 "지시"로 읽을지 "데이터"로 읽을지가 **맥락에 따라 달라져야 한다**).
  - 작성 가이드는 `notion-fetch`로 `notion://docs/skills`를 읽어 참조 — **내부 문서를 도구로 노출하는 패턴**.
  - Skill 개수 상한 등 제한은 **[확인필요]**(문서에 명시 없음).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Skill 페이지에 권한 없는 사용자가 트리거 | 검색 결과에서 제외(권한 필터는 페이지 시스템 그대로) |
  | Skill 본문이 악의적 지시를 포함 | **가장 위험한 경로** — Skill은 사실상 "저장된 프롬프트"다. 편집 권한 = 지시문 주입 권한이므로 **누가 Skill을 만들 수 있는지 통제**가 필요 |
  | Skill이 다른 Skill을 참조 | 순환 참조 가능 → **참조 깊이 상한 + 방문 집합**으로 차단 |
  | 유사한 Skill 여러 개 매칭 | 상위 N개 제시 후 사용자 확인. 임의 선택은 조용한 오작동 |
  | Skill 페이지가 실행 중 수정됨 | fetch 시점 스냅샷으로 1회 실행 완주(중간에 지시가 바뀌면 비결정적) |
  | Skill 삭제 후 에이전트가 참조 | 404 → 명시적 실패, 기억에 의존한 임의 진행 금지 |
  | Skill이 아주 긴 페이지 | fetch 시 컨텍스트 초과 → 길이 상한 경고 |
  | Skill 페이지를 편집하려는 요청 | **지시로 실행하지 말고 콘텐츠로 편집**(공식 규칙) |

- **데이터 모델 함의**: **신규 테이블 불필요** — `page.is_skill boolean default false` 컬럼 하나 + 검색용 부분 인덱스 `WHERE is_skill`. 부가 권고: `page.skill_description text`(검색 결과에 노출할 요약, 본문 미로드 상태에서 매칭에 사용), `skill_invocation_log(skill_page_id, session_id, invoked_at)`(어떤 Skill이 실제로 쓰이는지 관측). **이 기능의 교훈은 "AI 자산을 새 엔티티로 만들지 말고 기존 문서 시스템에 플래그로 얹으라"** 는 것이다.
- **UI/인터랙션**: 페이지 `•••` 메뉴의 "Skill로 전환" 토글, Skill 배지, Skill 목록 뷰(설명·최근 사용), 에이전트 실행 로그에 "사용한 Skill" 표시.
- **의존 기능**: 페이지·권한 시스템(전부 재사용), 검색(F-10-06 또는 단순 텍스트 검색), F-10-13 에이전트 / F-10-18 MCP(소비 측).
- **구현 난이도**: **S** — 불리언 컬럼 + 검색 필터 + 2단계 로딩 규약. 1일. **단 안전 규칙(맥락별 지시/데이터 구분)을 프롬프트 계층에 심는 설계 판단이 진짜 작업**이며 이건 코드량이 아니다.
- **우선순위**: **P2** — 에이전트(F-10-13)나 MCP(F-10-18)가 없으면 소비자가 없다. 다만 **둘 중 하나라도 만든다면 즉시 P1로 승격**할 만큼 비용 대비 효과가 크다.
- **클론 시 현실적 대안**: 그대로 구현해도 부담이 없는 드문 기능. 축소한다면 검색을 생략하고 **사용자가 `@`로 Skill 페이지를 직접 지정**하게 하라(자동 매칭의 오작동 위험이 사라진다).
- **참고 출처**: https://developers.notion.com/guides/mcp/notion-skills , https://developers.notion.com/guides/mcp/mcp-supported-tools

---

### F-10-20 에이전트 세션 API + 휴먼 승인 게이트 (HITL)

- **한 줄 정의**: 에이전트 실행을 **프로그래밍 가능한 세션 객체**로 노출하고, 위험한 단계 앞에서 세션을 멈춰 사람의 승인을 받는다.
- **사용자 시나리오**:
  1. 외부 시스템이 `POST /v1/sessions`로 세션을 시작하며 메시지 전송(`message` **maxLength 10000**). `session_id`를 생략하면 새 세션, 포함하면 이어가기.
  2. `Accept: text/event-stream` 헤더를 주면 JSON 대신 **SSE 스트림**으로 턴을 수신.
  3. 에이전트가 민감한 작업에 도달 → 세션이 **`requires_action`** 이 되고 `required_actions[]`(각 `action_id` + approve/reject 계열 `option_id`)가 도착.
  4. 사람이 승인 → `session_id` + `actions[{action_id, option_id}]` 제출 → 세션 재개.
  5. 완료/실패/취소 시 `query-session-events`로 전체 타임라인을 페이징 조회(감사).
- **동작 상세** ([공식 확인], public beta):
  - 세션 상태 7종: `queued`, `in_progress`, `requires_action`, `completed`, `failed`, `canceled`, `terminated`.
  - 이벤트 6종: `user.message`, `agent.message`, `agent.thinking`, `agent.tool_use`, `agent.tool_result`, `session.status`. 각 이벤트는 `id`·`type`·`sequence`·`created_at`으로 **and/or 중첩 필터** 조회 가능.
  - `continue_from`으로 특정 이벤트 이후를 **재생(replay)** — SSE 응답에서만 유효.
  - 인증: personal access token 또는 **"Interact with agents" capability**를 가진 connection token. 권한 3단: read(조회) / edit(상태 변경·삭제) / full(크레딧 한도, 없으면 `hidden`).
  - 취소: `cancel-session`으로 진행 중 세션 중단.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 승인 없이 무기한 대기 | **승인 TTL** 필요. 만료 시 `canceled` + 부분 결과 보존 여부 정책화 |
  | 같은 `action_id`에 상반된 응답 2건 | 선착순 확정 후 멱등 처리. 나중 요청은 현재 상태 반환 |
  | 승인자가 에이전트 권한보다 낮은 권한 | 승인은 **에이전트 권한을 확대하지 못한다** — 승인자 권한 ∩ 에이전트 권한으로 실행 |
  | 취소했는데 도구 호출이 이미 나감 | 외부 부작용은 되돌릴 수 없다 → `agent.tool_use` 이벤트를 **호출 전에** 기록해야 사후 추적이 가능 |
  | SSE 재접속 시 `continue_from` 누락 | 전체 재전송으로 중복 렌더 → 클라이언트가 마지막 `sequence`를 반드시 보관 |
  | 세션 폭주(트리거 다발) | 에이전트당 동시 세션 상한 + 큐잉 |
  | beta API 스펙 변경 | **[확인필요]** public beta이므로 필드·상태값이 바뀔 수 있다 — 클론이 이 enum을 그대로 채택하되 자체 버전 게이트를 둘 것 |
  | 이벤트 시퀀스에 구멍 | 서버 측 단조 증가 보장(DB 시퀀스). 애플리케이션 카운터는 동시성에서 깨진다 |

- **데이터 모델 함의**: `ai_session`(status 7값 + `required_actions jsonb` + `agent_id NULL`), `ai_session_event(id, session_id, type, sequence BIGSERIAL, payload jsonb, created_at)` — **`sequence`는 세션 단위 단조 증가**여야 하고(`UNIQUE(session_id, sequence)`), 조회 인덱스는 `(session_id, sequence)`. 승인용 `session_action(id, session_id, action_id, options jsonb, chosen_option_id NULL, decided_by, decided_at, expires_at)`. **이벤트는 append-only로 두고 절대 UPDATE 하지 말 것** — 감사·재생이 둘 다 깨진다.
- **UI/인터랙션**: (API 우선 기능) 승인 요청 알림·인박스 카드(무엇을 하려는지 + Approve/Reject), 세션 타임라인 뷰(thinking 접기/펼치기, tool_use 상세), 취소 버튼, 이벤트 필터.
- **의존 기능**: F-10-09(SSE·이벤트 영속화), F-10-13(에이전트 정의), 권한 시스템, F-10-12(크레딧 정산), 알림 시스템(승인 요청 전달).
- **구현 난이도**: **L** — 상태 기계와 append-only 이벤트 로그 자체는 명확하다(스펙이 공개돼 있어 설계 리스크가 낮은 편). 비용은 **승인 대기 중 세션의 수명 관리(TTL·재개·정산)** 와 **취소 시 외부 부작용 처리**. 6~10일.
- **우선순위**: **P2** 전반. 단 **`ai_session_event`의 `sequence` 컬럼과 append-only 규약만은 P0로 앞당길 것** — 나중에 넣으면 스트리밍·감사·재생을 전부 재작성해야 한다. 이 문서에서 "지금 당장 안 만들어도 되지만 스키마만은 지금 잡아야 하는" 유일한 항목이다.
- **클론 시 현실적 대안**: 공개 API는 만들지 말고 **내부 구조만 채택**하라(세션 상태 7값 + 이벤트 6종 + sequence). 승인 게이트는 "쓰기 작업 전 모달 확인" 한 종류로 축소하면 `session_action` 테이블 없이 클라이언트 왕복만으로 끝난다.
- **참고 출처**: https://developers.notion.com/guides/notion-agent-apis/overview , https://developers.notion.com/reference/notion-agent-apis/update-session , https://developers.notion.com/reference/notion-agent-apis/query-session-events , https://developers.notion.com/reference/notion-agent-apis/cancel-session

---

### F-10-21 Notion Agent (개인 에이전트 — 사용자 권한으로 다단계 작업 수행)

- **한 줄 정의**: 사용자와 **동일한 권한**을 가진 AI 팀메이트가 워크스페이스와 연결된 앱을 넘나들며 여러 단계짜리 작업을 대신 수행한다.
- **사용자 시나리오**:
  1. 사이드바/우하단 진입점에서 Agent에게 지시: *"Company Goals·Jira epics·지난 분기 리뷰를 참고해 Q1 OKR 초안을 만들고, 측정 가능한 KR과 출처 링크를 붙여줘."*
  2. Agent가 **여러 소스를 스스로 검색 → 읽기 → 초안 작성 → 페이지 생성**을 연쇄 수행.
  3. 이메일 전송 같은 **쓰기 작업 직전에는 확인을 요구**하고, 대부분의 문서 편집은 확인 없이 진행.
  4. 결과 확인 후 이어서 지시(대화 지속), 필요하면 Instructions 페이지(F-10-22)에 규칙을 추가.
- **동작 상세**:
  - **권한 모델이 핵심**: 공식 문언상 Agent는 *"has the same permissions you do"* — **별도 principal이 아니라 사용자 신원의 위임 실행**이다. 이 점이 F-10-13 Custom Agent(자율 백그라운드 프로세스, 명시적으로 부여된 리소스만)와 **정반대의 설계 선택**이다. 클론은 두 모델을 섞지 말고 `actor_kind enum(user_delegated, autonomous)`로 분기해야 한다.
  - 가능한 것: 페이지·데이터베이스 생성/수정(**view, form, property 포함**), 워크스페이스 및 연결 앱 검색, 인박스 알림 정리, Gmail 처리, 캘린더 일정 잡기, 데이터 분석, 파일(PDF·CSV 등) 취식.
  - **불가능한 것(공식 명시)**: **automation, template, formula 등 advanced property는 만들지 못한다.** → "선언적 구조는 만들고 실행 로직은 만들지 않는다"는 경계(F-10-15와 동일).
  - 승인: *"requires confirmation before writing actions (like sending emails)"* — 대부분의 편집은 무승인, **파일 조작과 일부 쓰기 작업은 사용자 동의**를 요구. 즉 승인 게이트는 전부/전무가 아니라 **작업 종류별 정책 테이블**이다.
  - 플랜: Business/Enterprise에 usage allowance 포함. **프리미엄 모델은 크레딧 + 관리자 승인** 필요.
  - 표면: 2026-01부터 **모바일에서 데스크톱과 동일 기능**(폼·DB 생성, 검색), 2026-04부터 **음성 입력**과 **문서 인라인 편집**.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 사용자 권한을 넘는 페이지 참조 요청 | 위임 실행이므로 **자동으로 불가** — 권한 검사를 에이전트 계층에 따로 만들지 말고 기존 사용자 권한 경로를 그대로 태울 것(중복 구현이 곧 우회 경로가 된다) |
  | 다단계 실행 중 사용자 권한이 축소됨 | **단계마다 재검증**. 시작 시점 권한 스냅샷으로 끝까지 진행하면 권한 우회 |
  | 승인 요구 작업과 무승인 작업이 한 계획에 섞임 | 계획을 승인 단위로 쪼개고, 승인 대기 중 나머지 단계는 **차단**(먼저 실행 후 사후 승인 금지) |
  | 외부 부작용(메일 발송) 후 사용자가 취소 | 되돌릴 수 없음 → `agent.tool_use`를 **호출 직전에 기록**(F-10-20과 동일 규칙) |
  | 3단계 중 2단계에서 실패 | 부분 산출물이 남는다 → 무엇이 만들어졌는지 목록으로 제시 + 롤백 선택지 |
  | formula/automation 생성을 요구받음 | 공식 제약 — **명시적으로 "불가"라고 답할 것**. 유사 기능을 몰래 흉내내면(예: 자동화 대신 반복 스케줄 에이전트) 사용자 기대가 깨진다 |
  | 같은 사용자가 동시에 여러 Agent 작업 실행 | 사용자당 동시 실행 상한 + 같은 리소스를 만지는 작업 직렬화(경합 시 후행 작업 대기) |
  | 대화 컨텍스트가 매우 길어짐 | rolling summary 압축(F-10-17과 동일) |
  | 연결 앱 토큰 만료 | 해당 도구만 비활성화하고 나머지 단계는 계속. 전체 실패로 처리하면 사용자 경험이 급격히 나빠진다 |
  | 크레딧/할당량 소진 | 계획 수립 **전에** 차단. 다단계 실행 중간 중단이 최악 |

- **데이터 모델 함의**: `ai_session(surface=agent_run, actor_kind=user_delegated, acting_user_id)` — 별도 agent 테이블 없이 **사용자 위임 세션**으로 표현하는 것이 정합적. 승인 정책은 `agent_action_policy(action_kind enum(page_write, db_write, file_op, email_send, calendar_write, external_tool), requires_confirmation bool, scope)`, 실제 승인 기록은 F-10-20의 `session_action` 재사용. 계획/단계는 F-10-10의 `ai_step` 재사용(`kind`에 `plan`, `act` 추가). 개인화는 F-10-22의 `user_ai_instructions`. **새 테이블은 `agent_action_policy` 하나면 충분하다** — 나머지는 전부 기존 세션/스텝/승인 스키마 재사용이며, 이 재사용이 가능하도록 F-10-09/F-10-20을 먼저 설계하라는 것이 이 문서 전체의 결론이다.
- **UI/인터랙션**: 사이드바 Agent 패널, 음성 입력 마이크 버튼, 계획 미리보기, 단계별 진행 로그(도구 호출 접기/펼치기), 승인 모달(무엇을 어디에 쓸 것인지 명시), 결과 페이지 링크, 모바일 동일 진입점.
- **의존 기능**: F-10-09(스트리밍·이벤트), F-10-20(승인 게이트), F-10-06(검색), F-10-15(구조 생성), F-10-22(Instructions), F-10-12(크레딧·모델 허용), 권한 시스템, 커넥터/연결 앱.
- **구현 난이도**: **XL** — 도구 사용 루프 + 단계별 권한 재검증 + 작업 종류별 승인 정책 + 부분 실패 복구가 한 덩어리다. 개별 도구(검색·페이지 생성)는 이미 있어도, **"여러 도구를 안전하게 엮는 계층"** 자체가 새 서브시스템이다.
- **우선순위**: **P2** — 다만 **클론이 "AI 노션"을 표방한다면 최종 목표 지점**. P0~P1을 다 만든 뒤에야 안전하게 얹을 수 있다.
- **클론 시 현실적 대안**: 자유 도구 루프 대신 **화이트리스트 도구 3개(검색 / 페이지 생성 / 프로퍼티 수정) + 최대 5스텝 + 쓰기 전 항상 확인**으로 시작. "계획을 먼저 보여주고 사용자가 승인한 계획만 실행"하는 **plan-then-execute 2단계**가 자율 루프보다 구현·신뢰 양쪽에서 우월하다.
- **참고 출처**: https://www.notion.com/help/notion-agent , https://www.notion.com/releases/2026-01-20 , https://www.notion.com/releases/2026-04-14

---

### F-10-22 Agent Instructions 페이지 (개인화 메모리)

- **한 줄 정의**: 사용자가 지정한 **일반 Notion 페이지 한 장**을 에이전트의 상시 지시문·기억 저장소로 삼아 모든 대화의 기본 동작(톤·형식·우선 참조 소스)을 고정한다.
- **사용자 시나리오**:
  1. Settings → Notion AI → **Add Instructions**로 새로 만들거나(기본 비공개 "My Notion AI" 페이지), 기존 페이지 `•••` → **Use with AI → Set as Notion AI Instructions**로 지정.
  2. 페이지에 규칙을 적는다: 말투, 문서 포맷, 자신의 역할·팀 맥락, **먼저 봐야 할 페이지/Slack 채널/파일**.
  3. 이후 **모든 채팅이 이 페이지를 항상 참조**한다.
  4. 대화하며 지시가 누적되고(메모리처럼 성장), Settings → Notion AI → General에서 다른 페이지로 교체 가능.
- **동작 상세**:
  - 공식 제약: **한 번에 하나만 활성**(*"You can only use one Instructions page at a time, but you can switch it anytime"*).
  - **적용 범위는 개인 Agent 한정** — 공식 FAQ에 *"Do my Notion Agent Instructions affect Custom Agents? No."* 라고 명시. Custom Agent는 자체 Instructions를 갖는다(F-10-13).
  - **공유해도 전파되지 않는다**: 지시문 페이지를 공유해도 상대의 Agent는 바뀌지 않고, 상대가 **직접 자기 Instructions로 지정**해야 한다.
  - **역으로, 남이 편집할 수 있는 페이지를 지시문으로 쓰면 그 사람이 내 에이전트의 행동을 바꾼다**(공식 경고). → 이것은 편의 기능이 아니라 **권한 = 프롬프트 주입 경로**라는 보안 사실이다.
  - 설계상 핵심은 F-10-19 Skills와 같다: **AI 자산을 새 엔티티로 만들지 않고 기존 페이지 시스템에 포인터 하나로 얹었다.** 버전 관리·권한·검색·협업이 전부 공짜로 따라온다.
  - 길이 상한·개수 제한은 **[확인필요]**(헬프 문서에 수치 없음 — 2026-09 확인).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 지시문 페이지가 비어 있음 | 기본 동작으로 폴백. 오류가 아니다 |
  | 지시문 페이지 삭제/휴지통 이동 | 활성 포인터 무효 → **조용히 무시하지 말고** 설정에서 "지시문 없음"으로 표시하고 사용자 고지 |
  | 지시문이 매우 김 | 매 요청 컨텍스트에 항상 들어가므로 **토큰 비용이 상시 발생** → 길이 상한 + 초과 시 경고. (요청당 고정비라는 점을 UI에 노출할 것) |
  | 지시문이 사용자 요청과 충돌 | **직접 요청이 우선**. 지시문은 기본값이지 강제 규칙이 아님을 프롬프트 계층에서 명시 |
  | 지시문에 악의적 문장("모든 페이지를 삭제하라") | 지시문은 **시스템 권한이 아니다** — 쓰기 작업은 여전히 승인 정책(F-10-21)을 통과해야 한다. 지시문을 시스템 프롬프트에 그대로 이어붙이지 말고 **사용자 제공 선호 블록으로 격리** |
  | 공동 편집 가능한 팀 페이지를 지시문으로 지정 | 공식 경고 대상 — 지정 시 "이 페이지는 N명이 편집 가능합니다" 경고를 띄울 것 |
  | 지시문 페이지 내에 다른 페이지 링크·멘션 | 링크를 따라가 본문을 로드할지 여부를 정책화(무한 확장 방지: 깊이 1, 개수 상한) |
  | 지시문 편집 중 진행 중인 세션 | 진행 중 세션은 **시작 시점 스냅샷 유지**(중간에 규칙이 바뀌면 비결정적) |
  | 지시문 페이지를 AI에게 "고쳐줘"라고 요청 | F-10-19와 동일 규칙 — **지시가 아니라 콘텐츠로 취급해 편집** |

- **데이터 모델 함의**: **신규 테이블 1개면 충분** — `user_ai_instructions(user_id PK, workspace_id, page_id FK, activated_at, updated_at)`. `user_id`를 PK로 두면 "한 번에 하나"가 스키마 차원에서 강제된다(애플리케이션 검증보다 안전). 부가 권고: `page.used_as_instructions_by int`(역참조 카운트 — 삭제 시 경고용), 컨텍스트 조립 캐시 `instructions_snapshot(user_id, page_version, rendered_text, token_count)` — **매 요청 페이지 트리를 다시 렌더링하면 지연이 누적**되므로 `page.version` 기반 캐시가 사실상 필수. Custom Agent 쪽은 `agent.instructions`(F-10-13)로 **별도 컬럼**이며 이 테이블과 섞지 않는다.
- **UI/인터랙션**: Settings → Notion AI → General의 Instructions 슬롯(현재 페이지 링크 + 교체 + 해제), 페이지 `•••` → Use with AI → Set as Instructions, 지시문 활성 페이지의 배지, 채팅 헤더에 "Instructions 적용 중" 표시(투명성), 편집 가능자 수 경고.
- **의존 기능**: 페이지·권한 시스템(전부 재사용), F-10-17(채팅 컨텍스트 조립), F-10-21(개인 Agent). Custom Agent(F-10-13)와는 **무관**(공식 확인).
- **구현 난이도**: **S** — 포인터 컬럼 1개 + 컨텍스트 조립 시 앞단 삽입 + 설정 UI. 1~2일. **단 "지시문을 시스템 프롬프트와 분리해 격리한다"는 프롬프트 계층 설계 판단이 실질 작업**이며 이건 코드량이 아니다.
- **우선순위**: **P1** — 구현 비용 대비 체감 효과가 이 문서에서 가장 높은 항목 중 하나. 채팅(F-10-17)이 있으면 즉시 얹을 수 있고, 사용자가 "이 AI가 나를 안다"고 느끼는 유일한 저비용 경로다.
- **클론 시 현실적 대안**: 그대로 구현해도 부담이 없다. 더 줄이려면 페이지 대신 **설정 화면의 텍스트 영역 하나**(2000자 상한)로 시작 — 다만 페이지 기반의 이점(협업·버전·권한)이 사라지므로, 페이지 시스템이 이미 있다면 축소할 이유가 없다.
- **참고 출처**: https://www.notion.com/help/instructions-for-notion-agent , https://www.notion.com/help/notion-agent , https://www.notion.com/releases/2026-04-14

---

### F-10-23 External Agents (Claude·Cursor를 워크스페이스 팀메이트로)

- **한 줄 정의**: 외부 제공자가 실행하는 AI 에이전트를 Notion 안에 **멘션 가능한 팀메이트**로 등록해, 보드 칼럼 이동이나 댓글 멘션으로 작업을 넘기고 실행 과정을 인라인으로 지켜본다.
- **사용자 시나리오**:
  1. 사이드바 **Agents → New Agent → Claude** (템플릿 선택 또는 처음부터 구성). Enterprise·HIPAA 워크스페이스는 **기본 비활성**이라 소유자가 먼저 켜야 한다.
  2. 접근 리소스와 트리거·스케줄을 설정.
  3. 실행 방법 2가지: **① 태스크 카드를 "Ready for Agent" 칼럼으로 드래그**(가장 흔한 트리거 — 팀이 이미 일하는 방식에 얹힌다), **② 태스크 댓글에 `@Claude` 멘션**(칼럼 이동이 어색하거나 실행 전 맥락을 덧붙일 때).
  4. 에이전트가 진행 상황을 **같은 태스크에 댓글로 보고**하고, 사용자는 실행 중에도 댓글로 방향을 바꿀 수 있다.
- **동작 상세**:
  - 공식 위치: *"bring tools like Claude and Cursor into Notion as teammates"* — Claude와 Cursor가 최초 두 External Agent.
  - **권한**: *"Permissions are set per agent and aren't inherited from whoever starts a run"* + *"Claude agents can only see what you share with them."* → **실행자의 권한으로 승격되지 않는다.** F-10-21(사용자 위임)과 정반대이며 F-10-13(자율 프로세스)과 같은 계열이다.
  - **능력**: Notion 안에서 대화·질의응답, (편집 권한이 있으면) 콘텐츠 생성·수정, 연결된 **GitHub 저장소 읽기**, **PR 생성**(diff·스크린샷 포함), 큰 일을 작은 태스크 카드로 분해(각각 기술 계획 포함), 페이지에서 **PowerPoint·Excel 산출물 생성**.
  - **명시적 제약**: 세션 중 **웹 브라우징 불가**, **다른 에이전트 호출 불가**.
  - **과금**: Notion credits, **런 단위 과금**, 단가는 Custom Agents와 동일. *"Tasks with more steps, more reading, or more tool use cost more credits."* **개인 Anthropic 계정 불필요.**
  - **데이터 보존**: *"don't support zero data retention"* — Anthropic이 Claude Managed Agents 구조의 일부로 세션 데이터를 보관. **ZDR이 필요한 워크스페이스는 이 기능을 못 쓴다**는 뜻이며, 이것이 Enterprise·HIPAA 기본 비활성의 이유로 보인다 **[추정]**.
  - **인프라**: *"hosted by Notion via Anthropic's infrastructure"* — 사용자는 외부 도구를 오가지 않지만 **실행 주체는 외부**다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 권한이 큰 사용자가 카드를 칼럼에 넣음 | 에이전트 권한은 **그대로** — 실행자 권한 상속 금지(공식). 이 규칙이 무너지면 칼럼 드래그가 곧 권한 상승 경로가 된다 |
  | 여러 사람이 동시에 같은 카드를 트리거 | 카드 단위 멱등 키 + 실행 중 재트리거 무시(또는 큐잉). 중복 PR 생성은 실제로 발생하는 사고 |
  | 에이전트가 PR을 열었는데 태스크가 삭제됨 | 외부 부작용은 남는다 → 태스크 삭제 시 진행 중 런을 취소하고 사용자에게 외부 산출물 링크 고지 |
  | ZDR 요구 워크스페이스 | 기능 자체 차단(정책 게이트). 사후 경고가 아니라 **생성 시점에 막아야** 한다 |
  | 웹 정보가 필요한 작업 지시 | 능력 밖임을 명시적으로 응답. 조용한 환각 금지 |
  | 에이전트가 다른 에이전트를 부르려 함 | 공식 불가 — 클론도 초기엔 **에이전트 체이닝 금지**가 안전(루프·비용 폭발의 최단 경로) |
  | 실행 중 사용자가 댓글로 방향 변경 | 진행 중 세션에 사용자 메시지를 주입(F-10-09의 `user.message` 이벤트). 다음 스텝부터 반영 |
  | 외부 제공자 장애 | 런을 `failed`로 정리 + 크레딧 미청구. 외부 실행이므로 **타임아웃 상한이 반드시 필요** |
  | 크레딧 소진 상태에서 칼럼 이동 | 카드를 되돌리지 말고 **"에이전트 미실행" 상태를 카드에 표시**(조용한 무동작이 최악) |
  | 저장소 접근 권한 없이 코드 작업 지시 | 명시적 실패 + 필요한 연결 안내 |

- **데이터 모델 함의**: F-10-13의 `agent` 테이블을 공유하되 `runtime=external`, `external_provider enum(claude, cursor, …)`, `data_retention_mode=provider_retained`, `capabilities jsonb {web_browsing:false, agent_chaining:false}`(능력 제약을 **데이터로** 두면 UI가 자동으로 정확해진다). 트리거는 `agent_trigger(kind=board_column_enter, config{database_id, column_property_id, target_option_id})` 와 `kind=comment_mention`. 실행 귀속은 `agent_run_binding(session_id, source_kind enum(task_card, comment), source_id, idempotency_key)` — **카드 단위 멱등성**이 중복 실행을 막는 핵심. 외부 산출물 추적 `external_artifact(session_id, kind enum(pull_request, file, page), url, created_at)`. 정책 게이트 `workspace_ai_policy(allow_external_agents bool, require_zdr bool)`.
- **UI/인터랙션**: 사이드바 Agents 목록, New Agent → 제공자 선택, "Ready for Agent" 칼럼 규약(보드 뷰 설정), 댓글 `@에이전트` 멘션 자동완성, 태스크 내 실행 타임라인(댓글 스레드로 표현), 실행 중 배지, 중단 버튼, 소유자용 기능 on/off 토글.
- **의존 기능**: F-10-13(에이전트 정의·권한), F-10-20(세션·이벤트), 댓글 시스템, 데이터베이스 보드 뷰 + 프로퍼티 변경 이벤트, OAuth/외부 실행 연동, F-10-12(런 단위 과금).
- **구현 난이도**: **XL** — "외부 모델을 부른다"가 아니라 **외부 실행 주체를 워크스페이스 권한 모델 안에 안전하게 앉히는 일**이다. 멱등성·타임아웃·외부 부작용 추적·보존 정책 게이트가 전부 새로 필요하다.
- **우선순위**: **P2** — 클론 초기 가치와 무관. 단 **F-10-18(MCP)을 이미 만들었다면 방향이 반대인 쌍둥이 기능**이다(MCP=밖에서 안으로, External Agent=안에서 밖으로). 둘을 같은 도구/권한 레지스트리 위에 세우면 중복이 크게 준다.
- **클론 시 현실적 대안**: 보드 칼럼 트리거만 만들고 멘션은 생략. 외부 실행은 **웹훅 1개**로 축소(카드가 칼럼에 들어오면 페이로드 POST → 외부가 결과를 댓글 API로 회신). 이러면 에이전트 런타임을 직접 호스팅할 필요가 없고, 멱등 키와 타임아웃만 지키면 된다.
- **참고 출처**: https://www.notion.com/help/use-claude-agents-in-notion , https://www.notion.com/help/guides/how-to-set-up-claude-agents-on-your-teams-notion-task-board , https://www.notion.com/releases/2026-07-01 , https://www.notion.com/help/category/external-agents

---

### F-10-24 AI 생성 인터랙티브 HTML 블록

- **한 줄 정의**: 에이전트(또는 사용자)가 만든 HTML 파일을 페이지 안에서 **샌드박스 iframe으로 실행 렌더링**하는 블록 — ROI 계산기·퀴즈·조직도 같은 작동하는 위젯이 문서 안에 산다.
- **사용자 시나리오**:
  1. 에이전트에게 *"이 가격 정책으로 ROI 계산기를 만들어줘"* 요청 → 에이전트가 HTML을 생성해 페이지에 블록으로 삽입.
  2. 팀원이 같은 페이지에서 값을 입력하며 **실제로 사용**하고, 필요하면 에이전트에게 수정 요청.
  3. 수동 경로: 슬래시 커맨드 **`/html`**.
- **동작 상세** ([공식 확인]):
  - 정체는 새 블록 타입이 아니라 **파일 업로드로 뒷받침된 embed 블록**이다. 공식 문언: *"An embed backed by an uploaded HTML file is an **HTML block**: the Notion app renders the file's contents interactively in a sandboxed iframe instead of linking out to it. This is the same block the app creates with the `/html` command and that agents create through Notion MCP."*
  - API 생성 절차(2026-07-03 changelog): **① File Upload API로 `.html`/`.htm` 업로드 → ② `embed.file_upload = {id: ...}`로 embed 블록에 첨부**(블록 자식 추가 또는 페이지 생성 시).
  - 즉 **AI 산출물을 "텍스트"가 아니라 "파일 + 실행 컨테이너"로 취급**하는 첫 사례다. F-10-16(파일 산출물)과 같은 계열이지만, 결과가 다운로드가 아니라 **페이지 내에서 실행**된다는 점이 다르다.
  - 업로드 상한은 File Upload API 규약을 따르므로 **20 MiB**(F-10-16/F-10-18에서 확인된 값) **[추정 — HTML 전용 별도 상한은 미공개]**.
  - iframe 샌드박스의 구체 정책(허용 속성, 네트워크 접근, 상위 페이지 데이터 접근 가부)은 **[확인필요]** — 공식 문서는 "sandboxed iframe"까지만 서술한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 생성된 HTML에 악성 스크립트 | **이 기능의 본질적 위험** — 임의 코드를 다른 사용자 브라우저에서 실행한다. `sandbox` 속성 최소권한(`allow-scripts`만, `allow-same-origin` **금지**) + **별도 origin(예: 전용 서브도메인)** 에서 서빙 + 엄격한 CSP. `allow-scripts`와 `allow-same-origin`을 함께 주면 샌드박스가 무력화된다 |
  | HTML이 부모 페이지 데이터를 읽으려 함 | 크로스 오리진 격리로 차단. 데이터를 넘겨야 하면 **postMessage 화이트리스트 프로토콜**로만 |
  | HTML이 외부 네트워크 호출 | CSP `connect-src`로 통제. 기본 차단이 안전(워크스페이스 데이터 유출 경로) |
  | 페이지 열람 권한만 있는 사용자 | 실행은 허용하되 **입력값은 저장되지 않는다**(HTML 블록은 상태 저장소가 아님). 저장이 필요하면 별도 DB 블록으로 유도 |
  | 무한 루프·메모리 폭주 스크립트 | iframe 격리로 탭 전체가 죽지는 않게 + 렌더 타임아웃 후 "중단됨" 표시와 재실행 버튼 |
  | 모바일/좁은 폭 | 블록 높이 고정 시 잘림 → 높이 조절 핸들 + 반응형 안내 |
  | 업로드 상한 초과 | 사전 차단(파일 업로드 규약) |
  | 블록 복제·템플릿 복사 | 파일 참조를 복제할지 공유할지 결정 필요. **공유 참조면 원본 삭제 시 전부 깨진다** → 복제 권장 |
  | 원본 파일 삭제 | embed 블록이 고아가 됨 → tombstone 표시, 조용한 빈 iframe 금지 |
  | 인쇄·PDF 내보내기 | iframe 콘텐츠가 캡처되지 않을 수 있음 → 스냅샷 대체 이미지 필요 **[확인필요]** |

- **데이터 모델 함의**: 새 블록 타입을 만들지 말고 **기존 embed 블록의 변형**으로 둘 것 — `block(type=embed, embed{url NULL, file_upload_id FK NULL})` + `file_upload(id, workspace_id, mime, bytes, ext, uploaded_by, storage_ref, created_at)`. 파생 권고: `html_block_meta(block_id, source_session_id NULL, generated_by enum(user, agent), sandbox_policy jsonb, height_px, last_rendered_at)` — **누가 생성한 코드인지(`generated_by`)를 기록하지 않으면 사후 보안 감사가 불가능**하다. 서빙은 반드시 `assets.<별도도메인>/html/{file_id}` 형태의 **분리 origin**.
- **UI/인터랙션**: `/html` 슬래시 커맨드, 에이전트 생성 시 미리보기 + 삽입 확인, 블록 호버 시 "코드 보기 / 다시 생성 / 높이 조절 / 새 탭에서 열기", 실행 오류 표시.
- **의존 기능**: 파일 업로드·스토리지, embed 블록, F-10-21/F-10-13(에이전트 생성 경로), F-10-18(MCP 도구), 별도 서빙 origin + CSP 인프라.
- **구현 난이도**: **M**(렌더링·업로드·블록만) / **보안 경계를 포함하면 L** — iframe 샌드박스 정책, 분리 origin, CSP, postMessage 프로토콜은 프론트 작업이 아니라 **인프라·보안 설계**다. 순진하게 `srcdoc`으로 같은 origin에 넣으면 **워크스페이스 전체가 XSS에 노출**된다. 이 항목은 "쉬워 보이지만 틀리면 치명적"인 대표 사례다.
- **우선순위**: **P2** — 데모 임팩트는 크지만 보안 부채가 크고, 잘못 만들면 되돌리기 어렵다. 만들 거라면 **분리 origin 없이는 시작하지 말 것**.
- **클론 시 현실적 대안**: 임의 HTML 대신 **선언적 위젯 스펙**(계산기 = 입력 필드 + 수식 정의를 JSON으로) → 서버가 안전한 컴포넌트로 렌더. 표현력은 줄지만 임의 코드 실행이 사라지므로 위 엣지 케이스 대부분이 소멸한다. 임의 HTML이 꼭 필요하면 전용 서브도메인 + `sandbox="allow-scripts"` 단독 + CSP `default-src 'none'`부터 시작하라.
- **참고 출처**: https://developers.notion.com/reference/block , https://developers.notion.com/page/changelog , https://www.notion.com/releases/2026-07-01

---

### F-10-25 AI 사용량 분석 · 에이전트 감사 로그 (관리자 관측성)

- **한 줄 정의**: 워크스페이스 관리자가 AI 채택률·사용자별 사용량·기능별 활용도를 시계열로 보고, 에이전트가 무엇을 왜 바꿨는지 감사 로그로 추적한다.
- **사용자 시나리오**:
  1. 관리자가 **Settings → Analytics → AI**로 이동 → 기간별 AI 사용 추이, 사용량 상위 사용자, 어떤 기능이 실제로 쓰이는지 확인(2026-01 도입, Enterprise).
  2. 크레딧 대시보드에서 에이전트별 소비를 확인하고 한도를 조정(2026-04).
  3. 규정 이슈 발생 시 **Custom Agent 감사 로그**에서 런 목록 → 어떤 변경이 있었고 누가 트리거했는지 추적(2026-07, Enterprise).
  4. API로도 동일 데이터 접근: `retrieve-agent-insights`(크레딧 사용량·완료 런 수), `get-agent-credit-usage` / `get-agents-credit-usage`.
- **동작 상세**:
  - 이 기능은 F-10-12(과금)와 **목적이 다르다**. 과금 원장은 "얼마를 청구할 것인가", 관측성은 "**무엇이 실제로 쓰였고 무엇이 바뀌었는가**"다. 같은 테이블로 둘 다 하려 들면 둘 다 나빠진다(원장은 불변·정산 지향, 분석은 집계·탐색 지향).
  - 분석 축(공식 서술 기준): 시간 / 사용자 / 기능. **[추정]** 여기에 모델·에이전트 축이 크레딧 대시보드 쪽에 존재한다.
  - 감사 로그 축(공식): **에이전트 런 / 변경 내역 / 트리거한 사용자**.
  - 보존 기간, 내보내기(CSV·SIEM 연동) 지원 여부는 **[확인필요]**.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 사용자별 사용량 노출 vs 프라이버시 | **프롬프트 내용이 아니라 메타데이터(횟수·기능·크레딧)만** 집계해야 한다. 내용까지 관리자에게 보이면 별도 법적 고지가 필요 |
  | 원장 재계산과 분석 수치 불일치 | 분석은 근사 집계여도 되지만 **과금 화면과 나란히 보이면 신뢰가 깨진다** → 화면에 "집계 기준·지연" 명시 |
  | 삭제된 페이지를 바꾼 런 기록 | 감사 로그는 **리소스 삭제와 무관하게 남아야 한다**(참조는 깨져도 `resource_ref` 원문 보존) |
  | 에이전트 삭제 | 감사 로그 캐스케이드 삭제 **금지** — 감사 목적이 소멸한다. `agent_id`를 tombstone으로 유지 |
  | 대량 런(수만 건) 조회 | 커서 페이징 + 기간 파티셔닝. 감사 테이블은 append-only라 빠르게 커진다 |
  | 관리자 아닌 사용자의 접근 | F-10-12의 `hidden` 규칙과 동일 — 값 자체가 권한 대상 |
  | 감사 로그 위·변조 | append-only + UPDATE/DELETE 권한 회수. 가능하면 별도 스토리지 |
  | 실시간성 기대 | 집계는 배치로 충분하지만 **감사 로그는 준실시간**이어야 한다(사고 대응) |

- **데이터 모델 함의**: 원장(`ai_usage_ledger`)에서 **롤업 테이블을 분리**: `ai_usage_rollup(workspace_id, day, user_id NULL, feature_key NULL, model_id NULL, requests, credits, tokens_in, tokens_out)` — (workspace, day) 파티셔닝. 감사는 F-10-13의 `agent_audit_event`(append-only, `actor_user_id`=트리거한 사람, `change_summary` = before/after 요약, `resource_ref` 원문 보존). 조회 권한은 `admin_capability(workspace_id, user_id, capability enum(view_ai_analytics, view_agent_audit, manage_credit_limits))`로 분리 — **"관리자면 다 본다"로 뭉치면 프라이버시 문제와 최소권한 원칙에 동시에 걸린다.**
- **UI/인터랙션**: Settings → Analytics → AI(기간 선택, 추이 차트, 상위 사용자 표, 기능별 분해), 크레딧 대시보드(에이전트별 소비 + 한도 편집), 감사 로그 테이블(에이전트·기간·사용자 필터, 런 상세 드릴다운), CSV 내보내기 **[확인필요]**.
- **의존 기능**: F-10-12(원장·한도), F-10-13/F-10-21/F-10-23(에이전트 실행 이벤트), 관리자 권한 체계, 배치 집계 잡.
- **구현 난이도**: **M** — 계측 훅이 이미 있다면 롤업 잡 + 조회 화면 + append-only 감사 테이블. 3~5일. **단 계측 훅이 없으면 이 기능은 만들 수 없다** — 그래서 F-10-12를 P0로 두는 것이다.
- **우선순위**: **P1** — 클론이 실제 사용자를 받는 순간 "누가 비용을 쓰는가"는 즉시 필요해진다. 감사 로그는 에이전트에 쓰기 권한을 주는 시점에 **동시에** 필요(P0로 승격).
- **클론 시 현실적 대안**: 전용 분석 화면 없이 **원장 테이블 위 SQL 뷰 2개**(일별 사용량, 사용자별 상위 N)로 시작. 감사 로그만은 축소하지 말고 처음부터 append-only로 남겨라 — 과거는 소급 생성할 수 없다.
- **참고 출처**: https://www.notion.com/releases/2026-01-20 , https://www.notion.com/releases/2026-07-01 , https://www.notion.com/releases/2026-04-14 , https://developers.notion.com/guides/notion-agent-apis/overview

---

### F-10-26 모델 선택 및 Auto 라우팅

- **한 줄 정의**: 사용자가 요청마다 모델을 고르거나 **Auto**에 맡기고, 관리자는 어떤 모델을 쓸 수 있는지 통제한다 — 모델을 바꿔도 대화 컨텍스트와 메모리는 유지된다.
- **사용자 시나리오**:
  1. 채팅/에이전트 입력창의 모델 피커에서 선택. 2026-01 기준 **GPT-5.2 / Claude Opus 4.5 / Gemini 3 / Auto**, 2026-07 기준 **Opus 4.8 / Grok 4.3 / GLM 5.2** 추가 — 속도·추론 깊이·비용 기준으로 선택.
  2. **Auto**를 고르면 시스템이 요청에 맞는 모델을 자동 선택.
  3. 대화 중간에 모델을 바꿔도 **컨텍스트와 메모리가 유지**된다(공식 문언).
  4. 프리미엄 모델은 **관리자 승인 + 크레딧** 필요. 기본은 비활성("off until you turn them on").
- **동작 상세**:
  - 모델은 3개 축의 교차점이다: **사용자 선택 / 관리자 허용 목록 / 크레딧 단가**. 셋 중 하나만 빠져도 제품이 성립하지 않는다(사용자가 못 고르면 무의미, 관리자가 못 막으면 비용 통제 불가, 단가가 없으면 과금 불가).
  - **크레딧 단가는 모델별로 다르고 시간에 따라 바뀐다**: 2026-04 릴리스에 "신규 모델은 최대 10배 적은 크레딧" 명시. → 단가는 코드 상수가 아니라 **데이터**여야 한다.
  - Auto 라우팅의 실제 판단 기준(질의 난이도 추정·비용 최적화·지연 목표 중 무엇을 쓰는지)은 **[확인필요]** — 공식 문서는 "선택해준다"까지만 서술한다. **[추정]** 일반적 구현은 질의 길이·도구 필요 여부·이전 실패 이력으로 라우팅한다.
  - 모델 교체와 **임베딩 모델 교체는 전혀 다른 문제**다. 생성 모델은 즉시 바꿔도 되지만, 임베딩 모델을 바꾸면 **전체 재색인**이 필요하다(F-10-08, Notion도 실제 수행). 이 둘을 같은 "모델 설정" 화면에 두면 관리자가 재앙적 버튼을 누른다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 관리자가 사용 중인 모델을 회수 | 진행 중 세션은 유지, 다음 턴부터 기본 모델 폴백(F-10-12와 동일 규칙) + 사용자 고지 |
  | 선택 모델이 프로바이더 장애 | 자동 폴백할지 실패로 알릴지 정책 필요. **자동 폴백 시 반드시 어떤 모델이 답했는지 표시**(응답 품질 차이를 사용자가 귀속할 수 있어야 한다) |
  | 모델 폐기(deprecated) | 세션에 박제된 `model_id`가 존재하지 않게 됨 → `model_registry.status=retired` + 별칭 매핑으로 과거 기록 조회 유지 |
  | 컨텍스트 윈도우가 더 작은 모델로 전환 | 요약 압축 후 진행. 조용한 절삭 금지 |
  | 도구 호출 미지원 모델 선택 | 에이전트 기능(F-10-21/23)을 비활성화하거나 모델 선택 자체를 제한 |
  | Auto가 매 턴 다른 모델을 고름 | 톤·형식이 흔들린다 → **세션 내 스티키 라우팅**(첫 선택 유지, 명시적 이유가 있을 때만 전환) |
  | 크레딧 단가 변경 시점에 걸친 세션 | 요청 시점 단가로 고정하고 원장에 `credit_multiplier`를 함께 기록(F-10-12) |
  | 프리미엄 모델이 꺼져 있는데 사용자가 선택 시도 | 피커에서 **숨기지 말고 비활성 + 사유 표시**("관리자 승인 필요") — 숨기면 지원 문의가 늘어난다 |

- **데이터 모델 함의**: `model_registry(model_id PK, provider, display_name, tier enum(standard, premium), context_window, supports_tools bool, supports_vision bool, credit_multiplier numeric, status enum(active, retired), effective_from)` — **단가·능력·상태가 전부 행(row) 데이터**여야 릴리스마다 코드를 고치지 않는다. `workspace_allowed_model(workspace_id, model_id, enabled_by, enabled_at)`, `ai_session.default_model_id`, **`ai_message.model_id`**(턴 단위 — 모델 전환이 세션 중간에 일어나므로 세션에만 두면 안 된다), 라우팅 관측용 `auto_routing_decision(message_id, chosen_model_id, reason, features jsonb)`. 임베딩 모델은 **별도 레지스트리**(`embedding_model_registry` + `index_generation`)로 완전히 분리.
- **UI/인터랙션**: 입력창 모델 피커(허용 모델만 활성, 비활성 항목은 사유 툴팁), Auto 배지 + 실제 선택된 모델 표시, 관리자 설정의 모델 허용 목록 토글 + 단가 안내, 응답 하단에 사용 모델 라벨.
- **의존 기능**: F-10-12(허용 목록·크레딧), F-10-17(세션 컨텍스트), F-10-09(생성 파이프라인), 프로바이더 추상화 계층.
- **구현 난이도**: **M** — 프로바이더 팩토리 + 레지스트리 테이블 + 피커 UI면 3~5일. **단 "컨텍스트가 프로바이더 중립 표현으로 저장돼 있어야 한다"는 전제가 깨져 있으면 L~XL로 뛴다** — 초기에 OpenAI 메시지 포맷을 그대로 DB에 저장하는 흔한 실수가 여기서 청구서로 돌아온다.
- **우선순위**: **P1** — MVP는 모델 1개로 충분하지만, **메시지 저장 포맷의 프로바이더 중립성과 `ai_message.model_id` 컬럼만은 P0로 앞당길 것**(F-10-20의 `sequence`와 같은 성격의 "지금 안 만들어도 스키마만은 지금 잡아야 하는" 항목).
- **클론 시 현실적 대안**: Auto 라우팅 생략(기본 모델 고정), 모델 2종(빠른 것 / 강한 것)만 노출. 관리자 통제는 워크스페이스 단위 허용 목록 하나. 중립 메시지 포맷은 Vercel AI SDK의 메시지 표현을 그대로 저장 스키마로 채택하면 무료로 얻는다.
- **참고 출처**: https://www.notion.com/releases/2026-01-20 , https://www.notion.com/releases/2026-07-01 , https://www.notion.com/releases/2026-04-14 , https://www.notion.com/help/notion-ai-faqs

---

## 구현 우선순위 요약표

**[정정]** 초판 표는 (a) F-10-15~F-10-20이 누락돼 있었고, (b) F-10-09·F-10-12의 난이도가 본문에서 상향(M→L)된 뒤에도 표에는 옛 값이 남아 있었다. 아래가 26개 전 기능을 반영한 정본이다.

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-10-09 | 스트리밍 응답 / 생성 라이프사이클 | **L** | **P0** | — (모든 것의 기반) |
| F-10-01 | 인라인 AI 작성 (Ask AI) | L | **P0** | F-10-09, 블록 에디터 |
| F-10-02 | 선택 영역 AI 편집 프리셋 | M | **P0** | F-10-01 |
| F-10-12 | 요금·한도·크레딧 거버넌스 | **L** | **P0** | 전 AI 기능 계측 훅, 결제 |
| F-10-03 | 페이지 전체 번역 | M | P1 | F-10-02 |
| F-10-04 | AI 블록 (Summary/Action items/Custom) | M | P1 | 블록 시스템, F-10-01 |
| F-10-05 | AI DB 프로퍼티 Autofill | L | P1 | DB 도메인, 잡 큐, (F-10-06) |
| F-10-08 | 권한 인지 임베딩 인덱스 | XL | P1 | 권한 시스템, CDC, 벡터 저장소 |
| F-10-06 | AI Q&A (워크스페이스 답변) | XL | P1 | **F-10-08**, 권한 |
| F-10-17 | AI 채팅 표면 (세션·히스토리·범위) | M | P1 | F-10-09, F-10-06, F-10-12 |
| F-10-22 | **Agent Instructions 페이지(개인화 메모리)** | **S** | **P1** | 페이지 시스템, F-10-17 |
| F-10-25 | **AI 사용량 분석 · 에이전트 감사 로그** | M | P1 (감사 로그는 P0*) | F-10-12, 에이전트 실행 |
| F-10-26 | **모델 선택 · Auto 라우팅** | M | P1 (스키마는 P0*) | F-10-12, F-10-17 |
| F-10-16 (범위 A) | 파일·이미지 **입력** 분석 | M | P1 | 파일 스토리지, F-10-09 |
| F-10-16 (범위 B) | 산출물 **파일 생성**(컴퓨트) | XL | P2 | 샌드박스 실행 인프라 |
| F-10-07 | AI 커넥터 (Slack/Drive 등) | XL | P2 | F-10-08, OAuth |
| F-10-10 | Research Mode | XL | P2 | F-10-06, F-10-09, 잡 |
| F-10-11 | AI Meeting Notes | XL | P2 | 데스크톱 앱, STT, F-10-04 |
| F-10-13 | Custom Agents | XL | P2 | 이벤트 버스, 스케줄러, F-10-12, F-10-20 |
| F-10-14 | 이미지 생성·편집 | S | P2 | 파일 스토리지, F-10-12 |
| F-10-15 | Build with AI (구조 생성) | L | P2 | DB 도메인, 구조화 출력 |
| F-10-18 | Notion MCP 서버 | L | P2 | OAuth, 공개 API, 레이트리밋 |
| F-10-19 | Notion Skills | S | P2 (에이전트 있으면 P1) | 페이지 시스템, F-10-13/18 |
| F-10-20 | 에이전트 세션 API + HITL 승인 | L | P2 (`sequence` 스키마는 P0*) | F-10-09, F-10-13 |
| F-10-21 | **Notion Agent(개인 에이전트)** | XL | P2 | F-10-20, F-10-06, F-10-22 |
| F-10-23 | **External Agents (Claude·Cursor)** | XL | P2 | F-10-13, F-10-20, 댓글·보드 |
| F-10-24 | **AI 생성 인터랙티브 HTML 블록** | M (보안 포함 L) | P2 | 파일 업로드, 분리 origin+CSP |

`*` = **기능은 나중에 만들어도 되지만 스키마·규약은 지금 잡아야 하는 항목.** 이 문서에서 그런 항목은 정확히 4개다: `ai_session_event.sequence`(F-10-20), `ai_message.model_id` + 프로바이더 중립 메시지 포맷(F-10-26), `ai_usage_ledger.raw_units/credit_multiplier`(F-10-12), `agent_audit_event` append-only(F-10-25). 나머지는 나중에 붙여도 비용이 선형이지만, 이 넷은 나중에 붙이면 **기존 데이터를 소급 복원할 수 없다.**

**의존 그래프(핵심 경로)**

```
F-10-09 스트리밍/이벤트 ─┬─> F-10-01 인라인 ──> F-10-02 프리셋 ──> F-10-03 번역
   (sequence, 중립포맷)   │                      └────────> F-10-04 AI 블록 ──> F-10-11 회의노트
                          ├─> F-10-17 채팅 표면 ─┬─> F-10-22 Instructions(메모리)
                          │                      └─> F-10-26 모델 선택/Auto
                          └─> F-10-12 쿼터·과금 ─┬─> F-10-25 분석·감사 로그
                                                 └─ (모든 기능에 횡단 적용)

권한 시스템 ─> F-10-08 임베딩 인덱스 ─┬─> F-10-06 Q&A ──> F-10-10 Research
                                      └─> F-10-07 커넥터 ──┘

DB 도메인 ─┬─> F-10-05 Autofill ─┐
           └─> F-10-15 Build ────┤
                                 ├─> F-10-13 Custom Agents ─┬─> F-10-23 External Agents
F-10-20 세션 API + HITL 승인 ────┤                          └─> F-10-19 Skills
                                 └─> F-10-21 Notion Agent(사용자 위임) ──> F-10-24 HTML 블록

F-10-18 MCP 서버 ── (F-10-23의 거울상: 밖→안 / 안→밖. 도구·권한 레지스트리 공유)
```

**단계별 권고**
- **MVP(P0)**: F-10-09 → F-10-01 → F-10-02 → F-10-12. 이 4개면 "AI가 있는 노션"의 체감 80%를 만든다. 여기에 **비용 0의 스키마 4종**(위 `*` 항목)을 함께 심는다.
- **v1(P1)**: F-10-03, F-10-04, F-10-05, F-10-17, **F-10-22(투자 대비 효과 최고)**, F-10-26, F-10-16 (범위 A) + F-10-06(FTS 버전), F-10-25(SQL 뷰 수준).
- **v2(P2)**: F-10-08 벡터화 → F-10-07/10/15/18/19. 에이전트 계열(F-10-20 → F-10-13 → F-10-21 → F-10-23)은 **반드시 이 순서**로 — 승인 게이트(F-10-20) 없이 에이전트에 쓰기 권한을 주는 것이 이 도메인에서 가장 흔한 치명적 실수다.
- **v3 / 선택**: F-10-11(회의노트), F-10-14(이미지), F-10-16 (범위 B — 컴퓨트 파일 생성), F-10-24(HTML 블록). 넷 다 **보안 또는 네이티브 플랫폼 비용**이 크고 제품 성립에는 불필요하다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | AI 구현 방식 | 차용 가능한 접근 |
|---|---|---|
| **AFFiNE / BlockSuite** | NestJS 백엔드에 Copilot 서브시스템. **provider factory 패턴**으로 OpenAI/Anthropic/Gemini 교체 가능. 모듈 경계가 Provider System / Backend Services & Session Management / Frontend Chat Interface / **Context & Embedding Management** / Prompts·Tools·Workflows / **Transcript & Meeting AI**로 분리. **tiktoken-rs**로 호출 전 토큰 카운팅(TS/Rust 하이브리드). Vercel AI SDK를 통해 `/v1/responses`에 **SSE 스트리밍**. | ① provider factory로 시작해 모델 락인 회피. ② 프롬프트를 코드가 아닌 **템플릿 레지스트리**로 분리(버전 관리 가능). ③ 호출 전 토큰 카운팅으로 컨텍스트 초과 사전 차단. ④ **모듈 경계를 그대로 베껴도 무리 없다** — 특히 Context&Embedding을 Session과 분리한 점. |
| **Docmost** | Ask AI(에디터 선택 영역: improve writing, grammar, length, continue, explain, summarize, 톤 3종(Professional/Casual/Friendly), 11개 이상 언어 번역, 자유 프롬프트) + AI Answers(**검색 다이얼로그 안의 토글**, vector embeddings 기반 시맨틱 검색, **결과가 사용자 권한을 존중**). 프로바이더 OpenAI / Gemini / **Ollama**. 관리자가 기능별 개별 토글. Enterprise 라이선스 필요. | ① **에디터 AI 액션 목록이 사실상 표준화되어 있다** — 그대로 채택. ② "검색 다이얼로그 안의 AI 토글"은 별도 챗 UI 없이 Q&A를 붙이는 가장 저렴한 진입점. ③ 기능별 관리자 토글을 처음부터 설계에 넣을 것. |
| **AppFlowy** | **Ollama 통합으로 로컬 AI를 무료 제공**(v0.8.7~), 100% 오프라인, GPU 없이 CPU만으로 실행. gemma3, qwen3, Llama 3.1, DeepSeek R1, Phi4 등 지원. AppFlowy-LAI 별도 레포. | 셀프호스트/프라이버시 포지셔닝이면 **Ollama를 기본 프로바이더로 두는 전략**이 이미 검증됨. 개발 중 API 비용을 0으로 만드는 실용적 이점도 크다. |
| **Notion 자체(공개 엔지니어링)** | Spark(offline) + Kafka(online) 이중 경로, span 단위 청킹, xxHash64 이중 해시 + DynamoDB 페이지 상태 캐시(데이터 70%↓), turbopuffer(오브젝트 스토리지 벡터DB, 네임스페이스=독립 인덱스), workspace_id 파티션 키 + generation ID 라우팅, Ray Serve로 임베딩 모델 self-host(90%+↓). | ① **text_hash 기반 재임베딩 스킵은 규모와 무관하게 처음부터 넣을 가치가 있다.** ② 워크스페이스를 네임스페이스로 격리하면 멀티테넌시·삭제·재색인이 전부 단순해진다. ③ ACL을 span 메타로 들고 메타만 바뀌면 임베딩 없이 패치. ④ 임베딩 모델 교체 = 전체 재색인이므로 **generation 전환 전략을 초기 설계에 포함**할 것. |

**클론 기술 스택 권고 [추정 / 판단]**

| 레이어 | 권고 | 근거 |
|---|---|---|
| 스트리밍 | Vercel AI SDK (`streamText` / `useChat`, SSE) | SSE가 업계 표준, AFFiNE도 동일 채택 |
| 프로바이더 추상화 | AFFiNE식 factory. 초기 Anthropic 1종 + Ollama 폴백 | 락인 회피 + 개발 비용 0 |
| 벡터 | v1 Postgres FTS(tsvector+GIN) → v2 **pgvector(HNSW)** | turbopuffer급 규모는 불필요. 단일 DB면 ACL JOIN이 가능 |
| 잡 큐 | BullMQ / Redis | autofill 대량 실행, 비동기 임베딩 |
| 쿼터 | Redis 원자 카운터(INCR + TTL) | 동시 요청 초과 방지 |
| 프롬프트 | DB 기반 템플릿 레지스트리(key + version) | A/B 및 롤백 가능 |
| 메시지 저장 포맷 | **프로바이더 중립 표현**(AI SDK 메시지 스키마) + `ai_message.model_id` | 세션 중간 모델 전환이 공식 동작(F-10-26). OpenAI 원문 포맷 저장은 나중에 마이그레이션 비용으로 돌아온다 |
| 모델 메타 | `model_registry` 테이블(단가·컨텍스트·능력·상태) | 2026-04에 크레딧 소비가 최대 10배 변동 — 단가는 코드 상수가 될 수 없다 |
| 이벤트 로그 | append-only 테이블 + `UNIQUE(session_id, sequence)`, DB 시퀀스로 채번 | `continue_from` 재생·감사·부분복구가 전부 여기 의존. 앱 카운터는 동시성에서 깨진다 |
| AI 생성 HTML 실행 | **전용 서브도메인** + `sandbox="allow-scripts"`(same-origin 금지) + `CSP default-src 'none'` | 같은 origin `srcdoc`은 워크스페이스 전역 XSS(F-10-24) |
| 감사 | `agent_audit_event` append-only, 에이전트 삭제와 무관하게 보존 | 소급 생성이 불가능한 유일한 데이터 |

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 |
|---|---|---|
| 1 | `[확인필요]` 인라인 생성 중 새로고침 시 세션 복구 여부 | ghost 블록을 서버에 쓸지 클라이언트에만 둘지 결정에 직결 |
| 2 | `[확인필요]` 페이지 번역이 원본을 치환하는가, 새 결과로 제시하는가 — **2026-09 재검색에도 공식 명시 없음**(`••• → Translate` 진입점과 "서식 유지"까지만 서술) | 되돌리기/버전 관리 설계가 완전히 달라짐 |
| 3 | `[확인필요]` AI 블록 결과가 편집 가능한 일반 블록인가 / stale 배지 존재 여부 | 재생성 시 수동 편집 유실 정책 |
| 4 | `[확인필요]` AI 프로퍼티 값을 수동 수정했을 때 다음 autofill이 덮어쓰는가 | 데이터 신뢰성. 사용자가 가장 크게 반발하는 지점 |
| 5 | `[확인필요]` Q&A가 근거를 못 찾았을 때의 실제 폴백(일반 지식으로 답하는가) — **2026-09 `notion-ai-faqs` 본문 재확인 결과 여전히 어떤 언급도 없음**(3회 검색·2회 본문 확인에도 불검출) | 환각 정책의 핵심. 공식 미공개로 확정 |
| 6 | `[확인필요]` 커넥터 OAuth revoke 시 기존 인덱스 처리(즉시 삭제 vs 검색 차단) | 보안 컴플라이언스 |
| 7 | `[확인필요]` Custom Agent 생성자 퇴사 시 권한 승계 | 비인간 principal 수명주기 |
| 8 | `[확인필요]` 번역 지원 언어의 정확한 목록(전사는 15개, 화자 라벨은 영어만으로 확인됨 / 번역은 미공개) | 범위 산정 |
| 9 | `[확인필요]` Notion의 청킹 기준(토큰 수 / heading 경계 / 블록 수)의 구체 규칙 | 검색 품질에 가장 큰 영향을 주는 파라미터인데 공개 자료에 수치가 없음 |
| 10 | `[확인필요]` 하이브리드 검색(BM25+vector) 및 리랭커 사용 여부 | 공개 엔지니어링 블로그에 명시적 언급 없음 |
| 11 | `[확인필요]` 게스트/외부 협업자의 AI 사용 가능 범위(커넥터는 제외로 확인됨, 그 외는 불명) | 권한 설계 |
| 12 | `[확인필요]` 워크스페이스 이전·병합 시 크레딧 귀속 | 과금 엣지 케이스 |
| 13 | `[추정]` 프롬프트 템플릿이 서버측 고정인지 클라이언트 조립인지 | 프롬프트 인젝션 방어 설계 |
| 14 | `[추정]` 본 문서의 의사 스키마 대부분은 공개 동작에서 역산한 것이다. **예외**: `ai_session.status` 7값, 세션 이벤트 6종, `sequence`/`continue_from`, `required_actions`, 크레딧 한도 정책 3축, `page.is_skill`, `embed.file_upload`는 **공식 문서로 확인된 값**이다 | 오해 방지 / 어디까지가 사실인지 구분 |
| 15 | `[확인필요]` HTML 블록 iframe의 실제 sandbox 정책(허용 속성·네트워크·postMessage 가부) | **보안 경계 그 자체**. 잘못 구현하면 워크스페이스 전역 XSS |
| 16 | `[확인필요]` HTML 블록이 인쇄·PDF 내보내기에서 어떻게 캡처되는가 | 대체 스냅샷 필요 여부 결정 |
| 17 | `[확인필요]` Auto 모델 라우팅의 판단 기준(난이도 추정 / 비용 / 지연 중 무엇) | 클론이 Auto를 흉내낼 때 유일한 설계 미지수 |
| 18 | `[확인필요]` Instructions 페이지의 길이·개수 상한 | 매 요청 고정 토큰 비용이라 상한이 곧 단가 |
| 19 | `[확인필요]` AI **커넥터(검색 인덱스)** 가 private Slack 채널을 색인하는가 — 에이전트 경로는 2026-04부터 지원 확인, 커넥터 경로는 미확인 | 두 경로의 권한 비대칭. 잘못 가정하면 정보 누출 |
| 20 | `[확인필요]` AI 분석·에이전트 감사 로그의 보존 기간과 내보내기(CSV/SIEM) 지원 | 컴플라이언스 요구 충족 여부 |
| 21 | `[확인필요]` Build with AI가 **차트**를 생성할 수 있는가 (폼=가능, automation·formula=불가는 2026-09 확인 완료) | 생성 가능 아티팩트 경계의 마지막 미확정 항목 |
| 22 | `[추정]` External Agent가 Enterprise·HIPAA에서 기본 비활성인 이유가 ZDR 미지원 때문이다 | 정책 게이트 설계 근거 |
| 23 | `[확인필요]` AI 채팅 히스토리의 보존 기간·삭제 정책 (FAQ·릴리스 노트·크레딧 문서 모두 언급 없음 — 2026-09 확인) | 세션 영속화 설계와 GDPR 삭제 요구 대응 |
| 24 | `[확인필요]` 플랜별 AI 사용 할당량의 **구체 수치** — 크레딧 문서는 "usage allowance"를 참조만 하고 수량을 명시하지 않는다 | 클론의 무료/유료 경계 설계 시 벤치마크 부재 |

---

## 출처

**공식 1차 (Notion 헬프센터 / 공식 블로그 / 공식 API 문서)**

1. https://www.notion.com/help/notion-ai-faqs — Notion AI 개요, 플랜 요구사항, 이미지 생성 한도(24h 10개 / 30d 30개), 관리자 통제 항목, 프리미엄 모델 기본 비활성
2. https://www.notion.com/help/autofill — AI DB autofill 4종 프로퍼티, Basic vs Custom Agent 차이, 실행 트리거(수동/생성/편집/스케줄), 명시적 제약(페이지·자동화·폼·차트·템플릿 생성 불가)
3. https://www.notion.com/help/notion-ai-connectors — 커넥터 목록 및 카테고리, 인덱싱 지연(신규 3시간 / 초기 최대 72시간), 1년 히스토리, 권한 매핑, "검색·요약용" 한계
4. https://www.notion.com/help/enterprise-search-security-and-privacy-practices — OpenAI zero-retention 임베딩 API, Turbopuffer 저장, 쿼리 시점 권한 필터, 권한 변경 1시간 내 반영, 삭제 30분~1시간 / 24시간 / 60일, 게스트 제외
5. https://www.notion.com/help/notion-ai-security-practices — LLM 프로바이더(Anthropic/OpenAI/Notion 호스팅), Enterprise ZDR vs 비Enterprise 30일, **retrieval 단계 권한 강제**, 임베딩 60일 삭제, Turbopuffer 명시, 관리자 토글 및 DLP
6. https://www.notion.com/blog/two-years-of-vector-search-at-notion — **핵심 엔지니어링 출처**: Spark/Kafka 이중 경로, xxHash64 이중 해시 + DynamoDB 페이지 상태 캐시(데이터 70%↓), turbopuffer 이전(검색 비용 60%↓, EMR 35%↓, p50 70~100ms→50~70ms), workspace_id 파티셔닝 + generation ID, Ray/Anyscale self-host(임베딩 인프라 90%+↓), 100억+ 벡터, 10x 확장 / 1/10 비용
7. https://www.notion.com/blog/introducing-q-and-a — Q&A 권한 모델(생성자/초대/워크스페이스 공유), Anthropic·OpenAI 파트너십, 고객 데이터 학습 미사용, 진입점(사이드바/스파클/단축키)
8. https://www.notion.com/help/ai-meeting-notes — 오디오 캡처 경로별 차이, 1분 최소 조건, 24시간/3일 보존, 화자 라벨 영어 전용, 1일 10시간, 지원 포맷·15개 언어·OS 요구사항, 오디오는 녹음자 로컬에만
9. https://www.notion.com/help/custom-agents — 에이전트 구성요소, Notion/Slack 트리거 목록, **자율 백그라운드 프로세스** 권한 모델, 공유 3단계, 활동 로그
10. https://www.notion.com/help/research-mode — 멀티스텝 연쇄 검색, 5분(복잡 시 10분) 실행, 웹 검색 토글, HIPAA 워크스페이스 웹 검색 불가, 하이퍼링크 인용, @ 소스 지정, PDF 첨부
11. https://www.notion.com/help/what-are-notion-credits — 크레딧 정의, 월간 $10/1k · 연간 $13/1k, 이월 없음, 소진 순서(free→monthly→annual), 결제 실패 시 hold
12. https://www.notion.com/help/manage-your-usage-allowance-for-notion-ai — rolling 6시간 + 월 청구주기 이중 할당량, Settings→Notion AI→Usage
13. https://www.notion.com/help/guides/notion-ai-for-docs — 에디터 진입점(스페이스 키 / 하이라이트 Edit with AI / 사이드바), 액션 목록, accept·discard·revise, @ 멘션 컨텍스트
14. https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai — 기능 전반, 단축키(Shift+Cmd/Ctrl+J), All sources 드롭다운, 파일·이미지 분석, Build with AI
15. https://www.notion.com/product/ai/use-cases/translate-your-content — 페이지 번역 진입점(••• 메뉴 / AI 아이콘), 서식 유지
16. https://www.notion.com/help/run-custom-code-with-workers — Workers로 에이전트 도구 확장
17. https://www.notion.com/help/create-and-edit-images-with-notion-ai — 이미지 생성·편집
18. https://developers.notion.com/reference/block — AI 블록은 공개 API에서 `unsupported`로 반환(생성·수정 불가), **HTML 블록 = 업로드한 `.html`을 `embed.file_upload`로 붙인 embed이며 샌드박스 iframe으로 실행 렌더링**, `/html` 커맨드 및 MCP 생성 경로와 동일 블록
19. https://www.notion.com/blog/introducing-custom-agents — Custom Agents 도입 배경·구성요소
20. https://www.notion.com/help/notion-ai-connectors-for-slack — Slack 커넥터 채널 선택 범위
21. https://www.notion.com/help/guides/power-your-deep-work-using-research-mode-in-notion — Research Mode 사용 가이드
22. https://www.notion.com/help/notion-agent — **Notion Agent(개인 에이전트)**: 사용자와 동일 권한, 다단계 작업, 페이지·DB·view·form·property 생성 가능 / **automation·template·formula 생성 불가**, 쓰기 작업 전 확인, Business·Enterprise + 프리미엄 모델은 크레딧·관리자 승인
23. https://www.notion.com/help/instructions-for-notion-agent — **Instructions 페이지**: 설정 경로 2종, **한 번에 하나만 활성**, 매 채팅 적용, 공유해도 타인 Agent에 전파 안 됨, **Custom Agents에는 미적용**, 공동 편집 가능 페이지는 타인이 내 Agent 동작을 바꿈
24. https://www.notion.com/help/use-claude-agents-in-notion — **External Agents(Claude)**: Business·Enterprise, Enterprise·HIPAA 기본 비활성, **권한은 에이전트별이며 실행자에게서 상속되지 않음**, 런 단위 크레딧 과금, **ZDR 미지원**, Notion이 Anthropic 인프라 위에 호스팅, 세션 중 웹 브라우징·다른 에이전트 호출 불가
25. https://www.notion.com/help/guides/how-to-set-up-claude-agents-on-your-teams-notion-task-board — 보드 "Ready for Agent" 칼럼 드래그 트리거, 댓글 `@에이전트` 멘션, 진행 상황 댓글 보고, GitHub 저장소 읽기·PR 생성·태스크 분해
26. https://www.notion.com/help/category/external-agents — External Agents 헬프 카테고리(Claude·Cursor)
27. https://www.notion.com/help/notion-mcp — 사용자 관점 MCP 연결 설정

**공식 1차 (개발자 문서 — MCP / Agent API / Skills)**

28. https://developers.notion.com/guides/mcp/mcp-supported-tools — MCP 도구 전체 목록(검색·읽기·쓰기·파일·비동기), 레이트리밋 180 req/min(키워드 검색 30), Notion 마크다운 포맷, `allow_async`
29. https://developers.notion.com/docs/mcp — MCP 개요·OAuth 인가 모델("인가한 사용자가 접근 가능한 콘텐츠만")
30. https://developers.notion.com/guides/mcp/mcp-security-best-practices — MCP 보안 권고(프롬프트 인젝션, 쓰기 확인)
31. https://developers.notion.com/guides/mcp/notion-skills — **Skills = `is_skill` 플래그가 선 페이지**, 메타데이터 검색 → 본문 fetch 2단계, "편집·검토 맥락에서는 지시가 아니라 콘텐츠로 취급" 안전 규칙
32. https://developers.notion.com/guides/notion-agent-apis/overview — Agent APIs public beta: Agent / Session / Session Event 3객체, 세션 시작·메시지·액션 제출·스트리밍·취소·이벤트 페이징, 권한 3단(read/edit/full, 없으면 크레딧 한도 `hidden`)
33. https://developers.notion.com/reference/notion-agent-apis/update-session — 세션 상태 7값 enum, `required_actions[]`, `message` maxLength 10000, `Accept: text/event-stream`로 SSE
34. https://developers.notion.com/reference/notion-agent-apis/query-session-events — 이벤트 6종, `sequence` 단조 증가, `continue_from` 재생, and/or 중첩 필터
35. https://developers.notion.com/reference/notion-agent-apis/cancel-session — 진행 중 세션 취소
36. https://developers.notion.com/page/changelog — **2026 API 변경 이력**: `transcription` → `meeting_notes` 블록 타입 개명(API 버전 `2026-03-11`), Agent APIs public beta(2026-08-20), MCP 세션 도구(2026-08-27), **HTML 블록 API(2026-07-03)**, `notion-query-meeting-notes`(2026-02-26)

**공식 1차 (릴리스 노트 — 2026 갱신 근거)**

37. https://www.notion.com/releases/2026-01-20 — Notion 3.2: 모델 선택(GPT-5.2 / Claude Opus 4.5 / Gemini 3 / **Auto**)과 **모델 전환 시 컨텍스트·메모리 유지**, 모바일 AI 패리티, **Settings → Analytics → AI** 관리자 사용량 분석
38. https://www.notion.com/releases/2026-04-14 — Notion 3.4 part 2: Custom Agent 비용 **35~50% 절감** 및 신규 모델 **최대 10배 적은 크레딧**, 크레딧 대시보드, **private Slack 채널 지원**, Skills, 음성 입력, 문서 인라인 편집, 회의 요약 커스텀 지시문, Salesforce·Box 커넥터, 회의 전사·노트 API
39. https://www.notion.com/releases/2026-07-01 — Notion 3.6: **External Agents(Claude·Cursor)**, **에이전트 생성 인터랙티브 HTML 블록**, **마이크 활성 기반 화자 식별**, 에이전트의 PPTX·XLSX·DOCX·PDF 읽기/쓰기, Outlook 연동, MCP 커넥션 5종(Mercury·Mixpanel·Miro·Box·ClickHouse), 모델 추가(Opus 4.8·Grok 4.3·GLM 5.2), **Custom Agent 감사 로그(Enterprise)**

**오픈소스 / 기술 구현 참고**

40. https://deepwiki.com/toeverything/AFFiNE/1.1-architecture-overview — AFFiNE Copilot 모듈 구조(Provider / Session / Context·Embedding / Prompts·Tools·Workflows / Transcript), provider factory, tiktoken-rs
41. https://docmost.com/docs/user-guide/ai — Docmost Ask AI 액션 전체 목록, AI Answers 벡터 시맨틱 검색 + 권한 존중, OpenAI/Gemini/Ollama, 관리자 기능별 토글
42. https://appflowy.com/blog/appflowy_local_ai_ollama — AppFlowy 로컬 AI(Ollama), 오프라인·CPU 실행, 지원 모델
43. https://vercel.com/blog/ai-sdk-5 — SSE를 서버→클라이언트 스트리밍 표준으로 채택
44. https://github.com/run-llama/LlamaIndexTS/issues/253 — `ai_block` API 미지원 실측 사례

**보조 (교차 확인용, 단독 근거로 사용하지 않음)**

45. https://www.zenml.io/llmops-database/scaling-vector-search-infrastructure-for-ai-powered-workspace-search — Notion 벡터 검색 사례 요약(6번의 2차 정리)
