<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as THREE from 'three'
import * as OBC from '@thatopen/components'
import * as OBCF from '@thatopen/components-front'
import * as BUI from '@thatopen/ui'
import * as BUIOBC from '@thatopen/ui-obc'
import type { FragmentsModel } from '@thatopen/fragments'
import {
  ElMessage,
  ElDescriptions,
  ElDescriptionsItem,
  ElButton,
  ElButtonGroup,
  ElTooltip,
  ElEmpty,
  ElUpload,
  ElIcon,
  ElDivider,
  ElInput,
  ElDialog,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElTable,
  ElTableColumn,
  ElPopconfirm,
} from 'element-plus'
import {
  Upload,
  ZoomIn,
  ZoomOut,
  Refresh,
  View,
  Hide,
  Select,
  Scissor,
  FullScreen,
  Delete,
  Plus,
  Download,
  Edit,
  Document,
  Search,
  Aim,
} from '@element-plus/icons-vue'
import {
  type IfcLineageMetadata,
  type PendingPropertyWrite,
  type ParsedCustomProperty,
  type AnnotationPoint,
  computeIfcSourceFingerprint,
  createUpdatedIfcBlob,
  downloadIfcBlob,
  hasCustomDataSection,
  parseIfcLineageMetadata,
  parseCustomProperties,
  parseAnnotationsFromCustomSection,
} from '@/utils/ifcExporter'
import {
  bootstrapModelOverlays,
  completeModelSnapshotSync,
  failModelSnapshotSync,
  deleteModelAnnotation,
  deleteModelCustomProperty,
  fetchPersistedModelFile,
  getModelOverlays,
  listPersistedModels,
  startModelSnapshotSync,
  uploadIfcModel,
  uploadModelSnapshotChunk,
  upsertModelAnnotation,
  upsertModelCustomProperty,
} from '@/services/api'
import { extractIfcSnapshotChunk, getAllIfcExpressIds } from '@/services/ifcSnapshot'
import type {
  AnnotationMutation,
  CustomPropertyMutation,
  IfcSnapshotElement,
  PersistedAnnotation,
  PersistedCustomProperty,
  PersistedModelSummary,
} from '@/types/persistence'

// 初始化 ThatOpen UI
BUI.Manager.init()

// 类型定义
interface PropertyRecord {
  [key: string]: string | number
}

interface CustomProperty {
  name: string
  value: string | number
  type: 'string' | 'number' | 'boolean'
}

interface PersistedPendingProperty extends PendingPropertyWrite {
  databaseId?: string
}

// 响应式状态
const viewerContainer = ref<HTMLElement | null>(null)
const spatialTreeContainer = ref<HTMLElement | null>(null)
const selectedProperties = ref<PropertyRecord>({})
const isLoading = ref(false)
const hasModel = ref(false)
const clippingEnabled = ref(false)
const treeFilterText = ref('')
const moveSpeed = ref(3)
const turnSpeed = ref(1.5)
const isWalking = ref(false)
const persistedModels = ref<PersistedModelSummary[]>([])
const activePersistedModelId = ref<string | null>(null)
const activePersistedModelSummary = ref<PersistedModelSummary | null>(null)
const isPersistingModel = ref(false)
const isSyncingModelSnapshot = ref(false)
const snapshotSyncProgress = ref('')

// 自定义属性相关状态
const showPropertyDialog = ref(false)
const showPropertyManager = ref(false) // 属性管理器对话框
const customProperties = ref<CustomProperty[]>([])
const newPropertyName = ref('')
const newPropertyValue = ref('')
const newPropertyType = ref<'string' | 'number' | 'boolean'>('string')
const selectedExpressId = ref<number | null>(null)
const selectedModelId = ref<string | null>(null)
const psetName = ref('CustomProperties')

// 编辑属性相关状态
const editingProperty = ref<{ index: number; psetIndex: number } | null>(null)
const editPropertyName = ref('')
const editPropertyValue = ref('')
const editPropertyType = ref<'string' | 'number' | 'boolean'>('string')

// 待写入属性列表（使用新的数据结构）
const pendingProperties = ref<PersistedPendingProperty[]>([])

// 从IFC文件解析的自定义属性（只读，用于回显）
const loadedCustomProperties = ref<ParsedCustomProperty[]>([])

// 内联编辑状态（用于右侧面板属性编辑）
const inlineEditingKey = ref<string | null>(null)
const inlineEditValue = ref<string>('')

// 搜索过滤
const propertySearchText = ref('')

// ThatOpen UI 空间树组件
let spatialTreeElement: HTMLElement | null = null
let updateSpatialTree: ((state: Partial<BUIOBC.SpatialTreeState>) => void) | null = null

// 类型定义
type IFCWorld = OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>

// OBC 组件实例
let components: OBC.Components | null = null
let currentIfcFileName: string = 'model' // 保存原始 IFC 文件名（不含扩展名）

let world: IFCWorld | null = null
let fragmentsManager: OBC.FragmentsManager | null = null
let ifcLoader: OBC.IfcLoader | null = null
let highlighter: OBCF.Highlighter | null = null
let clipper: OBC.Clipper | null = null
let currentModel: FragmentsModel | null = null
let walkAnimationId: number | null = null
const moveKeys = new Set<string>()
const walkClock = new THREE.Clock()
const walkTarget = new THREE.Vector3()

// ==================== 标注功能状态 ====================
const annotationMode = ref(false)
const annotations = ref<AnnotationPoint[]>([])
const showAnnotationDialog = ref(false)
const annotationText = ref('')
const pendingAnnotationPosition = ref<{ x: number; y: number; z: number } | null>(null)
const showAnnotationPopup = ref(false)
const annotationPopupInfo = ref<AnnotationPoint | null>(null)
const annotationPopupStyle = ref({ left: '0px', top: '0px' })
let annotationGroup: THREE.Group | null = null
const annotationMarkerMap = new Map<THREE.Mesh, AnnotationPoint>()

// 保存原始 IFC 数据用于后续文本操作导出
let currentIfcData: Uint8Array | null = null
let currentIfcLineageMetadata: IfcLineageMetadata | null = null
let snapshotSyncQueue: Promise<void> = Promise.resolve()
let persistedModelsRefreshTimer: number | null = null

// 初始化查看器
async function initViewer() {
  if (!viewerContainer.value) return

  try {
    // 创建组件系统
    components = new OBC.Components()

    // 创建世界
    const worlds = components.get(OBC.Worlds)
    world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>() as IFCWorld

    // 设置场景
    world.scene = new OBC.SimpleScene(components)
    world.scene.setup()
    world.scene.three.background = new THREE.Color(0xf0f0f0)

    // 设置渲染器
    world.renderer = new OBCF.PostproductionRenderer(components, viewerContainer.value)
    const { postproduction } = world.renderer

    // 设置相机
    world.camera = new OBC.OrthoPerspectiveCamera(components)
    await world.camera.controls?.setLookAt(12, 6, 8, 0, 0, 0)

    // 启用组件
    components.init()

    // 启用后期处理
    postproduction.enabled = true

    // 添加网格
    const grids = components.get(OBC.Grids)
    grids.create(world)

    // 设置 FragmentsManager - 使用本地 worker 文件
    fragmentsManager = components.get(OBC.FragmentsManager)
    const workerUrl = new URL('/wasm/fragment-worker.mjs', import.meta.url).href
    fragmentsManager.init(workerUrl)

    // 相机停止时更新 fragments
    world.camera.controls?.addEventListener('rest', () => {
      fragmentsManager?.core.update(true)
    })

    // 相机变化时更新模型
    world.onCameraChanged.add((camera) => {
      for (const [, model] of fragmentsManager!.list) {
        model.useCamera(camera.three)
      }
      fragmentsManager?.core.update(true)
    })

    // 模型加载后添加到场景
    fragmentsManager.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world!.camera.three as THREE.PerspectiveCamera | THREE.OrthographicCamera)
      world!.scene.three.add(model.object)
      fragmentsManager?.core.update(true)
      // 更新空间树
      updateModelTree()
    })

    // 设置 IFC 加载器 - 使用本地 WASM 文件
    ifcLoader = components.get(OBC.IfcLoader)
    await ifcLoader.setup({
      autoSetWasm: false,
      wasm: {
        path: '/wasm/',
        absolute: true,
      },
    })

    // 设置 Raycasters
    const casters = components.get(OBC.Raycasters)
    casters.get(world)

    // 设置高亮器
    highlighter = components.get(OBCF.Highlighter)
    highlighter.setup({ world })

    // 监听选择事件
    highlighter.events.select?.onHighlight.add((data) => {
      handleSelection(data)
    })

    highlighter.events.select?.onClear.add(() => {
      selectedProperties.value = {}
    })

    // 设置裁剪器
    clipper = components.get(OBC.Clipper)
    clipper.enabled = false

    // 初始化标注组
    annotationGroup = new THREE.Group()
    annotationGroup.name = 'annotations'
    world.scene.three.add(annotationGroup)

    // 双击事件：根据当前模式分发给标注或剖切
    viewerContainer.value.ondblclick = () => {
      if (annotationMode.value) {
        handleAnnotationDoubleClick()
      } else if (clipper && clippingEnabled.value && world) {
        clipper.create(world)
      }
    }

    // 单击事件：检测标注点击
    viewerContainer.value.addEventListener('click', handleAnnotationClick)

    // 监听键盘事件（删除剖切面 + 行走）
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // 初始化行走目标
    if (world.camera?.controls?.getTarget) {
      world.camera.controls.getTarget(walkTarget)
    } else {
      const dir = new THREE.Vector3()
      world.camera.three.getWorldDirection(dir)
      walkTarget.copy(world.camera.three.position).add(dir.multiplyScalar(10))
    }

    // 启动行走更新循环
    startWalkLoop()

    // 初始化空间树组件
    initSpatialTree()

    // 调整窗口大小
    window.addEventListener('resize', handleResize)
  } catch (error) {
    console.error('初始化查看器失败:', error)
    ElMessage.error('初始化查看器失败')
  }
}

// 初始化空间树组件
function initSpatialTree() {
  if (!components || !fragmentsManager || !spatialTreeContainer.value) return

  const [table, updateFn] = BUIOBC.tables.spatialTree(
    {
      components,
      models: [],
      selectHighlighterName: 'select'
    },
    true
  )

  spatialTreeElement = table
  updateSpatialTree = updateFn

  // 配置表格样式
  table.preserveStructureOnFilter = true
  table.indentationInText = true

  // 清空容器并添加表格
  spatialTreeContainer.value.innerHTML = ''
  spatialTreeContainer.value.appendChild(table)
}

