# 10-ai-features — SYNTHESIS 다이제스트

> 원본: `C:/VibeCoding/notion/docs/research/10-ai-features.md` (1363행, 26 기능)
> 이 다이제스트는 마스터 종합 문서 작성용 압축본이다. 스키마 정본은 `00-canonical-data-model.md`에 있으며, 여기서는 **이 도메인이 요구하는 것**만 기술한다.

**도메인 한 줄 요약**: Notion AI는 단일 앱이 아니라 5개 표면(에디터 인라인 / DB autofill / 워크스페이스 Q&A / 외부 에이전트 진입점(MCP·Agent API·Skills) / 에이전트 실행 표면(개인 Agent·Custom Agent·External Agent))의 집합이며, 이 전부를 떠받치는 공통 인프라는 **권한 인지 검색 인덱스**와 **이벤트 기반 스트리밍 생성 파이프라인** 둘뿐이다. 클론에서 어려운 지점도 UI가 아니라 이 둘이다.

---

## 1. 기능 인벤토리 (전수 26/26)

> 검증: `grep -c "^### F-" 10-ai-features.md` = **26**, 아래 표 행 수 = **26**. 일치.

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-10-01 | 인라인 AI 작성 (Ask AI / 빈 줄 프롬프트) | L | **P0** | F-10-09, 블록 에디터, 슬래시 커맨드, 멘션, 권한 |
| F-10-02 | 선택 영역 AI 편집 프리셋 (요약·톤·길이·문법·액션아이템) | M | **P0** | F-10-01, richtext selection, Undo 스택 |
| F-10-03 | 페이지 전체 번역 | M | P1 | F-10-02(템플릿), 블록 트리 순회·재조립 |
| F-10-04 | AI 블록 (Summary / Action items / Custom) | M | P1 | 블록 시스템, 페이지 템플릿, F-10-01 |
| F-10-05 | AI 데이터베이스 프로퍼티 (Autofill) | L | P1 | DB·프로퍼티 도메인, 잡 큐, (Custom 모드는 F-10-06) |
| F-10-06 | AI Q&A (워크스페이스 검색 기반 답변) | XL | P1 | **F-10-08(하드)**, 권한, F-10-09 |
| F-10-07 | AI 커넥터 (Slack / Google Drive 등) | XL | P2 | F-10-08, OAuth, 잡 스케줄러, 권한 매핑 |
| F-10-08 | 권한 인지 임베딩 인덱스 파이프라인 | XL | P1 | 블록 변경 스트림(CDC/Kafka), 권한, 벡터 저장소 |
| F-10-09 | 스트리밍 응답 및 생성 라이프사이클 | L | **P0** | **없음 — 모든 것의 기반** |
| F-10-10 | Research Mode (멀티스텝 조사 + 보고서) | XL | P2 | F-10-06, F-10-09, 백그라운드 잡, 알림 |
| F-10-11 | AI Meeting Notes (녹음→전사→요약) | XL | P2 | 데스크톱 앱(시스템 오디오), STT, 파일 스토리지, F-10-04, 캘린더 |
| F-10-12 | 요금·사용 한도·크레딧 (AI 거버넌스) | L | **P0** | 인증/워크스페이스, 결제, 전 AI 기능 계측 훅 |
| F-10-13 | Custom Agents (트리거 기반 자동 실행) | XL | P2 | F-10-09, **F-10-20**, 이벤트 버스, 스케줄러, F-10-12, F-10-18, F-10-19 |
| F-10-14 | 이미지 생성 및 편집 | S | P2 | 파일 업로드·스토리지, image 블록, F-10-12 |
| F-10-15 | Build with AI (프롬프트로 DB·뷰·페이지 구축) | L | P2 | DB·프로퍼티·뷰 도메인(하드), F-10-09, 구조화 출력, 비동기 잡 |
| F-10-16 | 파일·이미지 입력 분석 및 산출물 파일 생성 | 입력 **M** / 출력 **XL** | 입력 P1 / 출력 P2 | 파일 스토리지, F-10-09, F-10-12(컴퓨트 계량), (출력) 샌드박스 |
| F-10-17 | AI 채팅 표면 (세션·히스토리·소스 범위) | M | P1 | F-10-09, F-10-06, F-10-12(모델 허용), 권한 |
| F-10-18 | Notion MCP 서버 (외부 에이전트의 워크스페이스 접근) | L | P2 | OAuth 서버, 공개 API, 레이트리밋, 권한(호출 시점 평가), F-10-06 |
| F-10-19 | Notion Skills (재사용 워크플로 지시문) | S | P2 (에이전트 있으면 P1) | 페이지·권한 시스템, 검색, F-10-13/F-10-18(소비 측) |
| F-10-20 | 에이전트 세션 API + 휴먼 승인 게이트 (HITL) | L | P2 (`sequence` 스키마는 **P0**) | F-10-09, F-10-13, 권한, F-10-12, 알림 |
| F-10-21 | Notion Agent (개인 에이전트 — 사용자 권한 위임) | XL | P2 | F-10-09, F-10-20, F-10-06, F-10-15, F-10-22, F-10-12, 커넥터 |
| F-10-22 | Agent Instructions 페이지 (개인화 메모리) | S | **P1** | 페이지·권한 시스템, F-10-17, F-10-21 |
| F-10-23 | External Agents (Claude·Cursor를 팀메이트로) | XL | P2 | F-10-13, F-10-20, 댓글, 보드 뷰 + 프로퍼티 변경 이벤트, OAuth, F-10-12 |
| F-10-24 | AI 생성 인터랙티브 HTML 블록 | M (보안 포함 **L**) | P2 | 파일 업로드, embed 블록, F-10-13/21, F-10-18, **분리 origin + CSP** |
| F-10-25 | AI 사용량 분석 · 에이전트 감사 로그 | M | P1 (감사 로그는 **P0**) | F-10-12, 에이전트 실행 이벤트, 관리자 권한, 배치 집계 |
| F-10-26 | 모델 선택 및 Auto 라우팅 | M (중립 포맷 미비 시 L~XL) | P1 (스키마는 **P0**) | F-10-12, F-10-17, F-10-09, 프로바이더 추상화 |

