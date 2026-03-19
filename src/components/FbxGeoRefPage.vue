<template>
  <div class="geo-page">
    <aside class="panel">
      <h2>建筑配准与数据生成</h2>

      <section class="block">
        <label class="file-row">
          <span>建筑 FBX</span>
          <input type="file" accept=".fbx" @change="onModelFileChange" />
        </label>
        <label class="file-row">
          <span>导入 JSON</span>
          <input type="file" accept=".json" @change="onImportJsonChange" />
        </label>
        <label>
          <span>手动单位换算（1 单位 = ? 米）</span>
          <input v-model.number="manualMeterPerUnit" type="number" step="0.000001" min="0.000001" />
        </label>
        <div class="hint">当前模型：{{ modelFileName || '未加载' }}</div>
        <div class="hint">距离单位：{{ unitDisplayText }}</div>
      </section>

      <section class="block">
        <h3>基准点 A 经纬度</h3>
        <div class="grid2">
          <label>
            <span>纬度 lat</span>
            <input v-model.number="baseGeo.lat" type="number" step="0.000001" />
          </label>
          <label>
            <span>经度 lon</span>
            <input v-model.number="baseGeo.lon" type="number" step="0.000001" />
          </label>
        </div>
      </section>

      <section class="block">
        <h3>姿态角（度）</h3>
        <div class="grid3">
          <label>
            <span>Heading</span>
            <input
              v-model.number="rotation.heading"
              type="number"
              step="0.1"
              :min="ROTATION_MIN"
              :max="ROTATION_MAX"
              @blur="normalizeRotationInputs"
              @change="normalizeRotationInputs"
            />
          </label>
          <label>
            <span>Pitch</span>
            <input
              v-model.number="rotation.pitch"
              type="number"
              step="0.1"
              :min="ROTATION_MIN"
              :max="ROTATION_MAX"
              @blur="normalizeRotationInputs"
              @change="normalizeRotationInputs"
            />
          </label>
          <label>
            <span>Roll</span>
            <input
              v-model.number="rotation.roll"
              type="number"
              step="0.1"
              :min="ROTATION_MIN"
              :max="ROTATION_MAX"
              @blur="normalizeRotationInputs"
              @change="normalizeRotationInputs"
            />
          </label>
        </div>
        <div class="hint">范围：{{ ROTATION_MIN }}° 到 {{ ROTATION_MAX }}°（超出会自动折返归一化）</div>
      </section>

      <section class="block">
        <h3>拾取点位</h3>
        <div class="pick-row">
          <select v-model="activePickId">
            <option v-for="id in pointIdOptions" :key="id" :value="id">{{ id }}</option>
          </select>
          <button @click="startPick">拾取 {{ activePickId }}</button>
          <button class="secondary" @click="removePoint(activePickId)">清除当前</button>
        </div>
        <div class="hint">{{ pickTip }}</div>
      </section>

      <section class="block">
        <h3>点位结果</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Local (x,y,z)</th>
                <th>到基准点距离 (m)</th>
                <th>Geo [lat, lon]</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in calculatedPoints" :key="p.id">
                <td>{{ p.id }}</td>
                <td>{{ formatVec3(p.local) }}</td>
                <td>{{ formatDistanceToBase(p.local) }}</td>
                <td>{{ formatGeo(p.geo) }}</td>
              </tr>
              <tr v-if="!calculatedPoints.length">
                <td colspan="4">尚未拾取点</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="actions">
        <button @click="exportJson" :disabled="!canExport">导出 JSON</button>
      </section>

      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    </aside>

    <main ref="canvasHost" class="viewport" :class="{ 'is-picking': Boolean(pendingPickId) }">
      <div
        v-if="showSnapCursor"
        class="snap-cursor"
        :style="{ left: `${snapCursor.x}px`, top: `${snapCursor.y}px` }"
      ></div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  AmbientLight,
  AxesHelper,
  BackSide,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  GridHelper,
  MeshBasicMaterial,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import type { GeoCoordinate, PlacementExportJson, PlacementPoint, RotationAngles } from '@/types/geoPlacement'
