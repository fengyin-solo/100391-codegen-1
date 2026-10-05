/** 汛期值班矩阵子域类型：纯前端数据层，结构与全栈版接口保持一致。 */

export type DutyStatus = 'pending' | 'ongoing' | 'handed' | 'archived'

export type TaskKind = 'inspect' | 'contact'

export type TaskStatus = 'open' | 'done'

export type DutyPerson = {
  name: string
  title: string
  township: string
  role: 'leader' | 'staff'
  scope: 'township' | 'county'
}

export type RainStation = {
  code: string
  name: string
  township: string
}

export type ChangeLogEntry = {
  at: string
  type: 'swap' | 'handover' | 'archive' | 'rule'
  detail: string
}

export type HandoverTask = {
  id: number
  code: string
  kind: TaskKind
  shiftId: number
  township: string
  /** inspect 任务挂隐患点编号；contact 任务挂搬迁户户号 */
  refCode: string
  refName: string
  title: string
  ruleVersion: number
  status: TaskStatus
  createdAt: string
  doneAt?: string
}

/** 交接口径：决定负责人确认交班时落哪些任务。口径带版本，归档班次冻结当时版本。 */
export type HandoverRule = {
  version: number
  label: string
  publishedAt: string
  note: string
  /** 纳入现场核查的隐患点状态白名单 */
  hazardStatuses: string[]
  /** 纳入联络的搬迁状态白名单 */
  evacuationStatuses: string[]
  /** 待发布预警是否额外生成对应隐患点核查任务（同一隐患点不重复） */
  pendingAlarmExtra: boolean
}

export type DutyShift = {
  id: number
  date: string
  township: string
  leader: string
  person: string
  phone: string
  status: DutyStatus
  /** 确认交班时冻结的口径版本；未确认的班次不冻结，按当前口径试算 */
  ruleVersion?: number
  confirmedAt?: string
  archivedAt?: string
  handoverNote?: string
  logs: ChangeLogEntry[]
}

export type DutyStoreState = {
  people: DutyPerson[]
  stations: RainStation[]
  rules: HandoverRule[]
  currentRuleVersion: number
  shifts: DutyShift[]
  tasks: HandoverTask[]
}

export type CellSummary = {
  hazards: number
  stations: number
  pendingAlarms: number
}

export type DutyMatrixCell = {
  shift: DutyShift
  summary: CellSummary
  tasks: HandoverTask[]
  previewTaskCount: number
  crossTownshipCover: boolean
}