**분포** — P0(4): 09·01·02·12 / P1(10): 03·04·05·06·08·17·22·25·26·16(입력) / P2: 나머지 12 / XL(9): 06·07·08·10·11·13·16(출력)·21·23

### "지금 안 만들어도 되지만 **스키마·규약만은 지금** 잡아야 하는" 4종 (소급 복원 불가)
| # | 항목 | 출처 기능 | 미확보 시 대가 |
|---|---|---|---|
| 1 | `ai_session_event.sequence` + append-only 규약 | F-10-20 | 스트리밍·감사·재생 전면 재작성 |
| 2 | `ai_message.model_id` + **프로바이더 중립 메시지 포맷** | F-10-26 | 세션 중간 모델 전환 불가, 마이그레이션 비용 |
| 3 | `ai_usage_ledger.raw_units` + `credit_multiplier` | F-10-12 | 요금 사후 재계산·분쟁 대응 불가 |
| 4 | `agent_audit_event` append-only | F-10-25 | 과거 에이전트 런 복원 불가 |

---

## 2. 데이터 모델 — 이 도메인이 정본 스키마에 요구하는 것

> 새 스키마를 창작하지 않는다. 아래는 **요구사항 목록**이다. 원본 문서의 의사 스키마 중 `[공식 확인]` 표시된 값은 Notion Agent APIs 공개 문서에서 확인된 실제 값이다.

### 2-1. 이 도메인 고유 엔티티 (정본에 신규 추가 필요)

| 엔티티 | 핵심 필드 | 존재 이유 / 제약 |
|---|---|---|
| `ai_session` | `user_id`(권한 필터 주체, 생략 불가), `surface`(inline_editor/ai_block/db_property/chat_qa/research/agent_run), `context_page_id`, `mode`, `status`, `required_actions`, `agent_id NULL`, `actor_kind` | **status 7값은 공식 확인**: queued / in_progress / requires_action / completed / failed / canceled / terminated |
| `ai_message` | `session_id`, `role`, `content_richtext`(블록 트리, 마크다운 아님), **`model_id`(세션 아닌 턴 단위)**, `token_in/out`, `finish_reason`, `seq` | 모델 전환이 세션 중간에 일어남(공식) → 세션 레벨 model_id는 기본값일 뿐 |
| `ai_session_event` | `session_id`, `type`, **`sequence` BIGSERIAL + `UNIQUE(session_id, sequence)`**, `payload`, `created_at` | **type 6값 공식 확인**: user.message / agent.message / agent.thinking / agent.tool_use / agent.tool_result / session.status. **append-only, UPDATE 금지.** 메시지 테이블과 반드시 분리(tool_use·thinking이 사라지면 재생·감사 불가) |
| `ai_citation` | `message_id`, `source_kind`(notion_block/connector_doc/web), `source_ref`, `span_start/end`, `title/url/snippet` | 답변 텍스트 offset과 어긋나지 않도록 스트리밍 중 재계산 |
| `ai_block` (blocks 서브타입) | `ai_kind`(summary/action_items/custom), `prompt`, `generated_content`, `source_page_id`, `source_content_hash`, `last_generated_at`, `stale` | 자기 자신·형제 AI 블록을 컨텍스트에서 제외해야 함 |
| `ai_property_config` | `property_id PK`, `ai_kind`, `prompt`, `target_lang`, `scope`(page_only/workspace_search/web), `trigger`(manual/on_create/on_edit/scheduled), `output_type` | Basic(크레딧 미소모) vs Custom Agent(워크스페이스 검색+웹, 크레딧 소모) 구분 |
| `ai_property_value` | `(page_id, property_id) PK`, `value`, `generated_at`, `source_hash`, `state`(empty/queued/generating/filled/error/stale), `manually_edited` | **일반 프로퍼티 값과 분리 저장** 또는 최소 `generated_by_ai` 플래그 필수 |
| `embedding_span` | `workspace_id`(=네임스페이스), `source_kind/source_id`, `page_id`, `text`, **`text_hash`+`meta_hash`(xxHash64)**, `vector`, `acl_principals[]`, `generation_id` | 이중 해시로 재임베딩 스킵(Notion 실측 데이터 70%↓). ACL은 **retrieval 단계**에서 필터 |
| `connector_account` / `connector_document` / `identity_mapping` / `sync_cursor` | provider, oauth_token_ref, scope_config, external_user_id, acl_principals[], `deleted_at`(tombstone) | 삭제 tombstone 전파 필수 |
| `ai_usage_ledger` | `feature_key`, `model_id`, **`credit_multiplier`**, **`raw_units jsonb`**{tokens_in/out, images, compute_ms, steps, recording_sec}, `credits`, `counted_against` | 불변·정산용. **롤업과 절대 겸하지 않는다** |
| `ai_quota` / `credit_balance` / `credit_policy` | window(rolling_6h/monthly/rolling_24h/rolling_30d), kind, **`credit_policy.subject_type`(workspace/member/agent) + `expires_at`** | 한도 주체 3축(공식 Admin API), 정책은 만료를 가짐. 충돌 시 **더 엄격한 쪽이 이긴다** 명문화 |
| `model_registry` / `workspace_allowed_model` | tier(standard/premium), context_window, supports_tools/vision, `credit_multiplier`, status(active/retired), effective_from | 단가·능력은 **코드 상수 금지, 행 데이터**(2026-04에 10배 변동) |
| `agent` (+ `agent_trigger` / `agent_grant` / `agent_tool` / `agent_share`) | `runtime enum(internal, external)`, `external_provider`, `data_retention_mode(zdr/provider_retained)`, `capabilities jsonb`, `instructions`, `model_id` | 런타임별로 보존·권한·능력 정책 분기 |
| `agent_audit_event` | append-only, `agent_id`(tombstone 유지), `actor_user_id`, `trigger_kind`, `resource_ref`(원문 보존), `change_summary` | **에이전트 삭제 시 캐스케이드 금지** |
| `user_ai_instructions` | **`user_id` PK**(= "한 번에 하나"를 스키마로 강제), `page_id`, `activated_at` | + `instructions_snapshot(user_id, page_version, rendered_text, token_count)` 캐시 |
| `agent_action_policy` | `action_kind`(page_write/db_write/file_op/email_send/calendar_write/external_tool), `requires_confirmation`, `scope` | 승인은 전부/전무가 아니라 **작업 종류별 정책 테이블** |
| `session_action` | `action_id`, `options`, `chosen_option_id`, `decided_by`, `expires_at` | HITL 승인. **승인 TTL 필수**, `action_id` 멱등 |
| 보조 | `ai_session_scope`, `ai_session_context`(+`excluded_reason`), `ai_step`, `ai_attachment`, `ai_compute_run`, `ai_image`(`parent_image_id` 체인), `ai_build_run`(spec 원문 보존), `ai_retrieval_log`, `mcp_connection`+`mcp_call_log`, `html_block_meta`, `external_artifact`, `agent_run_binding`(멱등 키), `ai_usage_rollup`, `auto_routing_decision`, `meeting_note`+`transcript_segment`+`audio_file`, `ai_prompt_template(key, version)`, `async_task` | — |