// 更新模型树
function updateModelTree() {
  if (!updateSpatialTree || !fragmentsManager) return

  const models = Array.from(fragmentsManager.list.values())
  updateSpatialTree({
    models
  })
  hasModel.value = models.length > 0
}

// 处理选择
async function handleSelection(
  data: Map<string, Set<number>> | Record<string, Set<number> | number[]>
) {
  if (!fragmentsManager) return

  try {
    let modelId: string | undefined
    let expressId: number | undefined

    const getFirstId = (ids?: Set<number> | number[]) => {
      if (!ids) return undefined
      const arr = Array.isArray(ids) ? ids : Array.from(ids)
      return arr.length > 0 ? arr[0] : undefined
    }

    if (data instanceof Map) {
      for (const [id, ids] of data.entries()) {
        modelId = id
        expressId = getFirstId(ids)
        break
      }
    } else {
      for (const [id, ids] of Object.entries(data)) {
        modelId = id
        expressId = getFirstId(ids as Set<number> | number[])
        break
      }
    }

    if (!modelId || expressId === undefined) return

    // 保存当前选中的元素信息
    selectedModelId.value = modelId
    selectedExpressId.value = expressId

    // 取消内联编辑状态
    inlineEditingKey.value = null

    const model = fragmentsManager.list.get(modelId)
    if (!model) return

    const props = await getElementProperties(model, expressId)
    if (props) {
      // 追加该构件的待写入自定义属性到显示（使用特殊标记表示可编辑）
      const pendingForElement = getPendingPropertiesForElement(expressId)
      for (const p of pendingForElement) {
        const displayKey = `✏️ ${p.psetName}.${p.propertyName}`
        props[displayKey] = typeof p.value === 'boolean' ? String(p.value) : p.value
      }
      selectedProperties.value = props
    }
  } catch (error) {
    console.error('处理选择失败:', error)
  }
}

