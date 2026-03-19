<template>
  <div class="terrain-page">
    <aside class="panel">
      <h2>地形整合与自动落位</h2>

      <section class="block">
        <label class="file-row">
          <span>地形 FBX</span>
          <input type="file" accept=".fbx" @change="onTerrainFileChange" />
        </label>
        <label class="file-row">
          <span>建筑 FBX</span>
          <input type="file" accept=".fbx" @change="onBuildingFileChange" />
        </label>
        <label class="file-row">
          <span>建筑 JSON</span>
          <input type="file" accept=".json" @change="onPlacementJsonChange" />
        </label>
        <div class="hint">地形：{{ terrainFileName || '未加载' }}</div>
        <div class="hint">建筑：{{ buildingFileName || '未加载' }}</div>
      </section>

      <section class="block">
        <h3>地形四角经纬度（[lat, lon]）</h3>
        <div class="corner-grid">
          <div v-for="corner in cornerOrder" :key="corner" class="corner-item">
            <div class="corner-title">{{ corner.toUpperCase() }}</div>
            <label>
              <span>lat</span>
              <input v-model.number="geoCorners[corner].lat" type="number" step="0.000001" />
            </label>
            <label>
              <span>lon</span>
              <input v-model.number="geoCorners[corner].lon" type="number" step="0.000001" />
            </label>
          </div>
        </div>
        <button class="secondary" @click="buildMapping">建立映射</button>
      </section>

      <section class="block">
        <h3>自动落位</h3>
        <button @click="alignBuilding">执行自动落位</button>
        <div class="hint">Point_A 目标：{{ targetText }}</div>
      </section>

      <section class="block">
        <h3>高度微调 (Y)</h3>
        <input v-model.number="heightOffset" type="range" min="-50" max="50" step="0.1" @input="applyHeightOffset" />
        <div class="hint">当前偏移：{{ heightOffset.toFixed(1) }} m</div>
        <button class="secondary" @click="resetHeightOffset">重置高度偏移</button>
      </section>

      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    </aside>

    <main ref="canvasHost" class="viewport"></main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import type {
  PlacementExportJson,
  TerrainCornerGeo,
  TerrainCornerLocal,
  Vector2Like,
} from '@/types/geoPlacement'
import { isGeoCoordinateValid } from '@/utils/geoTransform'
import { toThreeEuler } from '@/utils/rotationTransform'
import { createTerrainAffineMapping, type TerrainGeoMapping } from '@/utils/terrainMapping'

type CornerId = 'nw' | 'ne' | 'se' | 'sw'

const cornerOrder: CornerId[] = ['nw', 'ne', 'se', 'sw']

const canvasHost = ref<HTMLElement | null>(null)
const terrainFileName = ref('')
const buildingFileName = ref('')
const errorMessage = ref('')
const heightOffset = ref(0)

const geoCorners = reactive<Record<CornerId, { lat: number; lon: number }>>({
  nw: { lat: 30.1236, lon: 120.5430 },
  ne: { lat: 30.1236, lon: 120.5440 },
  se: { lat: 30.1229, lon: 120.5440 },
  sw: { lat: 30.1229, lon: 120.5430 },
})

const placementJson = ref<PlacementExportJson | null>(null)
const targetPosition = ref<Vector2Like | null>(null)

let terrainModel: Group | null = null
let buildingModel: Group | null = null
let mapping: TerrainGeoMapping | null = null
let alignedBaseY: number | null = null

let scene: Scene | null = null
let camera: PerspectiveCamera | null = null
let renderer: WebGLRenderer | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrameId = 0

let terrainObjectUrl = ''
let buildingObjectUrl = ''

const targetMarker = new Mesh(
  new SphereGeometry(0.5, 18, 18),
  new MeshStandardMaterial({ color: 0x20c997 }),
)

const targetText = computed(() => {
  if (!targetPosition.value) return '--'
  return `X=${targetPosition.value.x.toFixed(3)}, Z=${targetPosition.value.y.toFixed(3)}`
})

const getPointA = () => placementJson.value?.points.find((p) => p.id === 'Point_A_Base') ?? null