### 2-2. 다른 도메인 엔티티에 **컬럼 추가**를 요구하는 것 (충돌 주의)

| 대상 | 요구 | 근거 기능 |
|---|---|---|
| `page` | **`is_skill boolean`** (+ 부분 인덱스), `skill_description`, `used_as_instructions_by`, `created_by_ai_session_id`, `translation_of` | F-10-19, F-10-22, F-10-03, F-10-15 |
| `block` | `draft_of_session_id NULL`(ghost 블록 — **서버 저장형 선택 시에만**), `version`(번역·동시편집 스킵 판정) | F-10-01, F-10-03 |
| `block(type=embed)` | `embed.file_upload_id` — **HTML 블록은 새 타입이 아니라 업로드 파일을 붙인 embed**(공식 확인) | F-10-24 |
| `block` 서브타입 | `meeting_notes`(API 버전 2026-03-11에서 `transcription`에서 개명, 공식 확인), `agent_chat`(에이전트 채팅 임베드) | F-10-11, F-10-13 |
| `db_property` | AI 계열 프로퍼티 타입 4종(Summary/Key Info/Translation/Custom) | F-10-05 |
| `admin_capability` | `view_ai_analytics` / `view_agent_audit` / `manage_credit_limits` 분리 | F-10-25 |
| `workspace` 설정 | `ai_admin_settings`(web_search_enabled, allowed_models[], dlp_enabled, audio_retention_days), `workspace_ai_policy`(allow_external_agents, require_zdr) | F-10-12, F-10-23 |

### 2-3. 설계 원칙 (이 도메인이 전체 스키마에 강제하는 것)
1. **권한 필터는 retrieval 단계에서** — 생성 단계 필터링 금지(누출).
2. **원장(ledger) ≠ 롤업(analytics)** — 같은 테이블로 겸하면 둘 다 나빠진다.
3. **이벤트 ≠ 메시지** — Notion 실제 구조. 통합하면 tool_use/thinking이 소실.
4. **AI 자산을 새 엔티티로 만들지 말고 페이지 시스템에 플래그로 얹어라** — Skills(`is_skill`), Instructions(포인터 1개), HTML(embed 변형)이 모두 같은 패턴. 권한·버전·협업·검색이 공짜로 따라온다.
5. **행위 주체 3종의 권한 모델이 서로 다르다**: 사용자 위임(F-10-21, 사용자 권한 그대로) / 자율(F-10-13, 명시 부여 리소스만) / 외부 실행(F-10-23, 자율 + 외부 보존). `actor_kind` + `agent.runtime`으로 분기.
6. **한도 값 자체가 권한 대상** — full access 없으면 `hidden` 반환(공식 동작). 0이나 null로 뭉개지 말 것.

