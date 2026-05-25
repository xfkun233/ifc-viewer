<template>
  <div
    class="viewer-app"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <!-- ═══ 顶部 Header ═══ -->
    <header class="header">
      <div class="header-left">
        <span class="app-title">3D Viewer</span>
      </div>
      <div v-if="fileName" class="header-center">{{ fileName }}</div>
      <div class="header-right">
        <button class="icon-btn" title="关于" @click="showAbout = !showAbout">ℹ️</button>
      </div>
    </header>

    <!-- ═══ 工具栏 ═══ -->
    <div class="toolbar">
      <!-- 文件操作 -->
      <button class="tb-btn" title="打开文件" @click="pickFile">📂</button>
      <div class="tb-sep"></div>

      <!-- 视图导航（模型加载后显示） -->
      <template v-if="modelLoaded">
        <button class="tb-btn" title="适应窗口" @click="fitToWindow">⊞</button>
        <button class="tb-btn" title="Y 轴朝上" @click="setUpY">⬆Y</button>
        <button class="tb-btn" title="Z 轴朝上" @click="setUpZ">⬆Z</button>
        <button class="tb-btn" title="翻转上方向" @click="flipUp">🔄</button>
        <div class="tb-sep"></div>

        <!-- 投影模式 -->
        <button
          class="tb-btn"
          :class="{ active: projMode === 'perspective' }"
          title="透视投影"
          @click="setProjection('perspective')"
        >🎥</button>
        <button
          class="tb-btn"
          :class="{ active: projMode === 'orthographic' }"
          title="正交投影"
          @click="setProjection('orthographic')"
        >📐</button>
        <div class="tb-sep"></div>

        <!-- 边线/截图 -->
        <button
          class="tb-btn"
          :class="{ active: showEdges }"
          title="显示/隐藏边线"
          @click="toggleEdges"
        >🔲</button>
        <button class="tb-btn" title="截图" @click="snapshot">📷</button>
      </template>
    </div>

    <!-- ═══ 主体区域 ═══ -->
    <div class="main-body" :class="{ resizing: isResizingPanel }">
      <!-- 左侧导航面板 -->
      <aside
        v-if="modelLoaded"
        class="panel panel-left"
        :class="{ collapsed: !showLeftPanel }"
        :style="showLeftPanel ? { width: `${leftPanelWidth}px` } : undefined"
      >
        <div class="panel-tabs">
          <button
            class="panel-tab"
            :class="{ active: leftTab === 'files' }"
            title="文件"
            @click="leftTab = 'files'"
          >📄</button>
          <button
            class="panel-tab"
            :class="{ active: leftTab === 'meshes' }"
            title="网格"
            @click="leftTab = 'meshes'"
          >🧊</button>
        </div>

        <div v-if="showLeftPanel" ref="treeScrollerEl" class="panel-body">
          <!-- 文件列表 -->
          <template v-if="leftTab === 'files'">
            <div class="panel-section-title">文件</div>
            <div v-for="f in loadedFiles" :key="f" class="tree-item">{{ f }}</div>
          </template>

          <!-- 网格树 -->
          <template v-if="leftTab === 'meshes'">
            <div class="panel-section-title mesh-header">
              <span>Meshes</span>
              <div class="mesh-actions">
                <button
                  class="mesh-icon-btn"
                  :class="{ active: meshViewMode === 'flat' }"
                  title="平级列表"
                  @click="setMeshViewMode('flat')"
                >☰</button>
                <button
                  class="mesh-icon-btn"
                  :class="{ active: meshViewMode === 'tree' }"
                  title="树状视图"
                  @click="setMeshViewMode('tree')"
                >▤</button>
                <span class="mesh-action-sep"></span>
                <button
                  class="mesh-icon-btn expand-collapse-btn"
                  :disabled="meshViewMode !== 'tree'"
                  title="全部展开"
                  @click="expandAllTreeGroups"
                >
                  <span class="expand-collapse-icon expand-all-icon"></span>
                </button>
                <button
                  class="mesh-icon-btn expand-collapse-btn"
                  :disabled="meshViewMode !== 'tree'"
                  title="全部折叠"
                  @click="collapseAllTreeGroups"
                >
                  <span class="expand-collapse-icon collapse-all-icon"></span>
                </button>
              </div>
            </div>

            <template v-if="meshViewMode === 'flat'">
              <div
                v-for="node in meshNodes"
                :key="node.key"
                class="tree-item"
                :class="{ selected: selectedMeshKey === node.key, hidden: !node.visible }"
                :data-mesh-key="node.key"
                @click="selectMesh(node)"
              >
                <button
                  class="vis-btn"
                  :title="node.visible ? '隐藏' : '显示'"
                  @click.stop="toggleMeshVis(node)"
                >{{ node.visible ? '👁' : '🚫' }}</button>
                <button class="fit-btn" title="适应窗口" @click.stop="fitMeshToWindow(node.key)">⊞</button>
                <span class="node-name">{{ node.name || `Mesh ${node.id}` }}</span>
              </div>
            </template>

            <template v-else>
              <div
                v-for="row in visibleMeshTreeRows"
                :key="row.key"
                class="tree-item"
                :class="{
                  selected: row.type === 'mesh' && selectedMeshKey === row.meshKey,
                  'tree-group': row.type === 'node',
                  hidden: !row.visible,
                }"
                :data-mesh-key="row.meshKey"
                :style="{ paddingLeft: `${18 + row.level * 22}px` }"
                @click="row.type === 'node' ? toggleTreeGroup(row.key) : row.meshKey !== null && selectMeshByKey(row.meshKey)"
              >
                <template v-if="row.type === 'mesh' && row.meshKey !== null">
                  <button
                    class="vis-btn"
                    :title="isMeshVisible(row.meshKey) ? '隐藏' : '显示'"
                    @click.stop="toggleMeshVisByKey(row.meshKey)"
                  >{{ isMeshVisible(row.meshKey) ? '👁' : '🚫' }}</button>
                  <button class="fit-btn" title="适应窗口" @click.stop="fitMeshToWindow(row.meshKey)">⊞</button>
                  <span class="node-name">{{ row.name }}</span>
                </template>
                <template v-else>
                  <span class="tree-branch">{{ row.hasChildren ? (isTreeGroupExpanded(row.key) ? '▾' : '▸') : '' }}</span>
                  <button
                    class="vis-btn"
                    :title="row.visible ? '隐藏' : '显示'"
                    @click.stop="row.nodeKey && toggleNodeVisByKey(row.nodeKey)"
                  >{{ row.visible ? '👁' : '🚫' }}</button>
                  <span class="node-name">{{ row.name }}</span>
                </template>
              </div>
            </template>
          </template>
        </div>

        <button class="panel-toggle left-toggle" @click="showLeftPanel = !showLeftPanel">
          {{ showLeftPanel ? '◀' : '▶' }}
        </button>
      </aside>

      <div
        v-if="modelLoaded && showLeftPanel"
        class="panel-resizer panel-resizer-left"
        title="拖动调整左侧面板宽度"
        @pointerdown="startPanelResize('left', $event)"
      ></div>

      <!-- 3D 视口 -->
      <div ref="viewerEl" class="viewport"></div>

      <div
        v-if="modelLoaded && showRightPanel"
        class="panel-resizer panel-resizer-right"
        title="拖动调整右侧面板宽度"
        @pointerdown="startPanelResize('right', $event)"
      ></div>

      <!-- 右侧详情面板 -->
      <aside
        v-if="modelLoaded"
        class="panel panel-right"
        :class="{ collapsed: !showRightPanel }"
        :style="showRightPanel ? { width: `${rightPanelWidth}px` } : undefined"
      >
        <button class="panel-toggle right-toggle" @click="showRightPanel = !showRightPanel">
          {{ showRightPanel ? '▶' : '◀' }}
        </button>

        <div class="panel-tabs">
          <button
            class="panel-tab"
            :class="{ active: rightTab === 'details' }"
            title="详情"
            @click="rightTab = 'details'"
          >📊</button>
          <button
            class="panel-tab"
            :class="{ active: rightTab === 'settings' }"
            title="设置"
            @click="rightTab = 'settings'"
          >⚙️</button>
        </div>

        <div v-if="showRightPanel" class="panel-body">
          <!-- 详情 -->
          <template v-if="rightTab === 'details'">
            <div class="panel-section-title">Details</div>
            <table class="detail-table">
              <tbody>
                <template v-for="group in detailGroups" :key="group.name">
                  <tr v-if="group.name" class="detail-group-row">
                    <td colspan="2">{{ group.name }}</td>
                  </tr>
                  <tr v-for="row in group.rows" :key="`${group.name}-${row.name}`">
                    <td>{{ row.name }}</td>
                    <td class="val">
                      <a
                        v-if="row.kind === 'calculated'"
                        class="calc-link"
                        @click="row.calculate?.()"
                      >{{ row.value }}</a>
                      <span v-else>{{ row.value }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </template>

          <!-- 设置 -->
          <template v-if="rightTab === 'settings'">
            <div class="panel-section-title">背景颜色</div>
            <div class="color-swatches">
              <button
                v-for="c in bgColors"
                :key="c"
                class="swatch"
                :style="{ background: c }"
                :class="{ active: currentBg === c }"
                @click="setBgColor(c)"
              ></button>
            </div>

            <div class="panel-section-title">显示边线</div>
            <label class="setting-toggle">
              <input v-model="showEdges" type="checkbox" @change="applyEdges" />
              <span>显示模型边线</span>
            </label>
          </template>
        </div>
      </aside>
    </div>

    <!-- ═══ 文件选择器 ═══ -->
    <input ref="fileInputEl" type="file" multiple class="hidden-input" @change="onFileChange" />

    <!-- ═══ 拖拽遮罩 ═══ -->
    <Transition name="fade">
      <div v-if="isDragging" class="drag-overlay">
        <div class="drag-hint">释放文件以加载模型</div>
      </div>
    </Transition>

    <!-- ═══ 空状态引导 ═══ -->
    <Transition name="fade">
      <div v-if="!modelLoaded && !isLoading" class="empty-state">
        <div class="empty-icon">📦</div>
        <p class="empty-title">拖拽文件到此处，或点击工具栏 📂 打开</p>
        <p class="empty-sub">支持 FBX / glTF / OBJ / STL / IFC / STEP / 3DM / 3MF 等 20+ 格式</p>
      </div>
    </Transition>

    <!-- ═══ 加载中 ═══ -->
    <Transition name="fade">
      <div v-if="isLoading" class="loading-overlay">
        <div class="spinner"></div>
        <span>模型加载中…</span>
      </div>
    </Transition>

    <!-- ═══ 错误提示 ═══ -->
    <Transition name="fade">
      <div v-if="errorMsg" class="error-toast" @click="errorMsg = ''">{{ errorMsg }}</div>
    </Transition>

    <!-- ═══ 关于弹窗 ═══ -->
    <Transition name="fade">
      <div v-if="showAbout" class="modal-mask" @click.self="showAbout = false">
        <div class="modal-card">
          <h3>3D Viewer</h3>
          <p>基于 <a href="https://github.com/kovacsv/Online3DViewer" target="_blank" rel="noopener">Online3DViewer</a> 引擎</p>
          <p>支持 20+ 种 3D 文件格式的在线预览。</p>
          <button class="modal-close" @click="showAbout = false">关闭</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import * as OV from 'online-3d-viewer'

// ─── 环境贴图 ───
const envUrls = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'].map(
  (s) => `/envmaps/fishermans_bastion/${s}.jpg`,
)

