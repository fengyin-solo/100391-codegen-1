import { buildDutySeed } from './duty-seed'
import type { DutyState } from './duty-types'

// 值班矩阵独立于业务清单存储，避免互相污染。
const DUTY_STORAGE_KEY = 'geohazard-monitor-prevention:duty'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): DutyState {
  const fallback = buildDutySeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(DUTY_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as DutyState
  } catch {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: DutyState | null = null

export function dutyState(): DutyState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveDutyState(state: DutyState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(state))
  }
}

export function updateDutyState(mutate: (draft: DutyState) => void): DutyState {
  const next = clone(dutyState())
  mutate(next)
  saveDutyState(next)
  return next
}

export function resetDutyState(): DutyState {
  const fresh = buildDutySeed()
  saveDutyState(fresh)
  return fresh
}

export function dutyStorageKey(): string {
  return DUTY_STORAGE_KEY
}
