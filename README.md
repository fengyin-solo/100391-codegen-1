# 地质灾害隐患点监测防治管理系统

面向地质灾害隐患点形变裂缝观测、雨量预警、避险搬迁安置与治理工程验收全流程的地质灾害防治数字化管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 隐患点台账 | `hazard` | 隐患点 | 隐患点编号、隐患点名称、灾害类型 |
| 形变观测 | `deformation` | 形变记录 | 记录编号、隐患点编号、观测日期 |
| 裂缝监测 | `crack` | 裂缝测点 | 测点编号、隐患点编号、裂缝编号 |
| 倾斜监测 | `tilt` | 倾斜记录 | 记录编号、测点编号、观测方向 |
| 雨量监测 | `rain_gauge` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 预警阈值 | `threshold` | 预警阈值 | 阈值编号、隐患点编号、监测类型 |
| 预警发布 | `alarm` | 预警通知 | 通知编号、隐患点编号、预警等级 |
| 避险搬迁 | `evacuation` | 搬迁安置户 | 户号、所属隐患点、户主姓名 |
| 巡查排查 | `patrol` | 巡查记录 | 巡查编号、隐患点编号、巡查日期 |
| 治理工程 | `engineering` | 治理工程项目 | 项目编号、隐患点编号、治理方案 |
| 工程验收 | `acceptance` | 验收报告 | 验收编号、项目编号、验收类型 |
| 整改跟踪 | `rectification` | 整改任务 | 任务编号、验收编号、整改内容 |
| 应急演练 | `drill` | 演练记录 | 演练编号、隐患点编号、演练主题 |
| 监测设备 | `device` | 监测设备 | 设备编号、设备类型、所属隐患点 |
| 灾情速报 | `report` | 灾情速报 | 速报编号、隐患点编号、发生时间 |
| 防灾宣传 | `propaganda` | 宣传活动 | 活动编号、宣传主题、宣传方式 |
| 承建单位 | `contract` | 承建单位 | 单位编号、单位名称、资质等级 |
| 群测群防培训 | `training` | 培训记录 | 培训编号、培训主题、培训对象 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `geohazard-monitor-prevention:entries` 这一项，或调用 `resetModule(模块)`。

## 汛期值班矩阵（运营概览页）

运营概览页内嵌汛期值班矩阵，按「值班日期 × 白/夜班 × 乡镇」铺开责任格：

- 格内实时汇总本乡镇**隐患点数**（在册/监测中等）、**雨量站数**（按站点编号去重，站点-乡镇映射
  见 `data/duty-logic.ts`）和**待发布预警数**（按隐患点归口到乡镇）。
- 格内可直接**接班、换班、确认交班、归档**。同乡镇换人当场生效；换入外乡镇人员（含县值班室代班）
  须**县值班室负责人授权**——值班员/乡镇负责人发起只生成待审批申请，授权后才写格并标「跨乡镇代班」。
- 值班负责人**确认交班**时按当前交接口径落任务：隐患点台账生成**现场核查任务**、避险搬迁页生成
  **避险联络任务**；同一班次重复确认只落一套任务（幂等）。
- **交接口径**（核查哪些隐患状态、联络哪些搬迁户、联络方式）由县值班室负责人在矩阵上调整，
  每次调整生成新版本；重算只覆盖**未结束班次**（待接班/值班中/已交班未归档），**已归档班次保留
  当时规则版本与已落任务**。格内显示冻结版本号（如 v1）。

值班数据独立持久化在 `geohazard-monitor-prevention:duty`，相关代码：

- `src/data/duty-types.ts` 类型；`src/data/duty-logic.ts` 口径任务生成与格内汇总纯函数；
  `src/data/duty-seed.ts` 花名册、班次与口径种子；`src/data/duty-store.ts` 持久化；
  `src/api/duty-service.ts` 业务服务；`src/views/dashboard/DutyMatrix.vue` 矩阵组件；
  `src/views/dashboard/HandoverTaskPanel.vue` 隐患点台账/避险搬迁页的交班任务面板。
- 业务规则验证脚本：`cd frontend && node scripts/verify-duty.mjs`。

