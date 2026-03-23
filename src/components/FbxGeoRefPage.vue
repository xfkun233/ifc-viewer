<template>
  <div class="geo-page">
    <aside class="panel">
      <h2>建筑配准与数据生成</h2>

      <section class="block">
        <label class="file-row">
          <span>导入 FBX（可多选）</span>
          <input type="file" accept=".fbx" multiple @change="onModelFileChange" />
        </label>
        <label class="file-row">
          <span>导入当前资产 JSON</span>
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
        <h3>资产列表（{{ assets.length }}）</h3>
        <div class="asset-list" v-if="assets.length">
          <div v-for="asset in assets" :key="asset.id" class="asset-row">
            <button
              class="secondary asset-item"
              :class="{ active: asset.id === activeAssetId }"
              @click="setActiveAsset(asset.id)"
            >
              <span>{{ asset.name }}</span>
            </button>
            <button
              class="secondary visibility-btn"
              :title="asset.visible ? '隐藏' : '显示'"
              @click.stop="toggleAssetVisibility(asset.id)"
            >
              {{ asset.visible ? '👁️' : '🚫' }}
            </button>
          </div>
        </div>
        <div class="hint" v-else>尚未导入 FBX 资产</div>
        <button class="secondary" :disabled="!activeAssetId" @click="removeActiveAsset">移除当前资产</button>
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
        <label>
          <span>高度 height (m)</span>
          <input v-model.number="baseHeight" type="number" step="0.1" />
        </label>
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
        <button @click="exportJson" :disabled="!canExport">导出当前资产 JSON</button>
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
import { applyMetersOffsetOnGeo, isGeoCoordinateValid, projectGeoToMeters } from '@/utils/geoTransform'
import { normalizeRotationAngles, rotateLocalDelta, toThreeEuler } from '@/utils/rotationTransform'

interface PickedPoint {
  id: string
  local: [number, number, number]
}

interface GeoAsset {
  id: string
  name: string
  model: Group
  baseModelY: number
  baseModelScale: Vector3
  baseGeo: GeoCoordinate
  height: number
  rotation: RotationAngles
  pickedPoints: PickedPoint[]
  geoPointMap: Record<string, [number, number]>
  fbxUnitScaleFactor: number
  fbxUnitFromMetadata: boolean
  manualMeterPerUnit: number | null
  visible: boolean
}

const pointIdOptions = ['Point_A_Base', 'Point_B_Corner', 'Point_C_Roof']
const ROTATION_MIN = -180
const ROTATION_MAX = 180
let assetIdSeed = 1

const canvasHost = ref<HTMLElement | null>(null)
const modelFileName = ref('')
const errorMessage = ref('')
const pickTip = ref('请选择点位并点击“拾取”，然后在模型上单击。')
const assets = ref<GeoAsset[]>([])
const activeAssetId = ref<string | null>(null)

const baseGeo = reactive<GeoCoordinate>({ lat: 30.12345, lon: 120.54321 })
const baseHeight = ref(0)
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
let animationFrameId = 0
let resizeObserver: ResizeObserver | null = null
let interactionElement: HTMLElement | null = null
let modelRadius = 1
let isUpdatingUiFromAsset = false

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

const activeAsset = computed(() => assets.value.find((item) => item.id === activeAssetId.value) ?? null)

const updateUiFromActiveAsset = () => {
  isUpdatingUiFromAsset = true

  const asset = activeAsset.value
  if (!asset) {
    modelFileName.value = ''
    baseGeo.lat = 30.12345
    baseGeo.lon = 120.54321
    baseHeight.value = 0
    rotation.heading = 0
    rotation.pitch = 0
    rotation.roll = 0
    pickedPoints.value = []
    fbxUnitScaleFactor.value = 100
    fbxUnitFromMetadata.value = false
    manualMeterPerUnit.value = null
    modelRoot = null
    clearSnapState()
    vertexCandidates = []
    updateMarkers()
    isUpdatingUiFromAsset = false
    return
  }

  modelFileName.value = asset.name
  baseGeo.lat = asset.baseGeo.lat
  baseGeo.lon = asset.baseGeo.lon
  baseHeight.value = asset.height
  rotation.heading = asset.rotation.heading
  rotation.pitch = asset.rotation.pitch
  rotation.roll = asset.rotation.roll
  pickedPoints.value = asset.pickedPoints.map((p) => ({ id: p.id, local: [...p.local] as [number, number, number] }))
  fbxUnitScaleFactor.value = asset.fbxUnitScaleFactor
  fbxUnitFromMetadata.value = asset.fbxUnitFromMetadata
  manualMeterPerUnit.value = asset.manualMeterPerUnit
  modelRoot = asset.model
  clearSnapState()
  vertexCandidates = []
  applyModelRotation()
  isUpdatingUiFromAsset = false
}

