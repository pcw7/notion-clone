# 08. 템플릿 · 자동화 · 버튼

> 조사일: 2026-09-06 / 모드: DOMAIN → **GAP 검증·보완 1차 (2026-09-06)**
> 대상: 노션 클론(C:/VibeCoding/notion) 기획 단계 기능 명세
> 태그 규칙: `[추정]` = 공개 문서에 없어 추론한 내용, `[확인필요]` = 실제 제품에서 검증이 필요한 내용, `[2차출처]` = 공식 문서가 아닌 신뢰 가능한 3자 문서로만 확인됨

### GAP 보완 이력 (2026-09-06)

| 구분 | 내용 |
|---|---|
| **추가된 기능** | F-08-15 AI Autofill property / F-08-16 Custom Agents / F-08-17 Integration webhooks(이벤트 구독) / F-08-18 Notion Workers — 초판이 2024년형 노션(규칙 기반 automation)에 머물러 **2026년 AI·개발자 플랫폼 계층 전체를 누락**하고 있었다. |
| **사실 정정** | ① webhook 실패 시 동작(재시도 추정 → **automation 일시정지 + 수동 재개**, 공식) ② 실패 배지 존재 여부(`[확인필요]` → 공식 확인) ③ `Send notification to` 수신자(20명 → **20명 또는 People property 연결 인원**, 공식) ④ automation과 권한(“공식 명시 없음” → **“접근이 제한된 페이지에는 영향을 주지 않는다” 공식 명시 있음**) ⑤ 공개 API의 부모 지정(2025-09-03 버전부터 `database_id` → `data_source_id`) |
| **근거 보강** | 기본 템플릿 스코프 문구(`[추정]` → `[2차출처]` 실제 UI 문구), 템플릿 수정의 비소급성(`[확인필요]` → `[2차출처]` 확인), 반복 템플릿 중첩 3단계·daily 중첩 불가(공식 문구 확인) |
| **등급 조정** | F-08-09 `L` → `L~XL`(실시간 협업 스택 위에서의 이벤트 정합성), F-08-11 우선순위 주석 보강(값 슬롯 스키마는 기능이 P2라도 **설계 결정은 P0**) |

---

## 요약

이 도메인은 "사람이 매번 손으로 만들던 페이지/블록/속성값을 규칙으로 대체"하는 계층이다. 2026년 기준 구성 요소는 여섯 가지이며, **자동화 표면이 세 계층으로 갈라져 있다**.

| 계층 | 구성 요소 | 성격 |
|---|---|---|
| ① 복제 | **템플릿**(페이지 / DB 행 / 반복 / 갤러리) | 초기 상태(블록 트리 + property 기본값)를 저장해 두고 복제 |
| ② 규칙 | **버튼**(블록 / property), **DB automation**, **변수·수식 결합** | 트리거 → 선언적 액션 목록의 순차 실행. 결정적(deterministic) |
| ③ AI·코드 | **AI Autofill property**, **Custom Agents**(2026-02-24 Notion 3.3), **Notion Workers**(2026-05-13 Developer Platform) | 트리거 → LLM 오케스트레이션 또는 사용자 코드 실행. **비결정적**이며 크레딧 과금 |

1. **템플릿**: 페이지 또는 DB 행의 초기 상태(블록 트리 + property 기본값)를 저장해 두고 복제한다.
2. **버튼**(버튼 블록 / 버튼 property): 사람이 클릭할 때 액션 목록을 순차 실행한다.
3. **데이터베이스 automation**: 트리거(페이지 추가 / property 변경 / 반복 스케줄) 발생 시 액션 목록을 자동 실행한다.
4. **변수·수식 결합**: 액션의 인자를 정적 값이 아니라 트리거 페이지 기준의 formula/mention으로 계산한다.
5. **AI 계층**: property 단위 AI Autofill(F-08-15)과 워크플로 단위 Custom Agents(F-08-16). 트리거 종류가 ②의 **상위집합**이다(페이지 삭제·댓글 추가·Slack 메시지·회의록 완료까지 포함).
6. **개발자 플랫폼**: 외부로 나가는 이벤트 구독(F-08-17 integration webhooks)과 노션 서버 위에서 도는 사용자 코드(F-08-18 Workers).

버튼과 automation은 **동일한 액션 실행 엔진을 공유**한다(액션 종류 목록이 거의 동일). 차이는 "무엇이 실행을 유발하는가"뿐이다. 클론 설계에서도 액션 엔진을 하나로 두고 트리거 소스만 다르게 붙이는 것이 맞다.

**클론 설계에 주는 가장 중요한 함의**: ①②③은 모두 "이벤트 → 실행 → 로그"라는 같은 뼈대를 쓴다. 그러므로 **트리거 이벤트 소스(outbox)와 실행 로그(run) 테이블을 처음부터 하나로 통일**해야 한다. 규칙형 automation을 먼저 만들고 나중에 AI 액션을 별도 파이프라인으로 붙이면, 루프 차단(`origin`/`depth`)과 권한·쿼터 계산이 두 벌로 갈라져 반드시 사고가 난다.
출처: https://www.notion.com/help/buttons , https://www.notion.com/help/database-automations , https://www.notion.com/help/database-buttons , https://www.notion.com/help/custom-agents

---

## 핵심 개념 / 데이터 모델

### 관통하는 엔티티

```sql
-- 1) 템플릿: 실체는 "숨겨진 페이지"다. 별도 테이블이 아니라 page 플래그로 두는 것이 노션의 모델에 가깝다 [추정]
page (
  id            uuid pk,
  parent_type   enum('workspace','page','database','block'),
  parent_id     uuid,
  is_template   boolean default false,       -- true면 일반 뷰/쿼리에서 제외
  template_of   uuid null,                   -- is_template일 때 소속 database_id
  properties    jsonb,                       -- DB 템플릿의 property 기본값 저장 위치
  created_by    uuid,
  ...
)

-- 2) 템플릿 메타 (기본 템플릿 지정, 반복 설정)
database_template_config (
  template_page_id uuid pk fk->page.id,
  database_id      uuid fk,
  name             text,                     -- 템플릿 페이지의 title이 곧 이름
  position         int,                      -- 템플릿 목록 정렬
  created_by       uuid
)

view_default_template (
  view_id          uuid pk,                  -- NULL이면 database 전체 기본값
  database_id      uuid,
  template_page_id uuid fk,
  scope            enum('view','all_views')
)

-- 3) 반복 템플릿(recurring)
template_recurrence (
  id               uuid pk,
  template_page_id uuid fk,
  freq             enum('daily','weekly','monthly','yearly'),
  interval         int default 1,            -- "n주마다"
  byweekday        int[] null,               -- weekly일 때 요일
  bymonthday       int null,                 -- monthly일 때 일자 [확인필요]
  start_date       date,
  end_date         date null,
  run_at_time      time,
  timezone         text,
  next_run_at      timestamptz,              -- 스케줄러가 읽는 인덱스 컬럼
  enabled          boolean default true
)

-- 4) 자동화 정의 (버튼/automation 공통)
automation (
  id            uuid pk,
  workspace_id  uuid,
  kind          enum('button_block','button_property','db_automation'),
  host_id       uuid,     -- button_block: block.id / button_property: property.id / db_automation: database.id
  name          text,
  label         text null,      -- 버튼 표기 텍스트 + 아이콘/스타일
  style         jsonb null,
  trigger_mode  enum('any','all') default 'any',  -- 다중 트리거 결합 방식
  enabled       boolean default true,
  created_by    uuid,           -- 실행 권한 판정 기준 [확인필요]
  updated_at    timestamptz
)

automation_trigger (
  id            uuid pk,
  automation_id uuid fk,
  type          enum('page_added','property_edited','schedule','manual_click'),
  property_id   uuid null,
  condition     jsonb null,     -- {op:'is', value:['Done']} 형태
  schedule      jsonb null      -- template_recurrence와 동일 형태
)

automation_action (
  id            uuid pk,
  automation_id uuid fk,
  order_index   int,            -- 순차 실행
  type          enum('insert_blocks','add_page_to','edit_pages_in','edit_property',
                     'send_notification','send_mail','send_webhook','send_slack',
                     'open_page_or_url','show_confirmation','define_variables'),
  config        jsonb           -- 액션별 인자. 값 슬롯은 정적값 | 변수참조 | formula AST
)

-- 5) 실행 기록 (루프 방지 · 디버깅 · 감사)
automation_run (
  id            uuid pk,
  automation_id uuid,
  trigger_page_id uuid null,
  actor_id      uuid null,      -- 버튼 클릭자 or 시스템
  origin        enum('user','automation','schedule','api'),
  depth         int default 0,  -- 연쇄 깊이. 루프 차단에 사용
  status        enum('queued','running','success','partial','failed'),
  error         jsonb null,
  started_at, finished_at timestamptz
)

-- 6) AI 계층 (F-08-15 / F-08-16). automation_run과 같은 실행 로그 뼈대를 공유해야 한다
ai_autofill_config (
  property_id      uuid pk fk->property.id,
  mode             enum('basic','agent'),
  task             enum('summary','translate','key_info','custom') null,  -- basic 전용
  instruction      text null,                 -- agent 모드의 지시문
  use_workspace_search boolean default false,
  use_web          boolean default false,
  run_on           jsonb,                     -- {manual:true, on_create:true, on_edit:false, schedule:null}
  model            text null,
  enabled          boolean default true
)

agent (
  id            uuid pk,
  workspace_id  uuid,
  name          text,
  instructions  text,
  model         text,                          -- 'auto' 기본
  web_enabled   boolean default false,
  created_by    uuid
)

agent_access (                                 -- 명시적으로 부여된 대상만. 기본 접근 없음
  agent_id      uuid fk,
  resource_type enum('page','database','slack_channel','connector'),
  resource_id   text,
  level         enum('read','edit')
)

agent_trigger (
  id            uuid pk,
  agent_id      uuid fk,
  type          enum('schedule','page_added','property_updated','page_removed',
                     'comment_added','meeting_note_finished',
                     'slack_message','slack_reaction','slack_mention'),
  filter        jsonb null,                    -- property 값 / view / 키워드 필터
  schedule      jsonb null
)

-- 7) 개발자 플랫폼 (F-08-17 / F-08-18)
webhook_subscription (
  id                 uuid pk,
  integration_id     uuid,
  url                text,                     -- HTTPS 공개 엔드포인트만. 검증 후 변경 불가
  verification_token text,                     -- HMAC-SHA256 서명 키를 겸함
  status             enum('pending','active','disabled'),
  event_types        text[],                   -- 자동 확장되지 않음(신규 이벤트는 수동 추가)
  created_at         timestamptz
)

webhook_delivery (
  id              uuid pk,
  subscription_id uuid fk,
  event_id        uuid,                        -- outbox 이벤트와 1:1. 소비자 멱등키로 노출
  attempt         int default 0,
  status_code     int null,
  next_retry_at   timestamptz null,
  status          enum('pending','delivered','failed')
)

worker (
  id           uuid pk,
  workspace_id uuid,
  name         text,
  code_ref     text,                            -- 배포된 번들 위치
  schedule     text null,                       -- cron. 15분/1시간/1일 주기 동기화용
  secrets_ref  text null,
  created_by   uuid
)
```

> `automation_run` / `agent_run` / `worker_run`을 **하나의 `run` 테이블 + `kind` 컬럼**으로 둘지, 분리할지는 초기에 결정해야 한다. 권장은 통합이다 — 루프 차단(`origin`,`depth`)과 워크스페이스 쿼터가 세 계층을 가로질러 계산돼야 하기 때문이다 `[추정 — 노션 내부 구조는 비공개]`.

### 값 슬롯(value slot) 개념 — 이 도메인의 핵심 추상

액션의 모든 인자는 세 형태 중 하나여야 한다. 이걸 초반에 정하지 않으면 나중에 전부 뜯어고쳐야 한다.

| 형태 | 예시 | 비고 |
|---|---|---|
| `literal` | `{"type":"literal","value":"To do"}` | 정적 값 |
| `mention` | `{"type":"mention","source":"trigger_page","property_id":"..."}` | 트리거/현재 페이지 property 참조. `person_who_clicked`, `now` 같은 시스템 변수 포함 |
| `formula` | `{"type":"formula","ast":{...}}` | 수식 도메인(F-06 등)의 AST 재사용 |
| `variable` | `{"type":"variable","name":"total"}` | `define_variables` 액션이 만든 런타임 변수 |

노션은 "mention과 formula는 **액션에서만** 쓸 수 있고 트리거에서는 못 쓴다", "블록 삽입 / 페이지·URL 열기 / Slack 알림 액션에서는 formula를 쓸 수 없다"고 명시한다.
출처: https://www.notion.com/help/database-buttons , https://www.notion.com/help/database-automations

---

## 기능 명세

### F-08-01 페이지 템플릿 (일반 페이지 복제형 템플릿)

- **한 줄 정의**: 임의의 페이지를 원본으로 삼아 블록 트리 전체를 새 페이지로 복제한다.
- **사용자 시나리오**: 사이드바에서 템플릿용 페이지를 연다 → `•••` → `Duplicate` → 사본이 같은 부모 아래 "제목 (1)"로 생성된다 → 제목/내용을 수정해 사용한다. 갤러리 템플릿도 결국 이 복제 경로를 탄다.
- **동작 상세**:
  - 복제는 **깊은 복사**. 자식 페이지, 자식 블록, 인라인 DB까지 새 id로 재생성된다.
  - 복제 시 `created_by`/`created_time`은 복제 시점·복제자로 재설정된다 `[추정]`.
  - 내부 링크·relation은 원본 대상을 그대로 가리킨다(사본을 가리키도록 재매핑되지 않는다). 노션은 DB 템플릿 문서에서 relation을 미리 채우면 "생성되는 모든 페이지가 같은 페이지를 참조하게 된다"고 경고한다 — 복제 시 참조 재매핑이 없다는 근거.
  - Notion에는 "workspace 전역 페이지 템플릿" 개념이 별도로 없다. 공식 정의는 "복제 가능한 공개 페이지는 모두 템플릿"이다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 페이지 복제 | 제목만 있는 빈 페이지 생성, 오류 없음 |
  | 원본에 수천 블록 / 깊은 중첩 | 동기 복제 불가 → 비동기 잡 + "복제 중" 플레이스홀더 필요 `[추정]` |
  | 원본이 삭제(휴지통)된 상태 | 템플릿 목록에서 제거, 참조는 dangling 처리 |
  | 원본의 일부 자식 페이지에 복제자가 권한 없음 | 권한 있는 부분만 복제하거나 전체 거부 `[확인필요]` |
  | 복제 도중 원본이 동시 편집됨 | 스냅샷 기준 복제(원본 최신 편집이 사본에 반영되지 않을 수 있음) `[추정]`. CRDT 스택에서는 "특정 버전 벡터 시점의 서브트리"를 고정해 읽어야 하며, 그렇지 않으면 사본에 반쯤 적용된 편집이 섞인다 |
  | 원본 자신을 자기 하위로 복제(순환) | 부모 체인 검사로 차단. 새 부모가 복제 대상 서브트리 내부면 거부 |
  | 복제본 안의 relation이 원본 서브트리 내부 페이지를 가리킴 | id 재매핑 테이블로 **사본 내부 대상**으로 치환. 외부 대상은 원본 유지 — 이 규칙을 문서화하지 않으면 사용자가 가장 많이 혼란스러워하는 지점 |
  | 파일/이미지 수백 MB 첨부 | 스토리지 객체 참조 공유(복사 아님) + 원본 삭제 시 GC가 참조 카운트를 보게 설계 |
