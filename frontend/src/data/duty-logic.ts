import { listRows } from './local-store'
import type {
  CellSummary,
  DutyShift,
  DutyTask,
  HandoverRules,
  ShiftKind,
} from './duty-types'
import type { EntryRow } from './types'

// 汛期覆盖的乡镇，矩阵列固定按这个顺序铺开。
export const TOWNSHIPS = ['城关镇', '青龙镇', '白沙乡', '龙泉乡', '金沙镇', '云岭乡'] as const

export const SHIFT_KINDS: ShiftKind[] = ['白班', '夜班']

// 雨量站编号到乡镇的映射：雨量记录本身没有乡镇字段，靠站点目录归口。
export const STATION_TOWNSHIP: Record<string, string> = {
  'YL-CG-01': '城关镇',
  'YL-CG-02': '城关镇',
  'YL-QL-01': '青龙镇',
  'YL-QL-02': '青龙镇',
  'YL-BS-01': '白沙乡',
  'YL-LQ-01': '龙泉乡',
  'YL-JS-01': '金沙镇',
  'YL-YL-01': '云岭乡',
}

const STATION_PREFIX: Array<[string, string]> = [
  ['CG', '城关镇'],
  ['QL', '青龙镇'],
  ['BS', '白沙乡'],
  ['LQ', '龙泉乡'],
  ['JS', '金沙镇'],
  ['YL', '云岭乡'],
]

export function stationTownship(code: string): string {
  if (STATION_TOWNSHIP[code]) {
    return STATION_TOWNSHIP[code]
  }
  const middle = code.split('-')[1] ?? ''
  const hit = STATION_PREFIX.find(([prefix]) => middle === prefix)
  return hit ? hit[1] : ''
}

export function shiftSource(shift: Pick<DutyShift, 'date' | 'kind' | 'township'>): string {
  return `${shift.date} ${shift.kind} · ${shift.township}`
}

export function shiftIdOf(date: string, kind: ShiftKind, townshipIndex: number): string {
  return `DUTY-${date}-${kind === '白班' ? 'D' : 'N'}-${String(townshipIndex + 1).padStart(2, '0')}`
}

interface TaskContext {
  hazards: EntryRow[]
  evacuations: EntryRow[]
}

/** 汇总口径实时取自各业务模块当前数据：格内三项指标都从这里来。 */
export function readTaskContext(): TaskContext {
  return { hazards: listRows('hazard'), evacuations: listRows('evacuation') }
}

function hazardCodeToTownship(hazards: EntryRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of hazards) {
    map.set(String(row['隐患点编号']), String(row['所在乡镇']))
  }
  return map
}

/**
 * 按交接口径给一个班次落任务：
 * 隐患点台账 → 现场核查任务；避险搬迁页 → 联络任务。
 * 纯函数，同一班次同一口径重复执行结果一致，幂等由调用方保证。
 */
export function buildShiftTasks(
  shift: DutyShift,
  rules: HandoverRules,
  ctx: TaskContext,
  startId: number,
): DutyTask[] {
  const tasks: DutyTask[] = []
  let nextId = startId
  const stamp = shift.confirmedAt ?? new Date().toISOString()
  const source = shiftSource(shift)

  for (const row of ctx.hazards) {
    if (String(row['所在乡镇']) !== shift.township) {
      continue
    }
    if (!rules.hazardStatuses.includes(String(row.status))) {
      continue
    }
    tasks.push({
      id: nextId++,
      shiftId: shift.id,
      category: '现场核查',
      refId: Number(row.id),
      refCode: String(row['隐患点编号']),
      township: shift.township,
      title: `现场核查 ${row['隐患点名称']}（${row['隐患点编号']}）`,
      detail: `${row['隐患点名称']}当前状态「${row.status}」，按 v${rules.version} 交班核查口径需现场复核，重点查看变形迹象、威胁群众与撤离路线。`,
      source,
      status: '待执行',
      ruleVersion: rules.version,
      createdAt: stamp,
    })
  }

  if (rules.generateContact) {
    const hazardTown = hazardCodeToTownship(ctx.hazards)
    for (const row of ctx.evacuations) {
      const code = String(row['所属隐患点'])
      if (hazardTown.get(code) !== shift.township) {
        continue
      }
      if (!rules.contactStatuses.includes(String(row.status))) {
        continue
      }
      tasks.push({
        id: nextId++,
        shiftId: shift.id,
        category: '避险联络',
        refId: Number(row.id),
        refCode: String(row['户号']),
        township: shift.township,
        title: `联络 ${row['户主姓名']}（${row['户号']}）`,
        detail: `${row['户主姓名']}家共${row['家庭人口']}人，搬迁状态「${row.status}」，安置方式「${row['安置方式']}」，按 v${rules.version} 口径${rules.contactMode}。`,
        source,
        status: '待执行',
        ruleVersion: rules.version,
        createdAt: stamp,
      })
    }
  }

  return tasks
}

/** 格内汇总：隐患点数、雨量站数（按站点去重）、待发布预警数。 */
export function summarizeCell(township: string, ctx: TaskContext): CellSummary {
  const hazardCount = ctx.hazards.filter(
    (row) => String(row['所在乡镇']) === township && String(row.status) !== '已核销',
  ).length

  const stationCodes = new Set(
    listRows('rain_gauge')
      .filter((row) => stationTownship(String(row['站点编号'])) === township)
      .map((row) => String(row['站点编号'])),
  )

  const hazardTown = hazardCodeToTownship(ctx.hazards)
  const pendingAlarmCount = listRows('alarm').filter((row) => {
    if (String(row.status) !== '待发布') {
      return false
    }
    return hazardTown.get(String(row['隐患点编号'])) === township
  }).length

  return { hazardCount, stationCount: stationCodes.size, pendingAlarmCount }
}