import { applyMetersOffsetOnGeo, isGeoCoordinateValid } from '@/utils/geoTransform'
import { normalizeRotationAngles, rotateLocalDelta, toThreeEuler } from '@/utils/rotationTransform'

interface PickedPoint {
  id: string
  local: [number, number, number]
}

const pointIdOptions = ['Point_A_Base', 'Point_B_Corner', 'Point_C_Roof']
const ROTATION_MIN = -180
const ROTATION_MAX = 180

const canvasHost = ref<HTMLElement | null>(null)
const modelFileName = ref('')
const errorMessage = ref('')
const pickTip = ref('请选择点位并点击“拾取”，然后在模型上单击。')

const baseGeo = reactive<GeoCoordinate>({ lat: 30.12345, lon: 120.54321 })
const rotation = reactive<RotationAngles>({ heading: 0, pitch: 0, roll: 0 })

const activePickId = ref<string>('Point_A_Base')
const pendingPickId = ref<string | null>(null)
const pickedPoints = ref<PickedPoint[]>([])
const fbxUnitScaleFactor = ref(100)
const fbxUnitFromMetadata = ref(false)
const manualMeterPerUnit = ref<number | null>(null)
const showSnapCursor = ref(false)
const snapCursor = reactive({ x: 0, y: 0 })

let scene: Scene | null = null
let camera: PerspectiveCamera | null = null
let renderer: WebGLRenderer | null = null
let controls: OrbitControls | null = null
let modelRoot: Group | null = null
let modelObjectUrl = ''
let animationFrameId = 0
let resizeObserver: ResizeObserver | null = null
let interactionElement: HTMLElement | null = null
let modelRadius = 1

const markerGroup = new Group()
const hoverGroup = new Group()
const raycaster = new Raycaster()
const pointer = new Vector2()
const hoverMarker = new Mesh(
  new SphereGeometry(0.12, 20, 20),
  new MeshBasicMaterial({ color: 0x16a34a, depthTest: false, depthWrite: false }),
)

interface VertexCandidate {
  modelLocal: Vector3
  world: Vector3
}

let vertexCandidates: VertexCandidate[] = []
let snappedCandidate: VertexCandidate | null = null

const formatNumber = (value: number, digits = 3) => {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

const formatVec3 = (local: [number, number, number]) => {
  return `[${formatNumber(local[0])}, ${formatNumber(local[1])}, ${formatNumber(local[2])}]`
}

const formatGeo = (geo: [number, number] | null) => {
  if (!geo) return '--'
  return `[${formatNumber(geo[0], 6)}, ${formatNumber(geo[1], 6)}]`
}

const meterPerModelUnit = computed(() => {
  const manual = manualMeterPerUnit.value
  if (Number.isFinite(manual) && (manual as number) > 0) {
    return manual as number
  }

  const scale = fbxUnitScaleFactor.value
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return scale / 100
})

const unitDisplayText = computed(() => {
  if (Number.isFinite(manualMeterPerUnit.value) && (manualMeterPerUnit.value as number) > 0) {
    return `手动输入（1 单位=${formatNumber(manualMeterPerUnit.value as number, 6)} m）`
  }

  const sourceText = fbxUnitFromMetadata.value ? '来自 FBX 元数据' : '未检测到元数据，按 1 单位 = 1 米'
  return `${sourceText}（UnitScaleFactor=${formatNumber(fbxUnitScaleFactor.value, 3)}，1 单位=${formatNumber(
    meterPerModelUnit.value,
    6,
  )} m）`
})

const formatDistanceToBase = (local: [number, number, number]) => {
  const pointA = pointAModel.value
  if (!pointA) return '--'

  const dx = local[0] - pointA.local[0]
  const dy = local[1] - pointA.local[1]
  const dz = local[2] - pointA.local[2]
  const distance = Math.hypot(dx, dy, dz) * meterPerModelUnit.value
  return formatNumber(distance, 3)
}

const updateUnitScaleFromModel = (group: Group) => {
  const raw = (group.userData as { unitScaleFactor?: unknown })?.unitScaleFactor
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(value) && value > 0) {
    fbxUnitScaleFactor.value = value
    fbxUnitFromMetadata.value = true
    return
  }

  fbxUnitScaleFactor.value = 100
  fbxUnitFromMetadata.value = false
}

