import { defineStore } from 'pinia'

export interface IdentityPreset {
  operator: string
  role: '负责人' | '值班员'
  township: string
  shiftLabel: string
}

// 演示用身份：负责人可调口径、授权跨乡镇代班、确认交班；值班员只能发起申请。
export const IDENTITY_PRESETS: IdentityPreset[] = [
  { operator: '周建国', role: '负责人', township: '县值班室', shiftLabel: '县值班室 · 汛期总带班' },
  { operator: '李建华', role: '负责人', township: '城关镇', shiftLabel: '城关镇 · 白班 08:00-20:00' },
  { operator: '王敏', role: '值班员', township: '城关镇', shiftLabel: '城关镇 · 白班 08:00-20:00' },
  { operator: '何军', role: '值班员', township: '金沙镇', shiftLabel: '金沙镇 · 白班 08:00-20:00' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '周建国',
    role: '负责人' as '负责人' | '值班员',
    township: '县值班室',
    shiftLabel: '县值班室 · 汛期总带班',
    scope: '地质灾害隐患点监测防治管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isLeader: (state) => state.role === '负责人',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    useIdentity(preset: IdentityPreset) {
      this.operator = preset.operator
      this.role = preset.role
      this.township = preset.township
      this.shiftLabel = preset.shiftLabel
    },
  },
})