// 获取元素属性（包括基本属性和属性集）
async function getElementProperties(
  model: FragmentsModel,
  expressId: number
): Promise<PropertyRecord | null> {
  try {
    const properties: PropertyRecord = {}
    properties['Express ID'] = expressId

    // 第一步：获取基本属性和 IsDefinedBy 关系（属性集列表）
    const itemsData = await model.getItemsData([expressId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: false }
      },
      relationsDefault: { attributes: false, relations: false }
    })

    if (itemsData && itemsData.length > 0) {
      const data = itemsData[0] as Record<string, unknown>
      if (data) {
        // 提取基本属性
        for (const [key, value] of Object.entries(data)) {
          if (key === 'IsDefinedBy') continue // 跳过关系数据，单独处理
          if (typeof value === 'object' && value !== null && 'value' in value) {
            const attr = value as { value: string | number; type?: string }
            properties[key] = attr.value
          }
        }

        // 处理 IsDefinedBy 关系（属性集）
        const isDefinedBy = data.IsDefinedBy as Array<Record<string, unknown>> | undefined

        if (isDefinedBy && Array.isArray(isDefinedBy)) {
          // 收集所有属性集的 localId
          const psetIds: number[] = []
          const psetNameMap: Map<number, string> = new Map()

          for (const pset of isDefinedBy) {
            // _localId 是 { value: number } 格式
            const localIdRaw = pset?._localId as { value?: number } | undefined
            const localId = localIdRaw?.value
            const psetNameAttr = pset?.Name as { value?: string } | undefined
            if (localId) {
              psetIds.push(localId)
              psetNameMap.set(localId, psetNameAttr?.value || 'PropertySet')
            }
          }

          // 第二步：获取属性集的 HasProperties 和 Quantities
          if (psetIds.length > 0) {
            const psetData = await model.getItemsData(psetIds, {
              attributesDefault: false,
              relations: {
                HasProperties: { attributes: true, relations: false },
                Quantities: { attributes: true, relations: false }
              },
              relationsDefault: { attributes: false, relations: false }
            })

            if (psetData) {
              for (let i = 0; i < psetData.length; i++) {
                const pset = psetData[i] as Record<string, unknown>
                const psetId = psetIds[i]!
                const psetDisplayName = psetNameMap.get(psetId) || 'PropertySet'

                // 处理 HasProperties（IfcPropertySet 的属性列表）
                const hasProperties = pset?.HasProperties as Array<Record<string, unknown>> | undefined

                if (hasProperties && Array.isArray(hasProperties)) {
                  // 收集属性的 localId，需要第三次查询获取详细信息
                  const propIds: number[] = []
                  for (const prop of hasProperties) {
                    const propLocalId = prop?._localId as { value?: number } | undefined
                    if (propLocalId?.value) {
                      propIds.push(propLocalId.value)
                    }
                  }

                  if (propIds.length > 0) {
                    // 第三次查询：获取属性的 Name 和 NominalValue
                    const propData = await model.getItemsData(propIds, {
                      attributesDefault: true,
                      relationsDefault: { attributes: false, relations: false }
                    })

                    if (propData) {
                      for (const prop of propData) {
                        const propRecord = prop as Record<string, unknown>
                        const propNameAttr = propRecord?.Name as { value?: string } | undefined
                        const propName = propNameAttr?.value

                        // 获取 NominalValue（属性值）
                        const nominalValue = propRecord?.NominalValue as { value?: string | number } | undefined

                        if (propName && nominalValue?.value !== undefined) {
                          const displayKey = `${psetDisplayName}.${propName}`
                          properties[displayKey] = nominalValue.value
                        }
                      }
                    }
                  }
                }

                // 处理 Quantities（IfcElementQuantity 的数量属性）
                const quantities = pset?.Quantities as Array<Record<string, unknown>> | undefined
                if (quantities && Array.isArray(quantities)) {
                  // 收集数量属性的 localId
                  const qtyIds: number[] = []
                  for (const qty of quantities) {
                    const qtyLocalId = qty?._localId as { value?: number } | undefined
                    if (qtyLocalId?.value) {
                      qtyIds.push(qtyLocalId.value)
                    }
                  }

                  if (qtyIds.length > 0) {
                    // 查询数量属性的详细信息
                    const qtyData = await model.getItemsData(qtyIds, {
                      attributesDefault: true,
                      relationsDefault: { attributes: false, relations: false }
                    })

                    if (qtyData) {
                      for (const qty of qtyData) {
                        const qtyRecord = qty as Record<string, unknown>
                        const qtyNameAttr = qtyRecord?.Name as { value?: string } | undefined
                        const qtyName = qtyNameAttr?.value

                        // 尝试获取不同类型的数量值
                        const lengthValue = qtyRecord?.LengthValue as { value?: number } | undefined
                        const areaValue = qtyRecord?.AreaValue as { value?: number } | undefined
                        const volumeValue = qtyRecord?.VolumeValue as { value?: number } | undefined
                        const countValue = qtyRecord?.CountValue as { value?: number } | undefined
                        const weightValue = qtyRecord?.WeightValue as { value?: number } | undefined

                        const qtyValue = lengthValue?.value ?? areaValue?.value ?? volumeValue?.value ?? countValue?.value ?? weightValue?.value

                        if (qtyName && qtyValue !== undefined) {
                          const displayKey = `${psetDisplayName}.${qtyName}`
                          properties[displayKey] = qtyValue
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return properties
  } catch (error) {
    console.error('获取属性失败:', error)
    return { 'Express ID': expressId }
  }
}

// ==================== 自定义属性功能 ====================

// 打开添加属性对话框
function openPropertyDialog() {
  if (!selectedExpressId.value) {
    ElMessage.warning('请先选择一个构件')
    return
  }
  // 重置表单
  customProperties.value = []
  psetName.value = 'CustomProperties'
  showPropertyDialog.value = true
}

// 打开属性管理器
function openPropertyManager() {
  showPropertyManager.value = true
}

// 添加自定义属性到列表
function addPropertyToList() {
  if (!newPropertyName.value.trim()) {
    ElMessage.warning('请输入属性名称')
    return
  }
  if (!newPropertyValue.value.toString().trim()) {
    ElMessage.warning('请输入属性值')
    return
  }

  // 检查是否已存在同名属性
  const exists = customProperties.value.some(p => p.name === newPropertyName.value.trim())
  if (exists) {
    ElMessage.warning('该属性名称已存在')
    return
  }

  let value: string | number = newPropertyValue.value
  if (newPropertyType.value === 'number') {
    value = parseFloat(newPropertyValue.value.toString())
    if (isNaN(value)) {
      ElMessage.warning('请输入有效的数字')
      return
    }
  }

  customProperties.value.push({
    name: newPropertyName.value.trim(),
    value,
    type: newPropertyType.value
  })

  // 清空输入
  newPropertyName.value = ''
  newPropertyValue.value = ''
}

// 删除自定义属性
function removeProperty(index: number) {
  customProperties.value.splice(index, 1)
}

// ==================== 基于文本的 IFC 属性操作（更可靠） ====================

// 映射本地类型到导出器类型
function mapValueType(type: 'string' | 'number' | 'boolean'): PendingPropertyWrite['valueType'] {
  switch (type) {
    case 'string': return 'LABEL'
    case 'number': return 'REAL'
    case 'boolean': return 'BOOLEAN'
    default: return 'LABEL'
  }
}

// 映射导出器类型到本地类型
function mapValueTypeReverse(type: PendingPropertyWrite['valueType']): 'string' | 'number' | 'boolean' {
  switch (type) {
    case 'STRING':
    case 'LABEL': return 'string'
    case 'REAL':
    case 'INTEGER': return 'number'
    case 'BOOLEAN': return 'boolean'
    default: return 'string'
  }
}

function toCustomPropertyMutation(prop: PendingPropertyWrite, expressId?: number): CustomPropertyMutation {
  const normalizedExpressId =
    expressId ?? Number.parseInt(prop.elementId.replace('#', ''), 10)

  return {
    expressId: normalizedExpressId,
    psetName: prop.psetName,
    propertyName: prop.propertyName,
    valueType: prop.valueType,
    value: prop.value,
  }
}

function toAnnotationMutation(annotation: AnnotationPoint): AnnotationMutation {
  return {
    clientId: annotation.id,
    x: annotation.x,
    y: annotation.y,
    z: annotation.z,
    text: annotation.text,
  }
}

function applyPersistedCustomProperties(properties: PersistedCustomProperty[]) {
  pendingProperties.value = properties.map((property) => ({
    databaseId: property.id,
    elementId: `#${property.expressId}`,
    psetName: property.psetName,
    propertyName: property.propertyName,
    value: property.value,
    valueType: property.valueType,
  }))
}

function applyPersistedAnnotations(items: PersistedAnnotation[]) {
  annotations.value = items.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    z: item.z,
    text: item.text,
  }))
}

async function refreshPersistedModels() {
  try {
    persistedModels.value = await listPersistedModels()
    activePersistedModelSummary.value = activePersistedModelId.value
      ? persistedModels.value.find((model) => model.id === activePersistedModelId.value) ?? activePersistedModelSummary.value
      : null
    snapshotSyncProgress.value = describePersistedModelSync(activePersistedModelSummary.value)
  } catch (error) {
    console.warn('获取持久化模型列表失败:', error)
  }
}

function describePersistedModelSync(model: PersistedModelSummary | null | undefined) {
  if (!model) {
    return ''
  }

  if (model.syncStatus === 'READY') {
    return `后端同步已完成，已保存 ${model.totalElements} 个构件 / ${model.totalProperties} 条属性`
  }

  if (model.syncStatus === 'FAILED') {
    return '后端同步失败，可在同步队列页面重试'
  }

  if (model.syncStatus === 'PROCESSING') {
    if (model.totalElements > 0) {
      return `后端同步中 ${model.syncProcessedElements}/${model.totalElements} 个构件`
    }

    return '后端正在解析模型属性...'
  }

  return '模型已上传，等待后端同步队列处理'
}

async function buildCurrentIfcLineageMetadata(): Promise<IfcLineageMetadata | null> {
  if (!currentIfcData) {
    return null
  }

  const baseContentHash = await computeIfcSourceFingerprint(currentIfcData)
  return {
    schemaVersion: 1,
    sourceFingerprint: activePersistedModelSummary.value?.sourceFingerprint
      ?? currentIfcLineageMetadata?.sourceFingerprint
      ?? baseContentHash,
    baseContentHash,
    importedFileHash: activePersistedModelSummary.value?.fileHash
      ?? currentIfcLineageMetadata?.importedFileHash
      ?? null,
    exporter: 'ifc-viewer',
    exportedAt: new Date().toISOString(),
  }
}

function enqueueModelSnapshotSync(modelId: string, model: FragmentsModel) {
  snapshotSyncQueue = snapshotSyncQueue
    .catch(() => undefined)
    .then(() => syncModelSnapshotToServer(modelId, model))

  return snapshotSyncQueue
}

async function hydratePersistedOverlays(modelId: string) {
  const overlays = await getModelOverlays(modelId)
  applyPersistedCustomProperties(overlays.customProperties)
  applyPersistedAnnotations(overlays.annotations)
  loadAnnotationMarkers()
}

async function bootstrapPersistedOverlays(
  modelId: string,
  parsedProperties: ParsedCustomProperty[],
  parsedAnnotations: AnnotationPoint[],
) {
  if (parsedProperties.length === 0 && parsedAnnotations.length === 0) {
    await hydratePersistedOverlays(modelId)
    return
  }

  const overlays = await bootstrapModelOverlays(modelId, {
    customProperties: parsedProperties.map((property) => ({
      expressId: Number.parseInt(property.elementId.replace('#', ''), 10),
      psetName: property.psetName,
      propertyName: property.propertyName,
      valueType: property.valueType,
      value: property.value,
    })),
    annotations: parsedAnnotations.map(toAnnotationMutation),
  })

  applyPersistedCustomProperties(overlays.customProperties)
  applyPersistedAnnotations(overlays.annotations)
  loadAnnotationMarkers()
}

const snapshotUploadChunkSize = 40
const snapshotUploadMaxPayloadBytes = 4 * 1024 * 1024

function estimateSnapshotPayloadBytes(elements: IfcSnapshotElement[]): number {
  return new TextEncoder().encode(JSON.stringify({ chunkIndex: 0, elements })).length
}

function splitSnapshotElementsForUpload(elements: IfcSnapshotElement[]): IfcSnapshotElement[][] {
  if (elements.length === 0) {
    return []
  }

  const groups: IfcSnapshotElement[][] = []
  let currentGroup: IfcSnapshotElement[] = []

  for (const element of elements) {
    const nextGroup = [...currentGroup, element]
    if (currentGroup.length > 0 && estimateSnapshotPayloadBytes(nextGroup) > snapshotUploadMaxPayloadBytes) {
      groups.push(currentGroup)
      currentGroup = [element]
      continue
    }

    currentGroup = nextGroup
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

async function syncModelSnapshotToServer(modelId: string, model: FragmentsModel) {
  isSyncingModelSnapshot.value = true
  snapshotSyncProgress.value = '正在提取构件属性并同步到数据库...'

  try {
    const allExpressIds = await getAllIfcExpressIds(model)
    const batchSize = snapshotUploadChunkSize
    const totalChunks = Math.max(1, Math.ceil(allExpressIds.length / batchSize))
    let totalProperties = 0
    let processedElements = 0
    let uploadedChunkIndex = 0

    await startModelSnapshotSync(modelId, {
      totalElements: allExpressIds.length,
      totalChunks,
    })

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const chunkIds = allExpressIds.slice(chunkIndex * batchSize, (chunkIndex + 1) * batchSize)
      const elements = await extractIfcSnapshotChunk(model, chunkIds)
      totalProperties += elements.reduce((sum, element) => sum + element.properties.length, 0)

      const uploadGroups = splitSnapshotElementsForUpload(elements)
      const uploadChunkIndexStart = uploadedChunkIndex
      uploadedChunkIndex += uploadGroups.length

      await Promise.all(
        uploadGroups.map((uploadGroup, index) =>
          uploadModelSnapshotChunk(modelId, {
            chunkIndex: uploadChunkIndexStart + index,
            elements: uploadGroup,
          }),
        ),
      )

      snapshotSyncProgress.value = `属性同步中 ${chunkIndex + 1}/${totalChunks}`
      processedElements += chunkIds.length
      snapshotSyncProgress.value = `属性同步中 ${processedElements}/${allExpressIds.length} 个构件`
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    await completeModelSnapshotSync(modelId, {
      totalElements: allExpressIds.length,
      totalProperties,
    })

    snapshotSyncProgress.value = '属性同步完成'
    await refreshPersistedModels()
    ElMessage.success('模型全部构件属性已同步到数据库')
  } catch (error) {
    console.error('同步模型属性失败:', error)
    const reason = error instanceof Error ? error.message : 'Snapshot sync failed'
    try {
      await failModelSnapshotSync(modelId, { reason })
      await refreshPersistedModels()
    } catch (statusError) {
      console.error('回写模型同步失败状态失败:', statusError)
    }
    snapshotSyncProgress.value = '属性同步失败'
    ElMessage.error(`模型属性同步失败: ${reason}`)
  } finally {
    isSyncingModelSnapshot.value = false
  }
}



// 获取某个构件的待写入属性
function getPendingPropertiesForElement(expressId: number): PendingPropertyWrite[] {
  return pendingProperties.value.filter(
    p => p.elementId === `#${expressId}` || p.elementId === String(expressId)
  )
}

// 获取某个构件+属性集的待写入属性
function getPendingPropertiesForPset(expressId: number, psetNameStr: string): PendingPropertyWrite[] {
  return pendingProperties.value.filter(
    p => (p.elementId === `#${expressId}` || p.elementId === String(expressId)) && p.psetName === psetNameStr
  )
}

// 获取某个构件的所有待写入属性集名称
function getPendingPsetNames(expressId: number): string[] {
  const props = getPendingPropertiesForElement(expressId)
  return [...new Set(props.map(p => p.psetName))]
}

// 过滤后的属性列表
const filteredPendingProperties = computed(() => {
  if (!propertySearchText.value.trim()) {
    return pendingProperties.value
  }
  const search = propertySearchText.value.toLowerCase()
  return pendingProperties.value.filter(p =>
    p.propertyName.toLowerCase().includes(search) ||
    p.psetName.toLowerCase().includes(search) ||
    p.elementId.includes(search) ||
    String(p.value).toLowerCase().includes(search)
  )
})

// 将自定义属性记录到待写入列表
async function writePropertiesToIfc() {
  if (!currentModel || !selectedExpressId.value) {
    ElMessage.error('无法写入属性：缺少必要信息')
    return
  }

  if (customProperties.value.length === 0) {
    ElMessage.warning('请先添加要写入的属性')
    return
  }

  if (!currentIfcData) {
    ElMessage.error('请先加载 IFC 模型')
    return
  }

  try {
    const currentPsetName = psetName.value.trim() || 'CustomProperties'
    const elementId = `#${selectedExpressId.value}`
    const persistedModelId = activePersistedModelId.value

    let addedCount = 0
    let skippedCount = 0

    for (const prop of customProperties.value) {
      // 检查是否已存在相同的属性
      const exists = pendingProperties.value.some(
        p => p.elementId === elementId &&
             p.psetName === currentPsetName &&
             p.propertyName === prop.name
      )

      if (exists) {
        skippedCount++
      } else {
        const draftProperty: PersistedPendingProperty = {
          elementId,
          psetName: currentPsetName,
          propertyName: prop.name,
          value: prop.value,
          valueType: mapValueType(prop.type),
        }

        if (persistedModelId) {
          const savedProperty = await upsertModelCustomProperty(
            persistedModelId,
            toCustomPropertyMutation(draftProperty, selectedExpressId.value),
          )
          draftProperty.databaseId = savedProperty.id
        }

        pendingProperties.value.push(draftProperty)
        addedCount++
      }
    }

    if (skippedCount > 0) {
      ElMessage.warning(`添加 ${addedCount} 个，跳过 ${skippedCount} 个已存在的属性`)
    } else {
      ElMessage.success(`已添加 ${addedCount} 个自定义属性到 "${currentPsetName}"`)
    }

    // 刷新属性显示
    await refreshSelectedProperties()

    // 清空并关闭对话框
    customProperties.value = []
    showPropertyDialog.value = false

  } catch (error) {
    console.error('添加属性失败:', error)
    ElMessage.error('添加属性失败: ' + (error as Error).message)
  }
}

// 刷新当前选中元素的属性显示
async function refreshSelectedProperties() {
  if (selectedModelId.value && selectedExpressId.value) {
    const model = fragmentsManager?.list.get(selectedModelId.value)
    if (model) {
      const props = await getElementProperties(model, selectedExpressId.value)
      if (props) {
        // 添加待写入的自定义属性到显示（使用特殊标记表示可编辑）
        const pending = getPendingPropertiesForElement(selectedExpressId.value)
        for (const p of pending) {
          const displayKey = `✏️ ${p.psetName}.${p.propertyName}`
          props[displayKey] = typeof p.value === 'boolean' ? String(p.value) : p.value
        }
        selectedProperties.value = props
      }
    }
  }
}

// 删除单个待写入属性
async function deletePendingProperty(property: PersistedPendingProperty) {
  const index = pendingProperties.value.indexOf(property)
  if (index === -1) return

  const targetProperty = pendingProperties.value[index]
  if (!targetProperty) return

  if (activePersistedModelId.value && targetProperty.databaseId) {
    await deleteModelCustomProperty(activePersistedModelId.value, targetProperty.databaseId)
  }

  pendingProperties.value.splice(index, 1)
  ElMessage.success('属性已删除')
  await refreshSelectedProperties()
}

// 清空所有待写入属性
async function clearAllPendingProperties() {
  if (activePersistedModelId.value) {
    const deletableIds = pendingProperties.value
      .map((property) => property.databaseId)
      .filter((id): id is string => Boolean(id))

    await Promise.all(
      deletableIds.map((propertyId) => deleteModelCustomProperty(activePersistedModelId.value!, propertyId)),
    )
  }

  pendingProperties.value = []
  ElMessage.success('已清空所有待写入属性')
  await refreshSelectedProperties()
}

// 开始编辑属性
function startEditProperty(prop: PersistedPendingProperty) {
  const index = pendingProperties.value.indexOf(prop)
  if (index === -1) return

  editingProperty.value = { index, psetIndex: 0 }
  editPropertyName.value = prop.propertyName
  editPropertyValue.value = String(prop.value)
  editPropertyType.value = mapValueTypeReverse(prop.valueType)
}

// 保存编辑的属性
async function saveEditProperty() {
  if (!editingProperty.value) return

  const { index } = editingProperty.value
  const prop = pendingProperties.value[index]

  if (!prop) return

  if (!editPropertyName.value.trim()) {
    ElMessage.warning('属性名称不能为空')
    return
  }

  let value: string | number | boolean = editPropertyValue.value
  if (editPropertyType.value === 'number') {
    value = parseFloat(editPropertyValue.value)
    if (isNaN(value)) {
      ElMessage.warning('请输入有效的数字')
      return
    }
  } else if (editPropertyType.value === 'boolean') {
    value = editPropertyValue.value.toLowerCase() === 'true'
  }

  const previousDatabaseId = prop.databaseId
  const previousPropertyName = prop.propertyName

  // 更新属性
  prop.propertyName = editPropertyName.value.trim()
  prop.value = value
  prop.valueType = mapValueType(editPropertyType.value)

  if (activePersistedModelId.value) {
    if (previousDatabaseId && previousPropertyName !== prop.propertyName) {
      await deleteModelCustomProperty(activePersistedModelId.value, previousDatabaseId)
      prop.databaseId = undefined
    }

    const savedProperty = await upsertModelCustomProperty(
      activePersistedModelId.value,
      toCustomPropertyMutation(prop),
    )
    prop.databaseId = savedProperty.id
  }

  editingProperty.value = null
  ElMessage.success('属性已更新')
  await refreshSelectedProperties()
}

// ==================== 内联编辑功能（右侧面板直接编辑） ====================

// 检查属性是否可编辑（以 ✏️ 开头表示自定义属性）
function isEditableProperty(key: string): boolean {
  return key.startsWith('✏️ ')
}

// 从显示键名中提取原始属性信息
function parseEditableKey(displayKey: string): { psetName: string; propertyName: string } | null {
  if (!displayKey.startsWith('✏️ ')) return null
  const rest = displayKey.slice(3) // 去掉 "✏️ "
  const dotIndex = rest.indexOf('.')
  if (dotIndex === -1) return null
  return {
    psetName: rest.slice(0, dotIndex),
    propertyName: rest.slice(dotIndex + 1)
  }
}

// 开始内联编辑
function startInlineEdit(key: string, currentValue: string | number) {
  if (!isEditableProperty(key)) return
  inlineEditingKey.value = key
  inlineEditValue.value = String(currentValue)
}

// 保存内联编辑
async function saveInlineEdit(key: string) {
  if (!selectedExpressId.value) return

  const parsed = parseEditableKey(key)
  if (!parsed) return

  const elementId = `#${selectedExpressId.value}`

  // 找到对应的待写入属性
  const propIndex = pendingProperties.value.findIndex(
    p => p.elementId === elementId &&
         p.psetName === parsed.psetName &&
         p.propertyName === parsed.propertyName
  )

  if (propIndex === -1) {
    ElMessage.error('未找到对应属性')
    return
  }

  const prop = pendingProperties.value[propIndex]
  if (!prop) return

  // 根据类型解析新值
  let newValue: string | number | boolean = inlineEditValue.value
  if (prop.valueType === 'REAL' || prop.valueType === 'INTEGER') {
    const numValue = parseFloat(inlineEditValue.value)
    if (isNaN(numValue)) {
      ElMessage.warning('请输入有效的数字')
      return
    }
    newValue = prop.valueType === 'INTEGER' ? Math.floor(numValue) : numValue
  } else if (prop.valueType === 'BOOLEAN') {
    newValue = inlineEditValue.value.toLowerCase() === 'true' || inlineEditValue.value === '1'
  }

  // 更新属性值
  prop.value = newValue

  if (activePersistedModelId.value) {
    const savedProperty = await upsertModelCustomProperty(
      activePersistedModelId.value,
      toCustomPropertyMutation(prop, selectedExpressId.value),
    )
    prop.databaseId = savedProperty.id
  }

  // 退出编辑模式
  inlineEditingKey.value = null

  // 更新显示
  selectedProperties.value[key] = typeof newValue === 'boolean' ? String(newValue) : newValue

  ElMessage.success('属性值已更新')
}

// 取消内联编辑
function cancelInlineEdit() {
  inlineEditingKey.value = null
}

// 删除自定义属性（从右侧面板）
async function deleteCustomProperty(key: string) {
  if (!selectedExpressId.value) return

  const parsed = parseEditableKey(key)
  if (!parsed) return

  const elementId = `#${selectedExpressId.value}`

  // 找到并删除对应的待写入属性
  const propIndex = pendingProperties.value.findIndex(
    p => p.elementId === elementId &&
         p.psetName === parsed.psetName &&
         p.propertyName === parsed.propertyName
  )

  if (propIndex !== -1) {
    const property = pendingProperties.value[propIndex]
    if (activePersistedModelId.value && property?.databaseId) {
      await deleteModelCustomProperty(activePersistedModelId.value, property.databaseId)
    }
    pendingProperties.value.splice(propIndex, 1)
    ElMessage.success('属性已删除')
    await refreshSelectedProperties()
  }
}

// ==================== 内联编辑功能结束 ====================

// 取消编辑
function cancelEditProperty() {
  editingProperty.value = null
}

// 导出修改后的 IFC 文件（使用新的导出器模块）
async function exportModifiedIfc() {
  if (!currentModel || !currentIfcData) {
    ElMessage.warning('请先加载模型')
    return
  }

  try {
    isLoading.value = true
    ElMessage.info('正在导出 IFC 文件...')

    const lineageMetadata = await buildCurrentIfcLineageMetadata()

    // 使用新的导出器创建 Blob（包含标注数据）
    const blob = await createUpdatedIfcBlob(
      currentIfcData,
      pendingProperties.value,
      annotations.value,
      lineageMetadata,
    )

    // 下载文件
    const filename = (pendingProperties.value.length > 0 || annotations.value.length > 0)
      ? `${currentIfcFileName}_modified.ifc`
      : `${currentIfcFileName}.ifc`

    downloadIfcBlob(blob, filename)

    // 导出成功后的提示
    const annoCount = annotations.value.length
    const propCount = pendingProperties.value.length
    if (propCount > 0 || annoCount > 0) {
      const parts: string[] = []
      if (propCount > 0) parts.push(`${propCount} 个自定义属性`)
      if (annoCount > 0) parts.push(`${annoCount} 个标注点`)
      ElMessage.success(`IFC 文件导出成功！已保存 ${parts.join('、')}`)
    } else {
      ElMessage.success('IFC 文件导出成功')
    }
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败: ' + (error as Error).message)
  } finally {
    isLoading.value = false
  }
}

// 获取待写入属性的数量（用于 UI 显示）
const pendingWritesCount = computed(() => pendingProperties.value.length)

// 获取待写入的构件数量
const pendingElementsCount = computed(() => {
  const elementIds = new Set(pendingProperties.value.map(p => p.elementId))
  return elementIds.size
})

// 检查当前属性集名称是否已存在（用于 UI 警告）
const psetNameConflict = computed(() => {
  if (!selectedExpressId.value) return null
  const currentPsetName = psetName.value.trim() || 'CustomProperties'
  const existingProps = getPendingPropertiesForPset(selectedExpressId.value, currentPsetName)
  if (existingProps.length > 0) {
    return {
      psetName: currentPsetName,
      propertyCount: existingProps.length
    }
  }
  return null
})

// 获取建议的新属性集名称
const suggestedPsetName = computed(() => {
  if (!selectedExpressId.value) return 'CustomProperties'
  const baseName = psetName.value.trim() || 'CustomProperties'
  const existingNames = getPendingPsetNames(selectedExpressId.value)
  if (!existingNames.includes(baseName)) return baseName
  // 生成带时间戳的新名称
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  let suffix = 1
  let newName = `${baseName}_${timestamp}`
  while (existingNames.includes(newName)) {
    newName = `${baseName}_${timestamp}_${suffix++}`
  }
  return newName
})

// 检查 IFC 文件是否包含自定义数据区域
const hasExistingCustomData = computed(() => {
  if (!currentIfcData) return false
  return hasCustomDataSection(currentIfcData)
})

// ==================== 自定义属性功能结束 ====================

// 加载 IFC 文件
let isLoadingLock = false
interface LoadIfcOptions {
  persistedModelId?: string
  persistedModelSummary?: PersistedModelSummary | null
  skipServerUpload?: boolean
  skipSnapshotSync?: boolean
}

async function loadPersistedModel(model: PersistedModelSummary) {
  try {
    isPersistingModel.value = true
    const blob = await fetchPersistedModelFile(model.id)
    const file = new File([blob], model.originalFileName, { type: model.mimeType })

    await loadIfcFile(file, {
      persistedModelId: model.id,
      persistedModelSummary: model,
      skipServerUpload: true,
      skipSnapshotSync: model.syncStatus === 'READY',
    })
  } catch (error) {
    console.error('加载服务端模型失败:', error)
    ElMessage.error('加载已保存模型失败')
  } finally {
    isPersistingModel.value = false
  }
}

async function loadLatestPersistedModel() {
  await refreshPersistedModels()
  const latestModel = persistedModels.value[0]
  if (latestModel) {
    await loadPersistedModel(latestModel)
  }
}

async function loadIfcFile(file: File, options: LoadIfcOptions = {}) {
  if (!ifcLoader || !world || !fragmentsManager) return

  // 防止重复加载
  if (isLoadingLock) {
    ElMessage.warning('正在加载中，请稍候...')
    return
  }
  isLoadingLock = true
  isLoading.value = true
  ElMessage.info('正在加载模型...')

  try {
    let persistedModelId = options.persistedModelId ?? activePersistedModelId.value
    let persistedModelSummary = options.persistedModelSummary ?? activePersistedModelSummary.value

    if (!options.skipServerUpload) {
      isPersistingModel.value = true
      const persistedModel = await uploadIfcModel(file)
      persistedModelId = persistedModel.id
      persistedModelSummary = persistedModel
      activePersistedModelId.value = persistedModel.id
      activePersistedModelSummary.value = persistedModel
      snapshotSyncProgress.value = describePersistedModelSync(persistedModel)
      await refreshPersistedModels()
    } else if (persistedModelId) {
      activePersistedModelId.value = persistedModelId
      activePersistedModelSummary.value = persistedModelSummary
        ?? persistedModels.value.find((model) => model.id === persistedModelId)
        ?? null
      snapshotSyncProgress.value = describePersistedModelSync(activePersistedModelSummary.value)
    } else {
      activePersistedModelId.value = null
      activePersistedModelSummary.value = null
      snapshotSyncProgress.value = ''
    }

    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    // 如果已有模型，先清除
    if (currentModel) {
      world.scene.three.remove(currentModel.object)
      fragmentsManager.list.delete(currentModel.modelId)
    }

    // 清理旧的 web-ifc 数据和待写入属性
    ifcLoader.cleanUp()
    pendingProperties.value = []
    loadedCustomProperties.value = []
    currentIfcLineageMetadata = null

    // 清理旧的标注
    clearAnnotationMarkers()
    annotations.value = []
    annotationMode.value = false
    showAnnotationPopup.value = false

    // 保存原始文件名（去除扩展名）
    const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
    currentIfcFileName = fileNameWithoutExt

    // 保存原始 IFC 数据（用于后续文本操作导出）
    currentIfcData = uint8Array.slice() // 创建副本
    currentIfcLineageMetadata = parseIfcLineageMetadata(currentIfcData)

    // 解析文件中已有的自定义属性
    const existingProps = parseCustomProperties(currentIfcData)
    if (existingProps.length > 0) {
      loadedCustomProperties.value = existingProps
      // 将解析的属性添加到待写入列表，以便用户可以编辑
      pendingProperties.value = existingProps.map(p => ({
        elementId: p.elementId,
        psetName: p.psetName,
        propertyName: p.propertyName,
        value: p.value,
        valueType: p.valueType
      }))
      console.log(`已从文件中加载 ${existingProps.length} 个自定义属性`)
    }

    // 解析标注数据
    const existingAnnotations = parseAnnotationsFromCustomSection(currentIfcData)
    if (existingAnnotations.length > 0) {
      annotations.value = existingAnnotations
      console.log(`已从文件中加载 ${existingAnnotations.length} 个标注点`)
    }

    // 加载模型到 Fragments（用于 3D 显示）
    currentModel = await ifcLoader.load(uint8Array, false, file.name)

    console.log('模型加载完成:', currentModel)

    // 等待一下确保模型完全加载
    await new Promise(resolve => setTimeout(resolve, 100))

    // 调整相机视角
    fitToModel()

    // 加载标注标记（在模型加载后以便自适应大小）
    if (annotations.value.length > 0) {
      loadAnnotationMarkers()
    }

    hasModel.value = true

    if (persistedModelId) {
      await bootstrapPersistedOverlays(persistedModelId, existingProps, existingAnnotations)
      snapshotSyncProgress.value = describePersistedModelSync(activePersistedModelSummary.value)
    }

    // 显示加载结果
    const annoCount = annotations.value.length
    if (pendingProperties.value.length > 0 || annoCount > 0) {
      const parts: string[] = []
      if (pendingProperties.value.length > 0) parts.push(`${pendingProperties.value.length} 个自定义属性`)
      if (annoCount > 0) parts.push(`${annoCount} 个标注点`)
      ElMessage.success(`模型加载成功！已读取 ${parts.join('、')}`)
    } else {
      ElMessage.success('模型加载成功!')
    }
  } catch (error) {
    console.error('加载模型失败:', error)
    ElMessage.error(`加载模型失败: ${(error as Error).message}`)
  } finally {
    isPersistingModel.value = false
    isLoading.value = false
    isLoadingLock = false
  }
}

// 展开所有树节点
function expandAllTree() {
  if (!spatialTreeElement) return
  const table = spatialTreeElement as HTMLElement & { expanded?: boolean }
  table.expanded = true
}

// 收起所有树节点
function collapseAllTree() {
  if (!spatialTreeElement) return
  const table = spatialTreeElement as HTMLElement & { expanded?: boolean }
  // 先设置 expanded 为 true
  table.expanded = true
  // 使用 setTimeout 0 将状态切换隔开
  setTimeout(() => {
    // 再设置为 false 来收起所有节点
    table.expanded = false
  }, 0)
}

// 树过滤
watch(treeFilterText, (value) => {
  if (!spatialTreeElement) return
  const table = spatialTreeElement as HTMLElement & { queryString?: string }
  if (table.queryString !== undefined) {
    table.queryString = value
  }
})

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return

  if (event.code === 'Delete') {
    if (clipper && world) {
      clipper.delete(world)
    }
  }

  if (event.code === 'Escape') {
    if (annotationMode.value) {
      annotationMode.value = false
      ElMessage.info('已退出标注模式')
    }
    showAnnotationPopup.value = false
  }

  const key = event.key.toLowerCase()
  if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
    moveKeys.add(key)
    isWalking.value = true
  }
}

function handleKeyUp(event: KeyboardEvent) {
  const key = event.key.toLowerCase()
  if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
    moveKeys.delete(key)
    if (moveKeys.size === 0) {
      isWalking.value = false
    }
  }
}

function startWalkLoop() {
  if (walkAnimationId !== null) return
  walkClock.start()

  const tick = () => {
    walkAnimationId = requestAnimationFrame(tick)
    if (!world?.camera) return
    if (moveKeys.size === 0) return

    const delta = walkClock.getDelta()
    const speed = moveSpeed.value * (moveKeys.has('shift') ? 2 : 1)
    const camera = world.camera.three
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()

    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    const move = new THREE.Vector3()

    if (moveKeys.has('q') || moveKeys.has('e')) {
      const yaw = (moveKeys.has('q') ? 1 : 0) - (moveKeys.has('e') ? 1 : 0)
      if (yaw !== 0) {
        const angle = yaw * turnSpeed.value * delta
        const toTarget = walkTarget.clone().sub(camera.position)
        toTarget.applyAxisAngle(camera.up, angle)
        walkTarget.copy(camera.position).add(toTarget)
      }
    }

    if (moveKeys.has('w')) move.add(forward)
    if (moveKeys.has('s')) move.sub(forward)
    if (moveKeys.has('d')) move.add(right)
    if (moveKeys.has('a')) move.sub(right)

    if (move.lengthSq() === 0) return
    move.normalize().multiplyScalar(speed * delta)

    const nextPos = camera.position.clone().add(move)
    const nextTarget = walkTarget.clone().add(move)

    const controls = world.camera.controls
    if (controls?.setLookAt) {
      controls.setLookAt(
        nextPos.x,
        nextPos.y,
        nextPos.z,
        nextTarget.x,
        nextTarget.y,
        nextTarget.z,
        false
      )
    } else {
      camera.position.copy(nextPos)
      camera.lookAt(nextTarget)
    }

    walkTarget.copy(nextTarget)
  }

  tick()
}

// ==================== 标注功能 ====================

function toggleAnnotationMode() {
  annotationMode.value = !annotationMode.value
  if (annotationMode.value) {
    // 关闭剖切模式避免冲突
    if (clipper) clipper.enabled = false
    clippingEnabled.value = false
    ElMessage.info('标注模式：双击模型表面放置标注点')
  }
  showAnnotationPopup.value = false
}

async function handleAnnotationDoubleClick() {
  if (!world || !components) return

  const casters = components.get(OBC.Raycasters)
  const caster = casters.get(world)
  const result = await caster.castRay()

  if (result) {
    const point = result.point
    pendingAnnotationPosition.value = { x: point.x, y: point.y, z: point.z }
    annotationText.value = ''
    showAnnotationDialog.value = true
  } else {
    ElMessage.warning('请双击模型表面以放置标注')
  }
}

function handleAnnotationClick(event: MouseEvent) {
  if (!world || !viewerContainer.value || !annotationGroup || annotationGroup.children.length === 0) {
    showAnnotationPopup.value = false
    return
  }

  const rect = viewerContainer.value.getBoundingClientRect()
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )

  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, world.camera.three)

  const markers = annotationGroup.children.filter(c => (c as THREE.Mesh).isMesh) as THREE.Mesh[]
  if (markers.length === 0) {
    showAnnotationPopup.value = false
    return
  }

  const intersects = raycaster.intersectObjects(markers, false)
  if (intersects.length > 0) {
    const mesh = intersects[0]!.object as THREE.Mesh
    const annotation = annotationMarkerMap.get(mesh)
    if (annotation) {
      annotationPopupInfo.value = annotation
      annotationPopupStyle.value = {
        left: `${event.clientX - rect.left + 12}px`,
        top: `${event.clientY - rect.top - 12}px`
      }
      showAnnotationPopup.value = true
      return
    }
  }
  showAnnotationPopup.value = false
}

async function confirmAnnotation() {
  if (!pendingAnnotationPosition.value || !annotationText.value.trim()) return

  const pos = pendingAnnotationPosition.value
  const annotation: AnnotationPoint = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    x: pos.x,
    y: pos.y,
    z: pos.z,
    text: annotationText.value.trim()
  }

  if (activePersistedModelId.value) {
    await upsertModelAnnotation(activePersistedModelId.value, toAnnotationMutation(annotation))
  }

  annotations.value.push(annotation)
  createAnnotationMarker(annotation)

  showAnnotationDialog.value = false
  annotationText.value = ''
  pendingAnnotationPosition.value = null
  ElMessage.success('标注已添加')
}

function getAnnotationMarkerRadius(): number {
  if (!currentModel) return 0.15
  try {
    const box = new THREE.Box3().setFromObject(currentModel.object)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    return Math.max(0.05, maxDim * 0.01)
  } catch {
    return 0.15
  }
}

function createAnnotationMarker(annotation: AnnotationPoint) {
  if (!annotationGroup) return

  const radius = getAnnotationMarkerRadius()
  const geometry = new THREE.SphereGeometry(radius, 16, 16)
  const material = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    depthTest: false,
    transparent: true,
    opacity: 0.9
  })
  const marker = new THREE.Mesh(geometry, material)
  marker.position.set(annotation.x, annotation.y, annotation.z)
  marker.renderOrder = 999
  marker.userData.annotationId = annotation.id

  annotationGroup.add(marker)
  annotationMarkerMap.set(marker, annotation)
}