const normalizeRotationInputs = () => {
  const normalized = normalizeRotationAngles(rotation)
  rotation.heading = normalized.heading
  rotation.pitch = normalized.pitch
  rotation.roll = normalized.roll
}

const pointAModel = computed(() => pickedPoints.value.find((p) => p.id === 'Point_A_Base') ?? null)

const calculatedPoints = computed<PlacementPoint[]>(() => {
  const pointA = pointAModel.value
  if (!pointA) {
    return pickedPoints.value.map((p) => ({ id: p.id, local: p.local, geo: [NaN, NaN] }))
  }

  const normalized = normalizeRotationAngles(rotation)
  const scaleToMeters = meterPerModelUnit.value
  return pickedPoints.value.map((p) => {
    if (p.id === 'Point_A_Base') {
      return { id: p.id, local: p.local, geo: [baseGeo.lat, baseGeo.lon] }
    }

    const delta = {
      x: p.local[0] - pointA.local[0],
      y: p.local[1] - pointA.local[1],
      z: p.local[2] - pointA.local[2],
    }
    const rotated = rotateLocalDelta(delta, normalized)
    const geo = applyMetersOffsetOnGeo(baseGeo, rotated.x * scaleToMeters, rotated.z * scaleToMeters)

    return {
      id: p.id,
      local: p.local,
      geo: [geo.lat, geo.lon],
    }
  })
})

const canExport = computed(() => {
  return (
    Boolean(modelFileName.value) &&
    Boolean(pointAModel.value) &&
    isGeoCoordinateValid(baseGeo) &&
    calculatedPoints.value.length > 0 &&
    calculatedPoints.value.every((p) => Number.isFinite(p.geo[0]) && Number.isFinite(p.geo[1]))
  )
})

const updateMarkers = () => {
  markerGroup.clear()

  if (modelRoot && markerGroup.parent !== modelRoot) {
    modelRoot.add(markerGroup)
  }
  if (!modelRoot && scene && markerGroup.parent !== scene) {
    scene.add(markerGroup)
  }

  const markerRadius = Math.min(8, Math.max(0.12, modelRadius * 0.015))

  for (const p of pickedPoints.value) {
    const marker = new Mesh(
      new SphereGeometry(markerRadius, 20, 20),
      new MeshBasicMaterial({
        color: 0xff5533,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.96,
      }),
    )
    const outline = new Mesh(
      new SphereGeometry(markerRadius * 1.25, 20, 20),
      new MeshBasicMaterial({
        color: 0x111827,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      }),
    )

    marker.position.set(p.local[0], p.local[1], p.local[2])
    outline.position.copy(marker.position)
    marker.renderOrder = 10
    outline.renderOrder = 9
    marker.frustumCulled = false
    outline.frustumCulled = false

    marker.userData.pointId = p.id
    outline.userData.pointId = p.id
    markerGroup.add(outline)
    markerGroup.add(marker)
  }
}

const clearSnapState = () => {
  snappedCandidate = null
  showSnapCursor.value = false
  hoverGroup.visible = false
}

const refreshVertexWorldPositions = () => {
  if (!modelRoot) return
  modelRoot.updateMatrixWorld(true)
  for (const candidate of vertexCandidates) {
    candidate.world.copy(candidate.modelLocal)
    modelRoot.localToWorld(candidate.world)
  }
}