---

## 3. MVP 판단

### 없으면 제품이 성립 안 하는 것 (P0)

| F-ID | 왜 필수인가 |
|---|---|
| **F-10-09 스트리밍/생성 라이프사이클** | 없으면 모든 AI 기능이 "10초 멈춤 후 텍스트 뭉텅이". 의존이 없는 유일한 기반이라 **가장 먼저** 만들어야 한다. SSE는 공식 확인(Agent API가 `Accept: text/event-stream` 지원) |
| **F-10-01 인라인 AI 작성** | AI 도메인의 최소 진입점. 이게 없으면 "AI 노션"이 아니다 |
| **F-10-02 선택 영역 편집 프리셋** | 사용자가 "AI 있다"고 체감하는 가장 흔한 경로. F-10-01 위에 프롬프트 템플릿 테이블 + 메뉴만 얹으면 됨(ROI 최고) |
| **F-10-12 쿼터/레이트리밋** | **LLM API는 직접 현금 비용.** 무제한 클론은 즉시 파산. 크레딧 경제 전체는 아니어도 **레이트리밋만은 MVP 필수** |
| (기능 아닌) **스키마 4종** | 위 1절 표 참조. 구현 비용 ≈ 0, 미확보 시 소급 복원 불가 |

### 빼도 되는 것과 대체안

| 뺀 것 | 이유 | 대체안 |
|---|---|---|
| F-10-06 Q&A (XL) | MVP에 넣으면 프로젝트가 여기서 정체된다 | **Postgres FTS(tsvector+GIN) 상위 N개 → LLM 요약 + 인용.** ACL은 인덱스에 복제하지 말고 권한 테이블 JOIN(단일 DB이므로 가능) → ACL 동기화 문제 원천 소멸 |
| F-10-08 임베딩 인덱스 (XL) | 문서 전체에서 가장 비싼 항목 | v1 FTS → v2 pgvector(HNSW), 청크 경계 = "heading + 하위 블록". **`text_hash` 재임베딩 스킵만은 규모 무관하게 처음부터** |
| F-10-07 커넥터 (XL) | 커넥터 1개 = 개별 프로젝트(OAuth+증분동기화+ACL매핑+삭제전파) | **쿼리 시점 위임 검색(federated)** — 사용자 OAuth 토큰으로 그때 호출. ACL 동기화·삭제 전파·인덱스 저장이 전부 불필요 |
| F-10-05 Autofill 자동 트리거 | 잡 큐·디바운스·루프 차단이 작업량의 대부분 | v1은 **수동 트리거 + row 단위 실행**, 출력 타입 text만 |
| F-10-10 Research Mode | 인상적이나 초기 ROI 낮음 | **고정 3단계 파이프라인**(질의 확장 → 병렬 top-k → 1회 종합), 동기 30초 |
| F-10-11 Meeting Notes | 웹 클론이면 사실상 범위 밖(OS 네이티브 오디오 캡처) | 파일 업로드 → Whisper 배치 전사 → 요약. 화자 라벨이 필요하면 diarization 대신 **참가자별 스트림** 수신(Notion 3.6과 동일 전략, 모델 비용 0) |
| F-10-13/20/21/23 에이전트 계열 | v2+ 영역 | 에이전트 대신 **cron 1종 + DB row 생성 트리거 1종 + 프로퍼티 채우기 액션 1종** — 사실상 F-10-05 자동 트리거와 통합 |
| F-10-15 Build with AI | 데모 임팩트 최상급이나 DB 도메인 완성 후에야 의미 | **템플릿 카탈로그 + LLM 매칭**(사전 정의 템플릿 3개 제시 → 선택 → 프로퍼티만 LLM 조정). 검증·롤백 문제 대부분 소멸 |
| F-10-16 출력 파일 생성 | 임의 코드 실행 샌드박스 = 새 보안 경계 | **LLM은 중간 표현(JSON)만, 파일 조립은 결정적 라이브러리**(exceljs/pptxgenjs/docx). XL → S |
| F-10-24 HTML 블록 | 보안 부채 크고 되돌리기 어려움 | **선언적 위젯 스펙**(입력 필드 + 수식 JSON) → 서버가 안전 컴포넌트로 렌더 |
| F-10-14 이미지 생성 | 노션 핵심 가치와 무관, 비용 대비 빈도 낮음 | v1 생략 |
| F-10-18 MCP | 클론 자체 가치와 무관 | 4개 도구(search/fetch/create-page/update-page) **읽기 전용 먼저** |

### 저비용·고효과 우선 채택 (P1이지만 P0 다음 순번)
- **F-10-22 Instructions 페이지 (S, 1~2일)** — 문서 전체에서 투자 대비 효과 최고. 채팅이 있으면 즉시 얹을 수 있고, "이 AI가 나를 안다"는 유일한 저비용 경로.
- **F-10-19 Skills (S, 1일)** — 페이지에 boolean 1개. 에이전트/MCP 중 하나라도 만들면 즉시 P1.
- **F-10-25 감사 로그** — 에이전트에 쓰기 권한을 주는 시점에 **동시에** 필요(P0 승격). 과거는 소급 생성 불가.