function loadAnnotationMarkers() {
  clearAnnotationMarkers()
  for (const ann of annotations.value) {
    createAnnotationMarker(ann)
  }
}

function clearAnnotationMarkers() {
  if (!annotationGroup) return
  annotationMarkerMap.clear()
  while (annotationGroup.children.length > 0) {
    const child = annotationGroup.children[0]!
    annotationGroup.remove(child)
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
    if ((child as THREE.Mesh).material) {
      const mat = (child as THREE.Mesh).material
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat.dispose()
    }
  }
}

async function deleteAnnotation(id: string) {
  const idx = annotations.value.findIndex(a => a.id === id)
  if (idx !== -1) {
    annotations.value.splice(idx, 1)
  }

  if (activePersistedModelId.value) {
    await deleteModelAnnotation(activePersistedModelId.value, id)
  }

  if (annotationGroup) {
    const child = annotationGroup.children.find(c => c.userData.annotationId === id)
    if (child) {
      annotationGroup.remove(child)
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
      if ((child as THREE.Mesh).material) {
        const mat = (child as THREE.Mesh).material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat.dispose()
      }
      annotationMarkerMap.delete(child as THREE.Mesh)
    }
  }

  showAnnotationPopup.value = false
  ElMessage.success('标注已删除')
}

// ==================== 标注功能结束 ====================