const rebuildVertexCandidates = () => {
  if (!modelRoot) return

  const unique = new Set<string>()
  const collected: VertexCandidate[] = []
  const modelLocal = new Vector3()
  const world = new Vector3()
  const maxVertexCount = 240_000

  modelRoot.updateMatrixWorld(true)
  modelRoot.traverse((obj) => {
    const mesh = obj as Mesh
    const position = mesh.geometry?.getAttribute?.('position')
    if (!position || !mesh.geometry) return

    const stride = Math.max(1, Math.floor(position.count / maxVertexCount))
    for (let i = 0; i < position.count; i += stride) {
      world.fromBufferAttribute(position, i)
      mesh.localToWorld(world)
      modelLocal.copy(world)
      modelRoot?.worldToLocal(modelLocal)

      const key = `${Math.round(modelLocal.x * 1000)}_${Math.round(modelLocal.y * 1000)}_${Math.round(modelLocal.z * 1000)}`
      if (unique.has(key)) continue
      unique.add(key)

      collected.push({
        modelLocal: modelLocal.clone(),
        world: world.clone(),
      })
    }
  })

  vertexCandidates = collected
  refreshVertexWorldPositions()
}

const updateSnappedVertex = (event: { clientX: number; clientY: number }) => {
  if (!pendingPickId.value || !interactionElement || !camera || !modelRoot || !vertexCandidates.length) {
    clearSnapState()
    return
  }

  const rect = interactionElement.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  pointer.x = (localX / rect.width) * 2 - 1
  pointer.y = -(localY / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)

  const maxSnapPixels = 18
  let bestCandidate: VertexCandidate | null = null
  let bestScreenX = 0
  let bestScreenY = 0
  let bestScore = Number.POSITIVE_INFINITY
  const projected = new Vector3()

  for (const candidate of vertexCandidates) {
    projected.copy(candidate.world).project(camera)
    if (projected.z < -1 || projected.z > 1) continue

    const sx = (projected.x * 0.5 + 0.5) * rect.width
    const sy = (-projected.y * 0.5 + 0.5) * rect.height
    const screenDistance = Math.hypot(localX - sx, localY - sy)
    if (screenDistance > maxSnapPixels) continue

    const rayDistance = raycaster.ray.distanceToPoint(candidate.world)
    const score = screenDistance * 0.75 + rayDistance * 25

    if (score < bestScore) {
      bestScore = score
      bestCandidate = candidate
      bestScreenX = sx
      bestScreenY = sy
    }
  }

  if (!bestCandidate) {
    clearSnapState()
    return
  }

  snappedCandidate = bestCandidate
  hoverGroup.visible = true
  hoverMarker.position.copy(bestCandidate.world)
  const distanceToCamera = camera.position.distanceTo(bestCandidate.world)
  const markerScale = Math.max(modelRadius * 0.006, distanceToCamera * 0.004)
  hoverMarker.scale.setScalar(markerScale)

  snapCursor.x = bestScreenX
  snapCursor.y = bestScreenY
  showSnapCursor.value = true
}

const fitModel = () => {
  if (!modelRoot || !camera || !controls) return

  const box = new Box3().setFromObject(modelRoot)
  if (box.isEmpty()) return

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1
  modelRadius = radius

  controls.target.copy(center)
  camera.position.set(center.x + radius * 1.6, center.y + radius * 1.2, center.z + radius * 1.6)
  camera.near = Math.max(0.1, radius / 100)
  camera.far = radius * 200
  camera.updateProjectionMatrix()
  controls.update()
}

const applyModelRotation = () => {
  if (!modelRoot) return
  modelRoot.rotation.copy(toThreeEuler(rotation))
  refreshVertexWorldPositions()
  updateMarkers()
}

const renderLoop = () => {
  animationFrameId = requestAnimationFrame(renderLoop)
  controls?.update()
  if (scene && camera && renderer) {
    renderer.render(scene, camera)
  }
}