- **데이터 모델 함의**: 복제 = `page` + `block` 서브트리의 재귀 INSERT + id 재매핑 테이블(`old_id -> new_id`). 서브트리 내부를 가리키는 링크만 재매핑하고 외부 참조는 유지하는 규칙이 필요하다. 파일/이미지는 스토리지 객체 참조 카운트 증가 또는 재업로드.
- **UI/인터랙션**: 페이지 `•••` 메뉴 → Duplicate, `Ctrl/Cmd+D`(선택 블록 복제), 사이드바 드래그로 위치 이동.
- **의존 기능**: 블록 트리(F-01), 페이지 권한 모델, 파일 스토리지.
- **구현 난이도**: **L** — 재귀 복제 자체는 쉬우나 대용량 비동기 처리, id 재매핑, 첨부 파일 처리, 권한 필터링이 겹친다. 실시간 협업(CRDT/OT) 스택 위에서는 "일관된 스냅샷 읽기"가 추가로 필요해 **L의 상단**으로 잡아야 한다.
- **우선순위**: **P0** — 다른 모든 템플릿 기능이 이 복제 엔진 위에 올라간다.
- **클론 시 현실적 대안**: 1차는 동기 복제 + 블록 수 상한(예: 1,000 블록) 두고, 초과 시 비동기 큐로 넘긴다. 첨부는 재업로드 대신 참조 공유.
- **참고 출처**: https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates , https://www.notion.com/help/database-templates

---

### F-08-02 데이터베이스 템플릿 (새 항목 기본값)

