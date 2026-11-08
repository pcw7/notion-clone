'use client'

/**
 * 검증 고르개의 지연 로드 — 표(칸)와 행 페이지(머리 배지)가 같은 청크를 쓴다 (VF-2).
 * 열 때만 받는다 — 행 페이지의 첫 JS 예산을 쓰지 않는다.
 */

import dynamic from 'next/dynamic'

export const VerificationPickerLazy = dynamic(() => import('./verification-picker').then((m) => m.VerificationPicker))