const disposeModel = () => {
  if (!modelRoot || !scene) return
  scene.remove(modelRoot)
  modelRoot.traverse((obj) => {
    const mesh = obj as Mesh
    if (mesh.geometry) {
      mesh.geometry.dispose?.()
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
  modelRoot = null
  modelRadius = 1
}

const applyOvLikeDoubleSide = (group: Group) => {
  group.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh || !mesh.material) return

    const applySide = (material: { side: number; needsUpdate: boolean }) => {
      material.side = DoubleSide
      material.needsUpdate = true
    }

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => applySide(material))
    } else {
      applySide(mesh.material)
    }
  })
}

const loadModelFromFile = (file: File) => {
  if (!scene) return

  errorMessage.value = ''
  modelFileName.value = file.name
  pickedPoints.value = []
  fbxUnitScaleFactor.value = 100
  fbxUnitFromMetadata.value = false
  updateMarkers()

  disposeModel()
  if (modelObjectUrl) {
    URL.revokeObjectURL(modelObjectUrl)
    modelObjectUrl = ''
  }

  const loader = new FBXLoader()
  modelObjectUrl = URL.createObjectURL(file)

  loader.load(
    modelObjectUrl,
    (group) => {
      if (!scene) return
      group.name = file.name
      updateUnitScaleFromModel(group)
      applyOvLikeDoubleSide(group)
      modelRoot = group
      applyModelRotation()
      scene.add(group)
      rebuildVertexCandidates()
      clearSnapState()
      fitModel()
      URL.revokeObjectURL(modelObjectUrl)
      modelObjectUrl = ''
    },
    undefined,
    () => {
      errorMessage.value = 'FBX 加载失败，请检查文件是否有效。'
    },
  )
}

const onModelFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    loadModelFromFile(file)
  }
  input.value = ''
}

const startPick = () => {
  if (!modelRoot) {
    errorMessage.value = '请先加载建筑 FBX。'
    return
  }
  if (!vertexCandidates.length) {
    errorMessage.value = '当前模型没有可吸附顶点，无法拾取。'
    return
  }
  pendingPickId.value = activePickId.value
  pickTip.value = `移动鼠标会吸附到最近顶点，单击记录 ${activePickId.value}。`
}

const upsertPoint = (id: string, local: [number, number, number]) => {
  const index = pickedPoints.value.findIndex((p) => p.id === id)
  if (index === -1) {
    pickedPoints.value.push({ id, local })
  } else {
    pickedPoints.value[index] = { id, local }
  }
}

const removePoint = (id: string) => {
  pickedPoints.value = pickedPoints.value.filter((p) => p.id !== id)
  updateMarkers()
}

