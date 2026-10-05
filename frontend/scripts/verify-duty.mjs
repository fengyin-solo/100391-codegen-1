// 核心业务规则验证：幂等交班、口径重算、归档保留、跨乡镇授权。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, rmSync } from 'node:fs'

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  },
}

const entry = 'scripts/.duty-test-entry.ts'
writeFileSync(
  entry,
  `export * from '/workspace/frontend/src/api/duty-service.ts'\nexport * from '/workspace/frontend/src/data/duty-store.ts'\nexport * from '/workspace/frontend/src/data/duty-seed.ts'`,
)

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  external: [],
})
const outFile = 'scripts/.duty-test-bundle.mjs'
writeFileSync(outFile, result.outputFiles[0].text)
const svc = await import(pathToFileURL(`${process.cwd()}/${outFile}`).href)

const leader = { name: '李建华', role: '负责人', township: '城关镇' }
const county = { name: '周建国', role: '负责人', township: '县值班室' }
const guard = { name: '王敏', role: '值班员', township: '城关镇' }
const jinshaGuard = { name: '何军', role: '值班员', township: '金沙镇' }

let failures = 0
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  =>  ${JSON.stringify(actual)}${pass ? '' : ` (期望 ${JSON.stringify(expected)})`}`)
  if (!pass) failures++
}

// 初始种子：12 个 10-03 归档班次按 v1、10-04 白班 v1、夜班 v2 已交班
const seed = svc.dutyState()
const archived1003 = seed.shifts.filter((s) => s.date === '2026-10-03' && s.status === '已归档')
check('10-03 共 12 格全部归档', archived1003.length, 12)
const night1004 = seed.shifts.find((s) => s.id === 'DUTY-2026-10-04-N-01')
check('城关镇夜班为跨乡镇代班', night1004.crossTown, true)
check('城关镇夜班负责人为周建国', night1004.leader, '周建国')
check('城关镇夜班定格 v2', night1004.ruleVersion, 2)
const day1004 = seed.shifts.find((s) => s.id === 'DUTY-2026-10-04-D-01')
check('城关镇 10-04 白班定格 v1', day1004.ruleVersion, 1)

// v1 归档任务：城关镇在册+监测中 1 个核查点（HAZA-0001）；待动员+已签约 2 户联络
const day1004Tasks = svc.tasksOfShift(day1004.id)
check('v1 城关镇白班核查任务数', day1004Tasks.check.length, 1)
check('v1 城关镇白班联络任务数', day1004Tasks.contact.length, 2)
const night1004Tasks = svc.tasksOfShift(night1004.id)
check('v2 城关镇夜班核查任务数（仅监测中=0）', night1004Tasks.check.length, 0)
check('v2 城关镇夜班联络任务数（仅待动员=1）', night1004Tasks.contact.length, 1)

// 规则1：同一班次重复确认只落一套任务
const before = svc.allDutyTasks().length
const activeShift = 'DUTY-2026-10-05-D-01' // 城关镇白班 值班中
svc.confirmHandover(activeShift, leader)
const afterFirst = svc.allDutyTasks().length
const repeat = svc.confirmHandover(activeShift, leader)
const afterSecond = svc.allDutyTasks().length
check('首次确认交班有新任务', afterFirst > before, true)
check('重复确认被拒绝', repeat.ok, false)
check('重复确认不重复落任务', afterSecond, afterFirst)
const confirmedShift = svc.findShift(activeShift)
check('确认后状态为已交班', confirmedShift.status, '已交班')
check('确认后冻结口径 v2', confirmedShift.ruleVersion, 2)
const activeTasks = svc.tasksOfShift(activeShift)
check('城关镇当前口径核查 0（仅监测中）', activeTasks.check.length, 0)
check('城关镇当前口径联络 1（仅待动员）', activeTasks.contact.length, 1)

// 值班员不能确认交班
const guardDeny = svc.confirmHandover('DUTY-2026-10-05-D-02', guard)
check('值班员确认交班被拒', guardDeny.ok, false)

// 规则2：口径调整只重算未结束班次，已归档班次保留当时规则
const archivedTaskCount = svc
  .allDutyTasks()
  .filter((t) => seed.shifts.find((s) => s.id === t.shiftId)?.status === '已归档').length
const adjust = svc.updateHandoverRules(
  {
    hazardStatuses: ['在册', '监测中'],
    generateContact: true,
    contactStatuses: ['待动员', '已签约'],
    contactMode: '入户敲门确认',
  },
  county,
)
check('口径调整成功', adjust.ok, true)
check('口径升至 v3', svc.currentRules().version, 3)
const archivedAfter = svc
  .allDutyTasks()
  .filter((t) => svc.findShift(t.shiftId)?.status === '已归档')
check('已归档班次任务数量不变', archivedAfter.length, archivedTaskCount)
check('归档任务仍是旧版本', archivedAfter.every((t) => t.ruleVersion <= 2), true)
const recalculated = svc.tasksOfShift(activeShift)
check('未结束班次按 v3 重算核查', recalculated.check.length, 1)
check('未结束班次按 v3 重算联络', recalculated.contact.length, 2)
check('重算任务带新版本号', recalculated.contact[0].ruleVersion, 3)

// 已交班未归档班次也参与重算
const night1004After = svc.tasksOfShift(night1004.id)
check('已交班未归档班次也重算核查', night1004After.check.length, 1)

// 值班员不能调口径
const guardRules = svc.updateHandoverRules(
  { hazardStatuses: ['在册'], generateContact: false, contactStatuses: [], contactMode: '' },
  guard,
)
check('值班员调口径被拒', guardRules.ok, false)

// 规则3：跨乡镇代班需县值班室负责人授权——值班员申请进入待审批，不写格
const futureShift = 'DUTY-2026-10-06-D-05' // 金沙镇白班
const swapRes = svc.requestSwap(
  { shiftId: futureShift, fromPerson: '何军', toPerson: '王敏', reason: '家中有事' },
  jinshaGuard,
)
check('值班员跨乡镇申请已提交', swapRes.ok, true)
const pending = svc.listSwaps().filter((s) => s.status === '待审批')
const theSwap = pending.find((s) => s.shiftId === futureShift && s.toPerson === '王敏')
check('跨乡镇申请待审批', Boolean(theSwap), true)
check('待审批时代班人未写入格', svc.findShift(futureShift)?.members.includes('王敏'), false)
// 值班员、乡镇负责人均无权审批
const guardDecide = svc.decideSwap(theSwap.id, true, guard)
check('值班员授权被拒', guardDecide.ok, false)
const townLeaderDecide = svc.decideSwap(theSwap.id, true, leader)
check('乡镇负责人授权跨乡镇被拒', townLeaderDecide.ok, false)
check('被拒后仍未写入格', svc.findShift(futureShift)?.members.includes('王敏'), false)
// 县值班室负责人授权后写格并标跨乡镇
svc.decideSwap(theSwap.id, true, county)
check('授权后代班人写入格', svc.findShift(futureShift).members.includes('王敏'), true)
check('授权后标记跨乡镇', svc.findShift(futureShift).crossTown, true)

// 乡镇负责人发起跨乡镇代班也要走审批，县值班室负责人发起直接生效
const townLeaderApply = svc.requestSwap(
  { shiftId: 'DUTY-2026-10-06-N-01', fromPerson: '王敏', toPerson: '刘洋', reason: '兄弟乡镇互助' },
  leader,
)
check('乡镇负责人跨乡镇也需县值班室授权', townLeaderApply.ok, true)
check('乡镇负责人申请进入待审批', svc.listSwaps().some((s) => s.shiftId === 'DUTY-2026-10-06-N-01' && s.status === '待审批'), true)

const futureShift2 = 'DUTY-2026-10-07-D-06' // 云岭乡白班
const leaderSwap = svc.requestSwap(
  { shiftId: futureShift2, fromPerson: '罗亮', toPerson: '周建国', reason: '县镇带班' },
  county,
)
check('县值班室负责人跨乡镇代班直接生效', leaderSwap.ok, true)
check('负责人代班写入负责人位', svc.findShift(futureShift2).leader, '周建国')

// 同乡镇换班当场生效，无需审批
const sameTown = svc.requestSwap(
  { shiftId: 'DUTY-2026-10-06-D-01', fromPerson: '王敏', toPerson: '赵强', reason: '调班' },
  guard,
)
check('同乡镇换班当场生效', sameTown.ok, true)
check('同乡镇代班不算跨乡镇', svc.findShift('DUTY-2026-10-06-D-01').crossTown, false)

// 格内汇总：金沙镇 隐患2 / 雨量站1 / 待发布预警2
const matrix = svc.buildMatrix('2026-10-05', 1)
const jinshaDay = matrix.find((c) => c.date === '2026-10-05' && c.kind === '白班' && c.township === '金沙镇')
check('格内汇总隐患点（金沙镇）', jinshaDay.summary.hazardCount, 2)
check('格内汇总雨量站（金沙镇）', jinshaDay.summary.stationCount, 1)
check('格内汇总待发布预警（金沙镇）', jinshaDay.summary.pendingAlarmCount, 2)
const yunlingDay = matrix.find((c) => c.date === '2026-10-05' && c.kind === '白班' && c.township === '云岭乡')
check('格内汇总待发布预警（云岭乡为0）', yunlingDay.summary.pendingAlarmCount, 0)

// 窗口外未排班的格子补占位，可直接排人
const emptyCell = matrix.find((c) => c.date === '2026-10-05' && c.kind === '夜班')
check('占位格状态为待接班', emptyCell.shift.status, '待接班')

console.log(failures === 0 ? '\n全部规则验证通过' : `\n${failures} 项失败`)
rmSync(entry)
rmSync(outFile)
process.exit(failures === 0 ? 0 : 1)
