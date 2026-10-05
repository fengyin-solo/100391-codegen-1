/** 汛期值班矩阵相关类型：数据保存在本机，结构与将来后端接口保持一致。 */

export type ShiftKind = '白班' | '夜班'
export type DutyStatus = '待接班' | '值班中' | '已交班' | '已归档'
export type ActorRole = '负责人' | '值班员'
export type TaskCategory = '现场核查' | '避险联络'
export type TaskStatus = '待执行' | '执行中' | '已完成'
export type SwapStatus = '待审批' | '已授权' | '已拒绝'

export interface DutyActor {
  name: string
  role: ActorRole
  township: string
}

/** 交班确认后落到隐患点台账 / 避险搬迁页的任务。 */
export interface DutyTask {
  id: number
  shiftId: string
  category: TaskCategory
  /** 对应模块记录的行 id（隐患点 / 搬迁安置户）。 */
  refId: number
  refCode: string
  township: string
  title: string
  detail: string
  /** 来源班次，如 2026-10-04 白班 · 城关镇。 */
  source: string
  status: TaskStatus
  /** 生成时使用的交接口径版本，归档班次永远定格在交班时的版本。 */
  ruleVersion: number
  createdAt: string
}

export interface DutyShift {
  id: string
  date: string
  kind: ShiftKind
  township: string
  /** 带班负责人。 */
  leader: string
  members: string[]
  status: DutyStatus
  handoverConfirmed: boolean
  confirmedAt: string | null
  confirmedBy: string | null
  /** 交班确认时冻结的口径版本；未交班班次跟随当前口径。 */
  ruleVersion: number | null
  taskGenerated: boolean
  generatedTaskIds: number[]
  /** 当前在岗人员含外乡镇代班。 */
  crossTown: boolean
  note: string
}

/** 交接口径：决定交班时生成哪些任务。 */
export interface HandoverRules {
  version: number
  updatedAt: string
  updatedBy: string
  /** 哪些隐患状态需要现场核查。 */
  hazardStatuses: string[]
  generateContact: boolean
  /** 哪些搬迁状态需要逐户联络。 */
  contactStatuses: string[]
  contactMode: string
}

export interface SwapRequest {
  id: number
  shiftId: string
  shiftLabel: string
  fromPerson: string
  toPerson: string
  fromTownship: string
  toTownship: string
  crossTown: boolean
  reason: string
  status: SwapStatus
  authorizedBy: string | null
  authorizedAt: string | null
  createdAt: string
}

export interface DutyLog {
  id: number
  at: string
  actor: string
  action: string
  detail: string
}

export interface DutyState {
  shifts: DutyShift[]
  tasks: DutyTask[]
  rules: HandoverRules
  /** 历次口径，已归档班次按当时版本保留。 */
  ruleHistory: HandoverRules[]
  swaps: SwapRequest[]
  logs: DutyLog[]
  seq: { task: number; swap: number; log: number }
}

export interface CellSummary {
  hazardCount: number
  stationCount: number
  pendingAlarmCount: number
}

export interface MatrixCell {
  /** 窗口内每格都有班次，未排班会补占位的待接班。 */
  shift: DutyShift
  date: string
  kind: ShiftKind
  township: string
  summary: CellSummary
  checkTasks: number
  contactTasks: number
}

export interface SwapSubmit {
  shiftId: string
  fromPerson: string
  toPerson: string
  reason: string
}