### 단계별 로드맵
| 단계 | 내용 |
|---|---|
| **MVP** | F-10-09 → 01 → 02 → 12. 이 4개로 "AI 있는 노션" 체감의 80%. + **비용 0의 스키마 4종**을 함께 심는다 |
| **v1** | F-10-03, 04, 05(수동 트리거), 17, **22**, 26, 16(입력) + 06(FTS 버전), 25(SQL 뷰 수준) |
| **v2** | F-10-08 벡터화 → 07 / 10 / 15 / 18 / 19. 에이전트 계열은 **반드시 F-10-20 → 13 → 21 → 23 순서** — 승인 게이트 없이 에이전트에 쓰기 권한을 주는 것이 이 도메인 최대 실수 |
| **v3/선택** | F-10-11, 14, 16(출력), 24 — 넷 다 보안 또는 네이티브 플랫폼 비용이 크고 제품 성립에 불필요 |

### 의존 그래프 (핵심 경로)
```
F-10-09 스트리밍/이벤트 ─┬─ 01 인라인 ─ 02 프리셋 ─ 03 번역
 (sequence, 중립포맷)     │            └ 04 AI블록 ─ 11 회의노트
                          ├─ 17 채팅 ─┬ 22 Instructions
                          │           └ 26 모델선택
                          └─ 12 쿼터·과금 ─ 25 분석·감사   (12는 전 기능 횡단)

권한 시스템 ─ 08 임베딩인덱스 ─┬─ 06 Q&A ─ 10 Research
                               └─ 07 커넥터 ─┘

DB 도메인 ─┬─ 05 Autofill    20 세션API+HITL ─┬─ 13 CustomAgent ─┬─ 23 External
           └─ 15 Build                        │                  └─ 19 Skills
                                              └─ 21 NotionAgent ─── 24 HTML블록

18 MCP ── 23의 거울상(밖→안 / 안→밖). 도구·권한 레지스트리 공유
```

---

## 4. 기술 난제 & 권장 구현 접근 (L/XL 전수)

