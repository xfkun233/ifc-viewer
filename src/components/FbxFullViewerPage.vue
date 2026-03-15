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
    <div class="main-body">
      <!-- 左侧导航面板 -->
      <aside v-if="modelLoaded" class="panel panel-left" :class="{ collapsed: !showLeftPanel }">
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

        <div v-if="showLeftPanel" class="panel-body">
          <!-- 文件列表 -->
          <template v-if="leftTab === 'files'">
            <div class="panel-section-title">文件</div>
            <div v-for="f in loadedFiles" :key="f" class="tree-item">{{ f }}</div>
          </template>

          <!-- 网格树 -->
          <template v-if="leftTab === 'meshes'">
            <div class="panel-section-title mesh-header">
              <span>网格 ({{ meshNodes.length }})</span>
              <div class="mesh-view-switch">
                <button
                  class="mini-btn"
                  :class="{ active: meshViewMode === 'flat' }"
                  @click="meshViewMode = 'flat'"
                >平级</button>
                <button
                  class="mini-btn"
                  :class="{ active: meshViewMode === 'tree' }"
                  @click="meshViewMode = 'tree'"
                >树状</button>
              </div>
            </div>

            <template v-if="meshViewMode === 'flat'">
              <div
                v-for="node in meshNodes"
                :key="node.id"
                class="tree-item"
                :class="{ selected: selectedMeshId === node.id }"
                @click="selectMesh(node)"
              >
                <button
                  class="vis-btn"
                  :title="node.visible ? '隐藏' : '显示'"
                  @click.stop="toggleMeshVis(node)"
                >{{ node.visible ? '👁' : '🚫' }}</button>
                <span class="node-name">{{ node.name || `Mesh ${node.id}` }}</span>
              </div>
            </template>

            <template v-else>
              <div
                v-for="row in visibleMeshTreeRows"
                :key="row.key"
                class="tree-item"
                :class="{
                  selected: row.type === 'mesh' && selectedMeshId === row.meshId,
                  'tree-group': row.type === 'group',
                }"
                :style="{ paddingLeft: `${12 + row.level * 14}px` }"
                @click="row.type === 'group' ? toggleTreeGroup(row.groupKey) : row.meshId !== null && selectMeshById(row.meshId)"
              >
                <template v-if="row.type === 'mesh' && row.meshId !== null">
                  <button
                    class="vis-btn"
                    :title="isMeshVisible(row.meshId) ? '隐藏' : '显示'"
                    @click.stop="toggleMeshVisById(row.meshId)"
                  >{{ isMeshVisible(row.meshId) ? '👁' : '🚫' }}</button>
                  <span class="node-name">{{ row.name }}</span>
                </template>
                <template v-else>
                  <span class="tree-branch">{{ isTreeGroupExpanded(row.groupKey) ? '▾' : '▸' }}</span>
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

      <!-- 3D 视口 -->
      <div ref="viewerEl" class="viewport"></div>

      <!-- 右侧详情面板 -->
      <aside v-if="modelLoaded" class="panel panel-right" :class="{ collapsed: !showRightPanel }">
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
                <tr><td>Vertices</td><td class="val">{{ formatNum(details.vertices) }}</td></tr>
                <tr><td>Triangles</td><td class="val">{{ formatNum(details.triangles) }}</td></tr>
                <tr v-if="details.meshes > 0"><td>Meshes</td><td class="val">{{ formatNum(details.meshes) }}</td></tr>
                <tr><td>Size X</td><td class="val">{{ details.sizeX }}</td></tr>
                <tr><td>Size Y</td><td class="val">{{ details.sizeY }}</td></tr>
                <tr><td>Size Z</td><td class="val">{{ details.sizeZ }}</td></tr>
                <tr>
                  <td>Volume</td>
                  <td class="val">
                    <span v-if="details.volume !== null">{{ details.volume }}</span>
                    <a v-else class="calc-link" @click="calcVolume">Calculate…</a>
                  </td>
                </tr>
                <tr>
                  <td>Surface</td>
                  <td class="val">
                    <span v-if="details.surface !== null">{{ details.surface }}</span>
                    <a v-else class="calc-link" @click="calcSurface">Calculate…</a>
                  </td>
                </tr>
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
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
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
const leftTab = ref<'files' | 'meshes'>('meshes')
const rightTab = ref<'details' | 'settings'>('details')

