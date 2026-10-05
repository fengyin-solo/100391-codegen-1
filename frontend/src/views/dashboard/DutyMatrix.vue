<template>
  <section class="duty-matrix">
    <header class="page-head">
      <div>
        <h2>汛期值班矩阵</h2>
        <p class="page-desc">按值班日期与乡镇铺开责任格，格内汇总隐患点、雨量站和待发布预警，可直接格内换班、确认交班。</p>
      </div>
      <div class="page-actions matrix-tools">
        <label class="identity-switch">
          当前身份
          <select :value="session.operator" @change="switchIdentity(($event.target as HTMLSelectElement).value)">
            <option v-for="preset in IDENTITY_PRESETS" :key="preset.operator" :value="preset.operator">
              {{ preset.operator }}（{{ preset.role }}·{{ preset.township }}）
            </option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="!startOffset" @click="shiftWindow(-1)">上一窗</button>
        <button class="btn" type="button" @click="shiftWindow(1)">下一窗</button>
        <button class="btn primary" type="button" @click="openRules">调整交接口径</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">责任格总数</span>
        <strong class="stat-value">{{ cells.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">值班中</span>
        <strong class="stat-value">{{ countByStatus('值班中') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待接班</span>
        <strong class="stat-value">{{ countByStatus('待接班') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已交班未归档</span>
        <strong class="stat-value">{{ countByStatus('已交班') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已落核查/联络任务</span>
        <strong class="stat-value">{{ allTasks.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待授权跨乡镇代班</span>
        <strong class="stat-value" :class="{ 'alert-num': pendingSwapCount }">{{ pendingSwapCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">状态：待接班 / 值班中 / 已交班 / 已归档</span>
      <span class="legend-item">当前口径 v{{ rules.version }}：核查 {{ rules.hazardStatuses.join('、') || '—' }}；联络 {{ rules.generateContact ? rules.contactStatuses.join('、') : '不生成' }}</span>
      <span class="legend-item">格内「待落」按当前口径预估，确认交班时才生成任务</span>
    </p>

    <!-- 待授权代班审批 -->
    <div v-if="pendingSwaps.length" class="approval-bar">
      <strong>跨乡镇代班待县值班室授权（{{ pendingSwaps.length }}）：</strong>
      <div v-for="swap in pendingSwaps" :key="swap.id" class="approval-item">
        <span>{{ swap.shiftLabel }}：{{ swap.fromPerson }} → {{ swap.toPerson }}（{{ swap.toTownship }}），事由：{{ swap.reason }}</span>
        <template v-if="session.isLeader && session.township === '县值班室'">
          <button class="link" type="button" @click="decide(swap.id, true)">授权</button>
          <button class="link danger" type="button" @click="decide(swap.id, false)">拒绝</button>
        </template>
        <em v-else>需县值班室负责人授权</em>
      </div>
    </div>

    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col">值班日期</th>
            <th v-for="township in TOWNSHIPS" :key="township">{{ township }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.date + row.kind">
            <tr>
              <th class="sticky-col row-head">
                <span class="row-date">{{ row.date }}</span>
                <span class="row-kind">{{ row.kind }}</span>
                <span v-if="row.date === today" class="today-tag">今天</span>
              </th>
              <td
                v-for="cell in row.cells"
                :key="cell.shift.id"
                class="duty-cell"
                :class="cellClass(cell)"
              >
                <div class="cell-top">
                  <span class="cell-status">{{ cell.shift.status }}</span>
                  <span v-if="cell.shift.crossTown" class="cross-tag">跨乡镇代班</span>
                  <span v-if="cell.shift.handoverConfirmed" class="frozen-tag">v{{ cell.shift.ruleVersion }}</span>
                </div>
                <div class="cell-people">
                  <template v-if="cell.shift.leader || cell.shift.members.length">
                    <span class="person leader-person">{{ cell.shift.leader || '—' }}<em>负责</em></span>
                    <span v-for="member in cell.shift.members" :key="member" class="person">{{ member }}</span>
                  </template>
                  <span v-else class="empty-people">空班 · 点此排人</span>
                </div>
                <div class="cell-summary">
                  <span title="在册+监测中隐患点">隐患 {{ cell.summary.hazardCount }}</span>
                  <span title="乡镇雨量站">雨量站 {{ cell.summary.stationCount }}</span>
                  <span :class="{ 'alert-num': cell.summary.pendingAlarmCount }" title="待发布预警">待发预警 {{ cell.summary.pendingAlarmCount }}</span>
                </div>
                <div class="cell-tasks">
                  <template v-if="cell.shift.handoverConfirmed">
                    <span>核查任务 {{ cell.checkTasks }}</span>
                    <span>联络任务 {{ cell.contactTasks }}</span>
                  </template>
                  <template v-else>
                    <span class="preview-task">交班待落：核查 {{ previewOf(cell.township).check }} / 联络 {{ previewOf(cell.township).contact }}</span>
                  </template>
                </div>
                <div class="cell-actions">
                  <button class="link" type="button" @click="openSwap(cell)">换班</button>
                  <button
                    v-if="cell.shift.status === '待接班'"
                    class="link"
                    type="button"
                    @click="takeOver(cell.shift.id)"
                  >接班</button>
                  <button
                    v-if="cell.shift.status === '值班中'"
                    class="link"
                    type="button"
                    :class="{ disabled: !session.isLeader }"
                    @click="confirmShift(cell.shift.id)"
                  >确认交班</button>
                  <button
                    v-if="cell.shift.status === '已交班'"
                    class="link"
                    type="button"
                    :class="{ disabled: !session.isLeader }"
                    @click="archive(cell.shift.id)"
                  >归档</button>
                </div>
                <p v-if="cell.shift.note" class="cell-note">{{ cell.shift.note }}</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="matrix-bottom">
      <section class="log-panel">
        <h3>值班操作记录</h3>
        <ul class="log-list">
          <li v-for="log in logs.slice(0, 8)" :key="log.id">
            <time>{{ formatTime(log.at) }}</time>
            <strong>{{ log.actor }}</strong>
            <span>{{ log.action }}</span>
            <em>{{ log.detail }}</em>
          </li>
        </ul>
      </section>
      <section class="rules-panel">
        <h3>口径版本沿革</h3>
        <ul class="rules-list">
          <li v-for="rule in [...ruleHistory].reverse()" :key="rule.version">
            <strong>v{{ rule.version }}</strong>
            <span>核查：{{ rule.hazardStatuses.join('、') }}</span>
            <span>联络：{{ rule.generateContact ? rule.contactStatuses.join('、') + '（' + rule.contactMode + '）' : '不生成' }}</span>
            <em>{{ formatTime(rule.updatedAt) }} · {{ rule.updatedBy }}</em>
          </li>
        </ul>
      </section>
    </div>

    <p v-if="message" class="matrix-message" :class="{ 'error-text': !messageOk }">{{ message }}</p>

    <!-- 格内换班弹层 -->
    <div v-if="swapTarget" class="modal-mask" @click.self="swapTarget = null">
      <div class="modal-box">
        <h3>{{ swapTarget.shift.status === '待接班' && !swapTarget.shift.leader ? '排人值班' : '格内换班' }} · {{ swapTarget.date }} {{ swapTarget.kind }} {{ swapTarget.township }}</h3>
        <p class="modal-hint">
          当前格：负责人 {{ swapTarget.shift.leader || '—' }}；值班员 {{ swapTarget.shift.members.join('、') || '—' }}。
          同乡镇换人直接生效；换入外乡镇人员须县值班室负责人授权。
        </p>
        <label class="modal-field">
          被替换人
          <select v-model="swapForm.fromPerson">
            <option value="">（空班直接排人，不替换）</option>
            <option v-if="swapTarget.shift.leader" :value="swapTarget.shift.leader">{{ swapTarget.shift.leader }}（负责人）</option>
            <option v-for="member in swapTarget.shift.members" :key="member" :value="member">{{ member }}（值班员）</option>
          </select>
        </label>
        <label class="modal-field">
          换入人员
          <select v-model="swapForm.toPerson">
            <option value="">请选择花名册人员</option>
            <option v-for="actor in actorOptions" :key="actor.name" :value="actor.name">
              {{ actor.name }}（{{ actor.role }}·{{ actor.township }}）
            </option>
          </select>
        </label>
        <p v-if="swapCross" class="cross-warn">
          跨乡镇代班：{{ session.isLeader && session.township === '县值班室' ? '你是县值班室负责人，提交即授权生效' : '提交后进入待审批，需县值班室负责人授权' }}
        </p>
        <label class="modal-field">
          换班事由
          <input v-model="swapForm.reason" placeholder="如：家中急事、培训冲突" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="swapTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitSwap">提交</button>
        </div>
      </div>
    </div>

    <!-- 交接口径弹层 -->
    <div v-if="rulesOpen" class="modal-mask" @click.self="rulesOpen = false">
      <div class="modal-box">
        <h3>调整交接口径（当前 v{{ rules.version }}）</h3>
        <p class="modal-hint">保存后生成新版本，只重算未结束班次；已归档班次保留当时规则与任务。</p>
        <fieldset class="modal-field">
          <legend>交班时需现场核查的隐患状态</legend>
          <label v-for="status in HAZARD_STATUSES" :key="status" class="check-item">
            <input type="checkbox" :value="status" v-model="rulesForm.hazardStatuses" />
            {{ status }}
          </label>
        </fieldset>
        <label class="check-item block-item">
          <input type="checkbox" v-model="rulesForm.generateContact" />
          交班时向避险搬迁页生成联络任务
        </label>
        <fieldset class="modal-field" :disabled="!rulesForm.generateContact">
          <legend>需逐户联络的搬迁状态</legend>
          <label v-for="status in CONTACT_STATUSES" :key="status" class="check-item">
            <input type="checkbox" :value="status" v-model="rulesForm.contactStatuses" :disabled="!rulesForm.generateContact" />
            {{ status }}
          </label>
        </fieldset>
        <label class="modal-field">
          联络口径
          <input v-model="rulesForm.contactMode" placeholder="如：逐户电话+入户确认撤离情况" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="rulesOpen = false">取消</button>
          <button class="btn primary" type="button" @click="saveRules">保存并重算未结束班次</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  allDutyTasks,
  archiveShift,
  buildMatrix,
  confirmHandover,
  currentRules,
  decideSwap,
  listActors,
  listLogs,
  listSwaps,
  pendingSwapCount as fetchPendingSwapCount,
  previewTaskCount,
  requestSwap,
  resetDuty,
  takeOverShift,
  TOWNSHIPS,
  updateHandoverRules,
  type DutyIdentity,
} from '@/api/duty-service'
import type { DutyTask, HandoverRules, MatrixCell, SwapRequest } from '@/data/duty-types'
import { dutyState } from '@/data/duty-store'
import { IDENTITY_PRESETS, useSessionStore } from '@/stores/session'

const HAZARD_STATUSES = ['在册', '监测中', '已治理']
const CONTACT_STATUSES = ['待动员', '已签约', '已搬迁']

const session = useSessionStore()

const windowStart = ref('2026-10-03')
const startOffset = ref(0)
const cells = ref<MatrixCell[]>([])
const swaps = ref<SwapRequest[]>([])
const logs = ref<ReturnType<typeof listLogs>>([])
const allTasks = ref<DutyTask[]>([])
const rules = ref<HandoverRules>(currentRules())
const ruleHistory = ref<HandoverRules[]>([])
const pendingSwapCount = ref(0)
const message = ref('')
const messageOk = ref(true)
const today = '2026-10-05'

const actorOptions = listActors()

const swapTarget = ref<MatrixCell | null>(null)
const swapForm = reactive({ fromPerson: '', toPerson: '', reason: '' })
const rulesOpen = ref(false)
const rulesForm = reactive({
  hazardStatuses: [] as string[],
  generateContact: true,
  contactStatuses: [] as string[],
  contactMode: '',
})

interface MatrixRow {
  date: string
  kind: MatrixCell['kind']
  cells: MatrixCell[]
}

const rows = computed<MatrixRow[]>(() => {
  const grouped = new Map<string, MatrixCell[]>()
  for (const cell of cells.value) {
    const key = cell.date + cell.kind
    const list = grouped.get(key) ?? []
    list.push(cell)
    grouped.set(key, list)
  }
  return [...grouped.entries()].map(([key, rowCells]) => ({
    date: rowCells[0].date,
    kind: rowCells[0].kind,
    cells: rowCells,
  }))
})

const pendingSwaps = computed(() => swaps.value.filter((swap) => swap.status === '待审批'))

function identity(): DutyIdentity {
  return { name: session.operator, role: session.role, township: session.township }
}

const previewCache: Record<string, { check: number; contact: number }> = {}
function previewOf(township: string) {
  if (!previewCache[township]) {
    previewCache[township] = previewTaskCount(township)
  }
  return previewCache[township]
}

function countByStatus(status: string): number {
  return cells.value.filter((cell) => cell.shift.status === status).length
}

function cellClass(cell: MatrixCell): Record<string, boolean> {
  return {
    'cell-ended': cell.shift.status === '已交班' || cell.shift.status === '已归档',
    'cell-archived': cell.shift.status === '已归档',
    'cell-active': cell.shift.status === '值班中',
    'cell-empty': !cell.shift.leader && !cell.shift.members.length,
  }
}

function formatTime(stamp: string): string {
  return stamp.replace('T', ' ').slice(0, 16)
}

function notify(result: { ok: boolean; message: string }) {
  messageOk.value = result.ok
  message.value = result.message
}

function reload() {
  cells.value = buildMatrix(windowStart.value, 6)
  swaps.value = listSwaps()
  logs.value = listLogs()
  allTasks.value = allDutyTasks()
  rules.value = currentRules()
  ruleHistory.value = dutyRuleHistory()
  pendingSwapCount.value = fetchPendingSwapCount()
  Object.keys(previewCache).forEach((key) => delete previewCache[key])
}

// 规则历史直接从 store 读。
function dutyRuleHistory(): HandoverRules[] {
  return dutyState().ruleHistory
}

function shiftWindow(delta: number) {
  startOffset.value = Math.max(0, startOffset.value + delta)
  const base = new Date('2026-10-03T00:00:00')
  base.setDate(base.getDate() + startOffset.value * 6)
  windowStart.value = base.toISOString().slice(0, 10)
  reload()
}

function switchIdentity(name: string) {
  const preset = IDENTITY_PRESETS.find((item) => item.operator === name)
  if (preset) {
    session.useIdentity(preset)
  }
}

function takeOver(shiftId: string) {
  notify(takeOverShift(shiftId, identity()))
  reload()
}

function confirmShift(shiftId: string) {
  if (!session.isLeader) {
    notify({ ok: false, message: '交班确认须由值班负责人操作' })
    return
  }
  notify(confirmHandover(shiftId, identity()))
  reload()
}

function archive(shiftId: string) {
  if (!session.isLeader) {
    notify({ ok: false, message: '归档须由值班负责人操作' })
    return
  }
  notify(archiveShift(shiftId, identity()))
  reload()
}

function decide(swapId: number, approve: boolean) {
  notify(decideSwap(swapId, approve, identity()))
  reload()
}

function openSwap(cell: MatrixCell) {
  swapTarget.value = cell
  swapForm.fromPerson = cell.shift.leader || cell.shift.members[0] || ''
  swapForm.toPerson = ''
  swapForm.reason = ''
}

const swapCross = computed(() => {
  if (!swapTarget.value || !swapForm.toPerson) {
    return false
  }
  const actor = actorOptions.find((item) => item.name === swapForm.toPerson)
  return Boolean(actor && actor.township !== swapTarget.value.township)
})

function submitSwap() {
  if (!swapTarget.value) {
    return
  }
  if (!swapForm.toPerson) {
    notify({ ok: false, message: '请选择换入人员' })
    return
  }
  const result = requestSwap(
    {
      shiftId: swapTarget.value.shift.id,
      fromPerson: swapForm.fromPerson,
      toPerson: swapForm.toPerson,
      reason: swapForm.reason || '未填事由',
    },
    identity(),
  )
  notify(result)
  swapTarget.value = null
  reload()
}

function openRules() {
  if (!session.isLeader) {
    notify({ ok: false, message: '交接口径须由值班负责人调整' })
    return
  }
  rulesForm.hazardStatuses = [...rules.value.hazardStatuses]
  rulesForm.generateContact = rules.value.generateContact
  rulesForm.contactStatuses = [...rules.value.contactStatuses]
  rulesForm.contactMode = rules.value.contactMode
  rulesOpen.value = true
}

function saveRules() {
  const result = updateHandoverRules(
    {
      hazardStatuses: rulesForm.hazardStatuses,
      generateContact: rulesForm.generateContact,
      contactStatuses: rulesForm.contactStatuses,
      contactMode: rulesForm.contactMode || '逐户电话确认撤离情况',
    },
    identity(),
  )
  notify(result)
  rulesOpen.value = false
  reload()
}

function resetAll() {
  notify(resetDuty())
  reload()
}

onMounted(reload)
</script>