| F-ID | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-10-09 (L)** | SSE 자체는 1일이지만 딸린 게 6개: upstream abort 전파 / 증분 블록 파싱 / 프록시 버퍼링 회피 / 이벤트 영속화+sequence 재생 / `requires_action` 상태기계 / 원자적 usage 정산 | Vercel AI SDK(`streamText`+`useChat`) 채택하되 **와이어 이벤트 타입은 Notion 6종 taxonomy로 고정**. 문단 단위 버퍼링(줄바꿈 2회마다 커밋)으로 증분 파싱 회피. 취소는 서버가 upstream abort까지 해야 과금이 멈춤. heartbeat `:ping` 필수 | Vercel AI SDK, AFFiNE Copilot(Provider/Session 분리) |
| **F-10-01 (L)** | 스트리밍 텍스트 → 블록 트리 증분 파싱 + 취소/롤백 일관성 | **ghost 블록을 DB에 쓰지 말고 클라이언트 로컬 상태로**, Accept 때 한 번에 INSERT → 롤백 로직 소멸. 서버 저장형의 실질 위험은 롤백이 아니라 **모든 조회 쿼리의 `draft_of_session_id IS NULL` 필터 누락**(한 군데만 빠져도 미확정 콘텐츠 노출) | — |
| **F-10-12 (L)** | 3축 한도 우선순위 / 만료되는 정책 객체 / 한도 값의 권한 검사(`hidden`) / 3종 계량 축(토큰·이미지 장수·컴퓨트 작업) / 중단·필터링 시 정산 정확성 / 동시 요청 원자성 | v1은 **사용자당 일일 요청 수 + 일일 토큰 상한** 2개를 Redis INCR+TTL로. 단 원장 스키마(`raw_units`, `credit_multiplier`)만은 처음부터. 3축 충돌은 "더 엄격한 쪽 승" 명문화 | Redis 원자 카운터 |
| **F-10-05 (L)** | LLM 호출보다 **잡 큐·디바운스·자기 유발 루프 차단·대량 실행 제어**가 작업량 대부분 | 루프 차단의 유일한 견고한 방법: 변경 이벤트에 `actor_type=agent/ai` 태그를 붙여 트리거 소스에서 제외. select 출력은 기존 옵션 집합을 프롬프트 주입 + 미매칭 시 빈 값 | BullMQ |
| **F-10-15 (L)** | LLM 스키마 추출은 쉬움. 비용은 **스키마 검증·생성 순서 위상 정렬(순환 relation)·부분 실패 롤백** | LLM 출력을 그대로 DDL로 흘리지 말 것. **선언적 스키마(view/form/property)는 AI 생성 허용, 실행 로직(formula/automation/코드)은 사람 승인** — Notion도 정확히 이 선을 긋는다(공식). `ai_build_run.spec` 원문 보존으로 재현·부분 롤백 | MCP 도구 시퀀스(`notion-create-database` → `create-view`) |
| **F-10-18 (L)** | 프로토콜은 얇음. 비용은 **기존 REST API를 에이전트 입도로 재설계**(도구 25개는 단순 래핑이 아니라 의도 단위 재구성) | `@modelcontextprotocol/sdk` 원격 서버 + 기존 OAuth 재사용, 4개 도구 읽기 전용 시작. 권한은 **토큰 발급 시점 캐시 금지, 매 호출 시점 평가**. 권한 밖은 403 아닌 **404**(403은 존재를 누설) | Notion MCP 도구 목록(공식) |
| **F-10-20 (L)** | 상태기계·append-only 로그는 명확(스펙 공개). 비용은 **승인 대기 세션의 수명 관리(TTL·재개·정산)** 와 **취소 시 외부 부작용** | `agent.tool_use` 이벤트를 **호출 직전에** 기록해야 사후 추적 가능. 승인은 **승인자 권한 ∩ 에이전트 권한**으로 실행(승인이 권한을 확대하지 못함). `sequence`는 DB 시퀀스로 채번(앱 카운터는 동시성에서 깨짐) | Notion Agent API 스펙 그대로 |
| **F-10-24 (보안 포함 L)** | 임의 코드를 타인 브라우저에서 실행. `srcdoc`으로 같은 origin에 넣으면 **워크스페이스 전역 XSS** | **전용 서브도메인** + `sandbox="allow-scripts"` **단독**(`allow-same-origin` 동시 부여 시 샌드박스 무력화) + `CSP default-src 'none'`. 데이터 전달은 postMessage 화이트리스트만. `generated_by`(user/agent) 기록 없으면 사후 감사 불가 | — |
| **F-10-08 (XL)** | 정확성(ACL)과 비용(재임베딩) 두 축 동시 만족. 임베딩 모델 교체 = 전체 재색인 | Notion 실측 전략 차용: **span 단위 이중 해시(text_hash + meta_hash, xxHash64)** → 텍스트 변경분만 재임베딩, 메타만 바뀌면 **임베딩 없이 ACL 패치**(데이터 70%↓). workspace_id = 네임스페이스로 격리 → 멀티테넌시·삭제·재색인 단순화. generation ID로 재샤딩 없이 전환 | Notion 엔지니어링 블로그, pgvector(HNSW), turbopuffer |
| **F-10-06 (XL)** | 인덱싱·ACL 필터·랭킹·인용 정합성이 묶인 서브시스템 | **벡터가 키워드를 대체하지 않는다** — Notion도 `notion-ai-search`(시맨틱)와 `notion-search`(키워드, 레이트리밋도 다름) **2경로 병존**(공식 확인). 고유명사·ID·정확일치는 벡터가 구조적으로 약함. `ai_retrieval_log`를 초기부터 넣어야 나중에 랭킹을 고칠 수 있다. 근거 없을 때 일반 지식으로 채우지 않는 것을 기본값으로 | Docmost AI Answers(검색 다이얼로그 내 토글 = 최저비용 진입점) |
| **F-10-07 (XL)** | 커넥터 1개당 OAuth+증분동기화+ACL매핑+삭제전파, 앱마다 권한 모델이 전부 다름 | federated search로 대체(위 3절). 만들 경우 **삭제 tombstone 전파**가 최우선. 외부 권한 회수 시 최대 1시간 노출 창 존재 → 민감 워크스페이스는 쿼리 시점 원본 권한 재확인 | — |
| **F-10-10 (XL)** | 장기 실행 에이전트 루프 + 예산 제어 + 부분 결과 복구 | `session_budget(max_steps, max_tokens, deadline_at)` 하드 리밋 필수. 크레딧 소진은 **실행 시작 전** 차단(중간 중단이 최악) | — |
| **F-10-11 (XL)** | 시스템 오디오 캡처가 OS 네이티브(macOS ScreenCaptureKit / Windows WASAPI loopback) + 실시간 STT + 화자 분리 | 실시간 포기, 배치 전사. 화자 라벨은 **참가자별 스트림 수신**(Notion 3.6이 마이크 활성 신호 기반으로 전환한 이유) | Whisper, pyannote, AFFiNE Transcript 모듈 |
| **F-10-13 (XL)** | 이벤트 소싱 + 워크플로 엔진 + **비인간 principal 권한 모델**을 새로 세워야 함 | `agent_run`/`agent_run_step`을 만들지 말고 **`ai_session`/`ai_session_event`와 통합**(Notion도 Session+Event 하나로 대화와 자동 실행을 모두 표현) → 스트리밍·재생·감사 로직을 두 벌 만들 필요 없음. **F-10-20 승인 게이트 없이 쓰기 권한을 주는 것이 이 도메인 최대 실수** | — |
| **F-10-16 출력 (XL)** | 임의 코드 실행 샌드박스 = 새 보안 경계(격리·리소스 리밋·네트워크 차단·아티팩트 회수) | **LLM은 중간 표현만, 파일 조립은 결정적 라이브러리.** 이 분리가 XL→M(사실상 S)로 낮추는 유일한 지렛대. 입력 축(M)과 출력 축(XL)을 **하나의 난이도로 묶지 말 것** | exceljs / pptxgenjs / docx, pdf-parse |
| **F-10-21 (XL)** | 도구 루프 + **단계별 권한 재검증** + 작업 종류별 승인 정책 + 부분 실패 복구. 개별 도구가 있어도 "여러 도구를 안전하게 엮는 계층"이 새 서브시스템 | **plan-then-execute 2단계**(계획을 보여주고 승인된 계획만 실행)가 자율 루프보다 구현·신뢰 양쪽에서 우월. 화이트리스트 도구 3개 + 최대 5스텝 + 쓰기 전 항상 확인. 권한 검사를 에이전트 계층에 **따로 만들지 말고** 기존 사용자 권한 경로를 그대로 태울 것(중복 구현 = 우회 경로) | — |
| **F-10-23 (XL)** | "외부 모델 호출"이 아니라 **외부 실행 주체를 워크스페이스 권한 모델 안에 앉히는 일**. 멱등성·타임아웃·외부 부작용 추적·보존 정책 게이트가 전부 새로 필요 | **웹훅 1개로 축소**(카드가 칼럼 진입 → 페이로드 POST → 외부가 댓글 API로 회신). 에이전트 런타임 직접 호스팅 불필요. `agent_run_binding.idempotency_key`(카드 단위)가 중복 PR 생성 사고를 막는 핵심. **F-10-18 MCP와 거울상**(밖→안 / 안→밖) — 같은 도구·권한 레지스트리 위에 세우면 중복 대폭 감소 | — |