// 网格树
interface MeshNode {
  id: number
  name: string
  visible: boolean
}

interface MeshTreeRow {
  key: string
  name: string
  level: number
  type: 'group' | 'mesh'
  meshId: number | null
  groupKey: string
  parentGroupKeys: string[]
}

const meshNodes = ref<MeshNode[]>([])
const meshTreeRows = ref<MeshTreeRow[]>([])
const selectedMeshId = ref<number | null>(null)
const meshViewMode = ref<'flat' | 'tree'>('tree')
const expandedTreeGroups = ref<Set<string>>(new Set())

const meshVisibilityMap = computed(() => {
  const map = new Map<number, boolean>()
  for (const node of meshNodes.value) {
    map.set(node.id, node.visible)
  }
  return map
})

const visibleMeshTreeRows = computed(() => {
  const expanded = expandedTreeGroups.value
  return meshTreeRows.value.filter((row) => {
    if (row.parentGroupKeys.length === 0) return true
    return row.parentGroupKeys.every((groupKey) => expanded.has(groupKey))
  })
})

// 详情面板
const details = reactive({
  vertices: 0,
  triangles: 0,
  meshes: 0,
  sizeX: '0',
  sizeY: '0',
  sizeZ: '0',
  volume: null as string | null,
  surface: null as string | null,
})

let embeddedViewer: OV.EmbeddedViewer | null = null
let resizeObserver: ResizeObserver | null = null

// ─── 格式化数字 ───
const formatNum = (n: number) => n.toLocaleString()
const formatDim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '')

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
      fitToWindowInternal(false)
      isLoading.value = false
      modelLoaded.value = true
      refreshModelInfo()
    },
    onModelLoadFailed: () => {
      isLoading.value = false
      errorMsg.value = '模型加载失败，请检查文件是否完整或格式是否支持。'
    },
  })
}

const destroyViewer = () => {
  if (embeddedViewer) {
    embeddedViewer.Destroy()
    embeddedViewer = null
  }
}

const getInternalViewer = (): OV.Viewer | null => (embeddedViewer?.GetViewer() as OV.Viewer) ?? null

// ─── 模型信息 ───
const refreshModelInfo = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = embeddedViewer?.GetModel() as Record<string, any> | null
  if (!model) return

  details.vertices = model.VertexCount?.() ?? 0
  details.triangles = model.TriangleCount?.() ?? 0
  details.meshes = model.MeshInstanceCount?.() ?? 0
  details.volume = null
  details.surface = null

  // 平级网格列表 + 树状网格列表
  const nodes: MeshNode[] = []
  const treeRows: MeshTreeRow[] = []
  const root = model.GetRootNode?.()
  if (root) {
    let idCounter = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walkNode = (node: any, level: number, parentGroupKeys: string[]) => {
      const nodeName = node.GetName?.() || 'Node'
      const childCount = node.ChildNodeCount?.() ?? 0
      const meshCount = node.MeshIndexCount?.() ?? 0
      const nodeId = node.GetId?.() ?? `${nodeName}-${level}`
      const groupKey = `group-${nodeId}-${level}`
      const nextParentGroupKeys = [...parentGroupKeys, groupKey]

      treeRows.push({
        key: groupKey,
        name: nodeName,
        level,
        type: 'group',
        meshId: null,
        groupKey,
        parentGroupKeys,
      })

      for (let i = 0; i < meshCount; i++) {
        const meshName = meshCount > 1 ? `${nodeName} [${i + 1}]` : nodeName
        const meshId = idCounter++
        nodes.push({
          id: meshId,
          name: meshName,
          visible: true,
        })
        treeRows.push({
          key: `mesh-${meshId}`,
          name: meshName,
          level: level + 1,
          type: 'mesh',
          meshId,
          groupKey: '',
          parentGroupKeys: nextParentGroupKeys,
        })
      }

      for (let i = 0; i < childCount; i++) {
        const child = node.GetChildNode?.(i)
        if (child) walkNode(child, level + 1, nextParentGroupKeys)
      }
    }

    walkNode(root, 0, [])
  }
  meshNodes.value = nodes
  meshTreeRows.value = treeRows
  expandedTreeGroups.value = new Set()

  // 包围盒尺寸
  const v = getInternalViewer()
  if (v) {
    const bbox = v.GetBoundingBox?.(() => true)
    if (bbox) {
      const size = { x: 0, y: 0, z: 0 }
      try { bbox.getSize(size) } catch { /* ignore */ }
      // THREE.Box3.getSize returns THREE.Vector3
      if (size) {
        details.sizeX = formatDim(Math.abs(size.x ?? 0))
        details.sizeY = formatDim(Math.abs(size.y ?? 0))
        details.sizeZ = formatDim(Math.abs(size.z ?? 0))
      }
    }
  }
}

