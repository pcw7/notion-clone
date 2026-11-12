'use client'

/**
 * 속성 편집기의 지연 로드 (BX-2) — 칸을 편집하기 시작할 때·메뉴를 열 때만 받는다.
 * 읽기 전용 표시(cell-view)는 그대로 먼저 오고, 편집기·고르개는 첫 사용에 받는다 — 행 페이지의 첫 JS 예산을 쓰지 않는다.
 */

import dynamic from 'next/dynamic'

export const SelectEditorLazy = dynamic(() => import('./select-editor').then((m) => m.SelectEditor))
export const FilesEditorLazy = dynamic(() => import('./files-editor').then((m) => m.FilesEditor))
export const PlaceEditorLazy = dynamic(() => import('./place-editor').then((m) => m.PlaceEditor))
export const RelationEditorLazy = dynamic(() => import('./relation-editor').then((m) => m.RelationEditor))
export const FormulaEditFormLazy = dynamic(() => import('./formula-editor').then((m) => m.FormulaEditForm))
export const ButtonEditFormLazy = dynamic(() => import('./button-editor').then((m) => m.ButtonEditForm))
export const RollupSourceEditorLazy = dynamic(() => import('./rollup-source-editor').then((m) => m.RollupSourceEditor))
