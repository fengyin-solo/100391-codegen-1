import type { ActionResult } from '@/data/types'
import {
  buildShiftTasks,
  readTaskContext,
  shiftIdOf,
  shiftSource,
  SHIFT_KINDS,
  summarizeCell,
  TOWNSHIPS,
} from '@/data/duty-logic'
import { COUNTY_LEADER, DUTY_ROSTER, rosterActors } from '@/data/duty-seed'
import { dutyState, resetDutyState, updateDutyState } from '@/data/duty-store'
import type {
  CellSummary,
  DutyActor,
  DutyShift,
  DutyTask,
  HandoverRules,
  MatrixCell,
  SwapRequest,
  SwapSubmit,
} from '@/data/duty-types'

export interface DutyIdentity {
  name: string
  role: '负责人' | '值班员'
  township: string
}

function ok(message: string): ActionResult {
  return { ok: true, message }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

export function currentRules(): HandoverRules {
  return dutyState().rules
}

export function listActors(): DutyActor[] {
  return rosterActors()
}

export function findShift(id: string): DutyShift | undefined {
  return dutyState().shifts.find((shift) => shift.id === id)
}

function indexShift(state: ReturnType<typeof dutyState>, id: string): number {
  return state.shifts.findIndex((shift) => shift.id === id)
}

// 窗口补排的占位班次第一次被操作时落库。
function materializeShift(state: ReturnType<typeof dutyState>, id: string): DutyShift | null {
  const found = state.shifts.find((shift) => shift.id === id)
  if (found) {
    return found
  }
  const match = /^DUTY-(\d{4}-\d{2}-\d{2})-([DN])-(\d{2})$/.exec(id)
  if (!match) {
    return null
  }
  const townshipIndex = Number(match[3]) - 1
  if (townshipIndex < 0 || townshipIndex >= TOWNSHIPS.length) {
    return null
  }
  const shift: DutyShift = {
    id,
    date: match[1],
    kind: match[2] === 'D' ? '白班' : '夜班',
    township: TOWNSHIPS[townshipIndex],
    leader: '',
    members: [],
    status: '待接班',
    handoverConfirmed: false,
    confirmedAt: null,
    confirmedBy: null,
    ruleVersion: null,
    taskGenerated: false,
    generatedTaskIds: [],
    crossTown: false,
    note: '格内排班补录',
  }
  state.shifts.push(shift)
  return shift
}

function deriveTownshipFromId(id: string): string | null {
  const match = /-(\d{2})$/.exec(id)
  if (!match) {
    return null
  }
  const index = Number(match[1]) - 1
  return index >= 0 && index < TOWNSHIPS.length ? TOWNSHIPS[index] : null
}

function appendLog(state: ReturnType<typeof dutyState>, actor: string, action: string, detail: string): void {
  state.logs.unshift({
    id: state.seq.log++,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  })
}

/** 已结束 = 已交班或已归档；口径调整后只有未结束班次参与重算。 */
export function isEnded(shift: DutyShift): boolean {
  return shift.status === '已交班' || shift.status === '已归档'
}

function actorByName(name: string): DutyActor | undefined {
  return rosterActors().find((actor) => actor.name === name)
}

/**
 * 确认交班：
 * 只有班次带班负责人本人或县值班室负责人可确认；
 * 确认即冻结当前口径版本，并向隐患点台账 / 避险搬迁落任务；
 * 同一班次重复确认只落一套任务（幂等）。
 */
export function confirmHandover(shiftId: string, actor: DutyIdentity): ActionResult {
  const shift = findShift(shiftId)
  if (!shift) {
    return fail('没有找到对应班次')
  }
  if (actor.role !== '负责人') {
    return fail('交班确认须由值班负责人操作')
  }
  if (shift.status === '已归档') {
    return fail('该班次已归档，不能重复确认')
  }
  if (shift.handoverConfirmed) {
    return fail('该班次已确认交班，任务只落一套，无需重复确认')
  }
  if (shift.status !== '值班中') {
    return fail('该班次尚未接班，不能确认交班')
  }
  if (!shift.leader) {
    return fail('该格尚未安排带班负责人，不能确认交班')
  }

  const state = dutyState()
  const rules = state.rules
  // 幂等：即便历史标记错乱，已生成过任务也不再重复落。
  if (shift.taskGenerated && shift.generatedTaskIds.length > 0) {
    return fail('该班次交班任务已生成，重复确认不会再落任务')
  }

  updateDutyState((draft) => {
    const idx = indexShift(draft, shiftId)
    const target = draft.shifts[idx]
    target.handoverConfirmed = true
    target.confirmedAt = new Date().toISOString()
    target.confirmedBy = actor.name
    target.ruleVersion = draft.rules.version
    target.status = '已交班'

    const built = buildShiftTasks(target, draft.rules, readTaskContext(), draft.seq.task)
    for (const task of built) {
      draft.tasks.push(task)
      target.generatedTaskIds.push(task.id)
      draft.seq.task++
    }
    target.taskGenerated = built.length > 0
    appendLog(
      draft,
      actor.name,
      '确认交班',
      `${shiftSource(target)}按 v${draft.rules.version} 口径落任务 ${built.length} 条`,
    )
  })
  return ok(`交班已确认，按当前 v${rules.version} 口径生成核查/联络任务，同一班次只落一套`)
}

/** 归档：已交班班次封存，口径版本与任务一并定格，后续口径调整不再重算。 */
export function archiveShift(shiftId: string, actor: DutyIdentity): ActionResult {
  if (actor.role !== '负责人') {
    return fail('归档须由值班负责人操作')
  }
  const shift = findShift(shiftId)
  if (!shift) {
    return fail('没有找到对应班次')
  }
  if (shift.status !== '已交班') {
    return fail('只有已交班班次可以归档')
  }
  updateDutyState((draft) => {
    const idx = indexShift(draft, shiftId)
    draft.shifts[idx].status = '已归档'
    appendLog(draft, actor.name, '班次归档', `${shiftSource(draft.shifts[idx])}已封存，保留 v${draft.shifts[idx].ruleVersion} 口径`)
  })
  return ok('班次已归档，交接口径与任务按当时版本保留')
}

/** 接班：待接班班次进入值班中。 */
export function takeOverShift(shiftId: string, actor: DutyIdentity): ActionResult {
  const current = findShift(shiftId)
  if (current && current.status !== '待接班') {
    return fail('该班次已接班或已结束')
  }
  if (!current && !deriveTownshipFromId(shiftId)) {
    return fail('没有找到对应班次')
  }
  let label = ''
  updateDutyState((draft) => {
    const target = materializeShift(draft, shiftId)
    if (!target) {
      return
    }
    target.status = '值班中'
    label = shiftSource(target)
    appendLog(draft, actor.name, '接班', label)
  })
  return label ? ok(`${label}已接班，进入值班中`) : fail('没有找到对应班次')
}

/**
 * 格内直接换班：
 * 同乡镇换人当场生效；跨乡镇换人须负责人授权——
 * 负责人本人发起可直接授权生效，值班员发起则进入待审批。
 */
export function requestSwap(payload: SwapSubmit, actor: DutyIdentity): ActionResult & { swapId?: number } {
  const existing = findShift(payload.shiftId)
  if (existing && isEnded(existing)) {
    return fail('该班次已结束，不能换班')
  }
  const toActor = actorByName(payload.toPerson)
  if (!toActor) {
    return fail('花名册里没有该值班人员')
  }
  if (existing && (payload.toPerson === existing.leader || existing.members.includes(payload.toPerson))) {
    return fail('该人员已在本格班次内，无需换班')
  }
  if (
    existing &&
    payload.fromPerson &&
    payload.fromPerson !== existing.leader &&
    !existing.members.includes(payload.fromPerson)
  ) {
    return fail('被替换人员不在本格班次内')
  }
  const shiftTownship = existing?.township ?? deriveTownshipFromId(payload.shiftId)
  if (!shiftTownship) {
    return fail('没有找到对应班次')
  }
  // 县值班室代乡镇班也算跨乡镇，需要授权。
  const crossTown = toActor.township !== shiftTownship

  let result: ActionResult & { swapId?: number } = { ok: true, message: '' }

  updateDutyState((draft) => {
    const target = materializeShift(draft, payload.shiftId)
    if (!target) {
      result = fail('没有找到对应班次')
      return
    }
    const swap: SwapRequest = {
      id: draft.seq.swap++,
      shiftId: target.id,
      shiftLabel: shiftSource(target),
      fromPerson: payload.fromPerson,
      toPerson: payload.toPerson,
      fromTownship: target.township,
      toTownship: toActor.township,
      crossTown,
      reason: payload.reason,
      status: '待审批',
      authorizedBy: null,
      authorizedAt: null,
      createdAt: new Date().toISOString(),
    }

    if (!crossTown) {
      // 同乡镇换班不需要负责人授权。
      swap.status = '已授权'
      swap.authorizedBy = actor.name
      swap.authorizedAt = new Date().toISOString()
      applySwapToShift(draft, swap, toActor)
      appendLog(draft, actor.name, '格内换班', `${swap.shiftLabel}：${swap.fromPerson} → ${swap.toPerson}（同乡镇）`)
      draft.swaps.unshift(swap)
      result = ok(`同乡镇换班已生效：${swap.fromPerson} → ${swap.toPerson}`)
    } else if (actor.role === '负责人' && actor.township === COUNTY_LEADER.township) {
      // 县值班室负责人发起跨乡镇代班，自行授权并生效。
      swap.status = '已授权'
      swap.authorizedBy = actor.name
      swap.authorizedAt = new Date().toISOString()
      applySwapToShift(draft, swap, toActor)
      appendLog(draft, actor.name, '授权跨乡镇代班', `${swap.shiftLabel}：${swap.fromPerson} → ${swap.toPerson}（${toActor.township}）`)
      draft.swaps.unshift(swap)
      result = ok(`跨乡镇代班已由县值班室负责人授权并生效：${swap.fromPerson} → ${swap.toPerson}`)
    } else {
      draft.swaps.unshift(swap)
      appendLog(draft, actor.name, '提交跨乡镇代班申请', `${swap.shiftLabel}：${swap.fromPerson} → ${swap.toPerson}（${toActor.township}），待负责人授权`)
      result = ok('跨乡镇代班需负责人授权，申请已提交')
    }
    result.swapId = swap.id
  })

  return result
}

function applySwapToShift(state: ReturnType<typeof dutyState>, swap: SwapRequest, toActor: DutyActor): void {
  const idx = indexShift(state, swap.shiftId)
  if (idx < 0) {
    return
  }
  const shift = state.shifts[idx]

  // 先把被替换人从格内移出（空班直接排人时 fromPerson 为空）。
  if (swap.fromPerson) {
    if (swap.fromPerson === shift.leader) {
      shift.leader = ''
    }
    shift.members = shift.members.filter((name) => name !== swap.fromPerson)
  }

  // 再把代班人放进去：带班负责人进负责人位，值班员进成员位。
  if (toActor.role === '负责人') {
    shift.leader = swap.toPerson
  } else if (!shift.members.includes(swap.toPerson)) {
    shift.members.push(swap.toPerson)
  }

  if (swap.crossTown) {
    shift.crossTown = true
    shift.note = `${swap.toPerson}（${toActor.township}）跨乡镇代班，授权人：${swap.authorizedBy ?? '待授权'}`
  }
}

/** 县值班室负责人审批跨乡镇代班申请（乡镇负责人无权授权跨乡镇）。 */
export function decideSwap(swapId: number, approve: boolean, actor: DutyIdentity): ActionResult {
  if (actor.role !== '负责人' || actor.township !== COUNTY_LEADER.township) {
    return fail('跨乡镇代班须由县值班室负责人授权')
  }
  const state = dutyState()
  const swap = state.swaps.find((item) => item.id === swapId)
  if (!swap) {
    return fail('没有找到该代班申请')
  }
  if (swap.status !== '待审批') {
    return fail('该申请已处理')
  }
  const toActor = actorByName(swap.toPerson)
  if (!toActor) {
    return fail('花名册里没有该值班人员')
  }
  updateDutyState((draft) => {
    const target = draft.swaps.find((item) => item.id === swapId)
    if (!target) {
      return
    }
    target.status = approve ? '已授权' : '已拒绝'
    target.authorizedBy = actor.name
    target.authorizedAt = new Date().toISOString()
    if (approve) {
      applySwapToShift(draft, target, toActor)
      appendLog(draft, actor.name, '授权跨乡镇代班', `${target.shiftLabel}：${target.fromPerson} → ${target.toPerson}（${target.toTownship}）`)
    } else {
      appendLog(draft, actor.name, '驳回跨乡镇代班', `${target.shiftLabel}：${target.fromPerson} → ${target.toPerson}`)
    }
  })
  return approve ? ok('已授权，代班已写入值班格') : ok('已驳回该跨乡镇代班申请')
}

export function pendingSwapCount(): number {
  return dutyState().swaps.filter((swap) => swap.status === '待审批').length
}

export interface RulesDraft {
  hazardStatuses: string[]
  generateContact: boolean
  contactStatuses: string[]
  contactMode: string
}

/**
 * 调整交接口径：
 * 生成新版本，只重算未结束（待接班/值班中/已交班未归档）班次的预案任务；
 * 已归档班次保留当时规则与已落任务，不动。
 */
export function updateHandoverRules(draft: RulesDraft, actor: DutyIdentity): ActionResult {
  if (actor.role !== '负责人') {
    return fail('交接口径须由值班负责人调整')
  }
  if (draft.hazardStatuses.length === 0) {
    return fail('至少保留一种需核查的隐患状态')
  }
  if (draft.generateContact && draft.contactStatuses.length === 0) {
    return fail('启用联络任务时至少选择一种搬迁状态')
  }

  let recomputed = 0
  let frozen = 0
  const newVersion = dutyState().rules.version + 1

  updateDutyState((state) => {
    const rules: HandoverRules = {
      version: newVersion,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.name,
      ...draft,
    }
    state.ruleHistory.push({ ...rules })
    state.rules = rules

    const ctx = readTaskContext()
    for (const shift of state.shifts) {
      if (shift.status === '已归档') {
        frozen++
        continue
      }
      // 删除该班次按旧口径生成的任务，按新口径重算（含已交班未归档）。
      const oldIds = new Set(shift.generatedTaskIds)
      if (oldIds.size > 0) {
        state.tasks = state.tasks.filter((task) => !oldIds.has(task.id))
        shift.generatedTaskIds = []
        shift.taskGenerated = false
      }
      if (shift.handoverConfirmed) {
        const built = buildShiftTasks(shift, rules, ctx, state.seq.task)
        for (const task of built) {
          state.tasks.push(task)
          shift.generatedTaskIds.push(task.id)
          state.seq.task++
        }
        shift.taskGenerated = built.length > 0
        shift.ruleVersion = rules.version
        recomputed++
      }
    }

    appendLog(
      state,
      actor.name,
      '调整交接口径',
      `口径升级至 v${newVersion}：重算 ${recomputed} 个未结束班次，${frozen} 个已归档班次保留原规则`,
    )
  })
  return ok(`口径已升级至 v${newVersion}：重算 ${recomputed} 个未结束班次，已归档班次保留当时规则`)
}

export interface ShiftTasks {
  check: DutyTask[]
  contact: DutyTask[]
}

export function tasksOfShift(shiftId: string): ShiftTasks {
  const tasks = dutyState().tasks.filter((task) => task.shiftId === shiftId)
  return {
    check: tasks.filter((task) => task.category === '现场核查'),
    contact: tasks.filter((task) => task.category === '避险联络'),
  }
}

/** 隐患点台账页：该隐患点待办的现场核查任务。 */
export function checkTasksForHazard(hazardId: number): DutyTask[] {
  return dutyState().tasks.filter((task) => task.category === '现场核查' && task.refId === hazardId)
}

/** 避险搬迁页：该户待办的联络任务。 */
export function contactTasksForHousehold(householdId: number): DutyTask[] {
  return dutyState().tasks.filter((task) => task.category === '避险联络' && task.refId === householdId)
}

export function allDutyTasks(): DutyTask[] {
  return dutyState().tasks
}

export function updateTaskStatus(taskId: number, status: DutyTask['status']): ActionResult {
  const exists = dutyState().tasks.some((task) => task.id === taskId)
  if (!exists) {
    return fail('没有找到该任务')
  }
  updateDutyState((draft) => {
    const task = draft.tasks.find((item) => item.id === taskId)
    if (task) {
      task.status = status
    }
  })
  return ok(`任务已标记为「${status}」`)
}

function datesInWindow(days: number, anchor: Date): string[] {
  const out: string[] = []
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(anchor)
    date.setDate(anchor.getDate() + offset)
    out.push(date.toISOString().slice(0, 10))
  }
  return out
}

