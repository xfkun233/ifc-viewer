# IFC Viewer 项目开发文档

> **版本**: 0.0.0  
> **技术栈**: Vue 3 + TypeScript + Vite + Three.js + ThatOpen Components  
> **最后更新**: 2026-02-09

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 技术架构](#2-技术架构)
- [3. 项目结构](#3-项目结构)
- [4. 环境配置与启动](#4-环境配置与启动)
- [5. 核心模块详解](#5-核心模块详解)
  - [5.1 应用入口 (main.ts)](#51-应用入口-maints)
  - [5.2 路由配置 (router/index.ts)](#52-路由配置-routerindexts)
  - [5.3 IFC 查看器 (IfcViewer.vue)](#53-ifc-查看器-ifcviewervue)
  - [5.4 FBX 播放器 (FBXPlayer.vue)](#54-fbx-播放器-fbxplayervue)
  - [5.5 IFC 导出工具 (ifcExporter.ts)](#55-ifc-导出工具-ifcexporterts)
  - [5.6 状态管理 (stores/counter.ts)](#56-状态管理-storescounterts)
- [6. IFC 查看器 API 详解](#6-ifc-查看器-api-详解)
  - [6.1 场景初始化](#61-场景初始化)
  - [6.2 模型加载](#62-模型加载)
  - [6.3 构件选择与属性查询](#63-构件选择与属性查询)
  - [6.4 自定义属性管理](#64-自定义属性管理)
  - [6.5 视图控制](#65-视图控制)
  - [6.6 剖切功能](#66-剖切功能)
  - [6.7 可见性控制](#67-可见性控制)
  - [6.8 第一人称行走](#68-第一人称行走)
  - [6.9 标注功能](#69-标注功能)
  - [6.10 IFC 文件导出](#610-ifc-文件导出)
  - [6.11 空间树](#611-空间树)
- [7. IFC 导出器 API 详解](#7-ifc-导出器-api-详解)
  - [7.1 核心策略：Slice & Overwrite](#71-核心策略slice--overwrite)
  - [7.2 类型定义](#72-类型定义)
  - [7.3 API 函数列表](#73-api-函数列表)
- [8. FBX 播放器 API 详解](#8-fbx-播放器-api-详解)
- [9. UI 组件与交互说明](#9-ui-组件与交互说明)
- [10. 依赖说明](#10-依赖说明)
- [11. 构建与部署](#11-构建与部署)

---

## 1. 项目概述

IFC Viewer 是一个基于 Web 的 **BIM（建筑信息模型）查看器**，核心功能包括：

- **IFC 模型加载与渲染**：支持拖拽/选择上传 `.ifc` 文件，基于 ThatOpen Components 和 Three.js 进行高性能 3D 渲染
- **构件选择与属性查看**：点击模型构件可查看其完整的 IFC 属性（基本属性、属性集、数量集）
- **自定义属性编写**：可向构件添加自定义属性集（PropertySet），支持文本、数字、布尔类型
- **IFC 文件导出**：采用 "Slice & Overwrite" 策略将自定义属性写入 IFC 文件并导出
- **剖切面**：支持创建和删除剖切平面，辅助查看模型内部结构
- **可见性控制**：支持隔离选中、隐藏选中、全部显示
- **第一人称行走**：使用 WASD + QE 键进行第一人称漫游
- **选点标注**：在模型表面放置标注点，附带文字信息，标注数据随 IFC 文件一起导出
- **空间树**：展示 IFC 模型的空间结构层次
- **FBX 查看**：独立的 FBX 3D 模型查看器页面（含动画播放）

---

## 2. 技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                        前端应用 (SPA)                         │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Vue 3   │ Vue      │ Pinia    │ Element  │  Three.js       │
│ Compo-   │ Router   │ Store    │ Plus UI  │  + ThatOpen     │
│ sition   │          │          │          │  Components     │
│ API      │          │          │          │                 │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│                      Vite Dev Server / Build                 │
├──────────────────────────────────────────────────────────────┤
│    web-ifc (WASM)    │    Fragment Worker     │   FBXLoader  │
└──────────────────────┴────────────────────────┴──────────────┘
```

| 层级 | 技术 | 说明 |
|------|------|------|
| 视图层 | Vue 3 (Composition API) + Element Plus | 响应式 UI 与组件库 |
| 路由 | Vue Router 4 | SPA 路由管理 |
| 状态管理 | Pinia 3 | 全局状态存储（预留） |
| 3D 渲染 | Three.js 0.182 + ThatOpen Components 3.x | IFC 模型渲染与交互 |
| IFC 解析 | web-ifc 0.0.74 (WASM) | 二进制 IFC 解析引擎 |
| 构建工具 | Vite 7 | 快速开发和打包 |

---

## 3. 项目结构

```
Ifc-Viewer/
├── index.html                # 入口 HTML
├── package.json              # 依赖与脚本配置
├── vite.config.ts            # Vite 构建配置
├── tsconfig.json             # TypeScript 配置（项目引用）
├── tsconfig.app.json         # 应用 TypeScript 配置
├── tsconfig.node.json        # Node 环境 TypeScript 配置
├── eslint.config.ts          # ESLint 配置
├── env.d.ts                  # 环境类型声明
│
├── public/
│   └── wasm/
│       └── fragment-worker.mjs  # Fragment 解析 Web Worker
│
└── src/
    ├── main.ts               # 应用入口：Vue 初始化 + 插件注册
    ├── App.vue               # 根组件（仅含 RouterView）
    │
    ├── components/
    │   ├── IfcViewer.vue     # 【核心】IFC 模型查看器（2600+ 行）
    │   └── FBXPlayer.vue     # FBX 模型播放器
    │
    ├── router/
    │   └── index.ts          # 路由定义（/ → IfcViewer, /fbx → FBXPlayer）
    │
    ├── stores/
    │   └── counter.ts        # Pinia 示例 Store（预留）
    │
    ├── three/                # Three.js 辅助模块（本地化依赖）
    │   ├── controls/
    │   │   └── OrbitControls.js
    │   ├── curves/
    │   │   ├── NURBSCurve.js
    │   │   └── NURBSUtils.js
    │   ├── libs/
    │   │   └── fflate.module.js
    │   └── loaders/
    │       └── FBXLoader.js
    │
    └── utils/
        └── ifcExporter.ts    # IFC 导出工具模块（671 行）
```

---

## 4. 环境配置与启动

### 前置要求

- **Node.js**: `^20.19.0` 或 `>=22.12.0`
- **包管理器**: npm / yarn / pnpm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

启动 Vite 开发服务器，默认监听 `http://localhost:5173`。

### 构建生产版本

```bash
npm run build
```

先执行 `vue-tsc --build` 类型检查，再执行 `vite build` 打包。

### 预览生产版本

```bash
npm run preview
```

### 代码检查

```bash
npm run lint
```

### Vite 配置要点

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  optimizeDeps: {
    exclude: ['web-ifc']  // web-ifc WASM 模块排除预构建
  },
  assetsInclude: ['**/*.wasm']  // WASM 文件作为资源处理
})
```

---

## 5. 核心模块详解

### 5.1 应用入口 (main.ts)

**文件**: `src/main.ts`

| 职责 | 说明 |
|------|------|
| 创建 Vue 应用 | `createApp(App)` |
| 注册 Pinia | 全局状态管理 |
| 注册 Vue Router | 路由管理 |
| 注册 Element Plus | UI 组件库（完整引入） |
| 注册图标 | Element Plus Icons 全局注册 |
| 挂载应用 | 挂载到 `#app` |

### 5.2 路由配置 (router/index.ts)

**文件**: `src/router/index.ts`

| 路径 | 名称 | 组件 | 说明 |
|------|------|------|------|
| `/` | `IfcViewer` | `IfcViewer.vue` | IFC 模型查看器（首页） |
| `/fbx` | `FBXPlayer` | `FBXPlayer.vue` | FBX 模型播放器 |

路由模式：`createWebHistory`（HTML5 History 模式）

---

### 5.3 IFC 查看器 (IfcViewer.vue)

**文件**: `src/components/IfcViewer.vue`（约 2600 行）

这是项目最核心的组件，包含 IFC 模型的加载、渲染、交互、属性管理、导出等全部功能。

#### 响应式状态一览

| 状态变量 | 类型 | 说明 |
|----------|------|------|
| `viewerContainer` | `Ref<HTMLElement>` | 3D 渲染容器 DOM 引用 |
| `spatialTreeContainer` | `Ref<HTMLElement>` | 空间树容器 DOM 引用 |
| `selectedProperties` | `Ref<PropertyRecord>` | 当前选中构件的属性键值对 |
| `isLoading` | `Ref<boolean>` | 加载状态标志 |
| `hasModel` | `Ref<boolean>` | 是否已加载模型 |
| `clippingEnabled` | `Ref<boolean>` | 剖切模式开关 |
| `treeFilterText` | `Ref<string>` | 空间树搜索过滤文本 |
| `moveSpeed` | `Ref<number>` | 行走移动速度 (默认 3) |
| `turnSpeed` | `Ref<number>` | 行走转向速度 (默认 1.5) |
| `isWalking` | `Ref<boolean>` | 行走状态 |
| `showPropertyDialog` | `Ref<boolean>` | 添加属性对话框可见性 |
| `showPropertyManager` | `Ref<boolean>` | 属性管理器对话框可见性 |
| `customProperties` | `Ref<CustomProperty[]>` | 对话框中临时属性列表 |
| `pendingProperties` | `Ref<PendingPropertyWrite[]>` | 全局待写入属性列表 |
| `loadedCustomProperties` | `Ref<ParsedCustomProperty[]>` | 从文件解析的自定义属性 |
| `annotationMode` | `Ref<boolean>` | 标注模式开关 |
| `annotations` | `Ref<AnnotationPoint[]>` | 标注点列表 |
| `showAnnotationDialog` | `Ref<boolean>` | 标注对话框可见性 |
| `annotationText` | `Ref<string>` | 标注文本输入 |

#### ThatOpen 组件实例

| 变量 | 类型 | 说明 |
|------|------|------|
| `components` | `OBC.Components` | ThatOpen 组件系统核心 |
| `world` | `IFCWorld` | 3D 世界实例（场景 + 相机 + 渲染器） |
| `fragmentsManager` | `OBC.FragmentsManager` | Fragment 模型管理器 |
| `ifcLoader` | `OBC.IfcLoader` | IFC 文件加载器 |
| `highlighter` | `OBCF.Highlighter` | 构件高亮选择器 |
| `clipper` | `OBC.Clipper` | 剖切面管理器 |
| `currentModel` | `FragmentsModel` | 当前加载的模型实例 |

---

### 5.4 FBX 播放器 (FBXPlayer.vue)

**文件**: `src/components/FBXPlayer.vue`（约 458 行）

独立的 FBX 3D 模型查看器组件：

| 功能 | 说明 |
|------|------|
| 场景初始化 | 创建 Scene、Camera、Renderer、OrbitControls、灯光 |
| FBX 加载 | 使用本地化的 FBXLoader 加载模型 |
| 动画播放 | 自动检测并播放 FBX 中的动画 |
| 性能优化 | 帧率限制 30FPS、页面不可见时暂停、按需渲染 |
| 错误处理 | 加载失败提示与重试机制 |
| 自适应 | ResizeObserver 监听容器大小变化 |

#### Props

| 属性 | 类型 | 说明 |
|------|------|------|
| `fbxPath` | `string` | FBX 文件路径 |

---

### 5.5 IFC 导出工具 (ifcExporter.ts)

**文件**: `src/utils/ifcExporter.ts`（671 行）

核心导出模块，采用 **"Slice & Overwrite"** 策略实现 IFC 文件的自定义属性写入。详细 API 见 [第 7 章](#7-ifc-导出器-api-详解)。

---

### 5.6 状态管理 (stores/counter.ts)

**文件**: `src/stores/counter.ts`

Pinia 示例 Store（预留），包含基础的计数器功能：

```typescript
const count = ref(0)
const doubleCount = computed(() => count.value * 2)
function increment() { count.value++ }
```

---

## 6. IFC 查看器 API 详解

### 6.1 场景初始化

#### `initViewer(): Promise<void>`

初始化整个 3D 查看器环境。

**执行流程**：

1. 创建 `OBC.Components` 组件系统
2. 创建 World（场景 + 后处理渲染器 + 正交/透视相机）
3. 设置场景背景色为 `#f0f0f0`，添加网格
4. 初始化 `FragmentsManager` 并配置本地 Worker
5. 绑定相机事件回调（停止时更新 fragments）
6. 配置 IFC Loader（使用本地 WASM）
7. 初始化 Raycasters、Highlighter、Clipper
8. 创建标注 Group 并添加到场景
9. 绑定鼠标双击（标注/剖切）、单击（标注检测）事件
10. 绑定键盘事件（Delete 删除剖切面、WASDQE 行走、Esc 退出标注模式）
11. 初始化空间树组件
12. 绑定窗口 resize 事件

**WASM 配置**：

```typescript
await ifcLoader.setup({
  autoSetWasm: false,
  wasm: { path: '/wasm/', absolute: true }
})
```

IFC 解析使用 `web-ifc` 的 WASM 引擎，Worker 和 WASM 文件位于 `public/wasm/` 目录。

---

### 6.2 模型加载

#### `loadIfcFile(file: File): Promise<void>`

从文件加载 IFC 模型到场景中。

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `file` | `File` | 用户上传的 `.ifc` 文件对象 |

**执行流程**：

1. 读取文件为 `ArrayBuffer` → `Uint8Array`
2. 如已有模型，从场景中移除旧模型
3. 清理旧的 web-ifc 数据、待写入属性、标注
4. 保存原始 IFC 数据副本 (`currentIfcData`)，用于后续导出
5. 调用 `parseCustomProperties()` 解析已有的自定义属性
6. 调用 `parseAnnotationsFromCustomSection()` 解析已有标注
7. 使用 `ifcLoader.load()` 加载模型到 Fragment 系统
8. 调用 `fitToModel()` 自动调整相机视角
9. 如有标注数据，调用 `loadAnnotationMarkers()` 渲染标注点

**文件上传方式**：
- **拖拽上传**：拖拽 `.ifc` 文件到视图区域
- **点击上传**：通过左侧面板的上传区域选择文件

#### `handleUploadChange(uploadFile: UploadFile): boolean`

Element Plus Upload 组件的文件变更回调。

#### `handleDrop(event: DragEvent): void`

处理拖拽上传事件，验证文件扩展名后调用 `loadIfcFile()`。

---

### 6.3 构件选择与属性查询

#### `handleSelection(data: Map<string, Set<number>>): Promise<void>`

处理 Highlighter 的选择事件，提取模型 ID 和 Express ID。

**执行流程**：

1. 从选择数据中提取第一个模型 ID 和 Express ID
2. 保存到 `selectedModelId` 和 `selectedExpressId`
3. 调用 `getElementProperties()` 获取完整属性
4. 追加待写入自定义属性到显示列表（带 ✏️ 前缀标记可编辑）

#### `getElementProperties(model: FragmentsModel, expressId: number): Promise<PropertyRecord | null>`

获取指定构件的完整属性，包括基本属性、属性集和数量集。

**三级查询架构**：

```
第一级查询：获取基本属性 + IsDefinedBy 关系
    ↓
第二级查询：获取属性集的 HasProperties / Quantities
    ↓
第三级查询：获取每个属性的 Name + NominalValue 详情
```

**返回格式**：

```typescript
{
  "Express ID": 12345,
  "Name": "Basic Wall:Generic - 200mm",
  "GlobalId": "2O2Fr$t4X7Z...",
  "Pset_WallCommon.IsExternal": true,
  "BaseQuantities.Length": 5.0,
  "✏️ CustomProperties.MyProp": "value"  // 自定义属性
}
```

**属性值来源**：

| 前缀 | 来源 |
|------|------|
| 无前缀 | IFC 实体基本属性（Name、GlobalId、ObjectType 等） |
| `PsetName.PropName` | IfcPropertySet 中的属性 |
| `QtoName.QtyName` | IfcElementQuantity 中的数量 |
| `✏️ PsetName.PropName` | 用户添加的自定义属性（可编辑） |

---

### 6.4 自定义属性管理

#### 添加属性流程

##### `openPropertyDialog(): void`

打开添加属性对话框。前提：必须先选中一个构件。

##### `addPropertyToList(): void`

在对话框中添加一条属性到临时列表。验证名称非空、值非空、名称不重复。

##### `writePropertiesToIfc(): Promise<void>`

将对话框中的临时属性写入全局待写入列表 (`pendingProperties`)。

**属性写入数据结构**：

```typescript
interface PendingPropertyWrite {
  elementId: string      // 目标构件 Express ID (如 "#12345")
  psetName: string       // 属性集名称
  propertyName: string   // 属性名
  value: string | number | boolean  // 属性值
  valueType: 'STRING' | 'REAL' | 'INTEGER' | 'BOOLEAN' | 'LABEL'
}
```

#### 属性编辑

##### `startInlineEdit(key: string, currentValue: string | number): void`

在右侧属性面板中，点击带 ✏️ 标记的属性值，进入内联编辑模式。

##### `saveInlineEdit(key: string): void`

保存内联编辑的属性值，根据属性类型自动解析。

##### `deleteCustomProperty(key: string): void`

从右侧面板删除自定义属性。

#### 属性管理器

##### `openPropertyManager(): void`

打开属性管理器对话框，展示所有待写入属性的表格视图，支持：
- **搜索过滤**：按属性名、属性集、构件 ID、值过滤
- **编辑属性**：修改属性名、类型、值
- **删除属性**：删除单个属性
- **清空全部**：清空所有待写入属性
- **导出**：直接从管理器导出 IFC 文件

#### 辅助函数

| 函数 | 说明 |
|------|------|
| `getPendingPropertiesForElement(expressId)` | 获取某构件的所有待写入属性 |
| `getPendingPropertiesForPset(expressId, psetName)` | 获取某构件某属性集的待写入属性 |
| `getPendingPsetNames(expressId)` | 获取某构件所有待写入属性集名称 |
| `mapValueType(type)` | 本地类型 → 导出器类型映射 |
| `mapValueTypeReverse(type)` | 导出器类型 → 本地类型映射 |
| `isEditableProperty(key)` | 判断属性键是否为可编辑（以 ✏️ 开头） |
| `parseEditableKey(key)` | 从显示键名提取 psetName 和 propertyName |

#### 计算属性

| 计算属性 | 说明 |
|----------|------|
| `pendingWritesCount` | 待写入属性总数 |
| `pendingElementsCount` | 涉及的构件数量 |
| `psetNameConflict` | 当前属性集名称是否冲突 |
| `suggestedPsetName` | 建议的新属性集名称（带时间戳） |
| `hasExistingCustomData` | IFC 文件是否已包含自定义数据 |
| `filteredPendingProperties` | 经搜索过滤后的属性列表 |

---

### 6.5 视图控制

| 函数 | 快捷方式 | 说明 |
|------|----------|------|
| `zoomIn()` | 工具栏按钮 | 放大视图（dolly +2） |
| `zoomOut()` | 工具栏按钮 | 缩小视图（dolly -2） |
| `resetView()` | 工具栏按钮 | 重置视角（有模型时适应模型，否则默认位置） |
| `fitToModel()` | 工具栏按钮 | 自动适应模型尺寸调整相机位置和朝向 |

#### `fitToModel(): void`

根据模型包围盒自动调整相机视角：

```
距离 = 模型最大维度 × 2
位置 = 模型中心 + (distance, distance×0.5, distance)
目标 = 模型中心
```

---

### 6.6 剖切功能

#### `toggleClipping(): void`

切换剖切模式开启/关闭。开启后双击模型表面可创建剖切面。

#### `deleteAllClips(): void`

删除所有已创建的剖切面。

**键盘操作**：
- `Delete` 键：删除最后一个剖切面

---

### 6.7 可见性控制

#### `isolateSelected(): Promise<void>`

**隔离选中**：将未选中的构件全部隐藏，只保留当前选中构件可见。

**执行流程**：
1. 获取当前选择集
2. 获取模型所有 Express ID
3. 隐藏所有构件
4. 仅显示选中构件

#### `hideSelected(): void`

**隐藏选中**：隐藏当前选中的构件。

#### `showAll(): Promise<void>`

**显示全部**：将所有构件恢复可见。

#### `getAllExpressIds(model: FragmentsModel): Promise<number[]>`

辅助函数，获取模型中所有构件的 Express ID。使用正则 `/.*/` 匹配所有 IFC 类别。

---

### 6.8 第一人称行走

使用 WASD + QE 键实现第一人称漫游模式。

#### 键位映射

| 键 | 动作 |
|----|------|
| `W` | 前进 |
| `S` | 后退 |
| `A` | 左移 |
| `D` | 右移 |
| `Q` | 左转 |
| `E` | 右转 |
| `Shift` (按住) | 加速（2 倍速） |

#### `startWalkLoop(): void`

启动行走更新循环（`requestAnimationFrame`）。每帧根据按下的键计算移动向量，更新相机位置和目标点。

**参数**：
- `moveSpeed`：移动速度，默认 `3`
- `turnSpeed`：转向速度，默认 `1.5`

**注意**：输入框获取焦点时自动屏蔽行走键，避免冲突。

---

### 6.9 标注功能

在模型表面放置可视化标注点，附带文字信息。

#### `toggleAnnotationMode(): void`

切换标注模式。进入标注模式时自动关闭剖切模式。

#### `handleAnnotationDoubleClick(): Promise<void>`

标注模式下的双击处理：使用 Raycaster 检测模型表面交点，记录坐标并弹出标注输入对话框。

#### `confirmAnnotation(): void`

确认添加标注，创建 `AnnotationPoint` 对象并在场景中渲染标记球体。

**标注数据结构**：

```typescript
interface AnnotationPoint {
  id: string    // 唯一 ID（时间戳 + 随机字符串）
  x: number     // 世界坐标 X
  y: number     // 世界坐标 Y
  z: number     // 世界坐标 Z
  text: string  // 标注文字
}
```

#### `createAnnotationMarker(annotation: AnnotationPoint): void`

在场景中创建标注标记（红色半透明球体）。球体大小根据模型尺寸自适应（模型最大维度 × 0.01）。

#### `handleAnnotationClick(event: MouseEvent): void`

单击事件处理：检测是否点击了标注标记，弹出标注信息浮窗。

#### `deleteAnnotation(id: string): void`

删除指定标注，同时移除场景中的标记对象。

#### `loadAnnotationMarkers(): void`

批量加载标注标记（从解析的标注数据中恢复）。

#### `clearAnnotationMarkers(): void`

清除所有标注标记，释放 Geometry 和 Material 资源。

**键盘操作**：
- `Esc`：退出标注模式

---

### 6.10 IFC 文件导出

#### `exportModifiedIfc(): Promise<void>`

导出修改后的 IFC 文件。

**执行流程**：

1. 校验模型和原始数据存在
2. 调用 `createUpdatedIfcBlob()` 创建包含自定义属性和标注的 Blob
3. 调用 `downloadIfcBlob()` 触发浏览器下载
4. 文件命名规则：有修改时添加 `_modified` 后缀

---

### 6.11 空间树

#### `initSpatialTree(): void`

初始化 ThatOpen UI 的空间树组件 (`BUIOBC.tables.spatialTree`)。

#### `updateModelTree(): void`

在模型加载后更新空间树数据。

#### `expandAllTree(): void` / `collapseAllTree(): void`

展开/收起空间树所有节点。

#### 树过滤

通过 `treeFilterText` 响应式变量实时过滤空间树（watch 监听并设置 `queryString`）。

---

## 7. IFC 导出器 API 详解

### 7.1 核心策略：Slice & Overwrite

IFC 文件被视为 **"只读基础层" + "可写用户层"** 的双层结构：

```
┌─────────────────────────────────────────────┐
│                 IFC 文件结构                  │
├─────────────────────────────────────────────┤
│  HEADER 段                                   │
│  DATA 段（原始 IFC 实体）                     │  ← 只读基础层
│  ...                                         │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│  /* === CUSTOM_DATA_START === */              │
│  IFCPROPERTYSINGLEVALUE(...)                 │  ← 可写用户层
│  IFCPROPERTYSET(...)                         │
│  IFCRELDEFINESBYPROPERTIES(...)              │
│  /* ANNOTATIONS_JSON_START */                │
│  /* [标注 JSON 数据] */                       │
│  /* ANNOTATIONS_JSON_END */                   │
│  /* === CUSTOM_DATA_END === */               │
│  ENDSEC;                                     │
│  END-ISO-10303-21;                           │
└─────────────────────────────────────────────┘
```

**首次写入**：在 `ENDSEC;` 之前插入自定义数据区域  
**再次写入**：替换 `CUSTOM_DATA_START` 到 `CUSTOM_DATA_END` 之间的内容

---

### 7.2 类型定义

#### `PendingPropertyWrite`

```typescript
interface PendingPropertyWrite {
  elementId: string    // 目标 Express ID (如 "#12345")
  psetName: string     // 属性集名称
  propertyName: string // 属性名称
  value: string | number | boolean  // 属性值
  valueType: 'STRING' | 'REAL' | 'INTEGER' | 'BOOLEAN' | 'LABEL'
}
```

#### `ParsedCustomProperty`

```typescript
interface ParsedCustomProperty {
  elementId: string
  psetName: string
  propertyName: string
  value: string | number | boolean
  valueType: PendingPropertyWrite['valueType']
}
```

#### `AnnotationPoint`

```typescript
interface AnnotationPoint {
  id: string
  x: number
  y: number
  z: number
  text: string
}
```

---

### 7.3 API 函数列表

#### `createUpdatedIfcBlob(originalData, allProperties, annotations?): Promise<Blob>`

**核心导出函数**。创建包含自定义属性的 IFC Blob。

| 参数 | 类型 | 说明 |
|------|------|------|
| `originalData` | `Uint8Array` | 原始 IFC 文件数据 |
| `allProperties` | `PendingPropertyWrite[]` | 所有自定义属性 |
| `annotations` | `AnnotationPoint[]` (可选) | 标注数据 |

**返回**: `Promise<Blob>` — 更新后的 IFC 文件 Blob

**5 步执行流程**：

1. **查找分割点**：搜索 `CUSTOM_DATA_START` 标记
2. **确定基础数据**：有标记则截取标记前数据，无标记则截取 `ENDSEC;` 前数据
3. **获取最大 Express ID**：遍历基础数据找到最大 `#xxxx=`，新 ID 从 max+1 开始
4. **生成新内容**：
   - 按构件和属性集分组
   - 生成 `IFCPROPERTYSINGLEVALUE` 实体
   - 生成 `IFCPROPERTYSET` 实体
   - 生成 `IFCRELDEFINESBYPROPERTIES` 关系实体
   - 如有标注，以 JSON 格式嵌入
5. **Blob 组装**：基础数据 + 新内容拼接为 Blob

---

#### `findMarkerIndex(data, marker, scanLimit?): number`

在二进制数据中高效搜索标记字符串。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data` | `Uint8Array` | — | IFC 文件二进制数据 |
| `marker` | `string` | — | 标记字符串 |
| `scanLimit` | `number` | 5MB | 从末尾开始的最大扫描范围 |

**返回**: `number` — 标记位置字节偏移，未找到返回 `-1`

---

#### `findEndSecPosition(data): number`

查找 IFC 文件中最后一个 `ENDSEC;` 的位置。

---

#### `findMaxExpressIdFromBytes(data): number`

使用状态机遍历二进制数据，找到最大的 Express ID（`#xxxx=` 格式）。

---

#### `generateIfcGuid(): string`

生成 IFC 兼容的 GUID（22 字符，使用 IFC 专用 base64 字符集）。

```
字符集: 0-9 A-Z a-z _ $
长度: 22 字符
来源: 128 位加密随机数 (crypto.getRandomValues)
```

---

#### `parseCustomProperties(data): ParsedCustomProperty[]`

从 IFC 文件的自定义数据区域解析已保存的属性。

**解析逻辑**：

1. 提取自定义数据区域文本
2. 逐行解析 `IFCPROPERTYSINGLEVALUE`、`IFCPROPERTYSET`、`IFCRELDEFINESBYPROPERTIES`
3. 通过关系链重建 属性 → 属性集 → 构件 的映射

---

#### `parseAnnotationsFromCustomSection(data): AnnotationPoint[]`

从 IFC 文件的自定义数据区域解析标注点数据。标注以 JSON 格式存储在 `ANNOTATIONS_JSON_START/END` 标记之间。

---

#### `hasCustomDataSection(data): boolean`

检查 IFC 数据是否包含自定义数据区域。

---

#### `extractCustomDataSection(data): string | null`

提取自定义数据区域的文本内容。

---

#### `downloadIfcBlob(blob, filename): void`

触发浏览器下载 IFC Blob 文件。

| 参数 | 类型 | 说明 |
|------|------|------|
| `blob` | `Blob` | IFC 文件 Blob |
| `filename` | `string` | 下载文件名（自动补 `.ifc` 后缀） |

---

#### `exportIfcWithCustomProperties(originalData, allProperties, filename): Promise<void>`

完整导出工作流：创建 Blob → 触发下载。

---

## 8. FBX 播放器 API 详解

### 核心函数

#### `initScene(): void`

初始化 Three.js 场景环境：

| 步骤 | 说明 |
|------|------|
| 创建场景 | 背景色 `#f0f0f0` |
| 创建相机 | 透视相机，FOV=75，位置 (50,50,50) |
| 创建渲染器 | WebGL 渲染器，抗锯齿 |
| 轨道控制器 | OrbitControls，阻尼 0.02 |
| 灯光 | 环境光 0.5 + 平行光 0.8 |
| 坐标轴 | AxesHelper(50) |
| 启动渲染循环 | `animate()` |

#### `loadFBXModel(url: string): void`

加载 FBX 模型：

1. 移除旧模型
2. 使用 FBXLoader 加载新模型
3. 自动居中和缩放（目标尺寸 100）
4. 检测并播放动画

#### `animate(time: number): void`

渲染循环，帧率限制 30FPS，仅在需要时渲染（按需渲染优化）。

#### 性能优化策略

| 策略 | 说明 |
|------|------|
| 帧率限制 | 目标 30FPS，通过时间差控制 |
| 按需渲染 | `needsRender` 标志，仅交互/动画时渲染 |
| 页面可见性 | 页面不可见时暂停动画循环 |
| ResizeObserver | 容器大小变化时自适应 |

---

## 9. UI 组件与交互说明

### 布局结构

```
┌────────────┬──────────────────────┬─────────────┐
│  左侧面板   │      中间视图区域      │  右侧面板    │
│  (280px)   │      (自适应)         │  (320px)    │
│            │                      │             │
│ ·文件上传   │  ·工具栏              │ ·属性面板    │
│ ·模型结构树 │  ·3D 渲染视口         │ ·编辑功能    │
│            │  ·标注模式提示         │ ·导出按钮    │
│            │  ·标注弹出框           │             │
└────────────┴──────────────────────┴─────────────┘
```

### 工具栏按钮

| 分组 | 按钮 | 图标 | 功能 |
|------|------|------|------|
| 视图控制 | 放大 | ZoomIn | `zoomIn()` |
| | 缩小 | ZoomOut | `zoomOut()` |
| | 重置视图 | Refresh | `resetView()` |
| | 适应模型 | FullScreen | `fitToModel()` |
| 可见性 | 隔离选中 | Select | `isolateSelected()` |
| | 隐藏选中 | Hide | `hideSelected()` |
| | 显示全部 | View | `showAll()` |
| 剖切 | 剖切模式 | Scissor | `toggleClipping()` |
| | 删除剖切面 | Delete | `deleteAllClips()` |
| 标注 | 选点标注 | Aim | `toggleAnnotationMode()` |

### 快捷键

| 按键 | 功能 |
|------|------|
| `W/A/S/D` | 第一人称行走（前/左/后/右） |
| `Q/E` | 左转/右转 |
| `Shift` (按住) | 行走加速 |
| `Delete` | 删除剖切面 |
| `Esc` | 退出标注模式 |
| 双击 | 创建剖切面（剖切模式）/ 放置标注（标注模式） |

### 对话框

| 对话框 | 触发方式 | 功能 |
|--------|----------|------|
| 添加自定义属性 | 右侧面板"添加"按钮 | 输入属性集名称 + 多条属性 |
| 属性管理器 | 右侧面板"管理属性"链接 | 搜索/编辑/删除/导出属性 |
| 添加标注信息 | 标注模式双击模型 | 输入标注文字 |

---

## 10. 依赖说明

### 生产依赖

| 包名 | 版本 | 说明 |
|------|------|------|
| `vue` | ^3.5.26 | 前端框架 |
| `vue-router` | ^4.6.4 | SPA 路由 |
| `pinia` | ^3.0.4 | 状态管理 |
| `element-plus` | ^2.13.1 | UI 组件库 |
| `@element-plus/icons-vue` | ^2.3.2 | Element Plus 图标 |
| `three` | ^0.182.0 | 3D 图形引擎 |
| `@thatopen/components` | ^3.2.7 | ThatOpen BIM 核心组件 |
| `@thatopen/components-front` | ^3.2.17 | ThatOpen 前端组件（Highlighter、PostproductionRenderer） |
| `@thatopen/fragments` | ^3.2.13 | Fragment 模型格式库 |
| `@thatopen/ui` | ^3.2.4 | ThatOpen UI 基础库 |
| `@thatopen/ui-obc` | ^3.2.3 | ThatOpen UI BIM 组件（空间树等） |
| `web-ifc` | ^0.0.74 | IFC 解析 WASM 引擎 |

### 开发依赖

| 包名 | 版本 | 说明 |
|------|------|------|
| `vite` | ^7.3.0 | 构建工具 |
| `@vitejs/plugin-vue` | ^6.0.3 | Vite Vue 插件 |
| `vite-plugin-vue-devtools` | ^8.0.5 | Vue DevTools 集成 |
| `typescript` | ~5.9.3 | TypeScript 编译器 |
| `vue-tsc` | ^3.2.2 | Vue TypeScript 类型检查 |
| `eslint` | ^9.39.2 | 代码检查工具 |
| `eslint-plugin-vue` | ~10.6.2 | Vue ESLint 规则 |
| `@types/three` | ^0.182.0 | Three.js 类型定义 |

### 本地化依赖（src/three/）

项目将部分 Three.js 附加模块本地化，避免外部依赖：

| 模块 | 说明 |
|------|------|
| `OrbitControls.js` | 轨道控制器（FBX 播放器使用） |
| `FBXLoader.js` | FBX 文件加载器 |
| `NURBSCurve.js` | NURBS 曲线（FBXLoader 依赖） |
| `NURBSUtils.js` | NURBS 工具函数 |
| `fflate.module.js` | 快速压缩/解压库（FBXLoader 依赖） |

---

## 11. 构建与部署

### 构建命令

```bash
npm run build
```

输出目录：`dist/`

### 注意事项

1. **WASM 文件**：`public/wasm/` 下的文件会原样复制到构建产物的根目录
2. **web-ifc 排除预构建**：在 `vite.config.ts` 中通过 `optimizeDeps.exclude` 配置
3. **WASM 资源**：通过 `assetsInclude: ['**/*.wasm']` 配置为资源类型
4. **路由模式**：使用 History 模式，部署时需配置服务器回退到 `index.html`

### 部署检查清单

- [ ] 确保 `public/wasm/` 目录包含 `fragment-worker.mjs` 和 web-ifc 的 WASM 文件
- [ ] 服务器配置 SPA 回退（History 路由模式）
- [ ] 如需 FBX 演示，确保 `public/` 下有对应的 FBX 文件
- [ ] 检查 MIME 类型：`.wasm` → `application/wasm`，`.mjs` → `application/javascript`
