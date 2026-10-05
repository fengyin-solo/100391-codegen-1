<template>
  <section class="handover-task-panel">
    <header class="panel-head">
      <h3>{{ title }}</h3>
      <button class="btn" type="button" @click="reload">刷新任务</button>
    </header>
    <p class="page-desc">
      {{ desc }}同一班次重复确认交班只落一套任务；已归档班次的任务保留交班时口径版本。
    </p>
    <table v-if="rows.length" class="data-table task-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>关联{{ refLabel }}</th>
          <th>来源班次</th>
          <th>口径版本</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in rows" :key="task.id">
          <td>
            <strong>{{ task.title }}</strong>
            <p class="task-detail">{{ task.detail }}</p>
          </td>
          <td>{{ task.refCode }}</td>
          <td>{{ task.source }}</td>
          <td>v{{ task.ruleVersion }}</td>
          <td>{{ task.status }}</td>
          <td class="row-actions">
            <button v-if="task.status === '待执行'" class="link" type="button" @click="advance(task.id, '执行中')">开始</button>
            <button v-if="task.status !== '已完成'" class="link" type="button" @click="advance(task.id, '已完成')">完成</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty-state">暂无交班生成的{{ category }}任务</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { allDutyTasks, updateTaskStatus } from '@/api/duty-service'
import type { DutyTask, TaskCategory } from '@/data/duty-types'

const props = defineProps<{
  category: TaskCategory
  title: string
  desc: string
  refLabel: string
}>()

const rows = ref<DutyTask[]>([])

function reload() {
  const order: Record<DutyTask['status'], number> = { 待执行: 0, 执行中: 1, 已完成: 2 }
  rows.value = allDutyTasks()
    .filter((task) => task.category === props.category)
    .sort((a, b) => order[a.status] - order[b.status])
}

function advance(taskId: number, status: DutyTask['status']) {
  updateTaskStatus(taskId, status)
  reload()
}

onMounted(reload)
</script>