const onCanvasPointerDown = (event: { clientX: number; clientY: number }) => {
  if (!pendingPickId.value || !modelRoot || !interactionElement || !camera) return
  updateSnappedVertex(event)

  let pickedLocal: [number, number, number] | null = null
  let usedSurfaceFallback = false

  if (snappedCandidate) {
    pickedLocal = [snappedCandidate.modelLocal.x, snappedCandidate.modelLocal.y, snappedCandidate.modelLocal.z]
  } else {
    const rect = interactionElement.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    pointer.x = (localX / rect.width) * 2 - 1
    pointer.y = -(localY / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObject(modelRoot, true)
    if (!hits.length) {
      pickTip.value = '未命中模型表面，请将鼠标移动到模型上后再点击。'
      return
    }

    const firstHit = hits[0]
    if (!firstHit) {
      pickTip.value = '未命中模型表面，请将鼠标移动到模型上后再点击。'
      return
    }

    const localHit = firstHit.point.clone()
    modelRoot.worldToLocal(localHit)
    pickedLocal = [localHit.x, localHit.y, localHit.z]
    usedSurfaceFallback = true
  }

  const id = pendingPickId.value
  upsertPoint(id, pickedLocal)
  pendingPickId.value = null
  pickTip.value = usedSurfaceFallback
    ? `${id} 已记录（表面命中）：${formatVec3(pickedLocal)}`
    : `${id} 已记录：${formatVec3(pickedLocal)}`
  console.info('[GeoRefPick] recorded', {
    id,
    local: pickedLocal,
    total: pickedPoints.value.length,
    fallback: usedSurfaceFallback,
  })
  clearSnapState()
  updateMarkers()
}

const onCanvasPointerMove = (event: PointerEvent) => {
  updateSnappedVertex(event)
}

const onCanvasPointerLeave = () => {
  clearSnapState()
}

const exportJson = () => {
  if (!canExport.value) {
    errorMessage.value = '导出条件不足：请确认模型、Point_A 与经纬度输入。'
    return
  }

  const hasManualUnit = Number.isFinite(manualMeterPerUnit.value) && (manualMeterPerUnit.value as number) > 0
  const unitSource: 'manual' | 'fbx-metadata' | 'default' = hasManualUnit
    ? 'manual'
    : fbxUnitFromMetadata.value
      ? 'fbx-metadata'
      : 'default'

  const json: PlacementExportJson = {
    model_name: modelFileName.value,
    rotation: normalizeRotationAngles(rotation),
    points: calculatedPoints.value,
    unit: {
      meter_per_unit: meterPerModelUnit.value,
      unit_scale_factor: fbxUnitScaleFactor.value,
      source: unitSource,
    },
  }

  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${modelFileName.value.replace(/\.fbx$/i, '') || 'building'}_placement.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const onImportJsonChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as PlacementExportJson

    if (!parsed.rotation || !Array.isArray(parsed.points) || !parsed.points.length) {
      throw new Error('JSON 结构缺少 rotation 或 points。')
    }

    const importedPointA = parsed.points.find((p) => p.id === 'Point_A_Base')
    if (!importedPointA) {
      throw new Error('JSON 缺少 Point_A_Base。')
    }

    rotation.heading = parsed.rotation.heading
    rotation.pitch = parsed.rotation.pitch
    rotation.roll = parsed.rotation.roll

    if (parsed.unit && Number.isFinite(parsed.unit.meter_per_unit) && parsed.unit.meter_per_unit > 0) {
      manualMeterPerUnit.value = parsed.unit.meter_per_unit
    }

    baseGeo.lat = importedPointA.geo[0]
    baseGeo.lon = importedPointA.geo[1]

    pickedPoints.value = parsed.points.map((p) => ({
      id: p.id,
      local: [p.local[0], p.local[1], p.local[2]],
    }))
    updateMarkers()
    applyModelRotation()
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'JSON 导入失败。'
  } finally {
    input.value = ''
  }
}

watch(
  () => ({ ...rotation }),
  () => {
    applyModelRotation()
  },
)