// ─── 背景色预设 ───
const bgColors = ['#f3f4f6', '#ffffff', '#e2e8f0', '#1e293b', '#0f172a', '#18181b', '#dbeafe', '#dcfce7']

// ─── 响应式状态 ───
const viewerEl = ref<HTMLElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)

const isLoading = ref(false)
const modelLoaded = ref(false)
const errorMsg = ref('')
const isDragging = ref(false)
const showAbout = ref(false)

const fileName = ref('')
const loadedFiles = ref<string[]>([])

// 工具栏状态
const projMode = ref<'perspective' | 'orthographic'>('perspective')
const showEdges = ref(false)
const currentBg = ref('#f3f4f6')

// 面板状态
const showLeftPanel = ref(true)
const showRightPanel = ref(true)
const leftPanelWidth = ref(390)
const rightPanelWidth = ref(300)
const isResizingPanel = ref(false)
const leftTab = ref<'files' | 'meshes'>('meshes')
const rightTab = ref<'details' | 'settings'>('details')
const hasHierarchicalMeshTree = ref(false)

// 网格树
interface MeshNode {
  key: string
  id: InstanceId
  name: string
  nodeId: number
  meshIndex: number
  visible: boolean
  parentNodeKeys: string[]
}

interface MeshTreeRow {
  key: string
  name: string
  level: number
  type: 'node' | 'mesh'
  meshKey: string | null
  nodeId: number | null
  nodeKey: string | null
  parentNodeKeys: string[]
  visible: boolean
  hasChildren: boolean
}

