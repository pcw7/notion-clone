-- 롤업을 대상 속성으로 찾기 — DB 심화 2j-1조각 (F-03-13)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 수식 1단계 · [보강] rollup v1
--       03-database-core.md F-03-14 *"변환된 프로퍼티를 참조하던 formula/rollup → 에러 상태로 전환하고 사용자에게 알림"*
--
-- 속성을 지우거나 유형을 바꾸기 전에 **그것을 읽는 수식 · 롤업**을 알린다(`property-dependents.ts`). 수식은 `property_dependency` 의
-- 역방향 인덱스(0060 `ix_property_dependency_source`)로 찾는다. 롤업은 **다른 표**의 속성을 읽는다(`config.target_property_id` —
-- relation 의 대상 표) — 그 속성의 표에서 "나를 읽는 롤업"을 찾으려면 모든 표의 롤업을 훑어야 한다. 그래서 대상으로 찾는 부분 인덱스를
-- 둔다. 같은 표의 relation 을 타는 롤업은 `data_source_id` 로 찾는다(롤업은 그 relation 의 표에 산다 — `ix_property_live`).

CREATE INDEX ix_property_rollup_target ON property ((config ->> 'target_property_id'))
  WHERE type = 'rollup' AND deleted_at IS NULL;