// ─── 文件加载 ───
const loadFiles = (files: FileList) => {
  if (!files.length) return
  if (!embeddedViewer) createViewer()
  errorMsg.value = ''
  isLoading.value = true
  modelLoaded.value = false

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
  const sphere = v.GetBoundingSphere?.(() => true)
  if (sphere) v.FitSphereToWindow(sphere, animated)
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
  selectedMeshId.value = node.id
}

const selectMeshById = (id: number) => {
  selectedMeshId.value = id
}

const isMeshVisible = (meshId: number) => {
  return meshVisibilityMap.value.get(meshId) ?? true
}

const applyMeshVisibility = () => {
  const v = getInternalViewer()
  if (!v) return

  const visMap = new Set(meshNodes.value.filter((n) => n.visible).map((n) => n.id))
  let idx = 0
  v.SetMeshesVisibility?.((() => {
    const isVis = visMap.has(idx)
    idx++
    return isVis
  }) as unknown as (userData: unknown) => boolean)
}

const toggleMeshVis = (node: MeshNode) => {
  node.visible = !node.visible
  applyMeshVisibility()
}

const toggleMeshVisById = (meshId: number) => {
  const node = meshNodes.value.find((n) => n.id === meshId)
  if (!node) return
  node.visible = !node.visible
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

// ─── 体积 / 面积计算 ───
const calcVolume = () => {
  const model = embeddedViewer?.GetModel()
  if (!model) return
  const vol = OV.CalculateVolume(model)
  details.volume = vol != null ? formatDim(vol) : 'N/A'
}

const calcSurface = () => {
  const model = embeddedViewer?.GetModel()
  if (!model) return
  const area = OV.CalculateSurfaceArea(model)
  details.surface = area != null ? formatDim(area) : 'N/A'
}

// ─── 尺寸响应 ───
const onResize = () => embeddedViewer?.Resize()

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

/* ═══════ 面板通用 ═══════ */
.panel {
  display: flex;
  flex-direction: column;
  background: #fff;
  width: 240px;
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
  padding: 6px 0;
}

.panel-section-title {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
}

.mesh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mesh-view-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mini-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  cursor: pointer;
}

.mini-btn.active {
  border-color: #93c5fd;
  background: #dbeafe;
  color: #1d4ed8;
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
  gap: 6px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-item:hover {
  background: #f1f5f9;
}

.tree-item.selected {
  background: #dbeafe;
}

.tree-item.tree-group {
  color: #475569;
  font-weight: 600;
  cursor: default;
}

.tree-branch {
  width: 12px;
  color: #64748b;
  flex-shrink: 0;
}

.vis-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  flex-shrink: 0;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ═══════ 详情表格 ═══════ */
.detail-table {
  width: 100%;
  border-collapse: collapse;
  padding: 0 12px;
}

.detail-table td {
  padding: 5px 12px;
  border-bottom: 1px solid #f1f5f9;
}

.detail-table .val {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #2563eb;
  font-weight: 500;
}

.calc-link {
  color: #2563eb;
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
