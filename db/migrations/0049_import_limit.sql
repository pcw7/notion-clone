-- 가져오기의 파일 크기 상한 — 잔여 묶음 8m-1조각 (F-09-12 · F-13-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 엔타이틀먼트 ⑥ · §3.4 [보강] 가져오기 ③
--       09-api-integrations.md F-09-12 *"Word / HTML / Text·Markdown / CSV — 무료 플랜 5 MB · 유료 플랜 50 MB"*
--
-- 키는 소비자가 생길 때 더한다(0047 ⑤) — 가져오기(`import/import.ts`)가 파일마다 묻는다. 업로드 상한(`file/limits.ts`)과 같은 단위
-- (MiB)로 둔다.
--
--   `import.max_bytes`(limit) — Free 5 MiB · Plus · Business · Enterprise 50 MiB

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'import.max_bytes', 'limit', v.value
  FROM plan p
  JOIN (VALUES ('free', '5242880'::jsonb), ('plus', '52428800'::jsonb), ('business', '52428800'::jsonb), ('enterprise', '52428800'::jsonb)) AS v(code, value)
    ON v.code = p.code;
