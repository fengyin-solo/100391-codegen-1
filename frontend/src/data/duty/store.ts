import { buildDutySeed } from './seed'
import type { DutyStoreState } from './types'

// 汛期值班矩阵单独占一个 localStorage 键，和通用模块 entries 互不影响。
const STORAGE_KEY = 'geohazard-monitor-prevention:duty'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): DutyStoreState {
  const fallback = buildDutySeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    // 用种子兜底新字段，老存档也能平滑升级
    const parsed = JSON.parse(raw) as Partial<DutyStoreState>
    return {
      people: parsed.people ?? fallback.people,
      stations: parsed.stations ?? fallback.stations,
      rules: fallback.rules,
      currentRuleVersion: parsed.currentRuleVersion ?? fallback.currentRuleVersion,
      shifts: parsed.shifts ?? fallback.shifts,
      tasks: parsed.tasks ?? fallback.tasks,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: DutyStoreState | null = null

export function dutyState(): DutyStoreState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveDutyState(state: DutyStoreState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetDutyState(): DutyStoreState {
  const next = buildDutySeed()
  saveDutyState(next)
  return next
}

export function dutyStorageKey(): string {
  return STORAGE_KEY
}

export function cloneDutyState(): DutyStoreState {
  return clone(dutyState())
}