const clearModel = (model: Group | null) => {
  if (!model || !scene) return
  scene.remove(model)
  model.traverse((obj) => {
    const mesh = obj as Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

const fitCamera = (focus: Group | null) => {
  if (!focus || !camera || !controls) return
  const box = new Box3().setFromObject(focus)
  if (box.isEmpty()) return

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const radius = Math.max(size.x, size.y, size.z) / 2 || 1

  controls.target.copy(center)
  camera.position.set(center.x + radius * 1.8, center.y + radius * 1.4, center.z + radius * 1.8)
  camera.near = Math.max(0.1, radius / 100)
  camera.far = radius * 300
  camera.updateProjectionMatrix()
  controls.update()
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

const loadFbx = (file: File, onLoaded: (group: Group) => void, onErrorMessage: string, type: 'terrain' | 'building') => {
  const loader = new FBXLoader()
  const objectUrl = URL.createObjectURL(file)

  if (type === 'terrain') {
    if (terrainObjectUrl) URL.revokeObjectURL(terrainObjectUrl)
    terrainObjectUrl = objectUrl
  } else {
    if (buildingObjectUrl) URL.revokeObjectURL(buildingObjectUrl)
    buildingObjectUrl = objectUrl
  }

  loader.load(
    objectUrl,
    (group) => {
      applyOvLikeDoubleSide(group)
      onLoaded(group)
      URL.revokeObjectURL(objectUrl)
      if (type === 'terrain') terrainObjectUrl = ''
      else buildingObjectUrl = ''
    },
    undefined,
    () => {
      errorMessage.value = onErrorMessage
    },
  )
}

const onTerrainFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !scene) return

  terrainFileName.value = file.name
  errorMessage.value = ''

  clearModel(terrainModel)
  terrainModel = null

  loadFbx(
    file,
    (group) => {
      if (!scene) return
      terrainModel = group
      scene.add(group)
      fitCamera(group)
    },
    '地形 FBX 加载失败。',
    'terrain',
  )

  input.value = ''
}

const onBuildingFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !scene) return

  buildingFileName.value = file.name
  errorMessage.value = ''

  clearModel(buildingModel)
  buildingModel = null
  alignedBaseY = null
  heightOffset.value = 0

  loadFbx(
    file,
    (group) => {
      if (!scene) return
      buildingModel = group
      scene.add(group)
      if (!terrainModel) fitCamera(group)
    },
    '建筑 FBX 加载失败。',
    'building',
  )

  input.value = ''
}

const toGeoCornersArray = (): TerrainCornerGeo[] => {
  return cornerOrder.map((id) => ({ id, lat: geoCorners[id].lat, lon: geoCorners[id].lon }))
}

const toLocalCornersArray = (): TerrainCornerLocal[] => {
  if (!terrainModel) {
    throw new Error('请先加载地形 FBX。')
  }

  const box = new Box3().setFromObject(terrainModel)
  if (box.isEmpty()) {
    throw new Error('地形模型包围盒为空。')
  }

  return [
    { id: 'nw', x: box.min.x, z: box.min.z },
    { id: 'ne', x: box.max.x, z: box.min.z },
    { id: 'se', x: box.max.x, z: box.max.z },
    { id: 'sw', x: box.min.x, z: box.max.z },
  ]
}

const buildMapping = () => {
  try {
    const geo = toGeoCornersArray()
    if (!geo.every((corner) => isGeoCoordinateValid({ lat: corner.lat, lon: corner.lon }))) {
      throw new Error('地形角点经纬度超出有效范围。')
    }

    const local = toLocalCornersArray()
    mapping = createTerrainAffineMapping(geo, local)
    errorMessage.value = ''
  } catch (error) {
    mapping = null
    errorMessage.value = error instanceof Error ? error.message : '建立映射失败。'
  }
}

const onPlacementJsonChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as PlacementExportJson

    if (!parsed.rotation || !Array.isArray(parsed.points) || !parsed.points.length) {
      throw new Error('JSON 缺少 rotation 或 points。')
    }

    if (!parsed.points.some((p) => p.id === 'Point_A_Base')) {
      throw new Error('JSON 缺少 Point_A_Base。')
    }

    placementJson.value = parsed
    errorMessage.value = ''
  } catch (error) {
    placementJson.value = null
    errorMessage.value = error instanceof Error ? error.message : 'JSON 解析失败。'
  } finally {
    input.value = ''
  }
}

