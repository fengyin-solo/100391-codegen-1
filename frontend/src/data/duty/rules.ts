import type { EntryRow } from '@/data/types'
import type { HandoverRule, HandoverTask, DutyShift } from './types'

/** 交接口径版本表：调整口径只追加新版本，归档班次按 ruleVersion 回放，历史不可变。 */
export const HANDOVER_RULES: HandoverRule[] = [
  {
    version: 1,
    label: '汛前口径（在册即核查）',
    publishedAt: '2026-04-01 09:00',
    note: '在册、监测中隐患点全部现场核查；待动员、已签约搬迁户全部电话联络。',
    hazardStatuses: ['在册', '监测中'],
    evacuationStatuses: ['待动员', '已签约'],
    pendingAlarmExtra: true,
  },
  {
    version: 2,
    label: '主汛期口径（盯紧监测中与未动员）',
    publishedAt: '2026-07-01 09:00',
    note: '仅监测中隐患点现场核查；仅待动员搬迁户上门联络；待发布预警仍补一条核查。',
    hazardStatuses: ['监测中'],
    evacuationStatuses: ['待动员'],
    pendingAlarmExtra: true,
  },
]

export function ruleByVersion(version: number): HandoverRule {
  const rule = HANDOVER_RULES.find((item) => item.version === version)
  if (!rule) {
    throw new Error(`交接口径版本 v${version} 不存在`)
  }
  return rule
}

export type RuleContext = {
  hazards: EntryRow[]
  evacuations: EntryRow[]
  alarms: EntryRow[]
}

type TaskDraft = Omit<HandoverTask, 'id' | 'status' | 'createdAt'>

function townshipOfHazard(row: EntryRow): string {
  return String(row['所在乡镇'] ?? '')
}

/**
 * 按口径试算某班次交班时应落的任务。
 * 同一班次内隐患点只出一条核查任务（白名单状态与待发布预警命中去重）。
 */
export function planTaskDrafts(shift: DutyShift, rule: HandoverRule, ctx: RuleContext): TaskDraft[] {
  const drafts: TaskDraft[] = []

  const localHazards = ctx.hazards.filter(
    (row) => townshipOfHazard(row) === shift.township,
  )
  const hazardName = new Map(
    ctx.hazards.map((row) => [String(row['隐患点编号'] ?? ''), String(row['隐患点名称'] ?? '')]),
  )
  const hazardTownship = new Map(
    ctx.hazards.map((row) => [String(row['隐患点编号'] ?? ''), townshipOfHazard(row)]),
  )

  const coveredHazardCodes = new Set<string>()
  localHazards
    .filter((row) => rule.hazardStatuses.includes(String(row.status)))
    .forEach((row) => {
      const code = String(row['隐患点编号'] ?? '')
      coveredHazardCodes.add(code)
      drafts.push({
        code: '',
        kind: 'inspect',
        shiftId: shift.id,
        township: shift.township,
        refCode: code,
        refName: hazardName.get(code) ?? code,
        title: `${shift.date} ${shift.township} ${hazardName.get(code) ?? code} 现场核查`,
        ruleVersion: rule.version,
      })
    })

  if (rule.pendingAlarmExtra) {
    ctx.alarms
      .filter((row) => String(row.status) === '待发布')
      .filter((row) => hazardTownship.get(String(row['隐患点编号'] ?? '')) === shift.township)
      .forEach((row) => {
        const code = String(row['隐患点编号'] ?? '')
        if (!code || coveredHazardCodes.has(code)) {
          return
        }
        coveredHazardCodes.add(code)
        drafts.push({
          code: '',
          kind: 'inspect',
          shiftId: shift.id,
          township: shift.township,
          refCode: code,
          refName: hazardName.get(code) ?? code,
          title: `${shift.date} ${shift.township} ${hazardName.get(code) ?? code} 待发布预警现场核查`,
          ruleVersion: rule.version,
        })
      })
  }

  ctx.evacuations
    .filter((row) => rule.evacuationStatuses.includes(String(row.status)))
    .filter((row) => hazardTownship.get(String(row['所属隐患点'] ?? '')) === shift.township)
    .forEach((row) => {
      const householdCode = String(row['户号'] ?? '')
      const hazardCode = String(row['所属隐患点'] ?? '')
      drafts.push({
        code: '',
        kind: 'contact',
        shiftId: shift.id,
        township: shift.township,
        refCode: householdCode,
        refName: String(row['户主姓名'] ?? householdCode),
        title: `${shift.date} ${shift.township} ${hazardName.get(hazardCode) ?? hazardCode} ${String(
          row['户主姓名'] ?? householdCode,
        )}户 避险搬迁联络`,
        ruleVersion: rule.version,
      })
    })

  return drafts
}

/** 给试算结果编号并落库：JC- 现场核查，LL- 联络任务。 */
export function materializeTasks(
  drafts: TaskDraft[],
  seq: { inspect: number; contact: number },
  createdAt: string,
): HandoverTask[] {
  return drafts.map((draft) => {
    if (draft.kind === 'inspect') {
      seq.inspect += 1
    } else {
      seq.contact += 1
    }
    return {
      ...draft,
      id: 0,
      code: `${draft.kind === 'inspect' ? 'JC' : 'LL'}-${String(
        draft.kind === 'inspect' ? seq.inspect : seq.contact,
      ).padStart(4, '0')}`,
      status: 'open',
      createdAt,
    }
  })
}