- **한 줄 정의**: 특정 데이터베이스에 속한 "새 행의 초기 상태"를 정의한다 — property 기본값 + 본문 블록 트리.
- **사용자 시나리오**: DB 우측 상단 `New` 버튼의 드롭다운 화살표 클릭 → `+ New template` → 열린 템플릿 페이지에서 제목(= 템플릿 이름) 입력, Priority=P1, PM=Fig 같은 property를 미리 채움, 본문에 체크리스트/이미지/서브페이지 작성 → 닫기. 이후 `New ▾`에서 해당 템플릿 선택 시 그 상태로 새 행 생성.
- **동작 상세**:
  - 템플릿은 **그 데이터베이스 안에서만** 존재한다(워크스페이스 전역 아님). 개수 제한 없음.
  - 템플릿 페이지 자체는 DB의 일반 뷰/쿼리 결과에 나타나지 않는다 → `is_template` 플래그로 필터링 `[추정]`.
  - 템플릿으로 생성한 페이지는 이후 자유롭게 수정 가능하며, **템플릿 원본과 링크되지 않는다**. "템플릿 변경은 기존 행에 소급되지 않으며, 그 이후 생성되는 행에만 새 구조가 적용된다" `[2차출처 — 공식 help 페이지에는 명시 없음. 데이터 모델이 '참조'가 아니라 '복제'임을 확정하는 근거]` (https://www.usecarly.com/blog/how-to-add-template-to-notion/)
  - 템플릿 **개수 제한 없음**(공식: "You can make as many as you want").
  - relation property를 템플릿에 채워두면 그 템플릿으로 만든 모든 페이지가 동일 대상을 참조한다(공식 경고).
  - 빈 상태의 DB에서 새 페이지를 만들면 회색 메뉴로 템플릿 목록이 노출된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 템플릿에 저장된 property가 이후 DB에서 삭제됨 | 해당 값은 무시 (템플릿 로드 시 스키마 교차 검증 필요) |
  | property 타입이 select→text로 변경됨 | 저장된 값 변환 또는 폐기 `[확인필요]` |
  | 템플릿 삭제 후 그 템플릿이 기본값으로 지정돼 있었음 | 기본값 해제 → "빈 페이지"로 폴백 |
  | 동시에 두 사용자가 같은 템플릿으로 행 생성 | 각각 독립 사본, 충돌 없음 |
  | 템플릿 본문에 서브페이지가 있음 | 서브페이지까지 복제 (중첩 깊이 제한 검토) |
  | 템플릿 사용자에게 DB 편집 권한 없음 | 템플릿 목록 노출은 하되 생성 불가 `[추정]` |
- **데이터 모델 함의**: `page.is_template = true`, `page.template_of = database_id`. property 기본값은 별도 컬럼이 아니라 **템플릿 페이지 자신의 property 값**으로 저장 → 스키마 변경 시 자동으로 같은 규칙 적용. 조회 시 모든 뷰 쿼리에 `WHERE is_template = false` 강제.
- **UI/인터랙션**: `New ▾` 드롭다운, 템플릿 항목 hover 시 `•••`(Edit / Duplicate / Delete / Set as default / Repeat), 템플릿 편집 화면 상단에 "템플릿 편집 중" 배너 `[확인필요]`.
- **의존 기능**: F-08-01(복제 엔진), 데이터베이스 & property 스키마, 뷰 쿼리 필터.
- **구현 난이도**: **M** — 복제 엔진이 있으면 플래그 + 목록 UI + 쿼리 필터가 대부분. 2~4일.
- **우선순위**: **P0** — DB를 만든 순간 사용자가 가장 먼저 원하는 자동화.
- **클론 시 현실적 대안**: v1은 "property 기본값 + 본문 블록" 복제만. 서브페이지 중첩 복제와 relation 경고 UI는 v2.
- **참고 출처**: https://www.notion.com/help/database-templates , https://www.notion.com/help/guides/using-database-templates

---

### F-08-03 기본 템플릿 지정 (뷰별 / 전체 뷰)

- **한 줄 정의**: `New` 버튼을 그냥 눌렀을 때 자동 적용될 템플릿을 뷰 단위 또는 DB 전체 단위로 고정한다.
- **사용자 시나리오**: `New ▾` → 템플릿 우측 `•••` → `Set as default` → 다이얼로그에서 `This view only` / `All views in the database` 중 선택 → 이후 그 뷰의 `New` 클릭은 템플릿이 적용된 페이지를 바로 연다.
- **동작 상세**:
  - 기본 템플릿이 지정되면 템플릿 선택 메뉴를 건너뛴다.
  - 실제 UI 선택지 문구는 "For all new pages"(DB 전체)와 "For all new pages in <현재 뷰 이름>"(그 뷰 한정)이며, **뷰마다 다른 기본 템플릿을 둘 수 있다** `[2차출처]`. 따라서 뷰별 지정이 DB 전체 지정보다 우선한다(스코프 우선순위 확정).
  - 캘린더/보드 뷰에서 셀·날짜 클릭으로 생성할 때도 기본 템플릿이 적용된다 `[확인필요]`.
  - 해제는 같은 메뉴에서 `Remove default` `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 기본 템플릿이 삭제됨 | 지정 해제, 빈 페이지로 폴백 |
  | 뷰가 삭제됨 | `view_default_template` 행 cascade 삭제 |
  | linked database view(다른 DB를 참조하는 뷰) | 원본 DB의 템플릿 목록을 사용, 기본값은 해당 뷰에 별도 저장 `[확인필요]` |
  | 보드 뷰에서 그룹 컬럼값과 템플릿 property가 충돌 | 그룹 컬럼값이 템플릿 값을 덮어씀 `[추정]` |
  | 두 사용자가 동시에 서로 다른 템플릿을 기본값으로 지정 | 단일 행 UPSERT + last-write-wins. 실시간 브로드캐스트로 상대 화면의 `New` 라벨까지 갱신해야 함 `[추정]` |
  | 기본 템플릿이 참조하는 relation 대상 DB에 클릭자 권한이 없음 | 페이지는 생성하되 권한 없는 relation은 빈 값으로 두고 경고 `[추정]` |
  | 뷰 필터와 기본 템플릿의 property 값이 모순되어 생성 즉시 뷰에서 사라짐 | "이 뷰의 필터와 맞지 않아 표시되지 않음" 안내 필수 — 사용자가 "저장이 안 됐다"고 오해하는 대표 케이스 `[추정]` |
- **데이터 모델 함의**: `view_default_template(view_id nullable, database_id, template_page_id, scope)`. 조회 시 `view_id = ? OR (view_id IS NULL AND database_id = ?)` 로 두 단계 조회.
- **UI/인터랙션**: 템플릿 목록에서 기본 템플릿에 배지/체크 표시, `New` 버튼 라벨을 `New <템플릿명>`으로 바꿔 예측 가능성 확보 `[확인필요]`.
- **의존 기능**: F-08-02, 뷰(view) 엔티티.
- **구현 난이도**: **S** — 테이블 하나 + 스코프 우선순위 규칙. 1일.
- **우선순위**: **P1** — 없어도 템플릿은 동작하지만 반복 입력 비용이 크게 다르다.
- **클론 시 현실적 대안**: v1은 "DB 전체 기본값" 하나만. 뷰별 오버라이드는 v2.
- **참고 출처**: https://thomasjfrank.com/docs/ultimate-brain/working-with-database-templates/ , https://www.notion.com/help/database-templates

---

### F-08-04 반복 템플릿 (Recurring templates)

- **한 줄 정의**: 지정한 주기·시각에 템플릿을 자동으로 실행해 새 DB 페이지를 생성한다(예: 매주 월요일 오전 9시 "주간 회의록" 생성).
- **사용자 시나리오**: `New ▾` → 템플릿 `•••` → `Repeat` → 빈도(daily / weekly / monthly / yearly) 선택 → 반복 간격(n주/n개월/n년), 시작 날짜, 생성 시각 지정 → 저장. 지정 시각에 DB에 페이지가 나타난다.
- **동작 상세**:
  - 공식 빈도 옵션: **daily, weekly, monthly, yearly** + interval + start date + time.
  - **중첩 제한(공식 문구 재확인)**: "You can only have three levels of nesting per database template" / "You can't nest a template within a template that recurs daily" — DB 템플릿당 최대 3단계 중첩, daily 반복 템플릿 안에는 템플릿 중첩 불가.
  - **핵심 제약**: 반복 템플릿이 만든 페이지는 **database automation을 트리거하지 않는다**. 상위 규칙인 "Automations can not be triggered by other automations"는 공식 문서에 있으나, 그 구체 사례로서 반복 템플릿을 명시한 것은 `[2차출처]`다 (https://thomasjfrank.com/notion-database-automations-the-complete-guide/). **반대로 버튼 클릭으로 생성된 페이지는 automation을 트리거한다** — 이 비대칭이 F-08-10 설계의 핵심이다.
  - 타임존 처리는 반복 템플릿 문서에 명시가 없다 `[확인필요]`. 반면 automation의 `Every {frequency}` 트리거는 타임존 설정을 명시한다 → 내부적으로 같은 스케줄러를 쓸 가능성 `[추정]`.
  - 생성되는 페이지의 date property가 자동으로 "그 주기의 날짜"로 채워지는지는 문서에 명시 없음 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 앱이 꺼져 있거나 서버 다운으로 실행 시각 놓침 | catch-up 실행 여부 정책 필요. 중복 생성 방지를 위해 `(recurrence_id, scheduled_for)` 유니크 키 권장 `[추정]` |
  | 31일 monthly 반복 + 2월 | 말일로 clamp 또는 스킵 — 정책 명시 필요 `[확인필요]` |
  | DST 전환일의 지정 시각 | 로컬 시각 고정(wall-clock) 권장, UTC 고정은 사용자 기대와 어긋남 `[추정]` |
  | 원본 템플릿이 삭제됨 | 반복 중지 |
  | 반복이 만든 페이지를 사용자가 삭제 | 다음 주기에 새로 생성, 소급 복구 없음 |
  | 대상 DB가 삭제/이동 | 반복 비활성화 + 사용자 알림 `[추정]` |
- **데이터 모델 함의**: `template_recurrence` 테이블 + `next_run_at` 인덱스. 워커가 `SELECT ... WHERE next_run_at <= now() AND enabled FOR UPDATE SKIP LOCKED`로 폴링. 실행 후 `next_run_at` 재계산(RRULE 라이브러리 권장). 멱등성 키: `recurrence_id + scheduled_for`.
- **UI/인터랙션**: 템플릿 목록에서 반복 중인 템플릿에 🔁 아이콘 + "매주 월요일 오전 9시" 요약 문구, 반복 설정 팝오버.
- **의존 기능**: F-08-02, 백그라운드 잡 스케줄러, 타임존 라이브러리.
- **구현 난이도**: **L** — 반복 규칙(RRULE) + 스케줄러 인프라 + 멱등성 + 타임존/DST. 로직보다 운영 리스크가 큼.
- **우선순위**: **P2** — MVP에는 불필요. 단, "스케줄러 인프라"는 F-08-10과 공유되므로 함께 계획해야 한다.
- **클론 시 현실적 대안**: 자체 스케줄러 대신 cron 워커 + `rrule` 라이브러리. 빈도를 daily/weekly/monthly로 제한하고 중첩 템플릿은 미지원.
- **참고 출처**: https://www.notion.com/help/database-templates , https://www.notion.com/help/database-automations

---

### F-08-05 템플릿 갤러리 / 마켓플레이스 (공개 템플릿 배포·복제)

- **한 줄 정의**: 페이지를 웹에 게시하면서 "템플릿으로 복제 허용"을 켜 외부인이 자기 워크스페이스로 복제할 수 있게 한다.
- **사용자 시나리오**: 페이지 우상단 `Share` → `Publish` 탭 → `Publish to web` → `Allow duplicate as template` 토글 ON → 공개 URL을 배포 → 방문자가 우상단 "Duplicate / Start with this template" 클릭 → 로그인 후 자기 Private 섹션에 사본 생성. 마켓플레이스 등록은 `notion.com/templates` → `Submit a template`에 공개 링크·이름·설명·카테고리 제출.
- **동작 상세**:
  - 공식 정의: "복제 가능한 공개 페이지는 모두 템플릿이다."
  - 복제 결과는 사용자의 **Private** 영역에 생성된다.
  - 크리에이터 프로필은 Notion 계정 프로필과 **분리된 별도 엔티티**(프로필 사진/커버/소개), 유료 판매 지원.
  - 사이드바의 `Marketplace` 버튼은 템플릿 갤러리를 팝업으로 연다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 템플릿 원본에 비공개 하위 페이지 포함 | 공개된 서브트리만 복제되어야 함(권한 누출 방지) — 보안상 가장 중요한 지점 |
  | 원본에 relation이 외부 DB를 가리킴 | 대상이 함께 복제되지 않으면 빈 relation |
  | 원본이 나중에 비공개 전환 | 기존 사본은 유지, 신규 복제 차단 |
  | 익명(비로그인) 방문자가 복제 시도 | 로그인/가입 플로우로 유도 후 복제 |
  | 초대형 템플릿(수천 블록) | 비동기 복제 + 진행 표시 |
  | 악성 템플릿(외부 webhook 버튼 포함) | 액션 포함 여부 사전 고지·검수 필요 `[추정, 보안 이슈]` |
- **데이터 모델 함의**:
  ```sql
  public_share (page_id pk, slug text unique, allow_duplicate bool,
                published_by uuid, published_at timestamptz)
  template_listing (id pk, page_id, creator_profile_id, title, description,
                    category, price_cents, status enum('draft','review','live'))
  creator_profile (id pk, user_id, handle unique, avatar, cover, bio)
  template_duplication_log (listing_id, user_id, at)  -- 사용량 집계
  ```
- **UI/인터랙션**: Share 패널의 Publish 탭 토글, 공개 페이지 상단 고정 "Duplicate" 버튼, 갤러리 검색/카테고리 필터.
- **의존 기능**: F-08-01(복제), 공개 게시(public share) 기능, 권한 모델, (판매 시) 결제.
- **구현 난이도**: **XL** — 복제 자체보다 공개 게시 인프라 + 크리에이터 프로필 + 검수/결제가 각각 독립 시스템.
- **우선순위**: **P2** — 클론 MVP와 무관. 단, "공개 링크에서 복제" 최소 기능은 P1로 승격 가능.
- **클론 시 현실적 대안**: 마켓플레이스 전체를 만들지 말고, ① 워크스페이스 내부 "Templates" 폴더 + ② 공개 링크 + `?duplicate=1` 복제 버튼까지만 구현.
- **참고 출처**: https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates , https://www.notion.com/help/selling-on-marketplace , https://www.notion.com/help/finding-templates-on-marketplace

---

### F-08-06 버튼 블록 (`/button`) — 블록 삽입형 자동화

- **한 줄 정의**: 페이지 본문에 놓이는 클릭 가능한 블록으로, 클릭 시 미리 정의한 블록 묶음을 지정 위치에 삽입한다(구 "template button"의 후신).
- **사용자 시나리오**: 본문에서 `/button` 입력 → 버튼 블록 생성 → 설정 패널에서 버튼 이름/아이콘 입력 → `Insert blocks` 액션 추가 → 삽입할 블록(체크박스, 토글, 텍스트 등)을 에디터에서 직접 작성 → 삽입 위치 선택(`Above button` / `Below button` / `At top of page` / `At bottom of page`) → 저장 → 클릭할 때마다 그 블록 묶음이 복제 삽입된다.
- **동작 상세**:
  - 생성 권한: `Full access` 또는 `Can edit`. 클릭 권한도 동일(버튼 블록 기준). 버튼 property는 `Can edit content`도 클릭 가능.
  - 구 `/template` 슬래시 커맨드는 워크스페이스 생성 시기에 따라 아직 노출될 수 있고("`/template button`을 입력하면 여전히 추가된다"), 블록 삽입 케이스에 한해 `/button`과 동일하게 동작한다 `[2차출처 — https://www.xray.tech/post/new-notion-buttons , https://noteforms.com/notion-glossary/template-button]`. 즉 **버튼 블록은 구 template button의 상위 호환**이며(삽입 위치 선택 옵션이 추가됨), 클론은 처음부터 버튼 블록 하나만 만들면 된다.
  - 2차 출처는 버튼으로 "AI 콘텐츠 생성"까지 가능하다고 서술하지만, 2026-09 시점 공식 buttons 헬프 문서의 액션 목록에는 AI 액션이 없다 `[확인필요 — AI 기능은 F-08-15/F-08-16 계층으로 분리된 것으로 보인다]`.
  - 삽입되는 블록은 버튼 설정 안에 **자식 블록 트리로 저장**된다(공개 API의 `template` 블록 타입이 `{rich_text, children}` 구조를 가졌던 것과 일치).
  - `Insert blocks` 액션에서는 **formula를 쓸 수 없다**(공식 제약).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 삽입 블록이 비어 있음 | 클릭해도 아무 일 없음, 저장 시 경고 |
  | 버튼을 다른 페이지로 이동 | `At top/bottom of page`가 새 페이지 기준으로 해석됨 |
  | 버튼 자체를 복제 | 액션 정의도 함께 복제, 대상 DB 참조는 그대로 유지 |
  | 삽입 블록에 DB/서브페이지 포함 | 매 클릭마다 새 DB/페이지 생성(의도치 않은 폭증 가능) |
  | 클릭 연타 | 클라이언트 디바운스 + 서버 멱등 토큰 필요 `[추정]` |
  | 클릭자에게 페이지 편집 권한 없음 | 버튼 비활성 또는 실행 거부 |
  | 동시 편집 중 삽입 | CRDT/OT 상에서 일반 블록 삽입과 동일하게 처리 |
- **데이터 모델 함의**: `block(type='button')` + `automation(kind='button_block', host_id=block.id)` + `automation_action(type='insert_blocks', config={position, children_block_ids[]})`. 삽입 원본 블록들은 버튼의 숨김 자식으로 저장하고, 일반 렌더링에서 제외.
- **UI/인터랙션**: hover 시 우측 ⚙️(설정) 노출, 좌측 `⋮⋮` 드래그 핸들 + 컨텍스트 메뉴(Duplicate/Delete), 버튼 색상/아이콘 커스터마이즈.
- **의존 기능**: 블록 에디터, 슬래시 커맨드(F-08-12), 액션 실행 엔진(F-08-07).
- **구현 난이도**: **M** — 블록 삽입 자체는 단순. 설정 패널 UX(중첩 에디터)가 실제 비용.
- **우선순위**: **P1** — 문서형 워크스페이스에서 체감 가치가 높고 DB 없이도 동작한다.
- **클론 시 현실적 대안**: 액션 종류를 `insert_blocks` 하나로 시작. 위치 옵션은 `Below button` / `At bottom of page` 두 개만.
- **참고 출처**: https://www.notion.com/help/buttons , https://www.notion.com/help/guides/automatically-generate-blocks-pages-with-buttons , https://developers.notion.com/reference/block

---

### F-08-07 액션 실행 엔진 (버튼·automation 공통 액션 목록)

- **한 줄 정의**: 트리거가 발생했을 때 순차 실행되는 액션 스텝들의 정의·검증·실행 계층.
- **사용자 시나리오**: 버튼 설정 또는 automation 설정에서 `+ Add step` → 액션 종류 선택 → 대상(DB/사람/URL)과 값 지정 → 스텝을 드래그로 순서 변경 → 저장.
- **동작 상세** — 공식 액션 목록:

  | 액션 | 동작 | 버튼 | DB automation | 플랜 제약 |
  |---|---|---|---|---|
  | `Insert blocks` | 지정 위치에 블록 삽입 | O | X | 전체 |
  | `Add page to` | 지정 DB에 페이지 생성 + property 설정 | O | O | 전체 |
  | `Edit pages in` | 지정 DB의 필터 일치 페이지들 property 수정 | O | O | 전체 |
  | `Edit property` | (automation) 트리거 페이지의 property 수정 | — | O | 전체 |
  | `Send notification to` | 워크스페이스 멤버 **최대 20명**, 또는 **특정 People property에 연결된 사람들**(동적 수신자) | O | O | 전체 |
  | `Send mail to` | Gmail 계정으로 메일 발송 | O | O | 유료 |
  | `Send webhook` | 지정 URL로 HTTP POST | O | O | 유료 |
  | `Send Slack notification to` | Slack 채널에 메시지 | O | O | Plus/Business/Enterprise |
  | `Show confirmation` | 실행 전 확인 다이얼로그 | O | X | 전체 |
  | `Open page or URL` | 페이지(기존/방금 생성) 또는 URL 열기 | O | X | 전체 |
  | `Define variables` | mention/formula로 런타임 변수 정의 | O | O | 전체 |

  - multi-select / people / relation 값은 **덮어쓰기뿐 아니라 개별 값 추가·제거**를 지원한다.
  - `Edit pages in`은 필터 조건으로 대상 집합을 지정한다("적용한 필터에 따라 특정 항목을 수정").
  - person property에 `Person who clicked the button` 같은 **동적 실행자 값**을 넣을 수 있다.
  - 메일 발송은 도착까지 최대 2분 소요될 수 있다(공식).
  - `Send webhook` 세부 제약(공식, https://www.notion.com/help/webhook-actions): **automation 하나당 최대 5개**, **POST만 지원**, **커스텀 헤더(key-value) 추가 가능하나 노션이 제공하는 인증 방식은 없음**(토큰을 헤더에 직접 넣어야 함), 전송 대상은 **DB 페이지의 property뿐이며 페이지 본문(블록)은 보낼 수 없음**, DB 버튼 property는 전송 필드로 선택 불가, **워크스페이스 레벨 webhook은 없음**, Enterprise 워크스페이스 소유자는 Settings > Connections에서 webhook을 전면 비활성화할 수 있음.
  - 템플릿이 지정한 값이 버튼이 생성하려는 값과 충돌하면 **템플릿 값이 우선**한다 — 공식 문구 "The values from the template overwrite the values from the button"으로 **재확인 완료**(초판의 `[확인필요]` 해제). 값 병합 순서는 `버튼 액션 값 적용 → 템플릿 값이 덮어씀`이다. 직관과 반대이므로 클론은 설정 화면에서 경고해야 한다.
  - 버튼 **클릭** 권한 = 페이지의 `Full access`/`Can edit` + **액션 대상별 추가 조건**(페이지 추가·수정 액션은 대상 DB의 editor 권한, 페이지 열기 액션은 대상에 대한 view 권한)(공식).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 스텝 3개 중 2번째 실패 | 부분 실패 정책 필요. 전체 롤백 vs 이어서 진행 — 노션 동작 `[확인필요]`. 클론은 `status='partial'` + 로그 권장 |
  | 대상 DB가 삭제됨 | 액션 무효화 + 설정 화면에 오류 배지 |
  | 대상 DB에 실행자 권한 없음 | 실행 거부(공식: 클릭자가 대상 DB의 editor여야 함) |
  | `Edit pages in` 필터가 5,000행 매칭 | 배치/비동기 처리 + 상한 필요 `[추정]` |
  | webhook 대상이 5초 무응답 / 5xx 반환 | **노션 실동작(공식): 무한 재시도가 아니라 automation에 느낌표를 표시하고 automation을 일시정지하며, 사용자가 수동으로 재개해야 한다.** 클론도 이 모델(N회 실패 → 정지 → 수동 재개)이 안전하다. 타임아웃 값 자체는 비공개 `[확인필요]` |
  | 같은 스텝이 재시도로 두 번 실행됨 | 액션별 멱등키(`run_id + action_id`) 필수. `Edit property`는 멱등이지만 `Add page to`·`Insert blocks`는 비멱등이라 반드시 키가 필요 |
  | 액션 대상이 5,000행이고 행마다 formula 평가 | 배치 처리 + 상한. 상한 초과 시 부분 실행보다 **거부**가 안전 `[추정]` |
  | 스텝 실행 중 대상 페이지가 다른 사용자에 의해 동시 수정 | last-write-wins 또는 낙관적 락. 최소한 실행 로그에 "덮어쓴 이전 값"을 남겨야 복구 가능 `[추정]` |
  | 알림 대상 21명 지정 | 20명 상한에서 거부 |
  | 액션 값이 읽기 전용 property(formula/rollup/created_time) | 선택 불가 처리 |
- **데이터 모델 함의**: `automation_action(order_index, type, config jsonb)` + 실행 시 `automation_run` 레코드. config 내부의 모든 값은 위의 **값 슬롯** 규약을 따른다. 액션별 config 스키마를 JSON Schema로 버전 관리해야 마이그레이션이 가능하다.
- **UI/인터랙션**: 스텝 리스트(드래그 정렬), 스텝별 접기/펼치기, 값 입력란에서 `@`로 mention 삽입, 저장 전 유효성 검사 표시.
- **의존 기능**: 권한 모델, 데이터베이스 CRUD, 알림 시스템, 수식 엔진, 아웃바운드 HTTP 워커.
- **구현 난이도**: **XL** — 액션이 11종이고 각각 별도 통합(메일/Slack/webhook/알림)을 요구한다. 엔진 뼈대만 1~2주, 전체는 그 이상.
- **우선순위**: **P1** (엔진 뼈대 + `add_page_to`/`edit_property`/`insert_blocks` 3종은 P1, 외부 연동 액션은 P2)
- **클론 시 현실적 대안**: 액션을 플러그인 인터페이스(`execute(ctx, config)`)로 정의하고 내부 액션 3~4종만 먼저 구현. 외부 연동은 `send_webhook` 하나로 통일해 사용자가 n8n/Zapier로 연결하게 한다.
- **참고 출처**: https://www.notion.com/help/buttons , https://www.notion.com/help/database-buttons , https://www.notion.com/help/database-automations

---

### F-08-08 데이터베이스 버튼 property

- **한 줄 정의**: 데이터베이스의 property 타입 중 하나로, 각 행마다 자기 자신을 대상으로 하는 버튼을 표시한다.
- **사용자 시나리오**: DB 상단 슬라이더 아이콘 → `Edit properties` → `New property` → 타입 `Button` 선택 → 라벨 입력 → `Edit automation`으로 액션 구성 → 각 행의 해당 셀에 버튼이 렌더링되고, 클릭하면 **그 행**을 대상으로 액션이 실행된다.
- **동작 상세**:
  - 액션 종류는 버튼 블록과 동일(F-08-07 표).
  - 버튼 블록과의 핵심 차이: **암묵적 컨텍스트 `this page`(= 클릭된 행)** 가 존재한다. `Edit property`가 그 행의 property를 대상으로 하는 이유.
  - 클릭 권한: `Full access` / `Can edit` / `Can edit content`.
  - 버튼 property는 값이 없으므로 정렬·필터·rollup 대상이 될 수 없다 `[추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 클릭 대상 행이 다른 사용자에 의해 방금 삭제됨 | 실행 거부 + 오류 토스트 |
  | 보드/캘린더 뷰에서의 노출 | 카드에 property로 표시되며 클릭 가능해야 함 `[확인필요]` |
  | 500행 그리드 렌더링 | 버튼 셀은 순수 렌더링이므로 비용 낮음. 단 클릭 시 서버 왕복 필요 |
  | 같은 행에서 두 사용자가 동시에 클릭 | 액션이 비멱등(예: 숫자 +1)이면 이중 적용. 멱등 토큰 또는 낙관적 락 필요 `[추정]` |
  | 버튼 property 삭제 | 연결된 automation 정의도 cascade 삭제 |
  | 템플릿에 버튼 property가 있는 경우 | 값이 없으므로 복제에 영향 없음 |
- **데이터 모델 함의**: `property(type='button')` + `automation(kind='button_property', host_id=property.id)`. 실행 컨텍스트: `{trigger_page_id: row.id, actor_id: user.id}`. property 스키마에는 값이 저장되지 않으므로 row 데이터 크기에 영향 없음.
- **UI/인터랙션**: 셀 안 pill 형태 버튼, hover 시 강조, 실행 중 스피너, 완료 시 체크 애니메이션 `[추정]`.
- **의존 기능**: F-08-07, property 타입 시스템, DB 뷰 렌더러.
- **구현 난이도**: **M** — 엔진이 있으면 property 타입 추가 + 컨텍스트 주입. 3~5일.
- **우선순위**: **P1** — "행 단위 액션"은 태스크 관리 클론의 핵심 UX(예: "완료 처리 + 다음 주로 미루기").
- **클론 시 현실적 대안**: 액션을 `edit_property`(현재 행) + `add_page_to` 2종으로 제한한 경량 버전.
- **참고 출처**: https://www.notion.com/help/database-buttons , https://www.notion.com/help/guides/make-work-more-efficient-database-button-property

---

### F-08-09 데이터베이스 automation — 트리거

- **한 줄 정의**: 데이터베이스에서 발생한 이벤트(페이지 추가 / property 변경 / 스케줄)를 감지해 액션 목록 실행을 시작한다.
- **사용자 시나리오**: DB 상단 ⚡ 아이콘 클릭 → `New automation` → 트리거 선택(`Page added` / `<Property> edited` / `Every <frequency>`) → property 트리거면 조건 지정(예: Status **is** Done) → 여러 트리거일 때 `When any of these occur` / `When all of these occur` 선택 → 액션 추가 → 저장. 이름 지정 가능.
- **동작 상세** — 공식 트리거 3종:

  | 트리거 | 조건 지정 | 비고 |
  |---|---|---|
  | `Page added` | 없음 | DB에 새 페이지가 추가될 때 |
  | `Property edited` | name/person/number/text/select/relation 등 타입별 조건 | 특정 값으로 변경될 때만 등 |
  | `Every {frequency}` | 시각, 시작·종료일, **타임존** | 반복 실행. 다른 트리거와 **조합 불가**(공식) |

  - **트리거에서는 mention·formula를 쓸 수 없다**(공식). 조건은 property 기반 비교 연산만.
  - select/multi-select/status 조건은 "임의의 옵션 또는 특정 옵션들"을 지정. multi-select 조건은 OR 결합만 가능(AND 조합 불가) `[2차 출처 — 확인필요]`.
  - status는 그룹(To-do / In progress / Complete) 단위 조건도 지원 `[2차 출처 — 확인필요]`.
  - **API/인테그레이션에 의한 변경은 트리거하지 않는다** `[2차출처, 확인필요 — 노션 공식 문서에는 명시 없음]`.
  - **3초 윈도우(공식 FAQ, GAP 조사에서 신규 확인)**: "Database automations work over a three second window." 이 창 안에서 사용자가 트리거를 되돌리거나 변경을 삭제하면 **property 변경이 없었던 것으로 처리되어 automation이 실행되지 않는다**. 즉 노션은 변경 이벤트를 즉시 발화시키지 않고 **약 3초간 코얼레싱한 뒤 순변화(net change)로 판정**한다. → 초판의 "한 저장에서 property 3개 동시 변경 시 3회 발화인가 1회인가 `[확인필요]`" 질문의 답이 사실상 여기 있다: **3초 창의 순변화 1건**으로 보는 것이 노션 모델이며, 클론도 이 방식을 그대로 채택하는 것이 옳다(디바운스 + 순변화 판정).
  - **트리거되지 않는 추가 조건(공식 FAQ)**: ① 편집 후 페이지가 **더 이상 뷰 필터에 맞지 않으면** 트리거하지 않는다 ② **데이터베이스가 잠겨 있으면(locked)** 트리거하지 않는다.
  - 접근 권한: automation 생성·편집에는 DB의 full access 필요. 유료 플랜 전용(무료 플랜은 Slack 알림 automation 생성과 템플릿 automation 사용만 가능, 편집 불가).
  - **권한과 실행 범위(공식)**: "자동화는 접근이 제한된 페이지에는 영향을 주지 않는다(Automations won't affect pages with restricted access)". 액션 대상 집합은 **실행 주체의 권한으로 한 번 더 필터링**되고 권한 없는 행은 조용히 건너뛴다. 클론도 "전체 실패"가 아니라 "스킵 + 로그"로 구현해야 사용자 기대와 맞는다. (초판이 "권한 관련 공식 언급 없음"이라고 쓴 것은 오류였다.)
  - **Custom Agents(F-08-16)의 트리거는 이 3종의 상위집합**이다 — 규칙형에 없는 `페이지 제거`, `댓글 추가`, `AI 회의록 완료`, `Slack 메시지/반응/멘션`을 지원한다. 클론의 트리거 타입 enum은 **처음부터 상위집합으로 열어두고** 규칙형 UI에서 일부만 노출하는 편이 마이그레이션 비용이 적다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 대량 임포트로 1,000행 동시 추가 | 1,000회 트리거 → 큐 폭주. 배치/레이트리밋 필수 `[추정]` |
  | 한 저장에서 property 3개 동시 변경 | **3초 코얼레싱 창의 순변화 1건**으로 처리(노션 공식 FAQ의 3초 윈도우에서 유추). 클론은 "변경 이벤트 1건에 변경된 property 집합"을 담아 1회 발화 |
  | 트리거 조건을 만족시켰다가 3초 안에 되돌림 | **발화하지 않음**(공식). 즉 "변경 발생 즉시 큐 투입"이 아니라 "창 종료 시점의 before/after 비교"여야 한다 — 구현 방식이 완전히 달라지는 지점이다 |
  | 편집 결과 페이지가 뷰 필터에서 벗어남 | 트리거하지 않음(공식) |
  | 데이터베이스가 잠김(locked) 상태 | 트리거하지 않음(공식) |
  | 조건 대상 property가 삭제됨 | automation 비활성화 + 오류 표시 |
  | 트리거 조건이 자기 자신을 변경하는 액션과 연결 | 무한 루프 → F-08-10의 차단 규칙 적용 |
  | 페이지가 휴지통에서 복원됨 | `Page added` 발화 여부 `[확인필요]`. 클론은 발화 안 함 권장 |
  | 액션 대상 행 중 일부에 실행 주체의 권한이 없음 | **해당 행만 스킵**(공식: 접근 제한 페이지에는 영향 없음). 전체 실패가 아님 |
  | 트리거 대상 property가 formula/rollup이라 다른 페이지 변경으로 값이 바뀜 | 파생값 재계산도 "편집"으로 볼지 정의 필요 `[확인필요]`. 재계산까지 트리거로 잡으면 rollup 폭포로 큐가 폭발한다 — 클론 권장: **사용자 편집에 의한 직접 변경만 트리거** |
  | 트리거 조건이 A→B, B→A로 두 DB를 오가는 경우 | `origin`/`depth` 억제 외에 automation 정의 그래프에서 정적 사이클 경고를 띄우는 것이 UX상 우수 `[추정]` |
  | automation 생성 이전 데이터 | 소급 실행하지 않음 `[추정]` |
- **데이터 모델 함의**: DB 쓰기 경로에 **이벤트 훅**이 필요하다. 권장 구조: 트랜잭션 커밋 후 `outbox` 테이블에 `{database_id, page_id, event_type, changed_property_ids[], actor_id, origin}` 기록 → 워커가 소비하며 매칭되는 `automation_trigger`를 조회해 `automation_run` 생성. 이 outbox 패턴이 없으면 나중에 실시간 협업(CRDT) 경로와 자동화 경로가 어긋난다.
- **UI/인터랙션**: DB 헤더의 ⚡ 아이콘(활성 automation 개수 배지), automation 목록 팝오버, 켜기/끄기 토글.
- **의존 기능**: 데이터베이스 & property, 변경 이벤트 파이프라인, 잡 큐, 권한 모델.
- **구현 난이도**: **L ~ XL** (초판 `L`에서 상향) — 조건 매칭 자체는 단순하지만, **실시간 협업(CRDT/OT) 스택 위에서 "property가 편집되었다"는 의미 있는 도메인 이벤트를 뽑아내는 것**이 진짜 난관이다. 키 입력 단위 op 스트림을 그대로 트리거로 쓰면 초당 수십 건이 발화하므로 ① op → 도메인 이벤트 축약 ② 디바운스/코얼레싱(노션도 webhook에서 `page.content_updated`를 aggregate한다) ③ 정확히-한-번 보장이 모두 필요하다. 단일 서버 CRUD 모델이면 L, 실시간 협업 위라면 XL.
- **우선순위**: **P1** — DB 클론의 차별화 지점. 단 MVP(P0)에는 넣지 않는다.
- **클론 시 현실적 대안**: `Page added` + `Property edited(특정 값)` 2종만. 스케줄 트리거는 F-08-04 스케줄러와 함께 v2.
- **참고 출처**: https://www.notion.com/help/database-automations , https://thomasjfrank.com/notion-database-automations-the-complete-guide/

---

### F-08-10 자동화 실행 런타임 — 연쇄·루프 차단·실행 주체

- **한 줄 정의**: 트리거와 액션 사이에서 실행 순서, 권한, 재귀 차단, 실패 처리를 책임지는 런타임.
- **사용자 시나리오**: 사용자는 직접 조작하지 않는다. 대신 "automation A가 만든 페이지가 automation B를 또 발동시키는가?" 같은 예측 가능성으로 체감한다.
- **동작 상세** — 노션의 공식 규칙:
  - **automation은 다른 automation을 트리거하지 않는다.** 구체적으로 ① 반복 템플릿 automation이 만든 페이지, ② automation이 다른 DB에 만든 페이지 — 둘 다 후속 automation을 발동하지 않는다.
  - **예외: 버튼 클릭으로 페이지가 생성되면 automation은 발동한다.** 즉 "사람이 시작한 실행"과 "시스템이 시작한 실행"을 구분한다.
  - 이는 곧 실행 컨텍스트에 `origin` 필드가 존재함을 시사한다 `[추정]`: `user | button | automation | schedule | api`. `origin ∈ {automation, schedule}`이면 후속 트리거를 억제.
  - **권한 경계는 공식으로 확인됨**: "자동화는 접근이 제한된 페이지에는 영향을 주지 않는다". 즉 automation은 권한을 우회하지 않는다.
  - 다만 **"누구의 권한으로 실행되는가"는 2차 출처가 서로 충돌한다** `[확인필요 — 이 도메인 최대의 미확정 지점]`: ① "automation 생성자로 실행되며 읽고 쓰는 모든 DB·페이지·property에 생성자의 편집 권한이 필요하다"는 설명과 ② "workspace owner로 실행되어 페이지 수준 접근 규칙에 제약받지 않는다"는 설명이 동시에 유통된다. ②가 사실이라면 권한 상승 경로이므로, 클론은 **반드시 ①(생성자 권한 + 실행 시점 재검증)** 으로 구현해야 한다.
  - 실패 처리 동작은 실재한다(공식): webhook 실패 시 automation에 느낌표가 붙고 **자동 일시정지**되며 수동 재개가 필요하다. 반면 **규칙형 automation의 상세 실행 로그 UI는 공개 문서에 없다** — 정식 실행 로그(Activity 탭)를 제공하는 것은 Custom Agents뿐이다(F-08-16).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | A→B→A 순환 automation | `origin` 억제 규칙으로 자연 차단. 추가로 `depth` 상한(예: 3) 병행 `[추정]` |
  | automation 생성자가 워크스페이스를 떠남 | 실행 주체 소실 → 비활성화 또는 소유자 이관 필요 `[확인필요]`. 클론 권장: 자동 비활성화 + 워크스페이스 admin에게 이관 요청 알림 |
  | 생성자의 권한이 나중에 축소됨 | **실행 시점마다 재검증**. 정의 저장 시점의 권한을 캐시해 쓰면 권한 상승 취약점이 된다 |
  | 같은 트리거 이벤트가 중복 전달됨(at-least-once 큐) | `idempotency_key = event_id + automation_id`로 중복 실행 차단 |
  | 트리거 대상 DB가 다른 워크스페이스로 이동/공유 해제 | 실행 중단 + 정의에 dangling 표시. 조용히 실패하면 사용자가 원인을 못 찾는다 |
  | 액션 실행 중 서버 재시작 | 잡 재시도 시 중복 실행 위험 → 액션별 멱등키 필요 |
  | 같은 페이지에 대해 automation과 사용자가 동시 쓰기 | last-write-wins 또는 낙관적 락 `[추정]` |
  | webhook 액션이 계속 실패 | 지수 백오프 후 automation 자동 비활성화 + 알림 `[추정]` |
  | 워크스페이스 전체 실행량 급증 | 워크스페이스 단위 쿼터 필요. 노션의 실행 한도는 공개되지 않음 `[확인필요]` |
- **데이터 모델 함의**: `automation_run(origin, depth, status, error, actor_id, idempotency_key)` + 재시도 큐. 페이지 편집 히스토리에 `edited_by_automation_id`를 남겨 감사 가능하게 한다.
- **UI/인터랙션**: 실패 표시(느낌표) + 일시정지/수동 재개는 노션에 실재한다(공식, 초판의 `[확인필요]` 해제). 단 "최근 실행" 상세 로그 UI는 규칙형 automation에 없고 Custom Agents에만 있다 — **클론이 규칙형에도 실행 로그 탭을 처음부터 제공하면 명확한 차별화**가 된다(디버깅 불가는 노션 automation의 대표 불만이다).
- **의존 기능**: F-08-07, F-08-09, 잡 큐, 감사 로그.
- **구현 난이도**: **L** — 코드량보다 정확성(중복 실행 없음, 루프 없음)이 어렵다.
- **우선순위**: **P1** — F-08-09를 만드는 순간 반드시 함께 필요하다. 나중에 붙이면 데이터가 오염된다.
- **클론 시 현실적 대안**: 초기엔 `depth > 0`이면 후속 트리거를 전면 억제(노션과 동일한 보수적 규칙). 실행 로그는 최근 50건만 보관.
- **참고 출처**: https://www.notion.com/help/database-automations , https://www.notion.com/help/buttons

---

### F-08-11 변수 정의 및 수식 결합 (`Define variables` + mention/formula)

- **한 줄 정의**: 액션 인자를 정적 값 대신 트리거 페이지·클릭자·현재 시각·수식 계산 결과로 채운다.
- **사용자 시나리오**: 액션 편집기에서 `Define variables` 스텝 추가 → 변수명 입력 → 값으로 mention(예: `@Due date`) 또는 formula(예: `dateAdd(prop("Due"), 7, "days")`) 지정 → 이후 스텝의 값 입력란에서 그 변수를 선택. 또는 `Edit property`의 값 입력란에서 바로 `@`를 눌러 mention 삽입.
- **동작 상세** — 공식 제약:
  - mention과 formula는 **액션에서만** 사용 가능, **트리거에서는 불가**.
  - **formula 사용 불가 액션**: `Insert blocks`, `Open page or URL`, `Send Slack notification`.
  - Slack 알림에서는 mention/formula 모두 미지원.
  - person property에 `Person who clicked the button`을 넣으면 클릭자가 동적으로 태깅된다 → 시스템 변수 존재.
  - 지원 동적 값에는 날짜, property, 계산값이 포함된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 참조 property가 삭제됨 | 변수 평가 실패 → 액션 스킵 또는 전체 실패 `[확인필요]` |
  | 수식 결과 타입 불일치(number → select) | 저장 전 타입 검증으로 차단 |
  | 트리거 페이지가 없는 컨텍스트(버튼 블록)에서 페이지 property 참조 | 해당 mention 옵션 자체를 노출하지 않음 |
  | 순환 참조(변수 A가 B를, B가 A를 참조) | 정의 순서(order_index) 기준 단방향만 허용 |
  | 빈 값(null) property 참조 | 빈 문자열/미설정으로 폴백, 오류 아님 `[추정]` |
  | 대량 `Edit pages in`에서 행마다 수식 평가 | 행 단위 평가 비용 → 배치 상한 필요 |
  | 평가 도중 트리거 페이지가 동시 편집됨 | 트리거 이벤트에 담긴 **스냅샷 값**으로 평가할지 실행 시점 최신값으로 평가할지 결정 필요. 권장: 스냅샷(재시도해도 결과가 달라지지 않음) `[추정]` |
  | 참조 property의 타입이 실행 중 변경됨 | 평가 실패 → 스텝 스킵 + 설정 화면에 오류 배지 |
  | formula가 rollup을 참조하고 그 rollup이 이 automation이 쓰는 property를 집계 | 값 순환. `depth` 상한과 별개로 **수식 참조 그래프의 사이클 검사**가 필요하다 |
- **데이터 모델 함의**: 액션 config의 값 슬롯이 `formula` 타입일 때 **수식 도메인(별도 문서)의 AST와 평가기를 그대로 재사용**해야 한다. 평가 컨텍스트: `{trigger_page, actor, now, variables{}}`. 변수는 실행 스코프 내 메모리 맵(영속 저장 불필요).
- **UI/인터랙션**: 값 입력란의 `@` 트리거 오토컴플리트, 수식 편집 모달, 변수 칩(chip) 렌더링, 미리보기.
- **의존 기능**: 수식 엔진, property 시스템, F-08-07.
- **구현 난이도**: **M** — 수식 엔진이 이미 있다면 컨텍스트 어댑터 + 타입 검증 정도. 없다면 XL.
- **우선순위**: **P2** (단, `mention` 수준의 동적 참조 — 특히 `person who clicked`, `now` — 는 **P1**). ⚠️ 기능 자체는 P2지만 **값 슬롯(literal/mention/formula/variable) 스키마 결정은 P0**이다. 액션 config를 초기에 평문 문자열로 저장하면 나중에 전 automation 마이그레이션이 필요해진다.
- **클론 시 현실적 대안**: v1은 `Define variables` 없이 mention만: `현재 사용자`, `현재 시각`, `트리거 페이지의 <property>` 3종 시스템 변수. 수식은 v2.
- **참고 출처**: https://www.notion.com/help/database-buttons , https://www.notion.com/help/database-automations , https://www.notion.com/help/guides/automatically-generate-blocks-pages-with-buttons

---

### F-08-12 슬래시 커맨드를 통한 템플릿·버튼 삽입

- **한 줄 정의**: 본문에서 `/`를 입력해 버튼 블록 또는 템플릿 관련 블록을 삽입하는 진입 경로.
- **사용자 시나리오**: 빈 블록에서 `/but` 입력 → 필터된 메뉴에서 `Button` 선택 → 버튼 블록 삽입 + 설정 패널 자동 오픈. 구 워크스페이스에서는 `/template`도 노출되며 블록 삽입형 버튼과 동일하게 동작한다 `[확인필요]`.
- **동작 상세**:
  - 슬래시 메뉴는 입력 문자열로 실시간 필터링되며, Enter/클릭 시 **현재 블록의 타입을 교체**한다(빈 텍스트 블록 → 버튼 블록).
  - 삽입 직후 설정 패널을 자동으로 열어 "액션 없는 빈 버튼"이 남지 않게 한다 `[추정]`.
  - `Esc`로 메뉴 취소 시 입력한 `/텍스트`는 일반 텍스트로 남는다 `[추정]`.
  - DB 페이지 안에서 템플릿을 삽입하는 별도 슬래시 커맨드는 노션에 없다 — DB 템플릿은 `New ▾` 경로 전용 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 텍스트가 이미 있는 블록에서 `/` | 메뉴가 뜨지 않거나(단어 중간) 뜨더라도 기존 텍스트 보존 |
  | 권한 없는 사용자 | 메뉴에 Button 항목 미노출 |
  | 모바일 | 슬래시 메뉴 대신 `+` 툴바에서 선택 |
  | 코드 블록 안에서 `/` | 메뉴 비활성화 |
  | 한글 IME 조합 중 `/` | 조합 확정 후 판정 — 한국어 클론에서 실제 버그가 잦은 지점 |
  | 두 사용자가 같은 빈 블록에서 동시에 슬래시 삽입 | 블록 타입 교체가 CRDT 상에서 충돌 → 한쪽 소실 또는 버튼 중복 생성. 타입 교체를 "삭제 후 삽입"이 아니라 **단일 타입 필드의 원자적 갱신**으로 처리해야 안전 `[추정]` |
  | 삽입 직후 다른 사용자가 그 블록을 삭제 | 열려 있던 설정 패널을 닫고 "블록이 삭제됨" 토스트 |
- **데이터 모델 함의**: 슬래시 메뉴 항목 레지스트리(`{id, label, keywords[], icon, group, requiresPermission, insert()}`). 버튼/템플릿은 이 레지스트리에 항목을 등록하는 형태로 붙는다.
- **UI/인터랙션**: `/`, 방향키 탐색, Enter 확정, Esc 취소, 최근 사용 항목 상단 고정 `[추정]`.
- **의존 기능**: 블록 에디터 슬래시 메뉴(별도 도메인), F-08-06.
- **구현 난이도**: **S** — 슬래시 메뉴 인프라가 있다면 항목 등록만. 1일.
- **우선순위**: **P1** — 버튼 블록(F-08-06)과 세트.
- **클론 시 현실적 대안**: 없음(그대로 구현 가능). 다만 한글 IME 조합 처리 테스트를 별도 항목으로 잡을 것.
- **참고 출처**: https://www.notion.com/help/buttons , https://www.notion.com/help/writing-and-editing-basics

---

### F-08-13 외부 연동 액션 (webhook / mail / Slack)

- **한 줄 정의**: 자동화가 워크스페이스 밖으로 나가는 출구 — HTTP POST, Gmail 메일, Slack 채널 메시지.
- **사용자 시나리오**: 액션 추가 → `Send webhook` → URL 붙여넣기 → 전송할 property 선택 → 저장. Slack은 워크스페이스 연결(OAuth) 후 채널 선택. 메일은 Gmail 계정 연결 후 수신자·제목·본문 지정.
- **동작 상세**:
  - `Send webhook`, `Send mail to`는 **유료 플랜 전용**. `Send Slack notification to`는 Plus/Business/Enterprise 전용(무료 플랜도 Slack 알림 automation "생성"은 가능하나 편집 불가).
  - 메일 발송은 **사용자의 Gmail 계정**으로 나간다(노션 서버 발신이 아님) → OAuth 토큰 저장 필요.
  - 메일 도착까지 최대 2분 지연 가능(공식).
  - Slack 알림 액션에서는 mention/formula 사용 불가(공식).
  - `Send webhook` 운영 제약(공식, https://www.notion.com/help/webhook-actions): automation당 **최대 5개**, **POST 전용**, 커스텀 헤더 지원(단 노션이 제공하는 인증 스킴은 없어 토큰을 헤더에 직접 넣어야 함), **DB 페이지의 property만 전송 가능**(페이지 본문 불가, DB 버튼 property는 전송 필드로 선택 불가), 페이로드 미리보기 없음, **워크스페이스 레벨 webhook 미지원**, Enterprise 소유자는 Settings > Connections에서 전면 비활성화 가능.
  - **실패 처리(공식)**: 전송 실패 시 느낌표가 표시되고 **automation이 자동 일시정지**되며 사용자가 수동으로 재개해야 한다. 초판이 가정한 "지수 백오프 자동 재시도"는 노션의 실제 동작이 아니다 — **정정**.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | webhook URL이 사내망/localhost | SSRF 방지 — 사설 IP 대역 차단 필수 |
  | webhook 응답 5xx | 노션은 재시도 대신 **automation 일시정지 + 수동 재개**(공식). 클론 권장: 짧은 재시도 3회 후 동일하게 정지 — 무한 재시도는 상대 서버를 공격하는 셈이 된다 |
  | 같은 run이 재시도되어 webhook이 두 번 도착 | 페이로드에 `run_id`(멱등키)를 반드시 포함해 수신 측이 중복 제거할 수 있게 한다. 노션 API webhook도 at-least-once 전제다 |
  | 대량 트리거로 동일 엔드포인트에 요청 폭주 | 워크스페이스·엔드포인트 단위 동시성 상한 + 큐. 노션의 "automation당 webhook 5개" 제한도 같은 목적으로 보인다 `[추정]` |
  | Gmail 토큰 만료/revoke | 액션 실패 + 재인증 유도 |
  | Slack 채널이 삭제되거나 봇이 제거됨 | 액션 비활성화 + 알림 |
  | 전송 페이로드에 비공개 property 포함 | 데이터 유출 경로 — 전송 필드 명시 선택 필수 |
  | 초당 수십 건 발화 | 아웃바운드 레이트리밋 + 큐 |
- **데이터 모델 함의**:
  ```sql
  integration_connection (id pk, workspace_id, user_id, provider enum('slack','gmail'),
                          access_token_enc, refresh_token_enc, scope, external_account_id,
                          expires_at)
  outbound_delivery (id pk, run_id, action_id, target, request jsonb,
                     response_status int, attempt int, next_retry_at, status)
  ```
- **UI/인터랙션**: 연결 계정 선택 드롭다운, "연결 필요" 배너 + OAuth 팝업, 테스트 발송 버튼 `[추정]`.
- **의존 기능**: F-08-07, OAuth 인프라, 시크릿 암호화 저장, 아웃바운드 워커.
- **구현 난이도**: **L** — 액션 하나당 OAuth + 토큰 갱신 + 실패 처리. Slack/Gmail 각각 별도 작업.
- **우선순위**: **P2** — MVP·v1 모두 불필요.
- **클론 시 현실적 대안**: **`Send webhook` 하나만** 구현하고 Slack/메일은 사용자가 n8n·Make·Zapier로 받게 한다. 개발량이 1/5로 줄고 SSRF 방어만 잘하면 된다.
- **참고 출처**: https://www.notion.com/help/database-automations , https://www.notion.com/help/database-buttons , https://www.notion.com/help/buttons

---

### F-08-14 공개 API에서의 템플릿·버튼 취급 (통합 제약)

- **한 줄 정의**: 외부 인테그레이션이 템플릿/버튼/자동화를 얼마나 다룰 수 있는지의 경계.
- **사용자 시나리오**: 개발자가 API로 "템플릿으로 페이지 생성"을 시도 → 지원되지 않음 → 템플릿 본문을 직접 읽어 `children`으로 복제하는 우회 구현을 하게 된다.
- **동작 상세**:
  - 공개 API의 `template` 블록 타입은 UI의 "template button"에 대응하며 `{ "type":"template", "template": { "rich_text": [...], "children": [...] } }` 형태다. **2023-03-27부터 template 블록 생성은 지원 중단**.
  - `button`, `form` 등은 API 미지원 블록 타입 — `"type": "unsupported"` 와 `block_type` 필드로 반환된다.
  - `Create a page` 엔드포인트에 "템플릿 지정" 파라미터는 없다. **2025-09-03 API 버전에서 데이터 모델이 크게 바뀌었는데도 템플릿 파라미터는 추가되지 않았다** — 이 빈틈은 2026-09 시점에도 유지된다 `[확인필요 — 전체 changelog 완독은 아님]`. API 기반 템플릿 적용은 여전히 property 복사 + children 복사로 직접 구현해야 한다.
  - **2025-09-03 버전의 breaking change**: database가 여러 data source를 담는 컨테이너가 되면서 조회·스키마 엔드포인트가 `/v1/databases/:id/query` → `/v1/data_sources/:id/query`로 이동했고, **페이지 생성 시 부모가 `database_id`가 아니라 `data_source_id`** 가 되었다. webhook 이벤트명도 `database.content_updated` → `data_source.content_updated`로 바뀌었다. 클론 API를 설계한다면 **처음부터 "database = 뷰 컨테이너 / data source = 스키마+행"으로 분리**해 두는 편이 이 마이그레이션 고통을 피한다. (https://developers.notion.com/docs/upgrade-guide-2025-09-03)
  - API 편집이 database automation을 트리거하지 않는다는 보고가 있다 `[2차출처, 확인필요]`. 단 **API webhook(F-08-17)은 별개 경로로 이벤트를 전달**하므로, 클론에서는 내부 automation 파이프라인과 외부 webhook 파이프라인을 같은 outbox에서 fan-out 하되 `origin='api'` 이벤트를 automation에 넘길지를 **설정으로 노출**하는 편이 낫다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | API로 템플릿 페이지 목록 조회 | DB 쿼리 결과에 템플릿이 포함되는지 불명 `[확인필요]`. 클론은 `?include_templates=true` 옵션 권장 |
  | API로 버튼 블록이 있는 페이지를 읽음 | `unsupported` 블록으로 반환 → 클라이언트가 렌더 실패하지 않도록 처리 |
  | API로 automation을 만들거나 실행 | 미지원 `[확인필요]`. 버튼을 API로 "클릭"하는 엔드포인트도 없다 |
  | API로 템플릿 페이지를 직접 수정 | 템플릿도 결국 page이므로 수정 자체는 가능할 것으로 보이나, `is_template` 플래그를 API가 노출하지 않으면 클라이언트가 템플릿을 구분할 수 없다 `[확인필요]` |
  | 통합 토큰의 권한 밖 페이지를 부모로 지정 | 권한 오류. 클론은 "존재하지만 권한 없음"과 "없음"을 같은 응답으로 통일해 존재 자체의 노출을 막아야 한다 |
  | 대량 생성 요청(초당 수십 건) | 노션은 통합당 평균 3 req/s 수준의 레이트리밋을 둔다 `[확인필요 — 수치 재확인]`. 클론도 토큰 단위 레이트리밋 필요 |
- **데이터 모델 함의**: 클론 API 설계 시 결정 사항 — ① 템플릿 페이지를 DB 쿼리에서 제외할 것(기본) ② `POST /pages { template_id }` 를 **처음부터 지원**할 것(노션의 빈틈을 메우는 차별점) ③ 버튼/자동화 정의를 읽기 전용으로라도 노출할 것.
- **UI/인터랙션**: 해당 없음(API 계층).
- **의존 기능**: F-08-02, 공개 API 계층.
- **구현 난이도**: **S** — 클론 자체 API라면 `template_id` 파라미터 추가는 단순. 단 "database / data source 분리"까지 처음부터 반영하면 **M**.
- **우선순위**: **P2** — 단 API 설계 시점에 "템플릿 제외 필터"와 "부모 식별자 체계(database vs data source)"만은 **P0**로 반영해야 한다. 나중에 바꾸면 노션이 겪은 것과 동일한 breaking change를 겪는다.
- **클론 시 현실적 대안**: (초판 누락 항목 보완) ① `POST /pages { template_id }`를 v1부터 지원해 노션의 빈틈을 메운다 — 구현은 F-08-01 복제 엔진 호출 한 줄이라 비용이 거의 없다. ② 버튼·automation 정의는 **읽기 전용 JSON으로만 노출**하고 실행 엔드포인트는 만들지 않는다(외부에서 임의 실행이 가능하면 권한 모델이 무너진다). ③ 템플릿 페이지는 기본적으로 쿼리에서 제외하고 `?include_templates=true`로만 노출한다.
- **참고 출처**: https://developers.notion.com/reference/block , https://developers.notion.com/docs/upgrade-guide-2025-09-03 , https://developers.notion.com/reference/webhooks

---

### F-08-15 AI Autofill property (AI 자동 채우기 속성)

- **한 줄 정의**: 데이터베이스 property 하나에 "AI가 값을 채우는 규칙"을 붙여, 수동 실행 또는 페이지 생성·편집·스케줄 시점에 값을 자동 생성한다.
- **사용자 시나리오**: DB에서 채우고 싶은 property 이름 위에 hover → property 이름 클릭 → `AI Autofill`(또는 `Set up AI Autofill`) → `Basic` 또는 `Custom Agent` 선택 → Basic이면 태스크 유형(Summary / Translate / Key info / Custom autofill) 선택, Custom Agent면 지시문 작성 + workspace 검색·web 검색 토글 → **실행 시점 지정(수동 / 페이지 생성 시 / 페이지 편집 시 / 스케줄)** → 저장. 이후 해당 열의 셀이 자동으로 채워진다.
- **동작 상세**:
  - **Basic Autofill**: 해당 행·페이지의 내용만 사용하며 **웹 브라우징을 하지 않는다**. Business·Enterprise 플랜에 포함되고 **Notion credit을 소모하지 않는다**. 요약·태깅·날짜 추출·번역 같은 단순 작업용.
  - **Custom Agent Autofill**: 워크스페이스 검색으로 관련 컨텍스트를 찾고, 허용 시 웹 검색 결과와 출처를 붙이며, "Status가 In Progress일 때만 채운다" 같은 조건 로직과 다중 property 동시 갱신을 지원한다. **크레딧을 소모**한다.
  - **기존 행 백필 불가**(공식). 설정 이후 생성·편집되는 행에만 적용되며, 소급 적용은 사용자가 수동 실행으로 처리해야 한다.
  - autofill은 **DB 페이지·automation·form·chart·template을 생성할 수 없다**(공식). 값 채우기 전용이다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | `on_edit` 설정 + 사용자가 본문을 타이핑 중 | 키 입력마다 LLM을 호출하면 비용이 폭발한다. **디바운스(편집 종료 후 N초) + 입력 해시 캐시** 필수 `[추정]` |
  | 사람이 수동으로 덮어쓴 값을 AI가 다시 덮어쓰는가 | 정책 미공개 `[확인필요]`. 클론 권장: 셀에 `manually_overridden` 플래그를 두고 사람이 손댄 값은 재생성하지 않음 |
  | AI가 채운 property가 automation의 트리거 대상 | AI 실행 → automation 발화 → 다시 AI 실행 순환. F-08-10의 `origin` 억제 규칙을 **AI 실행에도 동일 적용**해야 한다 |
  | 소스 페이지 일부에 실행 주체의 권한 없음 | 권한 있는 컨텍스트만 사용. 권한 없는 내용이 요약으로 새어 나가면 치명적 유출 |
  | 대량(수천 행) 대상 | 큐 + 워크스페이스 단위 동시성 상한. 크레딧 소진 시 중단 후 알림 |
  | 크레딧 소진 / 모델 API 장애 | 셀을 "생성 실패" 상태로 두고 기존 값은 지우지 않는다 |
  | 동시편집 중 AI가 같은 셀을 갱신 | 사람이 편집 중인 셀은 건너뛰거나 갱신을 지연. 커서가 있는 셀을 덮어쓰는 것이 최악의 UX `[추정]` |
- **데이터 모델 함의**: `ai_autofill_config`(핵심 개념 절 SQL) + 실행 로그. 로그는 **`automation_run`과 같은 테이블(`kind='ai_autofill'`)** 로 두어야 루프 차단과 쿼터가 한 곳에서 계산된다. 셀 값에는 `generated_by_ai`, `generated_at`, `source_hash`, `manually_overridden` 메타가 필요하고, 과금을 위해 `credit_ledger(workspace_id, run_id, credits, model)`가 붙는다.
- **UI/인터랙션**: property 헤더 메뉴의 진입점, 셀 내부 생성 중 스피너, 셀 hover 시 "AI가 생성함 · 재생성", 웹 검색 사용 시 출처 링크, 열 단위 "모두 다시 채우기".
- **의존 기능**: F-08-09의 이벤트 파이프라인(생성·편집 훅), property 시스템, LLM 게이트웨이, 크레딧·쿼터 회계, 권한 모델(컨텍스트 필터링).
- **구현 난이도**: **L** — LLM 호출 자체는 쉽다. 비용은 ① 편집 이벤트 디바운스 ② 크레딧 회계·쿼터 ③ 부분 실패·재시도 ④ 사람 편집과의 충돌 정책 ⑤ 권한 기반 컨텍스트 필터링이 각각 독립 설계라는 데서 나온다.
- **우선순위**: **P2** — MVP와 무관. 단 인프라 순서상 반드시 F-08-09(이벤트 훅) 이후여야 한다.
- **클론 시 현실적 대안**: v1은 **수동 실행 전용 + 단일 태스크(요약)** 로 시작하고, 자동 실행은 크레딧 회계가 준비된 뒤 연다. 모델은 외부 API 한 곳만 두고 프롬프트를 서버에 고정한다(사용자 지시문 허용은 프롬프트 인젝션 표면을 연다).
- **참고 출처**: https://www.notion.com/help/autofill , https://www.notion.com/help/notion-academy/lesson/ai-autofill-property

---

### F-08-16 Custom Agents (트리거 기반 자율 에이전트)

- **한 줄 정의**: 지시문·접근 권한·트리거를 부여받아 배경에서 자율적으로 다단계 작업을 수행하는 AI 워크플로 주체. 2026-02-24 Notion 3.3에서 출시(Business·Enterprise).
- **사용자 시나리오**: 사이드바 `Agents` → `+` → ① AI 채팅으로 자연어 설명해 생성 / ② 템플릿에서 생성 / ③ 빈 상태에서 지시문 직접 작성 → 트리거 추가(스케줄 / Notion 이벤트 / Slack 이벤트) → **접근 대상 명시 부여**(특정 페이지·DB, Slack 채널, 웹 사용 여부) → 모델 선택 → 저장 → `Activity` 탭에서 실행 로그 확인.
- **동작 상세** — 공식 트리거 목록(규칙형 automation의 **상위집합**):

  | 그룹 | 트리거 | 필터 |
  |---|---|---|
  | 스케줄 | daily / weekly / monthly / yearly + 시각 + **타임존** | — |
  | Notion | 페이지에 댓글 추가 / DB에 페이지 추가 / DB의 property 업데이트 / **DB에서 페이지 제거** / **AI 회의록 작성 완료** | property 값, view |
  | Slack | 채널에 메시지 게시 / 이모지 반응 추가 / 에이전트 멘션 | 키워드·구문, 스레드 답글 포함 여부 |

  - 액션: Notion 페이지·DB 및 연결된 앱 읽기, 보고서 게시·버그 등록·레코드 갱신·메시지 발송, 웹 브라우징(토글), Slack 게시·읽기, **다른 Custom Agent에게 작업 hand-off**.
  - **권한 모델**: 에이전트는 기본적으로 워크스페이스 전체 접근 권한이 없고, 명시적으로 부여한 대상만 접근한다. 공유 권한 3단계 — `Full access`(지시문·트리거·접근 설정, 활동 로그 열람, 실행) / `Can edit`(지시문·설정 수정, 활동 검토) / `Can view and interact`(실행·대화·읽기 전용 설정 열람).
  - **관측성**: `Activity` 탭에 **모든 실행 로그**(무엇이 트리거했는지, 어떤 액션을 했는지, 오류), `Insights` 탭 CSV 내보내기(내보내기 기간당 300 chat 제한), 설정 **버전 히스토리 복원**.
  - 모델 선택 가능(Auto 권장), 관리자가 사용 가능 모델을 워크스페이스 단위로 제한할 수 있다. 데스크톱·웹 전용(모바일에서 설정 불가).
  - 요금: 2026-05-04부터 Notion credits 과금(Business·Enterprise 애드온, 1,000 크레딧 $10). 프리미엄 모델은 모델 자체 가격으로 크레딧을 소모하고, 하위 에이전트 hand-off는 추가 비용이 든다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 에이전트 A가 B에게, B가 다시 A에게 hand-off | hand-off 깊이 상한 + 사이클 검출 필수. 규칙형의 `depth`와 같은 카운터를 공유해야 한다 `[추정]` |
  | 에이전트가 만든 변경이 규칙형 automation을 트리거 | "automation은 automation을 트리거하지 않는다" 규칙이 에이전트 실행에도 적용되는지 공개 문서에 없음 `[확인필요]`. 클론은 `origin='agent'`도 억제 대상에 포함 권장 |
  | 부여했던 접근 권한을 나중에 회수 | 실행 시점 재검증. 진행 중인 run은 즉시 중단 |
  | 같은 트리거로 재실행 | LLM은 비결정적이라 **결과가 달라진다**. 규칙형과 달리 "재시도 = 동일 결과"를 보장할 수 없으므로 부작용 있는 액션은 반드시 사전 멱등키로 보호해야 한다 |
  | 수천 행 처리 중 타임아웃 | 공식 한도 미공개 `[확인필요]`. 클론은 run 단위 wall-clock 상한 + 체크포인트 재개 |
  | 크레딧 소진 | run 중단 + 관리자 알림. 부분 완료 상태를 로그에 남겨야 수동 복구가 가능 |
  | 지시문에 외부 콘텐츠(Slack 메시지, 웹 페이지)가 섞여 들어감 | **프롬프트 인젝션**. 에이전트가 가진 쓰기 권한만큼이 공격 표면이다 — 쓰기 액션에 승인 게이트를 두는 것이 안전하다(노션도 2026-08-28에 "직접 변경 대신 편집 제안" 모드를 추가했다) |
- **데이터 모델 함의**: 핵심 개념 절의 `agent` / `agent_access` / `agent_trigger` + `agent_run(id, agent_id, trigger_event jsonb, status, steps jsonb, tokens, credits, error)`. **`agent_trigger.type`을 `automation_trigger.type`과 같은 enum으로 통일**하면 트리거 매칭 코드를 한 벌만 유지할 수 있다. 실행 권한은 사용자 권한이 아니라 **agent grant ∩ 생성자 권한**으로 계산한다 `[추정 — 안전 측 설계]`.
- **UI/인터랙션**: 사이드바 Agents 섹션, 지시문 에디터, 트리거 빌더, 접근 대상 피커, Activity 로그 타임라인(스텝 단위 펼치기), 버전 히스토리, 모델 선택 드롭다운.
- **의존 기능**: F-08-07(액션 엔진), F-08-09(이벤트 파이프라인), F-08-10(루프 차단), 권한 모델, LLM 게이트웨이, 크레딧 회계, Slack 커넥터.
- **구현 난이도**: **XL** — LLM 오케스트레이션 + 도구 호출 + 리소스 스코프 샌드박스 + 비용 회계 + 스텝 단위 로그. 사실상 별도 제품이다.
- **우선순위**: **P2 / 보류** — 지금 만들 것이 아니다. 다만 **설계 결정 하나는 지금 해야 한다**: `automation_run`과 `agent_run`을 같은 실행 로그 뼈대로 둘 것.
- **클론 시 현실적 대안**: ① 자체 에이전트 대신 `send_webhook`으로 외부 오케스트레이터(n8n·Make·자체 서버 + MCP)에 넘긴다. ② 꼭 내재화한다면 **액션 엔진에 "AI 액션" 1종**(요약·분류)만 추가하고 자율 다단계 실행은 만들지 않는다 — 다단계 자율성이 비용·권한·디버깅 난이도의 90%를 만든다.
- **참고 출처**: https://www.notion.com/help/custom-agents , https://www.notion.com/releases/2026-02-24 , https://www.notion.com/product/agents

---

### F-08-17 Integration webhooks (외부로 나가는 이벤트 구독)

- **한 줄 정의**: 외부 인테그레이션이 워크스페이스의 변경 이벤트를 실시간 수신하는 구독 채널. 폴링을 대체한다.
- **사용자 시나리오**: developers.notion.com에서 인테그레이션 생성 → `Webhooks` 탭 → `Create a subscription` → **공개 HTTPS 엔드포인트** 입력 → 수신할 이벤트 타입 선택 → 노션이 그 URL로 1회성 POST를 보내 `verification_token` 전달 → 개발자가 그 토큰을 노션 UI에 붙여넣어 검증 → 구독 활성화. 이후 이벤트를 받으면 payload의 id로 **Notion API를 다시 호출해 실제 데이터를 조회**한다.
- **동작 상세**:
  - 엔드포인트는 SSL + 공개 접근이어야 하며 localhost는 불가.
  - **검증 이후에는 URL을 변경할 수 없다** — 바꾸려면 구독을 삭제하고 재생성해야 한다.
  - 서명 헤더 `X-Notion-Signature` = HMAC-SHA256(request body, verification_token). 공식 SDK가 `verifyWebhookSignature()` 헬퍼를 제공한다.
  - **thin payload**: 이벤트에는 entity id, event type, timestamp 등 메타데이터만 담기고 실제 콘텐츠는 없다. 소비자가 API로 되짚어 조회해야 한다.
  - 일부 이벤트는 **집계(aggregation)** 된다. 특히 `page.content_updated`는 잦은 편집을 묶어 1~2분 지연 후 한 건으로 전달된다.
  - 이벤트 타입 예: `page.content_updated`, `comment.created`, `page.locked`, `database.schema_updated`, `data_source.schema_updated`(2025-09-03 버전에서 명칭 체계 변경).
  - 구독은 **자동 확장되지 않는다** — 새 이벤트 타입이 생겨도 수동으로 구독을 갱신해야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 수신 엔드포인트 다운 | 재시도 정책·보관 기간 미공개 `[확인필요]`. 클론 권장: 지수 백오프 N회 → 구독 `disabled` 전환 + 개발자 알림 |
  | 같은 이벤트 중복 수신 | **at-least-once 전제**. payload에 안정적인 `event_id`를 넣어 소비자가 멱등 처리할 수 있게 한다 |
  | 이벤트 순서 역전 | 순서 보장 없음으로 설계 `[추정]`. 소비자는 timestamp·version으로 최신성을 판단 |
  | 인테그레이션 권한 밖 페이지의 변경 | 이벤트 미전달이어야 한다(전달하면 존재 자체가 유출된다) `[추정]` |
  | 대량 편집 폭주 | 집계·코얼레싱으로 흡수. 클론도 페이지 단위 N초 윈도우 병합 권장 |
  | verification_token 유출 | 서명 위조 가능 → 토큰 로테이션 경로 필요 |
  | 워크스페이스에서 인테그레이션 연결 해제 | 구독 즉시 비활성화 |
- **데이터 모델 함의**: `webhook_subscription` / `webhook_delivery`(핵심 개념 절 SQL). **이벤트 소스는 F-08-09의 outbox를 그대로 재사용**하고 같은 파이프라인에서 ① 내부 automation ② AI autofill ③ 외부 webhook 세 방향으로 fan-out 한다. 이 구조를 처음에 잡지 않으면 "automation은 도는데 webhook은 안 온다" 류의 정합성 버그가 만성화된다.
- **UI/인터랙션**: 인테그레이션 설정의 Webhooks 탭, 구독 생성 폼, 검증 토큰 붙여넣기 단계, 최근 전송 로그(상태 코드·재시도 횟수), 테스트 전송.
- **의존 기능**: F-08-09(이벤트 outbox), 공개 API 인증, 아웃바운드 워커, 서명 키 관리.
- **구현 난이도**: **M** — outbox가 이미 있으면 fan-out + HMAC 서명 + 재시도 큐로 끝난다. outbox가 없으면 **L**(이벤트 소스부터 만들어야 한다).
- **우선순위**: **P2** — 외부 생태계용이므로 클론 초기에는 불필요. 단 **outbox 설계 자체는 P1**이며 F-08-09와 동시에 이뤄져야 한다.
- **클론 시 현실적 대안**: 노션의 계약(thin payload + at-least-once + HMAC 서명 + 검증 핸드셰이크)을 그대로 모방하는 것이 검증된 선택이다. 이벤트 타입은 `page.updated`, `data_source.row_changed` 2종으로 시작하고, 재전송 인프라 대신 **"최근 24시간 이벤트 재생(replay)" API**를 제공하면 적은 비용으로 신뢰성을 확보할 수 있다.
- **참고 출처**: https://developers.notion.com/reference/webhooks , https://www.notion.com/help/create-integrations-with-the-notion-api , https://developers.notion.com/docs/upgrade-guide-2025-09-03

---

### F-08-18 Notion Workers (호스팅 코드 실행) — 참고용 / 클론 비권장

- **한 줄 정의**: 노션 서버의 샌드박스에서 실행되는 사용자 작성 코드. DB 동기화, 에이전트용 커스텀 툴, webhook 처리기를 워크스페이스 안에서 완결시킨다. 2026-05-13 Developer Platform(3.5) 발표.
- **사용자 시나리오**: CLI로 인증 → worker 코드 작성(또는 코딩 에이전트가 생성) → 배포 → ① automation의 `Send webhook`이 worker를 호출하거나 ② worker가 스케줄(15분·1시간·1일)로 외부 데이터를 Notion에 동기화한다. 즉 **"DB automation → webhook → worker → Notion API"가 플랫폼 밖으로 나가지 않고 닫힌다.**
- **동작 상세**:
  - 서버 프로비저닝·컨테이너 설정 없이 배포하는 hosted runtime.
  - 하나의 worker가 DB 동기화 · 커스텀 에이전트 툴 · webhook 트리거를 모두 담당할 수 있다.
  - 2026-07-09부터 팀 간 공유 가능(`Can connect` / `Full access` 권한 레벨), 2026-08-19에 Developer Portal이 사이드바로 이동하며 로그 가시성이 개선됐다.
  - 베타 동안 무료, **2026-08-11부터 Notion credits 과금**.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | worker → automation → webhook → 같은 worker 순환 | 실행 체인 깊이 카운터를 **플랫폼 경계 밖까지** 전파해야 차단 가능. 헤더로 `depth`/`origin`을 실어 보내는 설계 필요 `[추정]` |
  | worker 코드가 워크스페이스 데이터를 외부로 유출 | 아웃바운드 네트워크 정책·시크릿 스코프가 핵심 통제점. 다중 테넌트 코드 실행의 본질적 리스크 |
  | 실행 시간·메모리 상한 초과 | 공식 한도 미공개 `[확인필요]`. 상한 없는 hosted runtime은 존재할 수 없다 |
  | 크레딧 소진 | 스케줄 worker 중단 → 동기화가 조용히 실패. 반드시 알림 필요 |
  | 콜드 스타트 | 15분 주기 동기화에서는 무시 가능하나 webhook 처리기에서는 지연이 체감된다 |
- **데이터 모델 함의**: `worker` / `worker_run`(핵심 개념 절 SQL) + `worker_grant(worker_id, resource_type, resource_id, level)`. 로그는 별도 스토리지(대용량·단기 보관)로 분리하고 실행 메타만 `run` 테이블에 남긴다.
- **UI/인터랙션**: Developer Portal(사이드바), 배포 목록, 실행 로그 뷰어, 시크릿 관리, 스케줄 설정, 공유 권한 설정.
- **의존 기능**: 공개 API, 인증·시크릿 관리, 멀티테넌트 샌드박스 런타임, 크레딧 회계, F-08-13(webhook 진입점).
- **구현 난이도**: **XL** — 멀티테넌트 코드 샌드박스는 격리·쿼터·로깅·과금이 붙는 **독립 제품**이다. 이 도메인에서 가장 비싼 항목.
- **우선순위**: **P2 / 만들지 말 것** — 노션 클론의 핵심 가치와 무관하고, 보안 사고 시 손실이 가장 크다.
- **클론 시 현실적 대안**: worker를 내재화하지 말고 **"서명된 아웃바운드 webhook(F-08-13) + 인바운드 API 토큰"** 조합으로 대체한다. 사용자가 Cloudflare Workers·Vercel·자체 서버에 직접 배포하게 하면 동일한 워크플로가 성립하면서 샌드박스 책임은 지지 않는다.
- **참고 출처**: https://www.notion.com/blog/introducing-developer-platform , https://www.notion.com/releases/2026-05-13

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-08-01 | 페이지 템플릿 (복제 엔진) | L | **P0** | 블록 트리, 권한, 스토리지 |
| F-08-02 | 데이터베이스 템플릿 (새 항목 기본값) | M | **P0** | F-08-01, DB/property |
| F-08-03 | 기본 템플릿 지정 (뷰별/전체) | S | P1 | F-08-02, view |
| F-08-04 | 반복 템플릿 (recurring) | L | P2 | F-08-02, 스케줄러 |
| F-08-05 | 템플릿 갤러리 / 마켓플레이스 | XL | P2 | F-08-01, 공개 게시, 결제 |
| F-08-06 | 버튼 블록 (`/button`, insert blocks) | M | P1 | 에디터, F-08-07, F-08-12 |
| F-08-07 | 액션 실행 엔진 (11종 액션) | XL | P1(코어)/P2(외부) | 권한, DB CRUD, 알림 |
| F-08-08 | 데이터베이스 버튼 property | M | P1 | F-08-07, property 시스템 |
| F-08-09 | DB automation 트리거 | **L~XL** | P1 | 이벤트 파이프라인, 잡 큐 |
| F-08-10 | 실행 런타임 (루프 차단·실행 주체) | L | P1 | F-08-07, F-08-09 |
| F-08-11 | 변수/수식 결합 | M | P1(mention)/P2(formula) | 수식 엔진 |
| F-08-12 | 슬래시 커맨드 삽입 | S | P1 | 슬래시 메뉴, F-08-06 |
| F-08-13 | 외부 연동 액션 (webhook/mail/Slack) | L | P2 | OAuth, 아웃바운드 워커 |
| F-08-14 | API에서의 템플릿·버튼 취급 | S(분리 설계 포함 시 M) | P2 (식별자 체계는 P0) | 공개 API |
| F-08-15 | AI Autofill property | L | P2 | F-08-09, LLM 게이트웨이, 크레딧 회계 |
| F-08-16 | Custom Agents (자율 에이전트) | XL | P2 / 보류 | F-08-07, F-08-09, F-08-10, 권한 |
| F-08-17 | Integration webhooks (이벤트 구독) | M (outbox 없으면 L) | P2 (outbox 설계는 P1) | F-08-09 outbox, 공개 API |
| F-08-18 | Notion Workers (호스팅 코드 실행) | XL | P2 / 만들지 말 것 | 샌드박스 런타임, 과금 |

**의존 순서 (구현 경로)**

```
블록 트리 ─┬─> F-08-01 복제 엔진 ─┬─> F-08-02 DB 템플릿 ─┬─> F-08-03 기본 템플릿
           │                      │                      └─> F-08-04 반복 템플릿 ──┐
           │                      └─> F-08-05 갤러리                                │
           │                                                        스케줄러 ───────┘
슬래시 메뉴 ─> F-08-12 ─> F-08-06 버튼 블록 ─┐
                                             ├─> F-08-07 액션 엔진 ─┬─> F-08-08 버튼 property
DB/property ─> F-08-09 트리거 ───────────────┘                      ├─> F-08-10 런타임
                                                                    ├─> F-08-11 변수/수식
                                                                    └─> F-08-13 외부 연동 ─> F-08-14 API

[AI · 개발자 플랫폼 계층 — GAP 보완에서 추가]
F-08-09 이벤트 outbox ─┬─> F-08-15 AI Autofill (+ LLM 게이트웨이, 크레딧 회계)
                       ├─> F-08-17 Integration webhooks (외부 fan-out)
                       └─> F-08-16 Custom Agents ─(선택)─> F-08-18 Workers
                            ↑ F-08-07 액션 엔진 · F-08-10 루프 차단을 그대로 재사용
```

> **outbox 하나에서 세 방향으로 fan-out** 하는 구조(내부 automation / AI autofill / 외부 webhook)가 이 도메인 전체의 척추다. F-08-09를 만들 때 이 확장점을 열어두지 않으면 F-08-15·17을 붙일 때 이벤트 소스를 두 벌 운영하게 된다.

**단계별 권고**
| 단계 | 포함 | 목표 |
|---|---|---|
| MVP | F-08-01, F-08-02 | "템플릿으로 새 항목 만들기"가 동작 |
| v1 | + F-08-03, F-08-06, F-08-12, F-08-07(코어 3액션), F-08-08 | 클릭 기반 자동화 |
| v2 | + F-08-09, F-08-10, F-08-11(mention) | 이벤트 기반 자동화 |
| v3 | + F-08-04, F-08-11(formula), F-08-13, F-08-05 | 스케줄·외부 연동·배포 |
| v4 | + F-08-17(이벤트 구독), F-08-15(수동 실행 AI autofill) | 생태계 개방 + AI 진입 |
| 검토만 | F-08-16(Custom Agents), F-08-18(Workers) | 내재화 대신 webhook + 외부 오케스트레이터로 대체 권장 |

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인 관련 현황 | 차용 가능한 접근 |
|---|---|---|
| **AppFlowy** | 문서/DB 템플릿을 "템플릿 갤러리"로 제공하지만, **DB 행 템플릿(새 행 기본값)은 미구현**. 관련 FR(Issue #8483)이 "database 레벨에 기본 템플릿 1개 + 선택형 다중 템플릿(고급)"을 제안한 상태로 **closed**. 현재 권장 방식은 "기존 페이지 복제". | FR이 제안한 2단계(기본 1개 → 다중 선택)가 우리 F-08-02 → F-08-03 순서와 정확히 일치. 이 순서로 쪼개는 것이 검증된 분할이다. |
| **AFFiNE** | Table/Kanban 뷰 지원. Relation/Rollup/Formula property가 없어 **수식 기반 자동화의 전제가 부재**. | 자동화보다 property 시스템이 먼저라는 증거. F-08-11(formula)을 뒤로 미루는 근거로 사용 가능. |
| **Outline** | 문서 템플릿을 정식 지원. 기존 문서로부터 템플릿 생성 또는 Settings에서 빈 템플릿 생성, 컬렉션/워크스페이스 범위 저장. **`{datetime}`, `{author}` 같은 프리셋 플레이스홀더**를 문서 생성 시 치환. | 가장 저렴한 "동적 템플릿" 구현. 우리 F-08-11의 mention 대신 v0에서는 **문자열 플레이스홀더 치환**으로 시작할 수 있다. |
| **Baserow** | Automation Builder를 네이티브 제공 — **trigger / action / logic node** 3종 노드 그래프 구조. | 우리 `automation_trigger` + `automation_action` 2테이블 대신, 처음부터 **노드 그래프(조건 분기 포함)** 로 설계할지 결정해야 함. 노션은 선형 스텝이므로 클론도 선형으로 시작하되 `order_index`를 그래프로 확장 가능하게 남길 것. |
| **NocoDB** | 네이티브 워크플로 자동화 없음 — 외부(n8n) 연동에 의존. | F-08-13의 "webhook 하나만 만들고 나머지는 외부 도구" 전략의 실증 사례. |
| **BlockSuite (AFFiNE 에디터 코어)** | 블록 스키마/CRDT(Yjs) 기반 문서 모델. | 템플릿 복제를 "Y.Doc 서브트리 스냅샷 → 새 doc으로 적용"으로 구현하면 F-08-01의 id 재매핑을 CRDT 레벨에서 처리 가능 `[추정 — 실제 API 검증 필요]`. |

**종합 판단**: 오픈소스 진영에서 **DB 행 템플릿 + 트리거 기반 자동화를 둘 다 갖춘 노션 클론은 사실상 없다**(Baserow는 자동화는 있으나 문서/블록 모델이 아님, AppFlowy/AFFiNE은 문서 모델은 있으나 자동화가 없음). 따라서 이 도메인은 참고할 선례가 적고 직접 설계 비중이 높다. 반대로 **차별화 지점**이기도 하다.

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| 1 | ~~템플릿 원본 수정이 기존 생성 페이지에 소급되는가~~ → **해소(2차출처)**: 소급되지 않으며 이후 생성분에만 적용. 데이터 모델은 "복제" 확정 | — | (공식 문서 재확인만 남음) |
| 2 | 반복 템플릿의 타임존 처리 및 DST 동작, 놓친 실행의 catch-up 여부 | 스케줄러 정확성 요구사항 | 반복 템플릿 설정 후 DST 경계 관찰 / 지원 문의 |
| 3 | monthly 반복에서 31일 → 2월 처리 규칙 | 날짜 계산 엣지 | 실측 |
| 4 | ~~한 번의 저장에서 여러 property가 바뀔 때 트리거가 1회인지 N회인지~~ → **대부분 해소(공식 FAQ)**: automation은 **3초 윈도우**로 동작하며 그 안에서 되돌린 변경은 발화하지 않는다 → 순변화 1건 모델. 남은 질문은 "서로 다른 두 automation이 같은 창에서 어떻게 정렬되는가" | 큐 설계·중복 실행 | 실측 |
| 5 | 액션 다단계 중 중간 실패 시 롤백 여부 | 트랜잭션 경계 설계 | 의도적 실패 액션(잘못된 webhook) 구성 후 관찰 |
| 6 | **(격상) automation이 어떤 사용자 권한으로 실행되는가** — "생성자 권한"과 "workspace owner 권한, 페이지 접근 규칙 무시"라는 상충하는 2차 출처가 동시에 존재한다. 단 "접근 제한 페이지에는 영향을 주지 않는다"는 공식 문구는 확인됨 | **이 도메인 최대 보안 이슈**. ②가 사실이면 권한 상승 경로 | 권한 낮은 사용자 소유 DB에서 automation 실행 후 히스토리·결과 확인 |
| 7 | API 편집이 automation을 트리거하지 않는다는 주장의 진위 (2차 출처만 존재) | 통합 시나리오 전체가 달라짐 | 공식 인테그레이션으로 property 변경 후 관찰 |
| 8 | 워크스페이스당 automation 실행 한도/레이트리밋 (공개 자료 없음) | 쿼터 설계 기준 | Notion 지원 문의 |
| 9 | 구 `/template` 블록의 현재 상태(신규 워크스페이스 노출 여부) | 마이그레이션 필요 여부 | 신규 워크스페이스에서 `/template` 입력 |
| 10 | `Set as default` 해제 UI 존재 여부, linked view에서의 동작 | F-08-03 스펙 완성 | 실측 |
| 11 | "템플릿 값이 버튼 생성 값을 덮어쓴다"는 우선순위 규칙의 정확한 범위 | 값 병합 로직 | 충돌 케이스 구성 후 실측 |
| 12 | 보드/캘린더 뷰에서 버튼 property의 렌더링·클릭 가능 여부 | UI 스펙 | 실측 |
| 13 | Notion API에 템플릿 기반 페이지 생성 파라미터가 추가되었는지 (2023 이후 변경) | F-08-14 결론 | developers.notion.com 최신 changelog 확인. 2025-09-03 upgrade guide에는 없음 |
| 14 | AI Autofill이 사람이 수동으로 덮어쓴 셀을 다시 덮어쓰는가 | 데이터 파괴 위험. 클론 정책의 기준점 | Business 플랜에서 autofill 설정 후 셀 수동 편집 → 재실행 |
| 15 | Custom Agents가 만든 변경이 규칙형 automation을 트리거하는가 | 루프 차단 규칙이 AI 계층까지 확장되는지 결정 | 에이전트 액션 대상 DB에 automation을 걸고 관찰 |
| 16 | Integration webhook의 재시도 횟수·보관 기간·순서 보장 | 소비자 구현 계약 | 엔드포인트를 의도적으로 5xx로 만들고 관찰 |
| 17 | 3초 윈도우가 "발화 지연"인지 "순변화 판정 창"인지 정확한 의미 | F-08-09 구현 방식(즉시 큐 vs 창 종료 후 diff)이 완전히 달라짐 | 3초 안에 A→B→A로 되돌리는 실측 |
| 18 | Notion Workers·Custom Agents의 실행 시간·행 수 상한 | 클론이 유사 기능을 만들 때의 쿼터 기준 | 공식 문서에 미공개. 지원 문의 |

---

## 출처

**1차 출처 (Notion 공식)**
1. Database templates in Notion — https://www.notion.com/help/database-templates
2. Database automations in Notion — https://www.notion.com/help/database-automations
3. Create & use buttons in Notion — https://www.notion.com/help/buttons
4. Database buttons in Notion — https://www.notion.com/help/database-buttons
5. Automatically generate blocks, pages and more with the click of a button (가이드) — https://www.notion.com/help/guides/automatically-generate-blocks-pages-with-buttons
6. The ultimate guide to Notion templates — https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates
7. Using database templates (가이드) — https://www.notion.com/help/guides/using-database-templates
8. Make work more efficient with database button properties — https://www.notion.com/help/guides/make-work-more-efficient-database-button-property
9. Sell templates on Notion Marketplace — https://www.notion.com/help/selling-on-marketplace
10. Find templates on Notion Marketplace — https://www.notion.com/help/finding-templates-on-marketplace
11. Notion API — Block reference (template 블록, unsupported 블록 타입) — https://developers.notion.com/reference/block
12. Webhook actions in Notion (webhook 5개 제한, 커스텀 헤더, 실패 시 일시정지) — https://www.notion.com/help/webhook-actions
13. Notion AI autofill for databases (Basic vs Custom Agent, 실행 시점, 백필 불가) — https://www.notion.com/help/autofill
14. AI Autofill property — Notion Academy — https://www.notion.com/help/notion-academy/lesson/ai-autofill-property
15. Custom Agents in Notion (트리거 목록, 접근 권한 3단계, Activity 로그) — https://www.notion.com/help/custom-agents
16. Notion 3.3 릴리스 노트 — Custom Agents (2026-02-24) — https://www.notion.com/releases/2026-02-24
17. Notion 3.5 릴리스 노트 — Developer Platform (2026-05-13) — https://www.notion.com/releases/2026-05-13
18. Introducing Notion's Developer Platform (Workers) — https://www.notion.com/blog/introducing-developer-platform
19. Notion API — Webhooks reference (검증 핸드셰이크, 서명, 이벤트 집계) — https://developers.notion.com/reference/webhooks
20. Notion API — Upgrade guide 2025-09-03 (database → data source 분리) — https://developers.notion.com/docs/upgrade-guide-2025-09-03
21. Automations 헬프 카테고리 (문서 인벤토리 — 실행 로그·AI 액션 문서 부재 확인) — https://www.notion.com/help/category/automations
22. Create integrations with the Notion API — https://www.notion.com/help/create-integrations-with-the-notion-api
23. Meet your 24/7 AI team (Agents 제품 페이지) — https://www.notion.com/product/agents

**2차 출처 (기술 분석 · 오픈소스)**
12. Thomas Frank — Notion Database Automations: The Complete Guide — https://thomasjfrank.com/notion-database-automations-the-complete-guide/
13. Thomas Frank — Working with Database Templates (기본 템플릿 지정 절차) — https://thomasjfrank.com/docs/ultimate-brain/working-with-database-templates/
14. AppFlowy Issue #8483 — Database Row/Card Templates FR — https://github.com/AppFlowy-IO/AppFlowy/issues/8483
15. AppFlowy Templates 문서 — https://docs.appflowy.io/docs/appflowy/community/appflowy-mentorship-program/mentorship-2022/mentee-projects/templates
16. Outline — Templates 문서(플레이스홀더 `{datetime}`, `{author}`) — https://docs.getoutline.com/s/guide/doc/templates-GP6DXgRtxl
17. Baserow — Workflow Automation Guide (trigger/action/logic node 구조) — https://baserow.io/blog/baserow-workflow-automation-guide
18. AppFlowy vs AFFiNE 비교 (AFFiNE의 relation/rollup/formula 부재) — https://appflowy.com/compare/appflowy-vs-affine
19. XRAY — How to Use the New Notion Buttons (구 template button과의 관계) — https://www.xray.tech/post/new-notion-buttons
20. NoteForms — Template Button 용어 정의 — https://noteforms.com/notion-glossary/template-button
21. usecarly — How to Add a Template to Notion 2026 (기본 템플릿 스코프 문구, 템플릿 수정의 비소급성) — https://www.usecarly.com/blog/how-to-add-template-to-notion/
22. Matthias Frank — Notion Custom Agents 튜토리얼·과금 변화 — https://matthiasfrank.de/en/notion-custom-agents-full-tutorial-use-cases-pricing-changes/
23. Matthias Frank — Notion Workers, Dev Day 2026 — https://matthiasfrank.de/en/notion-workers-dev-day-2026/
24. Hookdeck — Guide to Notion Webhooks — https://hookdeck.com/webhooks/platforms/guide-to-notion-webhooks-features-and-best-practices

---

## GAP 검증에서 확인한 "반증 시도" 결과

초판의 주장을 뒤집으려고 공식 문서를 다시 읽은 결과 다음이 드러났다.

| 검증 대상 | 결과 |
|---|---|
| "노션 automation은 트리거 3종 · 액션 11종이 전부다" | **부분적으로 틀림.** 규칙형 automation 기준으로는 맞지만, Custom Agents(F-08-16)가 `페이지 제거`·`댓글 추가`·`AI 회의록 완료`·Slack 이벤트를 추가로 지원한다. "노션의 자동화 트리거 집합"을 3종으로 서술한 것은 2026년 기준 오류였다. |
| "webhook 실패 시 지수 백오프 재시도" | **틀림.** 공식은 재시도가 아니라 **automation 일시정지 + 수동 재개**. |
| "automation의 권한 관련 공식 언급이 없다" | **틀림.** "자동화는 접근이 제한된 페이지에는 영향을 주지 않는다"는 공식 문장이 존재한다. |
| "실패 배지 제공 여부 불확실" | **틀림.** 실패 표시와 일시정지는 공식 문서에 명시돼 있다. |
| "여러 property 동시 변경 시 트리거 횟수 불명" | **대체로 해소.** 공식 FAQ의 **3초 윈도우**가 답이다. |
| "규칙형 automation에도 실행 로그 UI가 있을 것" | **없음(확인).** Automations 헬프 카테고리에 실행 로그 문서가 존재하지 않으며, 정식 Activity 로그는 Custom Agents에만 있다. → 클론의 차별화 지점으로 유효. |
| "API에 템플릿 기반 페이지 생성이 추가됐을 것" | **추가되지 않음(2025-09-03 upgrade guide 기준).** 대신 부모 식별자가 `data_source_id`로 바뀌는 breaking change가 있었다. |