interface DetailRow {
  name: string
  value: string
  kind?: 'normal' | 'calculated'
  calculate?: () => void
}

interface DetailGroup {
  name: string
  rows: DetailRow[]
}

type InstanceId = OV.MeshInstanceId
type ModelObject = {
  VertexCount?: () => number
  LineSegmentCount?: () => number
  TriangleCount?: () => number
  PropertyGroupCount?: () => number
  GetPropertyGroup?: (index: number) => {
    name: string
    PropertyCount: () => number
    GetProperty: (index: number) => unknown
  }
}

const meshNodes = ref<MeshNode[]>([])
const meshTreeRows = ref<MeshTreeRow[]>([])
const selectedMeshKey = ref<string | null>(null)
const meshViewMode = ref<'flat' | 'tree'>('tree')
const expandedTreeGroups = ref<Set<string>>(new Set())
const treeScrollerEl = ref<HTMLElement | null>(null)

const meshNodeByKey = new Map<string, MeshNode>()
const nodeMeshKeysByNodeKey = new Map<string, string[]>()
const nodeRowsByKey = new Map<string, MeshTreeRow>()
const highlightColor = new OV.RGBColor(142, 201, 240)

const meshVisibilityMap = computed(() => {
  const map = new Map<string, boolean>()
  for (const node of meshNodes.value) {
    map.set(node.key, node.visible)
  }
  return map
})

const visibleMeshTreeRows = computed(() => {
  const expanded = expandedTreeGroups.value
  return meshTreeRows.value.filter((row) => {
    if (row.parentNodeKeys.length === 0) return true
    return row.parentNodeKeys.every((groupKey) => expanded.has(groupKey))
  })
})

// 详情面板
const detailGroups = ref<DetailGroup[]>([])

let embeddedViewer: OV.EmbeddedViewer | null = null
let resizeObserver: ResizeObserver | null = null

// ─── 格式化与模型辅助 ───
const getModel = () => embeddedViewer?.GetModel() as (OV.Model & Record<string, unknown>) | null

const getInternalViewer = (): OV.Viewer | null => (embeddedViewer?.GetViewer() as OV.Viewer) ?? null

const getNameOrDefault = (name: string | null | undefined, fallback = 'No Name') => {
  const normalized = (name ?? '').trim()
  return normalized.length > 0 ? normalized : fallback
}

const getMeshDisplayName = (nodeName: string, meshName: string) => {
  return getNameOrDefault(nodeName.length > 0 ? nodeName : meshName)
}

const unitToString = (unit: number) => {
  switch (unit) {
    case OV.Unit.Millimeter:
      return 'Millimeter'
    case OV.Unit.Centimeter:
      return 'Centimeter'
    case OV.Unit.Meter:
      return 'Meter'
    case OV.Unit.Inch:
      return 'Inch'
    case OV.Unit.Foot:
      return 'Foot'
    default:
      return 'Unknown'
  }
}

const propertyToDisplayString = (property: unknown) => {
  const prop = property as { type?: number; value?: unknown }
  if (prop.type === OV.PropertyType.Color) {
    const color = prop.value as OV.RGBColor
    return `#${OV.RGBColorToHexString(color)}`
  }
  const value = OV.PropertyToString(property)
  return value === null || value === undefined ? '-' : String(value)
}

