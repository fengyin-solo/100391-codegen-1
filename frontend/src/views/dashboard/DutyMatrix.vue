<template>
  <section class="duty-matrix">
    <header class="page-head">
      <div>
        <h3>汛期值班矩阵</h3>
        <p class="page-desc">
          按值班日期 × 乡镇铺开责任格，格内汇总隐患点、雨量站与待发布预警；负责人确认交班后按当前口径生成交接任务。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="openRule">调整交接口径</button>
        <button class="btn ghost" type="button" @click="reset">恢复示例排班</button>
      </div>
    </header>

    <p class="status-legend">
      <span class="legend-item">当前口径：{{ rule.label }}（v{{ rule.version }}）</span>
      <span class="legend-item">口径说明：{{ rule.note }}</span>
      <span class="legend-item">调整口径只重算未归档班次，已归档班次冻结当时规则</span>
      <span class="legend-item warn">跨乡镇代班需县级值班负责人授权</span>
    </p>

    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="town-col">乡镇 \\ 日期</th>
            <th v-for="date in ctx.dates" :key="date" :class="{ today: date === ctx.today }">
              {{ date }}<span v-if="date === ctx.today" class="today-tag">今天</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="township in ctx.townships" :key="township">
            <th class="town-col">{{ township }}</th>
            <td
              v-for="cell in rowOf(township)"
              :key="cell.shift.id"
              :class="['duty-cell', cell.shift.status, { today: cell.shift.date === ctx.today }]"
            >
              <div class="cell-head">
                <span class="cell-person">
                  {{ cell.shift.person }}
                  <em v-if="cell.crossTownshipCover" class="cover-tag" title="跨乡镇代班（需县级负责人授权）">代</em>
                </span>
                <span class="cell-status">{{ statusLabel(cell.shift.status) }}</span>
              </div>
              <div class="cell-metrics">
                <span class="metric" title="本乡镇在册隐患点总数">隐患 {{ cell.summary.hazards }}</span>
                <span class="metric" title="本乡镇雨量站总数">雨量站 {{ cell.summary.stations }}</span>
                <span class="metric" :class="{ alert: cell.summary.pendingAlarms > 0 }" title="本乡镇隐患点关联的待发布预警">
                  待预警 {{ cell.summary.pendingAlarms }}
                </span>
              </div>
              <div class="cell-tasks">
                <template v-if="cell.shift.status === 'pending' || cell.shift.status === 'ongoing'">
                  交班预计 {{ cell.previewTaskCount }} 条任务
                </template>
                <template v-else>
                  已落 {{ cell.tasks.length }} 条 · 待办 {{ cell.tasks.filter((t) => t.status === 'open').length }}
                </template>
                <em v-if="cell.shift.ruleVersion !== undefined && cell.shift.ruleVersion !== rule.version" class="rule-tag">
                  按 v{{ cell.shift.ruleVersion }}
                </em>
              </div>
              <div class="cell-actions">
                <button class="link" type="button" @click="openDetail(cell)">责任格详情</button>
                <button
                  v-if="cell.shift.status !== 'archived'"
                  class="link"
                  type="button"
                  @click="openSwap(cell)"
                >
                  换班
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ShiftDialog
      :shift-id="activeId"
      :mode="dialogMode"
      :cell="liveActiveCell"
      @close="activeId = null"
      @switch-mode="dialogMode = $event"
      @changed="reload"
    />

    <div v-if="ruleEditor" class="modal-mask" @click.self="ruleEditor = false">
      <div class="modal">
        <header class="modal-head">
          <h3>调整交接口径</h3>
          <button class="link" type="button" @click="ruleEditor = false">关闭</button>
        </header>
        <div class="modal-body">
          <p class="page-desc">
            当前执行「{{ rule.label }}」v{{ rule.version }}。调整后生成新版本：未结束班次按新口径重算/试算，已归档班次保留当时版本。
          </p>
          <label class="filter-item full">
            <span>本次口径调整说明</span>
            <textarea v-model="ruleNote" rows="4" placeholder="说明本次交班任务范围为什么调整"></textarea>
          </label>
          <p class="hint-text">系统按主汛期口径模板生成下一版本（仅监测中隐患点核查、仅待动员搬迁户联络、待发布预警补核查）。</p>
        </div>
        <footer class="modal-foot">
          <span v-if="ruleMessage" class="error-text">{{ ruleMessage }}</span>
          <button class="btn primary" type="button" @click="applyRule">发布新口径并重算</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  adjustHandoverRule,
  currentRule,
  dutyContext,
  loadMatrix,
  resetDutyMatrix,
} from '@/api/duty-service'
import type { DutyMatrixCell, DutyStatus } from '@/data/duty/types'
import ShiftDialog from './ShiftDialog.vue'

const ctx = dutyContext()
const cells = ref<DutyMatrixCell[]>([])
const activeId = ref<number | null>(null)
const activeCell = ref<DutyMatrixCell | undefined>()
const dialogMode = ref<'detail' | 'swap'>('detail')
const ruleEditor = ref(false)
const ruleNote = ref('')
const ruleMessage = ref('')

const STATUS_LABEL: Record<DutyStatus, string> = {
  pending: '待值班',
  ongoing: '值班中',
  handed: '已交班待归档',
  archived: '已归档',
}

const rule = computed(() => currentRule())

// 弹窗里的预览数要跟着最新矩阵走，不能拿打开瞬间的旧格数据
const liveActiveCell = computed(() =>
  activeId.value === null ? undefined : cells.value.find((cell) => cell.shift.id === activeId.value),
)

function statusLabel(status: DutyStatus): string {
  return STATUS_LABEL[status]
}

function rowOf(township: string): DutyMatrixCell[] {
  return cells.value.filter((cell) => cell.shift.township === township)
}

function reload() {
  cells.value = loadMatrix()
}

function openDetail(cell: DutyMatrixCell) {
  activeCell.value = cell
  activeId.value = cell.shift.id
  dialogMode.value = 'detail'
}

function openSwap(cell: DutyMatrixCell) {
  activeCell.value = cell
  activeId.value = cell.shift.id
  dialogMode.value = 'swap'
}

function openRule() {
  ruleNote.value = ''
  ruleMessage.value = ''
  ruleEditor.value = true
}

function applyRule() {
  const result = adjustHandoverRule(ruleNote.value)
  if (!result.ok) {
    ruleMessage.value = result.message
    return
  }
  ruleEditor.value = false
  reload()
}

function reset() {
  resetDutyMatrix()
  reload()
}

reload()
</script>