onMounted(() => {
  if (!canvasHost.value) return

  scene = new Scene()
  scene.background = new Color('#f0f3f8')
  scene.add(markerGroup)
  hoverGroup.visible = false
  hoverGroup.add(hoverMarker)
  scene.add(hoverGroup)

  const width = canvasHost.value.clientWidth
  const height = canvasHost.value.clientHeight

  camera = new PerspectiveCamera(50, Math.max(width / height, 0.1), 0.1, 5000)
  camera.position.set(8, 6, 8)

  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(width, height)
  canvasHost.value.appendChild(renderer.domElement)
  interactionElement = renderer.domElement

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  const ambient = new AmbientLight(0xffffff, 0.7)
  const dir = new DirectionalLight(0xffffff, 1)
  dir.position.set(8, 12, 10)
  const grid = new GridHelper(200, 80, 0x7a8ca5, 0xb7c2d3)
  const axes = new AxesHelper(5)

  scene.add(ambient, dir, grid, axes)

  resizeObserver = new ResizeObserver(() => {
    if (!canvasHost.value || !camera || !renderer) return
    const w = canvasHost.value.clientWidth
    const h = canvasHost.value.clientHeight
    camera.aspect = Math.max(w / h, 0.1)
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(canvasHost.value)

  interactionElement.addEventListener('pointermove', onCanvasPointerMove)
  interactionElement.addEventListener('pointerdown', onCanvasPointerDown)
  interactionElement.addEventListener('click', onCanvasPointerDown)
  interactionElement.addEventListener('pointerleave', onCanvasPointerLeave)
  renderLoop()
})

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId)

  if (interactionElement) {
    interactionElement.removeEventListener('pointermove', onCanvasPointerMove)
    interactionElement.removeEventListener('pointerdown', onCanvasPointerDown)
    interactionElement.removeEventListener('click', onCanvasPointerDown)
    interactionElement.removeEventListener('pointerleave', onCanvasPointerLeave)
    interactionElement = null
  }

  resizeObserver?.disconnect()

  if (modelObjectUrl) {
    URL.revokeObjectURL(modelObjectUrl)
    modelObjectUrl = ''
  }

  disposeModel()
  markerGroup.clear()
  hoverGroup.clear()
  vertexCandidates = []
  clearSnapState()

  controls?.dispose()
  renderer?.dispose()

  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }

  controls = null
  renderer = null
  camera = null
  scene = null
})
</script>

<style scoped>
.geo-page {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 380px 1fr;
  background: radial-gradient(circle at 15% 0%, #f8fbff 0%, #eef4fa 42%, #e6edf5 100%);
}

.panel {
  height: 100%;
  overflow: auto;
  padding: 16px;
  border-right: 1px solid #d6e0eb;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(6px);
}

.panel h2 {
  font-size: 20px;
  color: #102a43;
  margin-bottom: 14px;
}

.block {
  margin-bottom: 14px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #dde6ef;
  background: #fdfefe;
}

.block h3 {
  font-size: 14px;
  margin-bottom: 10px;
  color: #334e68;
}

.grid2,
.grid3 {
  display: grid;
  gap: 8px;
}

.grid2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #486581;
}

input,
select,
button {
  width: 100%;
  min-width: 0;
  border: 1px solid #c6d1df;
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
}

button {
  cursor: pointer;
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
  transition: background-color 0.2s ease;
}

button:hover {
  background: #165dcc;
}

button.secondary {
  background: #eef3f8;
  border-color: #c6d1df;
  color: #243b53;
}

button.secondary:hover {
  background: #dfe8f2;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.file-row {
  margin-bottom: 8px;
}

.pick-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.pick-row button {
  white-space: normal;
  line-height: 1.2;
}

.table-wrap {
  max-height: 220px;
  overflow: auto;
}

.table-wrap table {
  width: 100%;
  border-collapse: collapse;
}

.table-wrap th,
.table-wrap td {
  border: 1px solid #e2e8f0;
  padding: 6px;
  font-size: 12px;
  color: #334155;
  white-space: normal;
  word-break: break-word;
}

.hint {
  margin-top: 8px;
  font-size: 12px;
  color: #627d98;
  overflow-wrap: anywhere;
}

.actions {
  margin-bottom: 14px;
}

.error {
  font-size: 12px;
  padding: 10px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  background: #fff1f2;
}

.viewport {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewport.is-picking {
  cursor: crosshair;
}

.snap-cursor {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #16a34a;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9), 0 0 14px rgba(22, 163, 74, 0.35);
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 20;
}

@media (max-width: 1100px) {
  .geo-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .panel {
    max-height: 45vh;
    border-right: none;
    border-bottom: 1px solid #d6e0eb;
  }

  .grid3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pick-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .grid2,
  .grid3,
  .pick-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .table-wrap th,
  .table-wrap td {
    font-size: 11px;
  }
}
</style>
