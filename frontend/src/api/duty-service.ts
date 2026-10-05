import { listRows } from '@/data/local-store'
import type { ActionResult } from '@/data/types'

import {
  cloneDutyState,
  dutyState,
  resetDutyState,
  saveDutyState,
} from '@/data/duty/store'
import { DUTY_DATES, DUTY_TOWNSHIPS, TODAY } from '@/data/duty/seed'
import {
  HANDOVER_RULES,
  planTaskDrafts,
  ruleByVersion,
} from '@/data/duty/rules'
import type {
  CellSummary,
  DutyMatrixCell,
  DutyPerson,
  DutyShift,
  HandoverRule,
  HandoverTask,
  TaskKind,
} from '@/data/duty/types'

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dutyContext() {
  return {
    dates: [...DUTY_DATES],
    townships: [...DUTY_TOWNSHIPS],
    today: TODAY,
  }
}

export function dutyPeople(): DutyPerson[] {
  return dutyState().people
}

export function currentRule(): HandoverRule {
  const state = dutyState()
  return (
    state.rules.find((item) => item.version === state.currentRuleVersion) ??
    ruleByVersion(state.currentRuleVersion)
  )
}

export function dutyRules(): HandoverRule[] {
  return [...HANDOVER_RULES]
}

function findShift(state: ReturnType<typeof dutyState>, id: number): DutyShift | undefined {
  return state.shifts.find((item) => item.id === id)
}

function summarize(township: string): CellSummary {
  const hazards = listRows('hazard').filter((row) => String(row['所在乡镇'] ?? '') === township)
  const stationCodes = new Set(
    dutyState().stations.filter((item) => item.township === township).map((item) => item.code),
  )
  const hazardCodes = new Set(hazards.map((row) => String(row['隐患点编号'] ?? '')))
  const pendingAlarms = listRows('alarm').filter(
    (row) =>
      String(row.status) === '待发布' && hazardCodes.has(String(row['隐患点编号'] ?? '')),
  ).length
  return {
    hazards: hazards.length,
    stations: stationCodes.size,
    pendingAlarms,
  }
}

/** 格内按当时（已确认班次）或当前（未确认班次）口径试算应落任务数。 */
function previewCount(shift: DutyShift): number {
  const state = dutyState()
  const rule =
    shift.ruleVersion !== undefined
      ? state.rules.find((item) => item.version === shift.ruleVersion) ?? ruleByVersion(shift.ruleVersion)
      : state.rules.find((item) => item.version === state.currentRuleVersion) ?? currentRule()
  const drafts = planTaskDrafts(shift, rule, {
    hazards: listRows('hazard'),
    evacuations: listRows('evacuation'),
    alarms: listRows('alarm'),
  })
  return drafts.length
}

function isCrossCover(shift: DutyShift): boolean {
  const person = dutyState().people.find((item) => item.name === shift.person)
  return !!person && person.township !== '县级' && person.township !== shift.township
}

export function loadMatrix(): DutyMatrixCell[] {
  const state = dutyState()
  return DUTY_DATES.flatMap((date) =>
    DUTY_TOWNSHIPS.map((township) => {
      const shift = state.shifts.find((item) => item.date === date && item.township === township)
      if (!shift) {
        throw new Error(`缺少 ${date} ${township} 的值班班次数据`)
      }
      return {
        shift,
        summary: summarize(township),
        tasks: state.tasks.filter((task) => task.shiftId === shift.id),
        previewTaskCount: previewCount(shift),
        crossTownshipCover: isCrossCover(shift),
      }
    }),
  )
}

export function shiftDetail(id: number): { shift: DutyShift; tasks: HandoverTask[] } {
  const state = dutyState()
  const shift = findShift(state, id)
  if (!shift) {
    throw new Error(`没有找到编号为 ${id} 的班次`)
  }
  return { shift, tasks: state.tasks.filter((task) => task.shiftId === id) }
}

export function shiftLabel(id: number): string {
  const state = dutyState()
  const shift = findShift(state, id)
  return shift ? `${shift.date} ${shift.township}` : `班次#${id}`
}

export function startDuty(id: number): ActionResult {
  const state = cloneDutyState()
  const shift = findShift(state, id)
  if (!shift) {
    return { ok: false, message: `没有找到编号为 ${id} 的班次` }
  }
  if (shift.status !== 'pending') {
    return { ok: false, message: '仅待值班班次能接班上岗' }
  }
  shift.status = 'ongoing'
  shift.logs.push({ at: nowStamp(), type: 'swap', detail: `值班人${shift.person}接班上岗` })
  saveDutyState(state)
  return { ok: true, message: `${shift.date} ${shift.township} 已接班上岗` }
}

type SwapInput = {
  person: string
  phone: string
  /** 跨乡镇代班时必填：县级值班负责人姓名 */
  authorizer?: string
  reason: string
}