const alignBuilding = () => {
  try {
    if (!buildingModel) {
      throw new Error('请先加载建筑 FBX。')
    }
    if (!placementJson.value) {
      throw new Error('请先加载建筑 JSON。')
    }
    if (!mapping) {
      throw new Error('请先建立地形映射。')
    }

    const pointA = getPointA()
    if (!pointA) {
      throw new Error('JSON 中未找到 Point_A_Base。')
    }

    const target = mapping.toLocalXZ({
      lat: pointA.geo[0],
      lon: pointA.geo[1],
    })

    buildingModel.rotation.copy(toThreeEuler(placementJson.value.rotation))
    buildingModel.updateMatrixWorld(true)

    const localA = new Vector3(pointA.local[0], pointA.local[1], pointA.local[2])
    const rotatedA = localA.clone().applyEuler(buildingModel.rotation)

    buildingModel.position.x = target.x - rotatedA.x
    buildingModel.position.z = target.z - rotatedA.z

    alignedBaseY = buildingModel.position.y
    heightOffset.value = 0

    targetPosition.value = { x: target.x, y: target.z }
    targetMarker.visible = true
    targetMarker.position.set(target.x, alignedBaseY, target.z)

    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '自动落位失败。'
  }
}

const applyHeightOffset = () => {
  if (!buildingModel || alignedBaseY === null) return
  buildingModel.position.y = alignedBaseY + heightOffset.value
}

const resetHeightOffset = () => {
  heightOffset.value = 0
  applyHeightOffset()
}

const renderLoop = () => {
  animationFrameId = requestAnimationFrame(renderLoop)
  controls?.update()
  if (scene && camera && renderer) {
    renderer.render(scene, camera)
  }
}

onMounted(() => {
  if (!canvasHost.value) return

  scene = new Scene()
  scene.background = new Color('#eef5f7')

  const width = canvasHost.value.clientWidth
  const height = canvasHost.value.clientHeight

  camera = new PerspectiveCamera(50, Math.max(width / height, 0.1), 0.1, 10000)
  camera.position.set(20, 16, 20)

  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(width, height)
  canvasHost.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  const ambient = new AmbientLight(0xffffff, 0.72)
  const dir = new DirectionalLight(0xffffff, 1)
  dir.position.set(18, 30, 22)
  const axes = new AxesHelper(10)

  targetMarker.visible = false
  scene.add(ambient, dir, axes, targetMarker)

  resizeObserver = new ResizeObserver(() => {
    if (!canvasHost.value || !camera || !renderer) return
    const w = canvasHost.value.clientWidth
    const h = canvasHost.value.clientHeight
    camera.aspect = Math.max(w / h, 0.1)
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })

  resizeObserver.observe(canvasHost.value)
  renderLoop()
})

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId)
  resizeObserver?.disconnect()

  if (terrainObjectUrl) URL.revokeObjectURL(terrainObjectUrl)
  if (buildingObjectUrl) URL.revokeObjectURL(buildingObjectUrl)

  clearModel(terrainModel)
  clearModel(buildingModel)

  controls?.dispose()
  renderer?.dispose()

  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }

  terrainModel = null
  buildingModel = null
  controls = null
  renderer = null
  camera = null
  scene = null
})
</script>

<style scoped>
.terrain-page {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 390px 1fr;
  background: linear-gradient(135deg, #edf6f9 0%, #dfeaf0 42%, #d7e3eb 100%);
}

.panel {
  height: 100%;
  overflow: auto;
  padding: 16px;
  border-right: 1px solid #cbd8e6;
  background: rgba(255, 255, 255, 0.9);
}

.panel h2 {
  margin-bottom: 14px;
  font-size: 20px;
  color: #12344d;
}

.block {
  margin-bottom: 14px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #d9e4ef;
  background: #ffffff;
}

.block h3 {
  margin-bottom: 8px;
  font-size: 14px;
  color: #2f4858;
}

.file-row {
  display: grid;
  gap: 6px;
  margin-bottom: 8px;
}

.corner-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 10px;
}

.corner-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
}

.corner-title {
  font-size: 12px;
  color: #486581;
  margin-bottom: 6px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #486581;
}

input,
button {
  border: 1px solid #c3d0de;
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
}

button {
  cursor: pointer;
  color: #fff;
  background: #0f766e;
  border-color: #0f766e;
}

button:hover {
  background: #0c5f58;
}

button.secondary {
  color: #234;
  background: #edf2f7;
  border-color: #c3d0de;
}

button.secondary:hover {
  background: #dde7f1;
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  color: #627d98;
}

.error {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  background: #fff1f2;
  font-size: 12px;
}

.viewport {
  width: 100%;
  height: 100%;
}

@media (max-width: 1120px) {
  .terrain-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .panel {
    max-height: 45vh;
    border-right: none;
    border-bottom: 1px solid #cbd8e6;
  }
}
</style>
