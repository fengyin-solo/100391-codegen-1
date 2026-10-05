import { buildShiftTasks, shiftIdOf, TOWNSHIPS } from './duty-logic'
import { SEED_ROWS } from './seed'
import type {
  DutyActor,
  DutyShift,
  DutyState,
  DutyTask,
  HandoverRules,
  ShiftKind,
} from './duty-types'

// 县值班室负责人：可代班任意乡镇、可授权跨乡镇代班、可调整交接口径。
export const COUNTY_LEADER: DutyActor = { name: '周建国', role: '负责人', township: '县值班室' }

// 乡镇值班花名册：带班负责人 + 值班员。
export const DUTY_ROSTER: Record<string, DutyActor[]> = {
  城关镇: [
    { name: '李建华', role: '负责人', township: '城关镇' },
    { name: '王敏', role: '值班员', township: '城关镇' },
    { name: '赵强', role: '值班员', township: '城关镇' },
  ],
  青龙镇: [
    { name: '陈志强', role: '负责人', township: '青龙镇' },
    { name: '刘洋', role: '值班员', township: '青龙镇' },
    { name: '黄莉', role: '值班员', township: '青龙镇' },
  ],
  白沙乡: [
    { name: '吴大勇', role: '负责人', township: '白沙乡' },
    { name: '钱进', role: '值班员', township: '白沙乡' },
  ],
  龙泉乡: [
    { name: '孙守山', role: '负责人', township: '龙泉乡' },
    { name: '周婷', role: '值班员', township: '龙泉乡' },
  ],
  金沙镇: [
    { name: '马振国', role: '负责人', township: '金沙镇' },
    { name: '何军', role: '值班员', township: '金沙镇' },
    { name: '冯雪', role: '值班员', township: '金沙镇' },
  ],
  云岭乡: [
    { name: '郑安民', role: '负责人', township: '云岭乡' },
    { name: '罗亮', role: '值班员', township: '云岭乡' },
  ],
}

export function rosterActors(): DutyActor[] {
  return [...Object.values(DUTY_ROSTER).flat(), COUNTY_LEADER]
}

// 初始口径 v1：在册、监测中隐患全部核查；待动员、已签约户逐户电话联络。
export const RULES_V1: HandoverRules = {
  version: 1,
  updatedAt: '2026-09-20T09:00:00',
  updatedBy: '周建国',
  hazardStatuses: ['在册', '监测中'],
  generateContact: true,
  contactStatuses: ['待动员', '已签约'],
  contactMode: '逐户电话确认撤离情况',
}

// 当前口径 v2：10月4日夜班前调整，已归档班次仍保留 v1。
export const RULES_V2: HandoverRules = {
  version: 2,
  updatedAt: '2026-10-04T19:30:00',
  updatedBy: '周建国',
  hazardStatuses: ['监测中'],
  generateContact: true,
  contactStatuses: ['待动员'],
  contactMode: '逐户电话+入户确认撤离情况',
}

interface ShiftSeed {
  status: DutyShift['status']
  handoverConfirmed: boolean
  confirmedAt: string | null
  ruleVersion: number | null
  crossTown?: boolean
  leaderOverride?: string
  note?: string
}

function roster(index: number, role: '负责人' | '值班员'): DutyActor {
  const actors = DUTY_ROSTER[TOWNSHIPS[index]]
  const picked = actors.filter((actor) => actor.role === role)
  return picked[index % picked.length]
}

function makeShift(date: string, kind: ShiftKind, townshipIndex: number, seed: ShiftSeed): DutyShift {
  const leader = roster(townshipIndex, '负责人')
  const membersPool = DUTY_ROSTER[TOWNSHIPS[townshipIndex]].filter(
    (actor) => actor.role === '值班员',
  )
  const member = membersPool[townshipIndex % membersPool.length]
  const leaderName = seed.leaderOverride ?? leader.name
  return {
    id: shiftIdOf(date, kind, townshipIndex),
    date,
    kind,
    township: TOWNSHIPS[townshipIndex],
    leader: leaderName,
    members: [member.name],
    status: seed.status,
    handoverConfirmed: seed.handoverConfirmed,
    confirmedAt: seed.confirmedAt,
    confirmedBy: seed.handoverConfirmed ? leaderName : null,
    ruleVersion: seed.ruleVersion,
    taskGenerated: false,
    generatedTaskIds: [],
    crossTown: seed.crossTown ?? false,
    note: seed.note ?? '',
  }
}