export function swapShift(id: number, input: SwapInput): ActionResult {
  const state = cloneDutyState()
  const shift = findShift(state, id)
  if (!shift) {
    return { ok: false, message: `没有找到编号为 ${id} 的班次` }
  }
  if (shift.status === 'archived') {
    return { ok: false, message: '已归档班次不能换班' }
  }
  const person = state.people.find((item) => item.name === input.person)
  if (!person || person.role !== 'staff') {
    return { ok: false, message: '代班人必须是防汛值班人员花名册里的值班人员' }
  }
  if (!input.phone.trim()) {
    return { ok: false, message: '请填写代班联系电话' }
  }
  const cross = person.township !== shift.township
  let authDetail = ''
  if (cross) {
    const authorizer = input.authorizer?.trim() ?? ''
    if (!authorizer) {
      return { ok: false, message: `跨乡镇代班需值班负责人授权：${person.township}人员代${shift.township}班，请选择授权负责人` }
    }
    const leader = state.people.find((item) => item.name === authorizer)
    if (!leader || leader.role !== 'leader' || leader.scope !== 'county') {
      return { ok: false, message: '跨乡镇代班只能由县级值班负责人授权' }
    }
    authDetail = `，经县级值班负责人${authorizer}授权`
  }
  const reason = input.reason.trim() || '汛期临时调班'
  shift.person = person.name
  shift.phone = input.phone.trim()
  shift.logs.push({
    at: nowStamp(),
    type: 'swap',
    detail: `换班：${person.name}（${person.township}${person.title}）接替本班次${cross ? '，属跨乡镇代班' : ''}${authDetail}，原因：${reason}`,
  })
  saveDutyState(state)
  return {
    ok: true,
    message: cross
      ? `跨乡镇代班已由授权通过：${person.name} 接替 ${shift.township} 班次`
      : `换班成功：${person.name} 接替 ${shift.date} ${shift.township} 班次`,
  }
}

/** 替换某班次的任务集：重建时尽量沿用原编号与已办结状态，避免口径调整刷出新编号。 */
function replaceShiftTasks(state: ReturnType<typeof dutyState>, shift: DutyShift, rule: HandoverRule): void {
  const drafts = planTaskDrafts(shift, rule, {
    hazards: listRows('hazard'),
    evacuations: listRows('evacuation'),
    alarms: listRows('alarm'),
  })
  const oldTasks = state.tasks.filter((task) => task.shiftId === shift.id)
  const reused: Record<TaskKind, HandoverTask[]> = {
    inspect: oldTasks.filter((task) => task.kind === 'inspect'),
    contact: oldTasks.filter((task) => task.kind === 'contact'),
  }
  const usedIds = new Set<number>()
  const pool: HandoverTask[] = []

  drafts.forEach((draft, index) => {
    const sameKind = reused[draft.kind]
    const matched =
      sameKind.find((task, taskIndex) => !usedIds.has(task.id) && taskIndex === index) ??
      sameKind.find((task) => !usedIds.has(task.id) && task.refCode === draft.refCode)
    if (matched) {
      usedIds.add(matched.id)
      pool.push({
        ...matched,
        refName: draft.refName,
        title: draft.title,
        ruleVersion: rule.version,
        // 对应对象还在则保留办结痕迹，否则重新打开
        status: matched.refCode === draft.refCode ? matched.status : 'open',
        doneAt: matched.refCode === draft.refCode ? matched.doneAt : undefined,
      })
    } else {
      pool.push({
        ...draft,
        id: 0,
        code: '',
        status: 'open',
        createdAt: nowStamp(),
        ruleVersion: rule.version,
      })
    }
  })

  // 给新增项编号
  const seq = {
    inspect: Math.max(0, ...state.tasks.filter((t) => t.kind === 'inspect').map((t) => Number(t.code.slice(3)) || 0)),
    contact: Math.max(0, ...state.tasks.filter((t) => t.kind === 'contact').map((t) => Number(t.code.slice(3)) || 0)),
  }
  let nextId = state.tasks.reduce((max, task) => Math.max(max, task.id), 0)
  pool.forEach((task) => {
    if (task.id === 0) {
      const kind = task.kind
      seq[kind] += 1
      task.code = `${kind === 'inspect' ? 'JC' : 'LL'}-${String(seq[kind]).padStart(4, '0')}`
      nextId += 1
      task.id = nextId
    }
  })

  state.tasks = state.tasks.filter((task) => task.shiftId !== shift.id).concat(pool)
}