// 适应模型
function fitToModel() {
  if (!world?.camera || !currentModel) return

  try {
    const box = new THREE.Box3().setFromObject(currentModel.object)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const distance = maxDim * 2

    world.camera.controls?.setLookAt(
      center.x + distance,
      center.y + distance * 0.5,
      center.z + distance,
      center.x,
      center.y,
      center.z,
      true
    )
  } catch (error) {
    console.error('调整视角失败:', error)
  }
}

// 放大
function zoomIn() {
  if (!world?.camera?.controls) return
  world.camera.controls.dolly(2, true)
}

// 缩小
function zoomOut() {
  if (!world?.camera?.controls) return
  world.camera.controls.dolly(-2, true)
}

// 重置视图
function resetView() {
  if (!world?.camera?.controls) return
  if (currentModel) {
    fitToModel()
  } else {
    world.camera.controls.setLookAt(12, 6, 8, 0, 0, 0, true)
  }
}

// 切换剖切模式
function toggleClipping() {
  if (!clipper) return
  clippingEnabled.value = !clippingEnabled.value
  clipper.enabled = clippingEnabled.value

  if (clippingEnabled.value) {
    ElMessage.info('双击创建剖切面，Delete键删除')
  }
}

// 删除所有剖切面
function deleteAllClips() {
  if (!clipper) return
  clipper.deleteAll()
  ElMessage.success('已删除所有剖切面')
}