### 기술 스택 권고 (원본 표 요약)
| 레이어 | 권고 |
|---|---|
| 스트리밍 | Vercel AI SDK(SSE), 이벤트 타입은 Notion 6종 |
| 프로바이더 | AFFiNE식 factory. 초기 1종 + **Ollama 폴백**(개발 중 API 비용 0 — AppFlowy가 검증) |
| 벡터 | v1 Postgres FTS → v2 pgvector(HNSW) |
| 잡 큐 / 쿼터 | BullMQ+Redis / Redis INCR+TTL |
| 프롬프트 | DB 기반 템플릿 레지스트리(key+version) — A/B·롤백 가능. **클라이언트가 프롬프트 문자열을 조립하지 않는다** |
| 메시지 저장 | 프로바이더 중립 표현(AI SDK 메시지 스키마) + `ai_message.model_id` |
| 이벤트 로그 | append-only + `UNIQUE(session_id, sequence)`, DB 시퀀스 채번 |
| HTML 실행 | 전용 서브도메인 + `sandbox="allow-scripts"` + `CSP default-src 'none'` |

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 이 도메인이 요구하는 것 |
|---|---|---|
| **블록/에디터** | F-10-01, 02, 03, 04, 24 | 블록 트리 증분 삽입 API, 슬래시 커맨드 확장점, richtext selection range 모델, **단일 Undo 트랜잭션 경계**, ghost 블록 렌더링 훅, embed 블록의 `file_upload_id` |
| **데이터베이스/프로퍼티/뷰** | F-10-05, 15, 23 | 커스텀 프로퍼티 타입 등록 메커니즘, 프로퍼티 변경 이벤트(+`actor_type` 태그), 뷰 생성 API, 보드 칼럼 진입 이벤트, select 옵션 집합 조회 |
| **권한/공유** | 전 기능 (특히 06, 07, 08, 18, 21) | **principal 집합 조회 API**(retrieval 필터용), 비인간 principal(agent) 지원, 호출 시점 권한 재평가, 게스트 구분, `hidden` 센티널 반환 규약 |
| **검색** | F-10-06, 08, 19 | FTS 인덱스 공유, 키워드/시맨틱 2경로 병존 설계, 검색 결과에 `is_skill` 필터 |
| **페이지/템플릿** | F-10-04, 19, 22 | 페이지에 `is_skill`·instructions 포인터 컬럼, 템플릿 복제 시 ai_block 포함, `page.version`(스냅샷 기준) |
| **파일/스토리지** | F-10-11, 14, 16, 24 | File Upload API(≤20 MiB), 워크스페이스 파일 쿼터 연동, GC(블록 삭제 시 즉시 삭제 금지) |
| **댓글** | F-10-23 | `@에이전트` 멘션 자동완성, 에이전트 진행 보고를 댓글 스레드로, 실행 중 사용자 메시지 주입 |
| **알림/인박스** | F-10-10, 13, 20, 21 | 승인 요청 카드(무엇을 하려는지 + Approve/Reject), 백그라운드 완료 알림, 에이전트 실패 알림 |
| **관리자/설정/과금** | F-10-12, 25, 26 | `admin_capability` 세분화, 결제 시스템 연동, Analytics 화면 슬롯, 워크스페이스 정책(ZDR, 외부 에이전트 허용) |
| **동시편집(CRDT/OT)** | F-10-01, 02, 03 | Accept 시점 앵커 존재 검증(soft reference), 치환 대상 range 무효 시 "Insert below" 폴백, 번역 중 변경된 블록 스킵 |
| **공개 API / 통합** | F-10-04, 11, 18, 24 | AI 산출물 블록을 영구 `unsupported`로 두지 말 것 — **읽기 가능한 정식 타입 + 쓰기 제한**이 낫다(Notion도 결국 `meeting_notes` 타입을 열었다) |
| **실시간/이벤트 버스** | F-10-05, 13, 23 | CDC 또는 Kafka 스타일 변경 스트림, `actor_type` 태그(루프 차단의 유일한 견고한 수단) |

---

## 6. 최우선 미해결 질문 (5)