const getBoxSize = (object3D: ModelObject) => {
  const box = OV.GetBoundingBox(object3D)
  return {
    x: Math.abs((box.max?.x ?? 0) - (box.min?.x ?? 0)),
    y: Math.abs((box.max?.y ?? 0) - (box.min?.y ?? 0)),
    z: Math.abs((box.max?.z ?? 0) - (box.min?.z ?? 0)),
  }
}

const getMeshKeyFromUserData = (userData: unknown): string | null => {
  if (!userData || typeof userData !== 'object') return null
  const id = (userData as { originalMeshInstance?: { id?: InstanceId } }).originalMeshInstance?.id
  return id?.GetKey?.() ?? null
}

const isMeshKeyVisible = (meshKey: string | null) => {
  if (meshKey === null) return false
  return meshVisibilityMap.value.get(meshKey) ?? true
}

const isUserDataVisible = (userData: unknown) => {
  const meshKey = getMeshKeyFromUserData(userData)
  return isMeshKeyVisible(meshKey)
}

const createCalculatedRow = (name: string, calculateValue: () => OV.Property | null): DetailRow => {
  const row: DetailRow = {
    name,
    value: 'Calculate...',
    kind: 'calculated',
    calculate: () => {
      row.value = 'Please wait...'
      row.kind = 'normal'
      OV.RunTaskAsync(() => {
        const result = calculateValue()
        row.value = result === null ? '-' : propertyToDisplayString(result)
      })
    },
  }
  return row
}

const showObjectDetails = (object3D: ModelObject | null) => {
  if (object3D === null) {
    detailGroups.value = []
    return
  }

  const model = getModel()
  const size = getBoxSize(object3D)
  const baseRows: DetailRow[] = [
    { name: 'Vertices', value: (object3D.VertexCount?.() ?? 0).toLocaleString() },
  ]

  const lineSegmentCount = object3D.LineSegmentCount?.() ?? 0
  if (lineSegmentCount > 0) {
    baseRows.push({ name: 'Lines', value: lineSegmentCount.toLocaleString() })
  }

  const triangleCount = object3D.TriangleCount?.() ?? 0
  if (triangleCount > 0) {
    baseRows.push({ name: 'Triangles', value: triangleCount.toLocaleString() })
  }

  const unit = model?.GetUnit?.() ?? OV.Unit.Unknown
  if (unit !== OV.Unit.Unknown) {
    baseRows.push({ name: 'Unit', value: unitToString(unit) })
  }

  baseRows.push(
    { name: 'Size X', value: propertyToDisplayString(new OV.Property(OV.PropertyType.Number, null, size.x)) },
    { name: 'Size Y', value: propertyToDisplayString(new OV.Property(OV.PropertyType.Number, null, size.y)) },
    { name: 'Size Z', value: propertyToDisplayString(new OV.Property(OV.PropertyType.Number, null, size.z)) },
    createCalculatedRow('Volume', () => {
      if (!OV.IsTwoManifold(object3D)) return null
      return new OV.Property(OV.PropertyType.Number, null, OV.CalculateVolume(object3D))
    }),
    createCalculatedRow('Surface', () => {
      return new OV.Property(OV.PropertyType.Number, null, OV.CalculateSurfaceArea(object3D))
    }),
  )

  const groups: DetailGroup[] = [{ name: '', rows: baseRows }]
  const propertyGroupCount = object3D.PropertyGroupCount?.() ?? 0
  for (let groupIndex = 0; groupIndex < propertyGroupCount; groupIndex++) {
    const propertyGroup = object3D.GetPropertyGroup?.(groupIndex)
    if (!propertyGroup) continue
    const rows: DetailRow[] = []
    for (let propertyIndex = 0; propertyIndex < propertyGroup.PropertyCount(); propertyIndex++) {
      const property = propertyGroup.GetProperty(propertyIndex) as { name?: string }
      rows.push({
        name: property.name ?? '',
        value: propertyToDisplayString(property),
      })
    }
    groups.push({
      name: propertyGroup.name,
      rows,
    })
  }

  detailGroups.value = groups
}

const updateMeshesSelection = () => {
  const viewer = getInternalViewer()
  if (!viewer) return
  const activeKey = selectedMeshKey.value
  viewer.SetMeshesHighlight?.(highlightColor, (userData: unknown) => {
    return activeKey !== null && getMeshKeyFromUserData(userData) === activeKey
  })
}

const clearSelection = () => {
  selectedMeshKey.value = null
  updateMeshesSelection()
  showObjectDetails(getModel())
}

const expandParentsForMesh = (meshKey: string) => {
  const node = meshNodeByKey.get(meshKey)
  if (!node) return
  const next = new Set(expandedTreeGroups.value)
  for (const parentNodeKey of node.parentNodeKeys) {
    next.add(parentNodeKey)
  }
  expandedTreeGroups.value = next
}

