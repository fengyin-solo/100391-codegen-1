<template>
  <div v-if="shift" class="modal-mask" @click.self="emit('close')">
    <div class="modal duty-modal">
      <header class="modal-head">
        <h3>{{ shift.date }} {{ shift.township }} 班次</h3>
        <button class="link" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="modal-body">
        <p class="status-legend">
          <span class="legend-item">状态：{{ statusLabel }}</span>
          <span class="legend-item">值班负责人：{{ shift.leader }}</span>
          <span class="legend-item">值班人：{{ shift.person }}</span>
          <span class="legend-item">电话：{{ shift.phone }}</span>
          <span v-if="crossCover" class="legend-item warn">跨乡镇代班</span>
          <span v-if="shift.ruleVersion !== undefined" class="legend-item">
            交班口径：v{{ shift.ruleVersion }}
          </span>
        </p>

        <section v-if="mode === 'detail'">
          <div class="stat-row">
            <article class="stat-card">
              <span class="stat-label">隐患点</span>
              <strong class="stat-value">{{ cell?.summary.hazards ?? 0 }}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">雨量站</span>
              <strong class="stat-value">{{ cell?.summary.stations ?? 0 }}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">待发布预警</span>
              <strong class="stat-value">{{ cell?.summary.pendingAlarms ?? 0 }}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">{{ shift.status === 'pending' || shift.status === 'ongoing' ? '交班预计任务' : '已落任务' }}</span>
              <strong class="stat-value">{{ taskCount }}</strong>
            </article>
          </div>

          <h4 class="sub-title">交接任务（{{ tasks.length }} 条）</h4>
          <table v-if="tasks.length" class="data-table compact">
            <thead>
              <tr><th>编号</th><th>类型</th><th>任务内容</th><th>口径</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.id">
                <td>{{ task.code }}</td>
                <td>{{ task.kind === 'inspect' ? '现场核查' : '搬迁联络' }}</td>
                <td>{{ task.title }}</td>
                <td>v{{ task.ruleVersion }}</td>
                <td>{{ task.status === 'done' ? '已办结' : '待办' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty-state">
            {{ shift.status === 'pending' || shift.status === 'ongoing' ? '尚未确认交班，确认后按当前口径落任务' : '该班次口径下无交接任务' }}
          </p>

          <h4 class="sub-title">班次记录</h4>
          <ul v-if="shift.logs.length" class="log-list">
            <li v-for="(log, index) in [...shift.logs].reverse()" :key="index">
              <span class="log-at">{{ log.at }}</span> {{ log.detail }}
            </li>
          </ul>
          <p v-else class="empty-state">暂无换班、交班记录</p>
        </section>

        <section v-else>
          <p class="page-desc">
            {{ shift.person }} 当前负责本班次。换班后值班人即时更新；跨乡镇代班需县级值班负责人授权。
          </p>
          <div class="form-grid">
            <label class="filter-item">
              <span>代班人 *</span>
              <select v-model="form.person">
                <option value="">请选择值班人员</option>
                <option v-for="person in staffOptions" :key="person.name" :value="person.name">
                  {{ person.name }}（{{ person.township }}·{{ person.title }}）
                </option>
              </select>
            </label>
            <label class="filter-item">
              <span>联系电话 *</span>
              <input v-model="form.phone" placeholder="代班期间联系电话" />
            </label>
            <label v-if="crossSelected" class="filter-item">
              <span>县级值班负责人授权 *</span>
              <select v-model="form.authorizer">
                <option value="">请选择授权负责人</option>
                <option v-for="leader in countyLeaders" :key="leader.name" :value="leader.name">
                  {{ leader.name }}（{{ leader.title }}）
                </option>
              </select>
            </label>
            <label class="filter-item full">
              <span>换班原因</span>
              <input v-model="form.reason" placeholder="如：原值班人参与抢巡、身体不适等" />
            </label>
          </div>
          <p v-if="crossSelected" class="hint-text">
            选中的代班人不属 {{ shift.township }}，本操作将记录为跨乡镇代班，必须有县级负责人授权。
          </p>
        </section>
      </div>

      <footer class="modal-foot">
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
        <template v-if="mode === 'detail'">
          <button v-if="shift.status === 'pending'" class="btn" type="button" @click="start">接班上岗</button>
          <button v-if="shift.status !== 'archived'" class="btn" type="button" @click="emit('switch-mode', 'swap')">
            格内换班
          </button>
          <button v-if="shift.status === 'ongoing'" class="btn primary" type="button" @click="confirm">
            负责人确认交班
          </button>
          <button v-if="shift.status === 'handed'" class="btn primary" type="button" @click="archive">
            归档班次
          </button>
        </template>
        <template v-else>
          <button class="btn ghost" type="button" @click="emit('switch-mode', 'detail')">返回详情</button>
          <button class="btn primary" type="button" @click="submitSwap">确认换班</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  archiveShift,
  confirmHandover,
  dutyPeople,
  shiftDetail,
  startDuty,
  swapShift,
} from '@/api/duty-service'
import type { DutyMatrixCell } from '@/data/duty/types'

const props = defineProps<{
  shiftId: number | null
  mode: 'detail' | 'swap'
  cell?: DutyMatrixCell
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'switch-mode', mode: 'detail' | 'swap'): void
  (e: 'changed'): void
}>()

const STATUS_LABEL: Record<string, string> = {
  pending: '待值班',
  ongoing: '值班中',
  handed: '已交班待归档',
  archived: '已归档',
}

const detail = computed(() => (props.shiftId === null ? null : shiftDetail(props.shiftId)))
const shift = computed(() => detail.value?.shift ?? null)
const tasks = computed(() => detail.value?.tasks ?? [])

const allPeople = dutyPeople()
const staffOptions = computed(() => allPeople.filter((person) => person.role === 'staff'))
const countyLeaders = computed(() =>
  allPeople.filter((person) => person.role === 'leader' && person.scope === 'county'),
)

const statusLabel = computed(() => (shift.value ? STATUS_LABEL[shift.value.status] : ''))
const taskCount = computed(() =>
  shift.value && (shift.value.status === 'pending' || shift.value.status === 'ongoing')
    ? props.cell?.previewTaskCount ?? 0
    : tasks.value.length,
)
const crossCover = computed(() => {
  if (!shift.value) {
    return false
  }
  const person = allPeople.find((item) => item.name === shift.value?.person)
  return !!person && person.township !== '县级' && person.township !== shift.value.township
})

const form = reactive({ person: '', phone: '', authorizer: '', reason: '' })
const message = ref('')
const messageOk = ref(true)

watch(
  () => props.shiftId,
  () => {
    form.person = ''
    form.phone = ''
    form.authorizer = ''
    form.reason = ''
    message.value = ''
  },
)

const selectedPerson = computed(() => allPeople.find((person) => person.name === form.person))
const crossSelected = computed(() =>
  !!shift.value && !!selectedPerson.value && selectedPerson.value.township !== shift.value.township,
)

function refresh() {
  emit('changed')
}

function start() {
  if (props.shiftId === null) {
    return
  }
  const result = startDuty(props.shiftId)
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}

function confirm() {
  if (props.shiftId === null) {
    return
  }
  const result = confirmHandover(props.shiftId, '')
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}

function archive() {
  if (props.shiftId === null) {
    return
  }
  const result = archiveShift(props.shiftId)
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}

function submitSwap() {
  if (props.shiftId === null) {
    return
  }
  const result = swapShift(props.shiftId, {
    person: form.person,
    phone: form.phone,
    authorizer: form.authorizer || undefined,
    reason: form.reason,
  })
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}
</script>