const syncActiveAssetFromUi = () => {
  const asset = activeAsset.value
  if (!asset) return

  asset.baseGeo = { lat: baseGeo.lat, lon: baseGeo.lon }
  asset.geoPointMap.Point_A_Base = [baseGeo.lat, baseGeo.lon]
  asset.height = Number.isFinite(baseHeight.value) ? baseHeight.value : 0
  asset.rotation = { heading: rotation.heading, pitch: rotation.pitch, roll: rotation.roll }
  asset.pickedPoints = pickedPoints.value.map((p) => ({ id: p.id, local: [...p.local] as [number, number, number] }))
  asset.fbxUnitScaleFactor = fbxUnitScaleFactor.value
  asset.fbxUnitFromMetadata = fbxUnitFromMetadata.value
  asset.manualMeterPerUnit = manualMeterPerUnit.value
}

const getMeterPerUnitForAsset = (asset: GeoAsset) => {
  if (Number.isFinite(asset.manualMeterPerUnit) && (asset.manualMeterPerUnit as number) > 0) {
    return asset.manualMeterPerUnit as number
  }

  if (Number.isFinite(asset.fbxUnitScaleFactor) && asset.fbxUnitScaleFactor > 0) {
    return asset.fbxUnitScaleFactor / 100
  }

  return 1
}