/** 值班矩阵：日期 × 班次 × 乡镇，缺格自动补占位班次。 */
export function buildMatrix(startDate: string, days = 6): MatrixCell[] {
  const state = dutyState()
  const ctx = readTaskContext()
  const anchor = new Date(`${startDate}T00:00:00`)
  const dates = datesInWindow(days, anchor)
  const cells: MatrixCell[] = []

  for (const date of dates) {
    for (const kind of SHIFT_KINDS) {
      TOWNSHIPS.forEach((township, tIndex) => {
        const id = shiftIdOf(date, kind, tIndex)
        const existed = state.shifts.find((item) => item.id === id)
        // 窗口内还没排的班次自动补为待接班，保证每格都可点开换班。
        const shift: DutyShift = existed ?? {
          id,
          date,
          kind,
          township,
          leader: '',
          members: [],
          status: '待接班',
          handoverConfirmed: false,
          confirmedAt: null,
          confirmedBy: null,
          ruleVersion: null,
          taskGenerated: false,
          generatedTaskIds: [],
          crossTown: false,
          note: '系统自动补排，可直接格内排人换班',
        }
        const summary: CellSummary = summarizeCell(township, ctx)
        const shiftTasks = state.tasks.filter((task) => task.shiftId === id)
        cells.push({
          shift,
          date,
          kind,
          township,
          summary,
          checkTasks: shiftTasks.filter((task) => task.category === '现场核查').length,
          contactTasks: shiftTasks.filter((task) => task.category === '避险联络').length,
        })
      })
    }
  }
  return cells
}

/** 未交班格内任务数：按当前口径实时预估，供格内提示「交班将落 N 条任务」。 */
export function previewTaskCount(township: string): { check: number; contact: number } {
  const state = dutyState()
  const ctx = readTaskContext()
  const probe: DutyShift = {
    id: 'preview',
    date: '',
    kind: '白班',
    township,
    leader: '',
    members: [],
    status: '值班中',
    handoverConfirmed: false,
    confirmedAt: null,
    confirmedBy: null,
    ruleVersion: null,
    taskGenerated: false,
    generatedTaskIds: [],
    crossTown: false,
    note: '',
  }
  const built = buildShiftTasks(probe, state.rules, ctx, state.seq.task)
  return {
    check: built.filter((task) => task.category === '现场核查').length,
    contact: built.filter((task) => task.category === '避险联络').length,
  }
}

export function listSwaps(): SwapRequest[] {
  return dutyState().swaps
}

export function listLogs() {
  return dutyState().logs
}

export function resetDuty(): ActionResult {
  resetDutyState()
  return ok('值班矩阵已恢复为示例数据')
}

export { DUTY_ROSTER, COUNTY_LEADER, TOWNSHIPS }