const scrollMeshIntoView = (meshKey: string) => {
  void nextTick(() => {
    const scroller = treeScrollerEl.value
    if (!scroller) return
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-mesh-key]'))
    const row = rows.find((item) => item.dataset.meshKey === meshKey)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

const selectMeshByKey = (meshKey: string, scrollToTree = false) => {
  const node = meshNodeByKey.get(meshKey)
  if (!node) return

  if (selectedMeshKey.value === meshKey) {
    clearSelection()
    return
  }

  selectedMeshKey.value = meshKey
  leftTab.value = 'meshes'
  rightTab.value = 'details'
  expandParentsForMesh(meshKey)
  updateMeshesSelection()

  const meshInstance = getModel()?.GetMeshInstance?.(node.id) as ModelObject | null
  showObjectDetails(meshInstance)
  if (scrollToTree) scrollMeshIntoView(meshKey)
}

const configureViewerSelectionHandlers = () => {
  const viewer = getInternalViewer()
  if (!viewer) return
  viewer.SetMouseClickHandler?.((button: number, mouseCoordinates: OV.Coord2D) => {
    if (button !== 1) return
    const meshUserData = viewer.GetMeshUserDataUnderMouse?.(OV.IntersectionMode.MeshAndLine, mouseCoordinates)
    const meshKey = getMeshKeyFromUserData(meshUserData)
    if (meshKey === null) {
      clearSelection()
      return
    }
    selectMeshByKey(meshKey, true)
  })
}

// ─── Viewer 生命周期 ───
const createViewer = () => {
  if (!viewerEl.value) return
  destroyViewer()

  embeddedViewer = new OV.EmbeddedViewer(viewerEl.value, {
    camera: new OV.Camera(
      new OV.Coord3D(-1.5, 2.0, 3.0),
      new OV.Coord3D(0.0, 0.0, 0.0),
      new OV.Coord3D(0.0, 1.0, 0.0),
      45.0,
    ),
    backgroundColor: new OV.RGBAColor(243, 244, 246, 255),
    defaultColor: new OV.RGBColor(200, 200, 200),
    edgeSettings: new OV.EdgeSettings(false, new OV.RGBColor(0, 0, 0), 1),
    environmentSettings: new OV.EnvironmentSettings(envUrls, false),
    onModelLoaded: () => {
      isLoading.value = false
      modelLoaded.value = true
      refreshModelInfo()
      fitToWindowInternal(false)
    },
    onModelLoadFailed: () => {
      isLoading.value = false
      errorMsg.value = '模型加载失败，请检查文件是否完整或格式是否支持。'
    },
  })

  configureViewerSelectionHandlers()
}

const destroyViewer = () => {
  if (embeddedViewer) {
    embeddedViewer.Destroy()
    embeddedViewer = null
  }
}

// ─── 模型信息 ───
const refreshModelInfo = () => {
  const model = getModel()
  if (!model) return

  selectedMeshKey.value = null
  meshNodeByKey.clear()
  nodeMeshKeysByNodeKey.clear()
  nodeRowsByKey.clear()

  // 平级网格列表 + 树状网格列表
  const nodes: MeshNode[] = []
  const treeRows: MeshTreeRow[] = []
  const root = model.GetRootNode?.()
  if (root) {
    hasHierarchicalMeshTree.value = false
    for (const childNode of root.GetChildNodes?.() ?? []) {
      if ((childNode.ChildNodeCount?.() ?? 0) > 0 || (childNode.MeshIndexCount?.() ?? 0) > 1) {
        hasHierarchicalMeshTree.value = true
        break
      }
    }
    meshViewMode.value = hasHierarchicalMeshTree.value ? 'tree' : 'flat'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectMeshKeys = (node: any, result: string[]) => {
      for (let i = 0; i < (node.MeshIndexCount?.() ?? 0); i++) {
        const meshIndex = node.GetMeshIndex?.(i)
        if (meshIndex === undefined) continue
        result.push(new OV.MeshInstanceId(node.GetId(), meshIndex).GetKey())
      }
      for (const child of node.GetChildNodes?.() ?? []) {
        collectMeshKeys(child, result)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addMeshRow = (node: any, level: number, parentNodeKeys: string[], meshIndex: number) => {
      const nodeId = node.GetId?.()
      const mesh = model.GetMesh?.(meshIndex)
      const meshName = getMeshDisplayName(node.GetName?.() ?? '', mesh?.GetName?.() ?? '')
      const meshId = new OV.MeshInstanceId(nodeId, meshIndex)
      const meshKey = meshId.GetKey()
      const meshNode: MeshNode = {
        key: meshKey,
        id: meshId,
        name: meshName,
        nodeId,
        meshIndex,
        visible: true,
        parentNodeKeys,
      }
      nodes.push(meshNode)
      meshNodeByKey.set(meshKey, meshNode)
      treeRows.push({
        key: `mesh-${meshKey}`,
        name: meshName,
        level,
        type: 'mesh',
        meshKey,
        nodeId,
        nodeKey: null,
        parentNodeKeys,
        visible: true,
        hasChildren: false,
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createNodeRow = (node: any, level: number, parentNodeKeys: string[]) => {
      const nodeName = getNameOrDefault(node.GetName?.(), 'No Name')
      const childCount = node.ChildNodeCount?.() ?? 0
      const meshCount = node.MeshIndexCount?.() ?? 0
      const nodeId = node.GetId?.()
      const nodeKey = `node-${nodeId}`
      const descendantMeshKeys: string[] = []
      collectMeshKeys(node, descendantMeshKeys)
      nodeMeshKeysByNodeKey.set(nodeKey, descendantMeshKeys)
      const row: MeshTreeRow = {
        key: nodeKey,
        name: nodeName,
        level,
        type: 'node',
        meshKey: null,
        nodeId,
        nodeKey,
        parentNodeKeys,
        visible: true,
        hasChildren: childCount > 0 || meshCount > 0,
      }
      nodeRowsByKey.set(nodeKey, row)
      treeRows.push(row)
      return nodeKey
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walkFlatNode = (node: any) => {
      for (const child of node.GetChildNodes?.() ?? []) {
        walkFlatNode(child)
      }
      for (const meshIndex of node.GetMeshIndices?.() ?? []) {
        addMeshRow(node, 0, [], meshIndex)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walkTreeNode = (node: any, parentNodeKeys: string[], level: number) => {
      const childMeshNodes: unknown[] = []
      for (const childNode of node.GetChildNodes?.() ?? []) {
        if (childNode.IsMeshNode?.()) {
          childMeshNodes.push(childNode)
        } else {
          const nodeKey = createNodeRow(childNode, level, parentNodeKeys)
          walkTreeNode(childNode, [...parentNodeKeys, nodeKey], level + 1)
        }
      }

      for (const meshNode of childMeshNodes) {
        walkTreeNode(meshNode, parentNodeKeys, level)
      }

      for (const meshIndex of node.GetMeshIndices?.() ?? []) {
        addMeshRow(node, level, parentNodeKeys, meshIndex)
      }
    }

    if (hasHierarchicalMeshTree.value) {
      for (const childNode of root.GetChildNodes?.() ?? []) {
        if (childNode.IsMeshNode?.()) {
          walkTreeNode(childNode, [], 0)
        } else {
          const nodeKey = createNodeRow(childNode, 0, [])
          walkTreeNode(childNode, [nodeKey], 1)
        }
      }
      for (const meshIndex of root.GetMeshIndices?.() ?? []) {
        addMeshRow(root, 0, [], meshIndex)
      }
    } else {
      walkFlatNode(root)
    }
  }
  meshNodes.value = nodes
  meshTreeRows.value = treeRows
  expandedTreeGroups.value = new Set()

  showObjectDetails(model)
  updateMeshesSelection()
}

// ─── 文件加载 ───
const loadFiles = (files: FileList) => {
  if (!files.length) return
  if (!embeddedViewer) createViewer()
  errorMsg.value = ''
  isLoading.value = true
  modelLoaded.value = false
  selectedMeshKey.value = null
  detailGroups.value = []
  meshNodes.value = []
  meshTreeRows.value = []
  meshNodeByKey.clear()
  nodeMeshKeysByNodeKey.clear()
  nodeRowsByKey.clear()
  updateMeshesSelection()

  const names: string[] = []
  for (let i = 0; i < files.length; i++) names.push(files[i]!.name)
  loadedFiles.value = names
  fileName.value = names[0] ?? ''

  embeddedViewer!.LoadModelFromFileList(Array.from(files))
}

const pickFile = () => fileInputEl.value?.click()

const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files) loadFiles(input.files)
  input.value = ''
}

// ─── 拖拽 ───
const onDragOver = (e: DragEvent) => {
  // dragover fires continuously; only update state when it actually changes.
  if (!isDragging.value) isDragging.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

const onDrop = (e: DragEvent) => {
  isDragging.value = false
  if (e.dataTransfer?.files) loadFiles(e.dataTransfer.files)
}

// ─── 工具栏操作 ───
const fitToWindowInternal = (animated = true) => {
  const v = getInternalViewer()
  if (!v) return
  const sphere = v.GetBoundingSphere?.(isUserDataVisible)
  if (!sphere) return
  if (!animated) v.AdjustClippingPlanesToSphere?.(sphere)
  v.FitSphereToWindow(sphere, animated)
}

const fitToWindow = () => {
  fitToWindowInternal(true)
}

const setUpY = () => getInternalViewer()?.SetUpVector?.(OV.Direction.Y, true)
const setUpZ = () => getInternalViewer()?.SetUpVector?.(OV.Direction.Z, true)
const flipUp = () => getInternalViewer()?.FlipUpVector?.()

const setProjection = (mode: 'perspective' | 'orthographic') => {
  const v = getInternalViewer()
  if (!v) return
  const m = mode === 'perspective' ? OV.ProjectionMode.Perspective : OV.ProjectionMode.Orthographic
  v.SetProjectionMode(m)
  projMode.value = mode
}

const toggleEdges = () => {
  showEdges.value = !showEdges.value
  applyEdges()
}

const applyEdges = () => {
  const v = getInternalViewer()
  if (!v) return
  v.SetEdgeSettings(new OV.EdgeSettings(showEdges.value, new OV.RGBColor(0, 0, 0), 1))
}

const snapshot = () => {
  const v = getInternalViewer()
  if (!v) return
  const size = v.GetImageSize?.()
  if (!size) return
  const dataUrl = v.GetImageAsDataUrl(size.width, size.height, false)
  if (!dataUrl) return
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${fileName.value || 'snapshot'}.png`
  a.click()
}

// ─── 背景颜色 ───
const hexToRgba = (hex: string): OV.RGBAColor => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return new OV.RGBAColor(r, g, b, 255)
}

const setBgColor = (hex: string) => {
  currentBg.value = hex
  getInternalViewer()?.SetBackgroundColor?.(hexToRgba(hex))
}

// ─── 网格操作 ───
const selectMesh = (node: MeshNode) => {
  selectMeshByKey(node.key)
}

const isMeshVisible = (meshKey: string) => {
  return meshVisibilityMap.value.get(meshKey) ?? true
}

const applyMeshVisibility = () => {
  const v = getInternalViewer()
  if (!v) return

  v.SetMeshesVisibility?.((userData: unknown) => isUserDataVisible(userData))
  fitToVisibleModelIfSelectionHidden()
}

const toggleMeshVis = (node: MeshNode) => {
  node.visible = !node.visible
  updateNodeVisibilityFromMeshes()
  applyMeshVisibility()
}

const toggleMeshVisByKey = (meshKey: string) => {
  const node = meshNodeByKey.get(meshKey)
  if (!node) return
  toggleMeshVis(node)
}

const toggleNodeVisByKey = (nodeKey: string) => {
  const meshKeys = nodeMeshKeysByNodeKey.get(nodeKey) ?? []
  const row = nodeRowsByKey.get(nodeKey)
  const nextVisible = !(row?.visible ?? true)
  for (const meshKey of meshKeys) {
    const meshNode = meshNodeByKey.get(meshKey)
    if (meshNode) meshNode.visible = nextVisible
  }
  updateNodeVisibilityFromMeshes()
  applyMeshVisibility()
}

const isTreeGroupExpanded = (groupKey: string) => expandedTreeGroups.value.has(groupKey)

const toggleTreeGroup = (groupKey: string) => {
  if (!groupKey) return
  const next = new Set(expandedTreeGroups.value)
  if (next.has(groupKey)) {
    next.delete(groupKey)
  } else {
    next.add(groupKey)
  }
  expandedTreeGroups.value = next
}

const setMeshViewMode = (mode: 'flat' | 'tree') => {
  meshViewMode.value = mode
  clearSelection()
}

const expandAllTreeGroups = () => {
  expandedTreeGroups.value = new Set(meshTreeRows.value.filter((row) => row.type === 'node').map((row) => row.key))
}

const collapseAllTreeGroups = () => {
  expandedTreeGroups.value = new Set()
}

const updateNodeVisibilityFromMeshes = () => {
  for (const row of meshTreeRows.value) {
    if (row.type === 'mesh' && row.meshKey !== null) {
      row.visible = meshNodeByKey.get(row.meshKey)?.visible ?? false
    }
  }
  for (const [nodeKey, meshKeys] of nodeMeshKeysByNodeKey) {
    const row = nodeRowsByKey.get(nodeKey)
    if (!row) continue
    row.visible = meshKeys.some((meshKey) => meshNodeByKey.get(meshKey)?.visible ?? false)
  }
  meshTreeRows.value = [...meshTreeRows.value]
  meshNodes.value = [...meshNodes.value]
}

const fitToVisibleModelIfSelectionHidden = () => {
  if (selectedMeshKey.value === null || isMeshKeyVisible(selectedMeshKey.value)) return
  clearSelection()
}

const fitMeshToWindow = (meshKey: string) => {
  const viewer = getInternalViewer()
  if (!viewer) return
  const sphere = viewer.GetBoundingSphere?.((userData: unknown) => getMeshKeyFromUserData(userData) === meshKey)
  if (sphere) viewer.FitSphereToWindow(sphere, true)
}

// ─── 尺寸响应 ───
const onResize = () => embeddedViewer?.Resize()

const clampPanelWidth = (width: number) => Math.min(620, Math.max(220, width))

const startPanelResize = (side: 'left' | 'right', event: PointerEvent) => {
  event.preventDefault()
  isResizingPanel.value = true
  const startX = event.clientX
  const startWidth = side === 'left' ? leftPanelWidth.value : rightPanelWidth.value
  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)

  const onPointerMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX
    const nextWidth = side === 'left' ? startWidth + delta : startWidth - delta
    if (side === 'left') {
      leftPanelWidth.value = clampPanelWidth(nextWidth)
    } else {
      rightPanelWidth.value = clampPanelWidth(nextWidth)
    }
    requestAnimationFrame(() => embeddedViewer?.Resize())
  }

  const stopResize = () => {
    isResizingPanel.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    embeddedViewer?.Resize()
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize, { once: true })
  window.addEventListener('pointercancel', stopResize, { once: true })
}

// ─── 生命周期 ───
onMounted(() => {
  createViewer()
  if (viewerEl.value) {
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(viewerEl.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  destroyViewer()
})
</script>

<style scoped>
/* ═══════ 全局布局 ═══════ */
.viewer-app {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f3f4f6;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #1e293b;
}

/* ═══════ Header ═══════ */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 14px;
  background: #1e293b;
  color: #e2e8f0;
  flex-shrink: 0;
}

.app-title {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
}

.header-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: #94a3b8;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right .icon-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
}

/* ═══════ 工具栏 ═══════ */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  padding: 0 8px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  overflow-x: auto;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: none;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}

.tb-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.tb-btn.active {
  background: #dbeafe;
  border-color: #93c5fd;
}

.tb-sep {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 4px;
  flex-shrink: 0;
}

/* ═══════ 主体 ═══════ */
.main-body {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.main-body.resizing {
  cursor: col-resize;
  user-select: none;
}

.main-body.resizing .panel {
  transition: none;
}

/* ═══════ 面板通用 ═══════ */
.panel {
  display: flex;
  flex-direction: column;
  background: #fff;
  width: 300px;
  min-width: 0;
  transition: width 0.2s;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.panel.collapsed {
  width: 36px;
}

.panel-left {
  border-right: 1px solid #e2e8f0;
}

.panel-right {
  border-left: 1px solid #e2e8f0;
}

.panel-resizer {
  width: 6px;
  flex: 0 0 6px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 4;
}

.panel-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #e5e7eb;
}

.panel-resizer-left::before {
  left: 0;
}

.panel-resizer-right::before {
  right: 0;
}

.panel-resizer:hover {
  background: rgba(37, 147, 209, 0.08);
}

.panel-resizer:hover::before {
  background: #3393bd;
}

.panel-tabs {
  display: flex;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.panel-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 15px;
  opacity: 0.5;
  transition: all 0.15s;
}

.panel-tab:hover {
  background: #f1f5f9;
}

.panel-tab.active {
  opacity: 1;
  background: #fff;
  box-shadow: inset 0 -2px 0 #2563eb;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.panel-section-title {
  padding: 10px 0 12px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0;
  color: #111827;
}

.mesh-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.mesh-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
}

.mesh-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: none;
  background: transparent;
  color: #425466;
  border-radius: 3px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.mesh-icon-btn:hover:not(:disabled) {
  background: #f1f5f9;
}

.mesh-icon-btn.active {
  color: #3393bd;
  background: #f3f4f6;
}

.mesh-icon-btn:disabled {
  color: #cbd5e1;
  cursor: default;
}

.expand-collapse-btn {
  position: relative;
}

.expand-collapse-icon {
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
}

.expand-collapse-icon::before,
.expand-collapse-icon::after {
  content: '';
  position: absolute;
  left: 4px;
  width: 10px;
  height: 10px;
  border-color: currentColor;
  border-style: solid;
  transform: rotate(45deg);
}

.expand-all-icon::before,
.expand-all-icon::after {
  border-width: 0 2px 2px 0;
}

.expand-all-icon::before {
  top: 1px;
}

.expand-all-icon::after {
  top: 7px;
}

.collapse-all-icon::before,
.collapse-all-icon::after {
  border-width: 2px 0 0 2px;
}

.collapse-all-icon::before {
  top: 4px;
}

.collapse-all-icon::after {
  top: 10px;
}

.mesh-action-sep {
  width: 1px;
  height: 22px;
  margin: 0 8px;
  background: #e5e7eb;
}

.panel-toggle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  font-size: 10px;
  color: #64748b;
  z-index: 3;
  border-radius: 0 4px 4px 0;
}

.left-toggle {
  right: -18px;
}

.right-toggle {
  left: -18px;
  border-radius: 4px 0 0 4px;
}

/* ═══════ 树节点 ═══════ */
.tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 18px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-item:hover {
  background: #f1f5f9;
}

.tree-item.selected {
  background: #eeeeee;
}

.tree-item.tree-group {
  color: #333333;
  font-weight: 400;
  cursor: default;
}

.tree-item.hidden {
  color: #94a3b8;
}

.tree-branch {
  width: 18px;
  color: #475569;
  font-size: 20px;
  line-height: 1;
  text-align: center;
  flex-shrink: 0;
}

.vis-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #7b8794;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

.vis-btn:hover {
  color: #334155;
}

.fit-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

.fit-btn:hover {
  color: #2563eb;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ═══════ 详情表格 ═══════ */
.detail-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 18px;
}

.detail-table td {
  padding: 6px 0;
  border-bottom: none;
  line-height: 1.4;
}

.detail-table .val {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #1f2937;
  font-weight: 400;
  padding-left: 28px;
  white-space: nowrap;
}

.detail-group-row td {
  padding-top: 18px;
  color: #111827;
  background: transparent;
  font-size: 18px;
  font-weight: 600;
  text-align: left;
  text-transform: none;
}

.calc-link {
  color: #3393bd;
  cursor: pointer;
  text-decoration: none;
}

.calc-link:hover {
  text-decoration: underline;
}

/* ═══════ 设置面板 ═══════ */
.color-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
}

.swatch {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 2px solid #e2e8f0;
  cursor: pointer;
  transition: border-color 0.12s;
}

.swatch:hover {
  border-color: #94a3b8;
}

.swatch.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
}

.setting-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

/* ═══════ 3D 视口 ═══════ */
.viewport {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.hidden-input {
  display: none;
}

/* ═══════ 拖拽遮罩 ═══════ */
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(37, 99, 235, 0.12);
  border: 3px dashed #2563eb;
  pointer-events: none;
}

.drag-hint {
  padding: 16px 28px;
  border-radius: 12px;
  font-size: 18px;
  font-weight: 600;
  color: #1e40af;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

/* ═══════ 空状态 ═══════ */
.empty-state {
  position: absolute;
  inset: 0;
  top: 78px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
}

.empty-icon {
  font-size: 56px;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 16px;
  color: #334155;
  margin: 0 0 6px;
}

.empty-sub {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}

/* ═══════ 加载 ═══════ */
.loading-overlay {
  position: absolute;
  inset: 0;
  top: 78px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(243, 244, 246, 0.7);
  z-index: 15;
  font-size: 15px;
  color: #334155;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ═══════ 错误 ═══════ */
.error-toast {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 25;
  max-width: 480px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  cursor: pointer;
}

/* ═══════ 弹窗 ═══════ */
.modal-mask {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}

.modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px 28px;
  max-width: 360px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  text-align: center;
}

.modal-card h3 {
  margin: 0 0 10px;
  font-size: 18px;
}

.modal-card p {
  margin: 0 0 8px;
  color: #475569;
  font-size: 13px;
}

.modal-card a {
  color: #2563eb;
}

.modal-close {
  margin-top: 12px;
  border: none;
  border-radius: 8px;
  padding: 6px 20px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}

/* ═══════ 过渡 ═══════ */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