const getAssetGeoPoint = (asset: GeoAsset, id: string): GeoCoordinate | null => {
  const value = asset.geoPointMap[id]
  if (!value) return null
  const [lat, lon] = value
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

const getAssetPointALocal = (asset: GeoAsset) => {
  const pointA = asset.pickedPoints.find((p) => p.id === 'Point_A_Base')
  if (!pointA) return null
  return new Vector3(pointA.local[0], pointA.local[1], pointA.local[2])
}

const getAssetAbsoluteAnchorGeo = (asset: GeoAsset): GeoCoordinate | null => {
  return getAssetGeoPoint(asset, 'Point_A_Base')
}

const getAssetHeadingAndScaleFromGeoPoints = (asset: GeoAsset) => {
  const pointA = asset.pickedPoints.find((p) => p.id === 'Point_A_Base')
  const pointAGeo = getAssetGeoPoint(asset, 'Point_A_Base')
  if (!pointA || !pointAGeo) return null

  const secondary = asset.pickedPoints.find((p) => {
    if (p.id === 'Point_A_Base') return false
    return Boolean(getAssetGeoPoint(asset, p.id))
  })
  if (!secondary) return null

  const secondaryGeo = getAssetGeoPoint(asset, secondary.id)
  if (!secondaryGeo) return null

  const localDx = secondary.local[0] - pointA.local[0]
  const localDz = secondary.local[2] - pointA.local[2]
  const localDist = Math.hypot(localDx, localDz)
  if (!Number.isFinite(localDist) || localDist < 1e-6) return null

  const aMeters = projectGeoToMeters(pointAGeo)
  const bMeters = projectGeoToMeters(secondaryGeo)
  const worldDx = bMeters.x - aMeters.x
  const worldDz = bMeters.y - aMeters.y
  const worldDist = Math.hypot(worldDx, worldDz)
  if (!Number.isFinite(worldDist) || worldDist < 1e-6) return null

  const headingRad = Math.atan2(worldDz, worldDx) - Math.atan2(localDz, localDx)
  const meterPerUnit = worldDist / localDist
  return { headingRad, meterPerUnit }
}

const applyAssetsSpatialAlignment = () => {
  if (!assets.value.length) return

  const absoluteAnchorAsset = assets.value.find((asset) => getAssetAbsoluteAnchorGeo(asset))
  const anchorGeo = absoluteAnchorAsset ? getAssetAbsoluteAnchorGeo(absoluteAnchorAsset) : assets.value[0]?.baseGeo
  if (!anchorGeo) return
  const anchorMeters = projectGeoToMeters(anchorGeo)
  const normalizedHeights = assets.value.map((asset) => (Number.isFinite(asset.height) ? asset.height : 0))
  const minHeight = Math.min(...normalizedHeights)

  assets.value.forEach((asset) => {
    const fromGeo = getAssetHeadingAndScaleFromGeoPoints(asset)
    const meterPerUnit = fromGeo?.meterPerUnit ?? getMeterPerUnitForAsset(asset)
    asset.model.scale.copy(asset.baseModelScale).multiplyScalar(meterPerUnit)

    const euler = toThreeEuler(asset.rotation)
    if (fromGeo) {
      euler.y = fromGeo.headingRad
    }
    asset.model.rotation.copy(euler)

    const assetAnchorGeo = getAssetAbsoluteAnchorGeo(asset) ?? asset.baseGeo
    const meters = projectGeoToMeters(assetAnchorGeo)
    const targetX = meters.x - anchorMeters.x
    const targetZ = meters.y - anchorMeters.y
    const normalizedHeight = Number.isFinite(asset.height) ? asset.height : 0
    const targetY = asset.baseModelY + (normalizedHeight - minHeight)

    const pointALocal = getAssetPointALocal(asset)
    if (!pointALocal) {
      asset.model.position.set(targetX, targetY, targetZ)
      asset.model.updateMatrixWorld(true)
      return
    }

    const rotatedPointAOffset = pointALocal.multiply(asset.model.scale).applyEuler(asset.model.rotation)
    asset.model.position.set(
      targetX - rotatedPointAOffset.x,
      targetY - rotatedPointAOffset.y,
      targetZ - rotatedPointAOffset.z,
    )
    asset.model.updateMatrixWorld(true)
  })

  refreshVertexWorldPositions()
  updateMarkers()
}

const setActiveAsset = (id: string) => {
  if (activeAssetId.value === id) {
    updateUiFromActiveAsset()
    fitModel()
    updateMarkers()
    return
  }
  syncActiveAssetFromUi()
  activeAssetId.value = id
  updateUiFromActiveAsset()
  fitModel()
  updateMarkers()
}

const toggleAssetVisibility = (id: string) => {
  const asset = assets.value.find((item) => item.id === id)
  if (!asset) return
  asset.visible = !asset.visible
  asset.model.visible = asset.visible
}

const removeAssetGroup = (group: Group) => {
  if (!scene) return
  scene.remove(group)
  group.traverse((obj) => {
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
}

const removeActiveAsset = () => {
  if (!activeAsset.value) return
  const removingId = activeAsset.value.id
  removeAssetGroup(activeAsset.value.model)
  assets.value = assets.value.filter((item) => item.id !== removingId)
  applyAssetsSpatialAlignment()

  const next = assets.value[assets.value.length - 1]
  activeAssetId.value = next ? next.id : null
  updateUiFromActiveAsset()
  fitModel()
  updateMarkers()
  errorMessage.value = ''
}

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

const readUnitScaleFromModel = (group: Group) => {
  const raw = (group.userData as { unitScaleFactor?: unknown })?.unitScaleFactor
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(value) && value > 0) {
    return { unitScaleFactor: value, unitFromMetadata: true }
  }

  return { unitScaleFactor: 100, unitFromMetadata: false }
}

const normalizeRotationInputs = () => {
  const normalized = normalizeRotationAngles(rotation)
  rotation.heading = normalized.heading
  rotation.pitch = normalized.pitch
  rotation.roll = normalized.roll
  syncActiveAssetFromUi()
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

const updateSnappedVertex = (event: { clientX: number; clientY: number }) => {
  if (!pendingPickId.value || !interactionElement || !camera || !modelRoot) {
    clearSnapState()
    return
  }

  const rect = interactionElement.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  pointer.x = (localX / rect.width) * 2 - 1
  pointer.y = -(localY / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)

  const hits = raycaster.intersectObject(modelRoot, true)
  if (!hits.length) {
    clearSnapState()
    return
  }

  let bestVertexWorld: Vector3 | null = null
  let bestVertexToHitDistance = Number.POSITIVE_INFINITY

  for (const hit of hits) {
    const mesh = hit.object as Mesh
    const face = hit.face
    const position = mesh.geometry?.getAttribute?.('position')
    if (!face || !position) continue

    const va = new Vector3().fromBufferAttribute(position, face.a)
    const vb = new Vector3().fromBufferAttribute(position, face.b)
    const vc = new Vector3().fromBufferAttribute(position, face.c)

    mesh.localToWorld(va)
    mesh.localToWorld(vb)
    mesh.localToWorld(vc)

    const da = va.distanceToSquared(hit.point)
    if (da < bestVertexToHitDistance) {
      bestVertexToHitDistance = da
      bestVertexWorld = va.clone()
    }

    const db = vb.distanceToSquared(hit.point)
    if (db < bestVertexToHitDistance) {
      bestVertexToHitDistance = db
      bestVertexWorld = vb.clone()
    }

    const dc = vc.distanceToSquared(hit.point)
    if (dc < bestVertexToHitDistance) {
      bestVertexToHitDistance = dc
      bestVertexWorld = vc.clone()
    }

    if (bestVertexWorld) {
      break
    }
  }

  if (!bestVertexWorld) {
    clearSnapState()
    return
  }

  const localHit = bestVertexWorld.clone()
  modelRoot.worldToLocal(localHit)

  const bestCandidate: VertexCandidate = {
    modelLocal: localHit,
    world: bestVertexWorld,
  }

  const projected = bestVertexWorld.clone().project(camera)
  const bestScreenX = (projected.x * 0.5 + 0.5) * rect.width
  const bestScreenY = (-projected.y * 0.5 + 0.5) * rect.height

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
  applyAssetsSpatialAlignment()
}

const renderLoop = () => {
  animationFrameId = requestAnimationFrame(renderLoop)
  controls?.update()
  if (scene && camera && renderer) {
    renderer.render(scene, camera)
  }
}

const disposeAllAssets = () => {
  assets.value.forEach((asset) => removeAssetGroup(asset.model))
  assets.value = []
  activeAssetId.value = null
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

  const loader = new FBXLoader()
  const objectUrl = URL.createObjectURL(file)

  loader.load(
    objectUrl,
    (group) => {
      if (!scene) return
      group.name = file.name
      applyOvLikeDoubleSide(group)
      scene.add(group)

      const unit = readUnitScaleFromModel(group)
      const asset: GeoAsset = {
        id: `asset-${assetIdSeed++}`,
        name: file.name,
        model: group,
        baseModelY: group.position.y,
        baseModelScale: group.scale.clone(),
        baseGeo: { lat: 30.12345, lon: 120.54321 },
        height: 0,
        rotation: { heading: 0, pitch: 0, roll: 0 },
        pickedPoints: [],
        geoPointMap: {},
        fbxUnitScaleFactor: unit.unitScaleFactor,
        fbxUnitFromMetadata: unit.unitFromMetadata,
        manualMeterPerUnit: null,
        visible: true,
      }

      syncActiveAssetFromUi()
      assets.value.push(asset)
      applyAssetsSpatialAlignment()
      activeAssetId.value = asset.id
      updateUiFromActiveAsset()
      fitModel()
      updateMarkers()

      URL.revokeObjectURL(objectUrl)
    },
    undefined,
    () => {
      errorMessage.value = 'FBX 加载失败，请检查文件是否有效。'
      URL.revokeObjectURL(objectUrl)
    },
  )
}

const onModelFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length) {
    files.forEach((file) => loadModelFromFile(file))
  }
  input.value = ''
}

const startPick = () => {
  if (!activeAsset.value) {
    errorMessage.value = '请先导入至少一个 FBX 资产。'
    return
  }
  if (!modelRoot) {
    errorMessage.value = '当前没有可拾取的激活资产。'
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
  const asset = activeAsset.value
  if (asset && id !== 'Point_A_Base') {
    delete asset.geoPointMap[id]
  }
  syncActiveAssetFromUi()
  applyAssetsSpatialAlignment()
}

const removePoint = (id: string) => {
  pickedPoints.value = pickedPoints.value.filter((p) => p.id !== id)
  const asset = activeAsset.value
  if (asset) {
    delete asset.geoPointMap[id]
  }
  syncActiveAssetFromUi()
  applyAssetsSpatialAlignment()
  updateMarkers()
}

const onCanvasPointerDown = (event: PointerEvent) => {
  if (!pendingPickId.value) return

  if (event.button === 2) {
    pendingPickId.value = null
    clearSnapState()
    pickTip.value = '已取消当前拾取。'
    return
  }

  if (event.button !== 0) return
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
  syncActiveAssetFromUi()
}

const onCanvasContextMenu = (event: MouseEvent) => {
  if (pendingPickId.value) {
    event.preventDefault()
  }
}

const onCanvasPointerMove = (event: PointerEvent) => {
  updateSnappedVertex(event)
}

const onCanvasPointerLeave = () => {
  clearSnapState()
}

const exportJson = () => {
  if (!activeAsset.value) {
    errorMessage.value = '请先选择一个资产再导出 JSON。'
    return
  }

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
    height: Number.isFinite(baseHeight.value) ? baseHeight.value : 0,
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
  if (!activeAsset.value) {
    errorMessage.value = '请先选择一个资产，再导入 JSON。'
    const input = event.target as HTMLInputElement
    input.value = ''
    return
  }

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
    const importedHeight = parsed.height
    baseHeight.value = typeof importedHeight === 'number' && Number.isFinite(importedHeight) ? importedHeight : 0

    if (parsed.unit && Number.isFinite(parsed.unit.meter_per_unit) && parsed.unit.meter_per_unit > 0) {
      manualMeterPerUnit.value = parsed.unit.meter_per_unit
    }

    baseGeo.lat = importedPointA.geo[0]
    baseGeo.lon = importedPointA.geo[1]

    pickedPoints.value = parsed.points.map((p) => ({
      id: p.id,
      local: [p.local[0], p.local[1], p.local[2]],
    }))

    const asset = activeAsset.value
    if (asset) {
      const nextGeoPointMap: Record<string, [number, number]> = {}
      parsed.points.forEach((p) => {
        if (Number.isFinite(p.geo[0]) && Number.isFinite(p.geo[1])) {
          nextGeoPointMap[p.id] = [p.geo[0], p.geo[1]]
        }
      })
      asset.geoPointMap = nextGeoPointMap
    }

    syncActiveAssetFromUi()
    applyAssetsSpatialAlignment()
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
    if (isUpdatingUiFromAsset) return
    syncActiveAssetFromUi()
    applyModelRotation()
  },
)

watch(
  () => [baseGeo.lat, baseGeo.lon],
  () => {
    if (isUpdatingUiFromAsset) return
    syncActiveAssetFromUi()
    applyAssetsSpatialAlignment()
  },
)

watch(baseHeight, () => {
  if (isUpdatingUiFromAsset) return
  syncActiveAssetFromUi()
  applyAssetsSpatialAlignment()
})

watch(manualMeterPerUnit, () => {
  if (isUpdatingUiFromAsset) return
  syncActiveAssetFromUi()
  applyAssetsSpatialAlignment()
})

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
  interactionElement.addEventListener('contextmenu', onCanvasContextMenu)
  interactionElement.addEventListener('pointerleave', onCanvasPointerLeave)
  renderLoop()
})

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId)

  if (interactionElement) {
    interactionElement.removeEventListener('pointermove', onCanvasPointerMove)
    interactionElement.removeEventListener('pointerdown', onCanvasPointerDown)
    interactionElement.removeEventListener('contextmenu', onCanvasContextMenu)
    interactionElement.removeEventListener('pointerleave', onCanvasPointerLeave)
    interactionElement = null
  }

  resizeObserver?.disconnect()

  disposeAllAssets()
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

.asset-list {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}

.asset-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
}

.asset-item {
  text-align: left;
}

.asset-item.active {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
}

.visibility-btn {
  min-width: 36px;
  padding: 8px 6px;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
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