export function confirmHandover(id: number, note: string): ActionResult {
  const state = cloneDutyState()
  const shift = findShift(state, id)
  if (!shift) {
    return { ok: false, message: `没有找到编号为 ${id} 的班次` }
  }
  // 幂等：同一班次已有任务集（或已确认过）时，直接返回，不重复落任务。
  // 检查要放在状态校验之前，这样已交班、已归档班次重复确认都只会得到同一结果。
  if (shift.status !== 'ongoing' || state.tasks.some((task) => task.shiftId === shift.id)) {
    if (shift.status === 'pending') {
      return { ok: false, message: '班次尚未接班上岗，不能确认交班' }
    }
    if (shift.status === 'ongoing') {
      return { ok: false, message: '当前班次异常：进行中但未生成交班任务，请联系管理员' }
    }
    return { ok: true, message: '该班次已确认过交班，未重复生成任务（同一班次只落一套）' }
  }
  const rule =
    state.rules.find((item) => item.version === state.currentRuleVersion) ??
    ruleByVersion(state.currentRuleVersion)
  shift.status = 'handed'
  shift.ruleVersion = rule.version
  shift.confirmedAt = nowStamp()
  shift.handoverNote = note.trim()
  shift.logs.push({
    at: shift.confirmedAt,
    type: 'handover',
    detail: `值班负责人${shift.leader}确认交班，按「${rule.label}」v${rule.version} 落一套交接任务`,
  })
  replaceShiftTasks(state, shift, rule)
  saveDutyState(state)
  return { ok: true, message: `交班已确认：按「${rule.label}」生成隐患点现场核查与避险搬迁联络任务各一套` }
}

export function archiveShift(id: number): ActionResult {
  const state = cloneDutyState()
  const shift = findShift(state, id)
  if (!shift) {
    return { ok: false, message: `没有找到编号为 ${id} 的班次` }
  }
  if (shift.status !== 'handed') {
    return { ok: false, message: '仅已交班未归档的班次能归档' }
  }
  shift.status = 'archived'
  shift.archivedAt = nowStamp()
  shift.logs.push({
    at: shift.archivedAt,
    type: 'archive',
    detail: `班次归档，交接口径冻结为 v${shift.ruleVersion}，后续口径调整不再重算`,
  })
  saveDutyState(state)
  return { ok: true, message: '班次已归档，交班任务与口径版本已冻结' }
}

export function adjustHandoverRule(note: string): ActionResult {
  const state = cloneDutyState()
  const nextVersion = state.currentRuleVersion + 1
  const preset = HANDOVER_RULES.find((item) => item.version === nextVersion)
  const rule: HandoverRule = preset
    ? { ...preset, publishedAt: nowStamp(), note: note.trim() || preset.note }
    : {
        version: nextVersion,
        label: `主汛期口径调整第 ${nextVersion - 2} 次`,
        publishedAt: nowStamp(),
        note: note.trim() || '交接口径已调整',
        hazardStatuses: ['监测中'],
        evacuationStatuses: ['待动员'],
        pendingAlarmExtra: true,
      }
  state.rules.push(rule)
  state.currentRuleVersion = nextVersion

  // 只重算未结束（未归档）班次：未确认班次没有任务集，仅后续试算用新口径；
  // 已确认未归档班次按新口径重建；归档班次不动。
  let rebuilt = 0
  state.shifts
    .filter((shift) => shift.status === 'handed')
    .forEach((shift) => {
      shift.ruleVersion = nextVersion
      shift.logs.push({
        at: rule.publishedAt,
        type: 'rule',
        detail: `交接口径调整为「${rule.label}」v${nextVersion}，本班次尚未结束，任务按新口径重算`,
      })
      replaceShiftTasks(state, shift, rule)
      rebuilt += 1
    })
  state.shifts
    .filter((shift) => shift.status === 'pending' || shift.status === 'ongoing')
    .forEach((shift) => {
      shift.logs.push({
        at: rule.publishedAt,
        type: 'rule',
        detail: `交接口径调整为「${rule.label}」v${nextVersion}，本班次未结束，交班确认时按新口径落任务`,
      })
    })

  saveDutyState(state)
  return {
    ok: true,
    message: `口径已调整为 v${nextVersion}：重算 ${rebuilt} 个已交班未归档班次，归档班次保留原规则`,
  }
}

export function listTasksByHazard(hazardCode: string): HandoverTask[] {
  return dutyState()
    .tasks.filter((task) => task.kind === 'inspect' && task.refCode === hazardCode)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function listTasksByHousehold(householdCode: string): HandoverTask[] {
  return dutyState()
    .tasks.filter((task) => task.kind === 'contact' && task.refCode === householdCode)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function completeTask(id: number): ActionResult {
  const state = cloneDutyState()
  const task = state.tasks.find((item) => item.id === id)
  if (!task) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接任务` }
  }
  if (task.status === 'done') {
    return { ok: false, message: '任务已办结，不用重复提交' }
  }
  task.status = 'done'
  task.doneAt = nowStamp()
  saveDutyState(state)
  return { ok: true, message: `任务 ${task.code} 已办结` }
}

export function resetDutyMatrix(): ActionResult {
  resetDutyState()
  return { ok: true, message: '汛期值班矩阵已恢复为示例排班' }
}