| # | 질문 | 왜 지금 답이 필요한가 | 원본 상태 |
|---|---|---|---|
| 1 | **AI 프로퍼티 값을 수동 수정했을 때 다음 autofill이 덮어쓰는가?** | 데이터 신뢰성 문제이자 사용자가 가장 크게 반발하는 지점. 정책을 나중에 바꾸면 이미 덮어써진 데이터를 복구할 수 없다 | 2026-09 공식 문서 재확인 결과 **언급 자체가 없음**(미공개 확정). 권고: `manually_edited=true`면 기본 스킵 + 컬럼 옵션으로 덮어쓰기 허용 |
| 2 | **Q&A가 근거를 못 찾았을 때 일반 지식으로 답하는가?** | 환각 정책의 핵심. 제품 신뢰의 기준선이며 프롬프트·평가 설계가 여기서 갈린다 | 3회 검색·2회 본문 확인에도 불검출. **공식 미공개 확정.** 권고 기본값: "근거 없음" 명시 |
| 3 | **인라인 생성 중 새로고침 시 세션 복구 여부** | ghost 블록을 서버에 쓸지 클라이언트에만 둘지가 여기서 갈리고, 이 결정이 F-10-01의 롤백 로직 전체를 좌우한다 | `[확인필요]`. 단 F-10-20의 `continue_from` 재생이 공식 존재하므로 **서버 이벤트 영속화 + 재개**가 Notion의 방향일 가능성 높음 `[추정]` |
| 4 | **HTML 블록 iframe의 실제 sandbox 정책**(허용 속성·네트워크·postMessage 가부) | **보안 경계 그 자체.** 잘못 구현하면 워크스페이스 전역 XSS이며, 출시 후 되돌리기가 가장 어려운 항목 | `[확인필요]` — 공식 문서는 "sandboxed iframe"까지만 서술 |
| 5 | **Notion의 청킹 기준**(토큰 수 / heading 경계 / 블록 수)과 하이브리드 검색·리랭커 사용 여부 | 검색 품질에 가장 큰 영향을 주는 단일 파라미터인데 공개 자료에 수치가 전무. 클론이 벤치마크할 기준점이 없다 | `[확인필요]` ×2(원본 #9, #10). 권고: 청크 경계 = "heading + 하위 블록" |

### 차순위 (참고)
- 페이지 번역이 원본을 치환하는가 vs 새 결과로 제시하는가 (되돌리기·버전 설계 직결, 2026-09 재검색에도 미공개)
- AI **커넥터(검색 인덱스)** 가 private Slack 채널을 색인하는가 — 에이전트 경로는 2026-04부터 지원 확인, 커넥터 경로 미확인. **두 경로의 권한 비대칭을 잘못 가정하면 정보 누출**
- 플랜별 AI 사용 할당량의 구체 수치 (크레딧 문서는 "usage allowance"를 참조만 하고 수량 미명시)
- AI 채팅 히스토리 보존 기간·삭제 정책 (GDPR 삭제 요구 대응)
- Auto 모델 라우팅의 판단 기준 (난이도 추정 / 비용 / 지연 중 무엇)

---

## 부록: 사실성 등급 구분

| 등급 | 해당 항목 |
|---|---|
| **[공식 확인]** (그대로 채택 가능) | `ai_session.status` 7값 / 세션 이벤트 6종 / `sequence`·`continue_from` / `required_actions` / `message` maxLength 10000 / SSE(`Accept: text/event-stream`) / 크레딧 한도 3축(workspace·member·agent) + 만료 정책 + `hidden` / `page.is_skill` / `embed.file_upload`(HTML 블록) / MCP 도구 목록·레이트리밋(180 vs 30 req/min) / 파일 상한(20 MiB, 텍스트 200 KiB) / `meeting_notes` 블록 타입 / Agent 생성 가능 범위(view·form·property 가능 / automation·template·formula 불가) / External Agent 권한 비상속·ZDR 미지원·웹브라우징 불가 / Instructions "한 번에 하나" + Custom Agent 미적용 / Notion 벡터 인프라 실측치(xxHash64 이중 해시, 데이터 70%↓, turbopuffer, 100억+ 벡터) |
| **[추정]** (역산한 권고 스키마) | 나머지 의사 스키마 대부분, ghost 블록 구현 방식, 프롬프트 템플릿 서버측 고정 여부, Auto 라우팅 기준, External Agent가 Enterprise/HIPAA 기본 비활성인 이유(ZDR) |
| **[확인필요]** (24건, 원본 "미해결" 절) | 위 6절 + 차순위 참조 |

**주요 출처(원본 45건 중 핵심)**: notion.com/help(autofill, notion-ai-connectors, notion-ai-security-practices, custom-agents, notion-agent, instructions-for-notion-agent, use-claude-agents-in-notion, ai-meeting-notes, research-mode, what-are-notion-credits) / developers.notion.com(guides/notion-agent-apis/overview, reference/notion-agent-apis/*, guides/mcp/*, reference/block, page/changelog) / notion.com/blog(two-years-of-vector-search-at-notion, introducing-q-and-a, introducing-custom-agents) / notion.com/releases(2026-01-20, 2026-04-14, 2026-07-01) / AFFiNE·Docmost·AppFlowy·Vercel AI SDK
