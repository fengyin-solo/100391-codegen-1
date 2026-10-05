import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

import { HANDOVER_RULES, planTaskDrafts, materializeTasks } from './rules'
import type { DutyPerson, DutyShift, DutyStoreState, HandoverTask, RainStation } from './types'

// 汛期值班演示锚点：与种子业务数据同一天，保证首次打开就有「进行中」班次可操作。
export const DUTY_TOWNSHIPS = ['青山镇', '大溪乡', '南坪镇', '红岩乡']
export const DUTY_DATES = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']
export const TODAY = '2026-10-03'

const PEOPLE: DutyPerson[] = [
  { name: '罗建国', title: '县自然资源局分管副局长', township: '县级', role: 'leader', scope: 'county' },
  { name: '陈守峰', title: '县防汛办主任', township: '县级', role: 'leader', scope: 'county' },
  { name: '何志安', title: '青山镇镇长', township: '青山镇', role: 'leader', scope: 'township' },
  { name: '马春雨', title: '大溪乡乡长', township: '大溪乡', role: 'leader', scope: 'township' },
  { name: '高志强', title: '南坪镇镇长', township: '南坪镇', role: 'leader', scope: 'township' },
  { name: '唐万军', title: '红岩乡乡长', township: '红岩乡', role: 'leader', scope: 'township' },
  { name: '宋晓磊', title: '青山镇防汛专干', township: '青山镇', role: 'staff', scope: 'township' },
  { name: '梁文婷', title: '青山镇监测员', township: '青山镇', role: 'staff', scope: 'township' },
  { name: '田小满', title: '大溪乡防汛专干', township: '大溪乡', role: 'staff', scope: 'township' },
  { name: '韩东生', title: '大溪乡监测员', township: '大溪乡', role: 'staff', scope: 'township' },
  { name: '段晓玲', title: '南坪镇防汛专干', township: '南坪镇', role: 'staff', scope: 'township' },
  { name: '蒋海涛', title: '南坪镇监测员', township: '南坪镇', role: 'staff', scope: 'township' },
  { name: '邓启明', title: '红岩乡防汛专干', township: '红岩乡', role: 'staff', scope: 'township' },
  { name: '许春燕', title: '红岩乡监测员', township: '红岩乡', role: 'staff', scope: 'township' },
]

const STATIONS: RainStation[] = [
  { code: 'YL-01', name: '青龙坡站', township: '青山镇' },
  { code: 'YL-02', name: '大溪沟站', township: '大溪乡' },
  { code: 'YL-03', name: '南屏山站', township: '南坪镇' },
  { code: 'YL-04', name: '红岩洞站', township: '红岩乡' },
  { code: 'YL-05', name: '绿水垭站', township: '青山镇' },
]

type ShiftSeed = {
  leader: string
  person: string
  phone: string
  status: DutyShift['status']
  ruleVersion?: number
}

const GRID: Record<string, ShiftSeed> = {
  // 2026-10-02：已归档，按汛前口径 v1
  '青山镇@2026-10-02': { leader: '何志安', person: '宋晓磊', phone: '13900001001', status: 'archived', ruleVersion: 1 },
  '大溪乡@2026-10-02': { leader: '马春雨', person: '田小满', phone: '13900001002', status: 'archived', ruleVersion: 1 },
  '南坪镇@2026-10-02': { leader: '高志强', person: '段晓玲', phone: '13900001003', status: 'archived', ruleVersion: 1 },
  '红岩乡@2026-10-02': { leader: '唐万军', person: '邓启明', phone: '13900001004', status: 'archived', ruleVersion: 1 },
  // 2026-10-03：进行中，尚未确认交班，格内按当前口径试算
  '青山镇@2026-10-03': { leader: '何志安', person: '梁文婷', phone: '13900001005', status: 'ongoing' },
  '大溪乡@2026-10-03': { leader: '马春雨', person: '韩东生', phone: '13900001006', status: 'ongoing' },
  '南坪镇@2026-10-03': { leader: '高志强', person: '蒋海涛', phone: '13900001007', status: 'ongoing' },
  '红岩乡@2026-10-03': { leader: '唐万军', person: '许春燕', phone: '13900001008', status: 'ongoing' },
  // 2026-10-04：待值班
  '青山镇@2026-10-04': { leader: '何志安', person: '宋晓磊', phone: '13900001001', status: 'pending' },
  '大溪乡@2026-10-04': { leader: '马春雨', person: '田小满', phone: '13900001002', status: 'pending' },
  '南坪镇@2026-10-04': { leader: '高志强', person: '段晓玲', phone: '13900001003', status: 'pending' },
  '红岩乡@2026-10-04': { leader: '唐万军', person: '邓启明', phone: '13900001004', status: 'pending' },
  // 2026-10-05：待值班
  '青山镇@2026-10-05': { leader: '何志安', person: '梁文婷', phone: '13900001005', status: 'pending' },
  '大溪乡@2026-10-05': { leader: '马春雨', person: '韩东生', phone: '13900001006', status: 'pending' },
  '南坪镇@2026-10-05': { leader: '高志强', person: '蒋海涛', phone: '13900001007', status: 'pending' },
  '红岩乡@2026-10-05': { leader: '唐万军', person: '许春燕', phone: '13900001008', status: 'pending' },
}

function ctxRows(): { hazards: EntryRow[]; evacuations: EntryRow[]; alarms: EntryRow[] } {
  return {
    hazards: SEED_ROWS.hazard ?? [],
    evacuations: SEED_ROWS.evacuation ?? [],
    alarms: SEED_ROWS.alarm ?? [],
  }
}

export function buildDutySeed(): DutyStoreState {
  const shifts: DutyShift[] = []
  const tasks: HandoverTask[] = []
  const seq = { inspect: 0, contact: 0 }
  let shiftId = 0

  DUTY_DATES.forEach((date) => {
    DUTY_TOWNSHIPS.forEach((township) => {
      shiftId += 1
      const seed = GRID[`${township}@${date}`]
      const shift: DutyShift = {
        id: shiftId,
        date,
        township,
        leader: seed.leader,
        person: seed.person,
        phone: seed.phone,
        status: seed.status,
        ruleVersion: seed.ruleVersion,
        logs: [],
      }
      if (shift.status === 'archived') {
        shift.confirmedAt = `${date} 20:10`
        shift.archivedAt = `${date} 21:00`
        shift.handoverNote = '雨具、喊话器已清点；监测设备运行正常。'
        shift.logs = [
          { at: `${date} 20:10`, type: 'handover', detail: `负责人${seed.leader}确认交班，按口径 v${seed.ruleVersion} 落一套交接任务` },
          { at: `${date} 21:00`, type: 'archive', detail: '班次归档，交接口径与任务按当时版本冻结' },
        ]
        const rule = HANDOVER_RULES.find((item) => item.version === seed.ruleVersion) ?? HANDOVER_RULES[0]
        const drafts = planTaskDrafts(shift, rule, ctxRows())
        const created = materializeTasks(drafts, seq, `${date} 20:10`)
        created.forEach((task, index) => {
          tasks.push({
            ...task,
            id: tasks.length + 1,
            // 归档班次的核查任务多数已完成，留一条未办结体现遗留事项
            status: index % 3 === 2 ? 'open' : 'done',
            doneAt: index % 3 === 2 ? undefined : `${date} 22:30`,
          })
        })
      }
      shifts.push(shift)
    })
  })

  return {
    people: PEOPLE,
    stations: STATIONS,
    rules: HANDOVER_RULES,
    currentRuleVersion: 2,
    shifts,
    tasks,
  }
}