// 获取模型所有 expressIds 的辅助函数
async function getAllExpressIds(model: FragmentsModel): Promise<number[]> {
  const allIds = await model.getItemsOfCategories([/.*/])
  const allExpressIds: number[] = []
  for (const ids of Object.values(allIds)) {
    allExpressIds.push(...ids)
  }
  return allExpressIds
}

// 隔离选中
async function isolateSelected() {
  if (!highlighter || !currentModel || !fragmentsManager) return

  const selection = highlighter.selection.select
  if (!selection || Object.keys(selection).length === 0) {
    ElMessage.warning('请先选择构件')
    return
  }

  try {
    // 遍历选择并设置可见性
    for (const [modelId, itemIds] of Object.entries(selection)) {
      const model = fragmentsManager.list.get(modelId)
      if (model) {
        const allExpressIds = await getAllExpressIds(model)
        // 隐藏所有
        model.setVisible(allExpressIds, false)
        // 显示选中
        const selectedIds = Array.isArray(itemIds) ? itemIds : Array.from(itemIds)
        model.setVisible(selectedIds, true)
      }
    }
    ElMessage.success('已隔离选中构件')
  } catch (error) {
    console.error('隔离选中失败:', error)
    ElMessage.error('隔离选中失败')
  }
}

// 显示全部
async function showAll() {
  if (!currentModel || !fragmentsManager) return

  try {
    for (const [, model] of fragmentsManager.list) {
      const allExpressIds = await getAllExpressIds(model)
      model.setVisible(allExpressIds, true)
    }
    ElMessage.success('已显示所有构件')
  } catch (error) {
    console.error('显示全部失败:', error)
    ElMessage.error('显示全部失败')
  }
}

// 隐藏选中
function hideSelected() {
  if (!highlighter || !currentModel || !fragmentsManager) return

  const selection = highlighter.selection.select
  if (!selection || Object.keys(selection).length === 0) {
    ElMessage.warning('请先选择构件')
    return
  }

  try {
    for (const [modelId, itemIds] of Object.entries(selection)) {
      const model = fragmentsManager.list.get(modelId)
      if (model) {
        const selectedIds = Array.isArray(itemIds) ? itemIds : Array.from(itemIds)
        model.setVisible(selectedIds, false)
      }
    }
    highlighter.clear('select')
    ElMessage.success('已隐藏选中构件')
  } catch (error) {
    console.error('隐藏选中失败:', error)
    ElMessage.error('隐藏选中失败')
  }
}

// 处理窗口大小变化
function handleResize() {
  if (!world?.renderer || !viewerContainer.value) return
  const size = new THREE.Vector2(viewerContainer.value.clientWidth, viewerContainer.value.clientHeight)
  world.renderer.resize(size)
}

// 处理文件上传
interface UploadFile {
  raw?: File
}

function handleUploadChange(uploadFile: UploadFile) {
  if (uploadFile.raw) {
    void loadIfcFile(uploadFile.raw)
  }
  return false
}

// 处理拖放
function handleDrop(event: DragEvent) {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const file = files[0]
    if (file && file.name.toLowerCase().endsWith('.ifc')) {
      void loadIfcFile(file)
    } else {
      ElMessage.warning('请上传 .ifc 格式的文件')
    }
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
}

// 生命周期
onMounted(() => {
  void (async () => {
    await initViewer()
    await loadLatestPersistedModel()
  })()

  persistedModelsRefreshTimer = window.setInterval(() => {
    if (activePersistedModelId.value || persistedModels.value.length > 0) {
      void refreshPersistedModels()
    }
  }, 3000)
})

onUnmounted(() => {
  if (persistedModelsRefreshTimer !== null) {
    window.clearInterval(persistedModelsRefreshTimer)
    persistedModelsRefreshTimer = null
  }

  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)

  // 清理双击事件和标注点击事件
  if (viewerContainer.value) {
    viewerContainer.value.ondblclick = null
    viewerContainer.value.removeEventListener('click', handleAnnotationClick)
  }

  // 清理标注
  clearAnnotationMarkers()

  // 停止行走动画
  if (walkAnimationId !== null) {
    cancelAnimationFrame(walkAnimationId)
    walkAnimationId = null
  }

  // 停止时钟
  walkClock.stop()

  // 清理组件
  if (components) {
    components.dispose()
  }
})
</script>