export function buildDutySeed(): DutyState {
  const dates = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']
  const shifts: DutyShift[] = []

  // 10-03 白班/夜班全部归档，定格在 v1。
  for (let t = 0; t < TOWNSHIPS.length; t++) {
    shifts.push(
      makeShift(dates[0], '白班', t, {
        status: '已归档',
        handoverConfirmed: true,
        confirmedAt: '2026-10-03T19:45:00',
        ruleVersion: 1,
      }),
    )
    shifts.push(
      makeShift(dates[0], '夜班', t, {
        status: '已归档',
        handoverConfirmed: true,
        confirmedAt: '2026-10-04T07:50:00',
        ruleVersion: 1,
      }),
    )
  }

  // 10-04 白班在 v1 下交班并归档；夜班在 v2 下已交班、待归档。
  for (let t = 0; t < TOWNSHIPS.length; t++) {
    shifts.push(
      makeShift(dates[1], '白班', t, {
        status: '已归档',
        handoverConfirmed: true,
        confirmedAt: '2026-10-04T19:40:00',
        ruleVersion: 1,
      }),
    )
  }
  for (let t = 0; t < TOWNSHIPS.length; t++) {
    const seed: ShiftSeed = {
      status: '已交班',
      handoverConfirmed: true,
      confirmedAt: '2026-10-05T07:45:00',
      ruleVersion: 2,
    }
    // 城关镇夜班已授权县值班室负责人跨乡镇代班。
    if (t === 0) {
      seed.crossTown = true
      seed.leaderOverride = COUNTY_LEADER.name
      seed.note = '县值班室周建国跨乡镇代班，已由负责人授权'
    }
    shifts.push(makeShift(dates[1], '夜班', t, seed))
  }

  // 10-05（今天）白班值班中、夜班待接班；后续日期待接班。
  for (let t = 0; t < TOWNSHIPS.length; t++) {
    shifts.push(
      makeShift(dates[2], '白班', t, {
        status: '值班中',
        handoverConfirmed: false,
        confirmedAt: null,
        ruleVersion: null,
      }),
    )
    shifts.push(
      makeShift(dates[2], '夜班', t, {
        status: '待接班',
        handoverConfirmed: false,
        confirmedAt: null,
        ruleVersion: null,
      }),
    )
  }
  for (const date of dates.slice(3)) {
    for (let t = 0; t < TOWNSHIPS.length; t++) {
      shifts.push(
        makeShift(date, '白班', t, {
          status: '待接班',
          handoverConfirmed: false,
          confirmedAt: null,
          ruleVersion: null,
        }),
      )
      shifts.push(
        makeShift(date, '夜班', t, {
          status: '待接班',
          handoverConfirmed: false,
          confirmedAt: null,
          ruleVersion: null,
        }),
      )
    }
  }

  // 给所有已确认班次按当时口径预生成任务：归档班次保留 v1，其余走 v2。
  const ctx = { hazards: SEED_ROWS.hazard, evacuations: SEED_ROWS.evacuation }
  const tasks: DutyTask[] = []
  let nextId = 1
  for (const shift of shifts) {
    if (!shift.handoverConfirmed || shift.ruleVersion === null) {
      continue
    }
    const rules = shift.ruleVersion === 1 ? RULES_V1 : RULES_V2
    const built = buildShiftTasks(shift, rules, ctx, nextId)
    for (const task of built) {
      tasks.push(task)
      shift.generatedTaskIds.push(task.id)
    }
    shift.taskGenerated = built.length > 0
    nextId += built.length
  }

  return {
    shifts,
    tasks,
    rules: { ...RULES_V2 },
    ruleHistory: [{ ...RULES_V1 }, { ...RULES_V2 }],
    swaps: [
      {
        id: 1,
        shiftId: shiftIdOf('2026-10-04', '夜班', 0),
        shiftLabel: '2026-10-04 夜班 · 城关镇',
        fromPerson: '李建华',
        toPerson: '周建国',
        fromTownship: '城关镇',
        toTownship: '县值班室',
        crossTown: true,
        reason: '城关镇负责人紧急事务，县值班室代班',
        status: '已授权',
        authorizedBy: '周建国',
        authorizedAt: '2026-10-04T17:20:00',
        createdAt: '2026-10-04T16:40:00',
      },
      {
        id: 2,
        shiftId: shiftIdOf('2026-10-06', '白班', 4),
        shiftLabel: '2026-10-06 白班 · 金沙镇',
        fromPerson: '何军',
        toPerson: '王敏',
        fromTownship: '金沙镇',
        toTownship: '城关镇',
        crossTown: true,
        reason: '何军家中有事，请城关镇值班员替班',
        status: '待审批',
        authorizedBy: null,
        authorizedAt: null,
        createdAt: '2026-10-05T08:30:00',
      },
    ],
    logs: [
      {
        id: 1,
        at: '2026-10-04T17:20:00',
        actor: '周建国',
        action: '授权跨乡镇代班',
        detail: '城关镇 2026-10-04 夜班由县值班室周建国代班',
      },
      {
        id: 2,
        at: '2026-10-04T19:30:00',
        actor: '周建国',
        action: '调整交接口径',
        detail: '口径升级至 v2：仅监测中隐患核查，联络范围收窄为待动员户',
      },
      {
        id: 3,
        at: '2026-10-05T08:30:00',
        actor: '何军',
        action: '提交代班申请',
        detail: '申请城关镇王敏跨乡镇代金沙镇 2026-10-06 白班，待负责人授权',
      },
    ],
    seq: { task: nextId, swap: 3, log: 4 },
  }
}