<template>
  <div class="ifc-viewer-container">
    <!-- 左侧面板 -->
    <div class="left-panel">
      <div class="panel-header">
        <h3>IFC 查看器</h3>
      </div>

      <!-- 文件上传 -->
      <div class="upload-section">
        <ElUpload
          drag
          :auto-upload="false"
          :show-file-list="false"
          accept=".ifc"
          :on-change="handleUploadChange"
        >
          <ElIcon class="upload-icon" :size="40">
            <Upload />
          </ElIcon>
          <div class="upload-text">
            <p>拖拽 IFC 文件到此处</p>
            <p class="upload-hint">或点击上传</p>
          </div>
        </ElUpload>
      </div>

      <div class="persistence-section">
        <div class="persistence-card">
          <div class="persistence-title">后端持久化</div>
          <p class="persistence-text">
            {{ activePersistedModelId ? '当前模型已绑定后端存储' : '上传 IFC 后将自动持久化到后端和数据库' }}
          </p>
          <p v-if="activePersistedModelSummary" class="persistence-text">
            源文件指纹: {{ activePersistedModelSummary.sourceFingerprint.slice(0, 16) }}...
          </p>
          <p v-if="isPersistingModel" class="persistence-status">正在上传模型到后端...</p>
          <p v-else-if="snapshotSyncProgress" class="persistence-status">{{ snapshotSyncProgress }}</p>
          <RouterLink class="persistence-link" to="/sync-queue">查看同步队列与进度</RouterLink>
          <p v-if="activePersistedModelSummary?.syncError" class="persistence-error">
            最近同步失败: {{ activePersistedModelSummary.syncError }}
          </p>
        </div>

        <div v-if="persistedModels.length > 0" class="recent-models">
          <div class="recent-models-header">
            <h4>最近模型</h4>
            <span>{{ persistedModels.length }}</span>
          </div>
          <div class="recent-model-list">
            <ElButton
              v-for="model in persistedModels.slice(0, 5)"
              :key="model.id"
              size="small"
              class="recent-model-item"
              :type="activePersistedModelId === model.id ? 'primary' : 'default'"
              :disabled="isLoading || isPersistingModel"
              @click="loadPersistedModel(model)"
            >
              {{ model.originalFileName }}
            </ElButton>
          </div>
        </div>
      </div>

      <ElDivider />

      <!-- 模型树 -->
      <div class="model-tree-section">
        <div class="model-tree-header">
          <h4>模型结构</h4>
          <div class="tree-actions">
            <ElButton size="small" @click="expandAllTree" :disabled="!hasModel">展开</ElButton>
            <ElButton size="small" @click="collapseAllTree" :disabled="!hasModel">收起</ElButton>
          </div>
        </div>
        <ElInput
          v-model="treeFilterText"
          size="small"
          clearable
          placeholder="搜索构件"
          class="tree-search"
        />
        <div class="tree-container">
          <div ref="spatialTreeContainer" class="spatial-tree-wrapper" v-show="hasModel"></div>
          <ElEmpty v-if="!hasModel" description="暂无模型" :image-size="60" />
        </div>
      </div>
    </div>

    <!-- 中间视图区域 -->
    <div class="viewer-section">
      <!-- 工具栏 -->
      <div class="toolbar">
        <ElButtonGroup>
          <ElTooltip content="放大" placement="bottom">
            <ElButton :icon="ZoomIn" @click="zoomIn" />
          </ElTooltip>
          <ElTooltip content="缩小" placement="bottom">
            <ElButton :icon="ZoomOut" @click="zoomOut" />
          </ElTooltip>
          <ElTooltip content="重置视图" placement="bottom">
            <ElButton :icon="Refresh" @click="resetView" />
          </ElTooltip>
          <ElTooltip content="适应模型" placement="bottom">
            <ElButton :icon="FullScreen" @click="fitToModel" :disabled="!hasModel" />
          </ElTooltip>
        </ElButtonGroup>

        <ElDivider direction="vertical" />

        <ElButtonGroup>
          <ElTooltip content="隔离选中" placement="bottom">
            <ElButton :icon="Select" @click="isolateSelected" :disabled="!hasModel" />
          </ElTooltip>
          <ElTooltip content="隐藏选中" placement="bottom">
            <ElButton :icon="Hide" @click="hideSelected" :disabled="!hasModel" />
          </ElTooltip>
          <ElTooltip content="显示全部" placement="bottom">
            <ElButton :icon="View" @click="showAll" :disabled="!hasModel" />
          </ElTooltip>
        </ElButtonGroup>

        <ElDivider direction="vertical" />

        <ElButtonGroup>
          <ElTooltip content="剖切模式" placement="bottom">
            <ElButton
              :icon="Scissor"
              @click="toggleClipping"
              :type="clippingEnabled ? 'primary' : 'default'"
            />
          </ElTooltip>
          <ElTooltip content="删除剖切面" placement="bottom">
            <ElButton :icon="Delete" @click="deleteAllClips" />
          </ElTooltip>
        </ElButtonGroup>

        <ElDivider direction="vertical" />

        <ElButtonGroup>
          <ElTooltip content="选点标注" placement="bottom">
            <ElButton
              :icon="Aim"
              @click="toggleAnnotationMode"
              :type="annotationMode ? 'primary' : 'default'"
              :disabled="!hasModel"
            />
          </ElTooltip>
        </ElButtonGroup>
      </div>

      <!-- 3D 视图 -->
      <div
        ref="viewerContainer"
        class="viewer-canvas"
        @drop="handleDrop"
        @dragover="handleDragOver"
      >
        <div v-if="isLoading" class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>正在加载模型...</p>
        </div>
        <!-- 标注模式提示 -->
        <div v-if="annotationMode" class="annotation-overlay">
          <div class="annotation-hint-bar">
            📌 标注模式 | 双击模型表面放置标注点，Esc 退出
          </div>
        </div>
        <!-- 标注信息弹出框 -->
        <div
          v-if="showAnnotationPopup && annotationPopupInfo"
          class="annotation-popup"
          :style="annotationPopupStyle"
          @click.stop
        >
          <div class="annotation-popup-content">
            <div class="annotation-popup-title">📌 标注信息</div>
            <div class="annotation-popup-text">{{ annotationPopupInfo.text }}</div>
            <div class="annotation-popup-coords">
              坐标: ({{ annotationPopupInfo.x.toFixed(3) }}, {{ annotationPopupInfo.y.toFixed(3) }}, {{ annotationPopupInfo.z.toFixed(3) }})
            </div>
            <ElButton type="danger" size="small" @click="deleteAnnotation(annotationPopupInfo.id)">
              删除标注
            </ElButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧属性面板 -->
    <div class="right-panel">
      <div class="panel-header">
        <h3>属性</h3>
      </div>

      <div class="properties-section">
        <template v-if="Object.keys(selectedProperties).length > 0">
          <!-- 提示信息 -->
          <div v-if="pendingWritesCount > 0" class="edit-hint">
            💡 带 ✏️ 的属性可直接点击编辑
          </div>

          <ElDescriptions :column="1" border size="small">
            <ElDescriptionsItem
              v-for="(value, key) in selectedProperties"
              :key="key"
              :label="String(key)"
              :class="{ 'editable-property': isEditableProperty(String(key)) }"
            >
              <!-- 编辑模式 -->
              <template v-if="inlineEditingKey === String(key)">
                <div class="inline-edit-container">
                  <ElInput
                    v-model="inlineEditValue"
                    size="small"
                    class="inline-edit-input"
                    @keyup.enter="saveInlineEdit(String(key))"
                    @keyup.escape="cancelInlineEdit"
                    autofocus
                  />
                  <div class="inline-edit-actions">
                    <ElButton type="primary" size="small" link @click="saveInlineEdit(String(key))">
                      保存
                    </ElButton>
                    <ElButton size="small" link @click="cancelInlineEdit">
                      取消
                    </ElButton>
                  </div>
                </div>
              </template>
              <!-- 显示模式 -->
              <template v-else>
                <div
                  class="property-value"
                  :class="{ 'clickable': isEditableProperty(String(key)) }"
                  @click="isEditableProperty(String(key)) && startInlineEdit(String(key), value)"
                >
                  <span>{{ value }}</span>
                  <template v-if="isEditableProperty(String(key))">
                    <ElButton
                      type="danger"
                      :icon="Delete"
                      size="small"
                      link
                      class="delete-prop-btn"
                      @click.stop="deleteCustomProperty(String(key))"
                    />
                  </template>
                </div>
              </template>
            </ElDescriptionsItem>
          </ElDescriptions>

          <!-- 自定义属性操作按钮 -->
          <div class="property-actions">
            <ElButton type="primary" :icon="Plus" size="small" @click="openPropertyDialog">
              添加自定义属性
            </ElButton>
          </div>
        </template>
        <ElEmpty v-else description="点击构件查看属性" :image-size="60" />
      </div>

      <!-- 导出按钮 -->
      <div class="export-section" v-if="hasModel">
        <ElDivider />

        <!-- 待写入属性统计 -->
        <div v-if="pendingWritesCount > 0" class="pending-stats">
          <div class="pending-info">
            📝 {{ loadedCustomProperties.length > 0 ? '自定义属性' : '待写入' }}: {{ pendingWritesCount }} 个属性 / {{ pendingElementsCount }} 个构件
          </div>
          <ElButton type="primary" link size="small" :icon="Document" @click="openPropertyManager">
            管理属性
          </ElButton>
        </div>

        <!-- 已有自定义数据提示 -->
        <div v-if="hasExistingCustomData && loadedCustomProperties.length > 0" class="existing-data-hint">
          ✅ 已从文件加载自定义属性（点击构件查看并编辑）
        </div>
        <div v-else-if="hasExistingCustomData" class="existing-data-hint">
          ⚠️ 文件包含自定义数据区域（导出时将覆盖）
        </div>

        <ElButton type="success" :icon="Download" @click="exportModifiedIfc" style="width: 100%">
          导出 IFC 文件
        </ElButton>
      </div>
    </div>

    <!-- 添加自定义属性对话框 -->
    <ElDialog
      v-model="showPropertyDialog"
      title="添加自定义属性"
      width="560px"
      :close-on-click-modal="false"
    >
      <div class="property-dialog-content">
        <!-- 属性集名称 -->
        <ElForm label-width="100px" size="default">
          <ElFormItem label="属性集名称">
            <ElInput v-model="psetName" placeholder="CustomProperties" />
          </ElFormItem>
        </ElForm>

        <!-- 属性集名称冲突警告 -->
        <div v-if="psetNameConflict" class="pset-conflict-warning">
          ⚠️ 该构件已存在属性集 "{{ psetNameConflict.psetName }}"（{{ psetNameConflict.propertyCount }} 个属性），
          新属性将合并到该属性集。
          <ElButton type="primary" link size="small" @click="psetName = suggestedPsetName">
            使用新名称: {{ suggestedPsetName }}
          </ElButton>
        </div>

        <ElDivider content-position="left">添加新属性</ElDivider>

        <!-- 添加新属性表单 -->
        <ElForm :inline="true" class="add-property-form" size="default">
          <ElFormItem label="名称">
            <ElInput v-model="newPropertyName" placeholder="属性名称" style="width: 120px" />
          </ElFormItem>
          <ElFormItem label="类型">
            <ElSelect v-model="newPropertyType" style="width: 100px">
              <ElOption label="文本" value="string" />
              <ElOption label="数字" value="number" />
              <ElOption label="布尔" value="boolean" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="值">
            <ElInput v-model="newPropertyValue" placeholder="属性值" style="width: 120px" />
          </ElFormItem>
          <ElFormItem>
            <ElButton type="primary" :icon="Plus" @click="addPropertyToList">添加</ElButton>
          </ElFormItem>
        </ElForm>

        <!-- 已添加的属性列表 -->
        <div class="property-list" v-if="customProperties.length > 0">
          <ElDivider content-position="left">待写入属性 ({{ customProperties.length }})</ElDivider>
          <ElTable :data="customProperties" size="small" max-height="200">
            <ElTableColumn prop="name" label="名称" />
            <ElTableColumn prop="type" label="类型" width="80">
              <template #default="{ row }">
                {{ row.type === 'string' ? '文本' : row.type === 'number' ? '数字' : '布尔' }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="value" label="值" />
            <ElTableColumn label="操作" width="80">
              <template #default="{ $index }">
                <ElPopconfirm title="确定删除此属性？" @confirm="removeProperty($index)">
                  <template #reference>
                    <ElButton type="danger" :icon="Delete" size="small" link />
                  </template>
                </ElPopconfirm>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
      </div>

      <template #footer>
        <ElButton @click="showPropertyDialog = false">取消</ElButton>
        <ElButton
          type="primary"
          @click="writePropertiesToIfc"
          :disabled="customProperties.length === 0"
          :loading="isLoading"
        >
          写入属性
        </ElButton>
      </template>
    </ElDialog>

    <!-- 属性管理器对话框 -->
    <ElDialog
      v-model="showPropertyManager"
      title="自定义属性管理器"
      width="800px"
      :close-on-click-modal="false"
    >
      <div class="property-manager-content">
        <!-- 搜索和操作栏 -->
        <div class="manager-toolbar">
          <ElInput
            v-model="propertySearchText"
            placeholder="搜索属性..."
            :prefix-icon="Search"
            clearable
            style="width: 300px"
          />
          <div class="manager-actions">
            <ElPopconfirm
              title="确定清空所有待写入属性？"
              @confirm="clearAllPendingProperties"
              :disabled="pendingProperties.length === 0"
            >
              <template #reference>
                <ElButton type="danger" :icon="Delete" :disabled="pendingProperties.length === 0">
                  清空全部
                </ElButton>
              </template>
            </ElPopconfirm>
          </div>
        </div>

        <!-- 属性列表 -->
        <div class="manager-list" v-if="filteredPendingProperties.length > 0">
          <ElTable :data="filteredPendingProperties" size="small" max-height="400">
            <ElTableColumn prop="elementId" label="构件 ID" width="100" />
            <ElTableColumn prop="psetName" label="属性集" width="140" />
            <ElTableColumn label="属性名" min-width="120">
              <template #default="{ row }">
                <template v-if="editingProperty?.index === pendingProperties.indexOf(row)">
                  <ElInput v-model="editPropertyName" size="small" />
                </template>
                <template v-else>
                  {{ row.propertyName }}
                </template>
              </template>
            </ElTableColumn>
            <ElTableColumn label="类型" width="80">
              <template #default="{ row }">
                <template v-if="editingProperty?.index === pendingProperties.indexOf(row)">
                  <ElSelect v-model="editPropertyType" size="small" style="width: 70px">
                    <ElOption label="文本" value="string" />
                    <ElOption label="数字" value="number" />
                    <ElOption label="布尔" value="boolean" />
                  </ElSelect>
                </template>
                <template v-else>
                  {{ row.valueType === 'REAL' || row.valueType === 'INTEGER' ? '数字' :
                     row.valueType === 'BOOLEAN' ? '布尔' : '文本' }}
                </template>
              </template>
            </ElTableColumn>
            <ElTableColumn label="值" min-width="120">
              <template #default="{ row }">
                <template v-if="editingProperty?.index === pendingProperties.indexOf(row)">
                  <ElInput v-model="editPropertyValue" size="small" />
                </template>
                <template v-else>
                  {{ row.value }}
                </template>
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <template v-if="editingProperty?.index === pendingProperties.indexOf(row)">
                  <ElButton type="success" size="small" link @click="saveEditProperty">保存</ElButton>
                  <ElButton type="info" size="small" link @click="cancelEditProperty">取消</ElButton>
                </template>
                <template v-else>
                  <ElButton type="primary" :icon="Edit" size="small" link @click="startEditProperty(row)" />
                  <ElPopconfirm title="确定删除此属性？" @confirm="deletePendingProperty(row)">
                    <template #reference>
                      <ElButton type="danger" :icon="Delete" size="small" link />
                    </template>
                  </ElPopconfirm>
                </template>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>

        <ElEmpty v-else description="暂无待写入的属性" :image-size="80" />
      </div>

      <template #footer>
        <ElButton @click="showPropertyManager = false">关闭</ElButton>
        <ElButton
          type="primary"
          :icon="Download"
          @click="exportModifiedIfc(); showPropertyManager = false"
          :disabled="pendingProperties.length === 0"
        >
          导出 IFC 文件
        </ElButton>
      </template>
    </ElDialog>

    <!-- 添加标注对话框 -->
    <ElDialog
      v-model="showAnnotationDialog"
      title="添加标注信息"
      width="420px"
      :close-on-click-modal="false"
    >
      <ElForm label-width="80px">
        <ElFormItem label="标注内容">
          <ElInput
            v-model="annotationText"
            type="textarea"
            :rows="3"
            placeholder="请输入标注信息"
          />
        </ElFormItem>
        <ElFormItem label="坐标">
          <span v-if="pendingAnnotationPosition" style="color: #909399; font-size: 13px;">
            ({{ pendingAnnotationPosition.x.toFixed(3) }},
            {{ pendingAnnotationPosition.y.toFixed(3) }},
            {{ pendingAnnotationPosition.z.toFixed(3) }})
          </span>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showAnnotationDialog = false; annotationText = ''">取消</ElButton>
        <ElButton type="primary" @click="confirmAnnotation" :disabled="!annotationText.trim()">确认标注</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.ifc-viewer-container {
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #f5f7fa;
  position: relative;
  overflow: hidden;
}

.ifc-viewer-container.is-resizing {
  cursor: col-resize;
  user-select: none;
}

/* 左侧面板 */
.left-panel {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
  flex-grow: 0;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.upload-section {
  padding: 16px;
}

.upload-section :deep(.el-upload) {
  width: 100%;
}

.upload-section :deep(.el-upload-dragger) {
  width: 100%;
  height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.upload-icon {
  color: #c0c4cc;
  margin-bottom: 8px;
}

.upload-text {
  text-align: center;
}

.upload-text p {
  margin: 4px 0;
  font-size: 14px;
  color: #606266;
}

.upload-hint {
  font-size: 12px !important;
  color: #909399 !important;
}

.persistence-section {
  padding: 0 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.persistence-card,
.recent-models {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fafcff;
}

.persistence-title,
.recent-models-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.persistence-text,
.persistence-status {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
}

.persistence-status {
  color: #409eff;
}

.persistence-link {
  display: inline-flex;
  margin-top: 8px;
  font-size: 12px;
  color: #0f766e;
  text-decoration: none;
}

.persistence-link:hover {
  text-decoration: underline;
}

.persistence-error {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #f56c6c;
}

.recent-models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.recent-models-header span {
  font-size: 12px;
  color: #909399;
}

.recent-model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.recent-model-item {
  justify-content: flex-start;
  margin: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-tree-section {
  flex: 1;
  padding: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.model-tree-section h4 {
  margin: 0;
  font-size: 14px;
  color: #606266;
}

.model-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.tree-actions {
  display: flex;
  gap: 6px;
}

.tree-search {
  margin-bottom: 10px;
}

.tree-container {
  flex: 1;
  overflow: auto;
  min-height: 0;
  border-radius: 6px;
  background: #fafafa;
  display: flex;
  flex-direction: column;
}

.spatial-tree-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-x: auto;
}

/* ThatOpen UI 空间树样式覆盖 */
.tree-container :deep(bim-table) {
  --bim-ui_bg-base: #fafafa;
  --bim-ui_bg-contrast-20: #f0f0f0;
  --bim-ui_bg-contrast-40: #e4e4e4;
  --bim-ui_main-base: #409eff;
  --bim-ui_accent-base: #409eff;
  --bim-ui_size-base: 14px;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}

.tree-container :deep(bim-table-row) {
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-radius: 4px;
  margin: 1px 0;
}

.tree-container :deep(bim-table-row:hover) {
  background-color: #ecf5ff;
}

.tree-container :deep(bim-table-row[data-selected="true"]) {
  background-color: #d9ecff;
}

.tree-container :deep(bim-table-cell) {
  padding: 4px 8px;
}

.tree-container :deep(bim-label) {
  font-size: 13px;
  color: #303133;
  line-height: 1.5;
}

.tree-container :deep(bim-icon) {
  color: #909399;
  margin-right: 4px;
}

/* 收窄层级缩进 */
.tree-container :deep(bim-table-group) {
  --bim-table-children--ml: 12px;
}

.tree-container :deep(bim-table-children) {
  margin-left: 12px !important;
  padding-left: 0 !important;
}

/* 确保内容不换行，支持横向滚动 */
.tree-container :deep(bim-table-row) {
  white-space: nowrap;
}

.tree-container :deep(bim-label) {
  white-space: nowrap;
}

/* 中间视图区域 */
.viewer-section {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  gap: 8px;
}

.viewer-canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e4e7ed;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay p {
  margin-top: 16px;
  color: #606266;
}

/* 右侧属性面板 */
.right-panel {
  width: 320px;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
  flex-grow: 0;
}

.properties-section {
  flex: 1;
  padding: 16px;
  overflow: auto;
}

.properties-section :deep(.el-descriptions) {
  width: 100%;
  table-layout: fixed;
}

.properties-section :deep(.el-descriptions__label) {
  width: 120px;
  min-width: 120px;
  max-width: 120px;
  font-weight: 500;
  word-break: break-all;
  white-space: normal;
}

.properties-section :deep(.el-descriptions__content) {
  word-break: break-all;
  white-space: normal;
}

/* 可编辑属性样式 */
.editable-property :deep(.el-descriptions__content) {
  background-color: #f0f9eb !important;
}

.edit-hint {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f9eb 100%);
  border: 1px solid #d9ecff;
  border-radius: 6px;
  color: #606266;
  font-size: 12px;
  text-align: center;
}

.property-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.property-value.clickable {
  cursor: pointer;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

.property-value.clickable:hover {
  background-color: #e8f4fd;
}

.property-value .delete-prop-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.property-value:hover .delete-prop-btn {
  opacity: 1;
}

.inline-edit-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.inline-edit-input {
  width: 100%;
}

.inline-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* 自定义属性操作按钮 */
.property-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

/* 导出区域 */
.export-section {
  padding: 0 16px 16px;
}

/* 属性对话框样式 */
.property-dialog-content {
  max-height: 60vh;
  overflow-y: auto;
}

.add-property-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.add-property-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 0;
}

.property-list {
  margin-top: 16px;
}

/* 属性集名称冲突警告 */
.pset-conflict-warning {
  margin: 8px 0 16px;
  padding: 10px 12px;
  background-color: #fdf6ec;
  border: 1px solid #faecd8;
  border-radius: 4px;
  color: #e6a23c;
  font-size: 13px;
  line-height: 1.6;
}

.pset-conflict-warning .el-button {
  margin-left: 4px;
}

/* 待写入属性统计 */
.pending-stats {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #f0f9eb 0%, #e8f5e9 100%);
  border: 1px solid #c8e6c9;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pending-info {
  color: #67c23a;
  font-size: 13px;
  font-weight: 500;
}

/* 已有自定义数据提示 */
.existing-data-hint {
  margin-bottom: 12px;
  padding: 8px 12px;
  background-color: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 4px;
  color: #409eff;
  font-size: 12px;
  text-align: center;
}

/* 属性管理器样式 */
.property-manager-content {
  min-height: 300px;
}

.manager-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
}

.manager-actions {
  display: flex;
  gap: 8px;
}

.manager-list {
  border: 1px solid #ebeef5;
  border-radius: 4px;
}

.manager-list :deep(.el-table) {
  border-radius: 4px;
}

.manager-list :deep(.el-table__header th) {
  background-color: #f5f7fa;
}

/* 标注模式覆盖提示 */
.annotation-overlay {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  pointer-events: none;
}

.annotation-hint-bar {
  background: rgba(59, 130, 246, 0.88);
  color: #fff;
  padding: 8px 24px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(4px);
}

/* 标注信息弹出框 */
.annotation-popup {
  position: absolute;
  z-index: 200;
  pointer-events: auto;
}

.annotation-popup-content {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  max-width: 320px;
}

.annotation-popup-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.annotation-popup-text {
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
  line-height: 1.5;
  word-break: break-all;
}

.annotation-popup-coords {
  font-size: 12px;
  color: #909399;
  margin-bottom: 10px;
  font-family: monospace;
}
</style>
