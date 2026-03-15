<template>
  <div class="fbx-simple-page">
    <div class="topbar">
      <button class="pick-btn" @click="pickFile">选择文件</button>
      <span v-if="fileName" class="hint">{{ fileName }}</span>
      <span v-if="modelLoaded" class="hint">
        自动旋转中{{ autoRotateEnabled ? '' : '（已暂停，1 分钟无操作后恢复）' }}
      </span>
    </div>

    <div ref="viewerEl" class="viewer"></div>

    <input ref="fileInputEl" type="file" multiple class="hidden-input" @change="onFileChange" />

    <div v-if="!modelLoaded && !isLoading" class="overlay">请选择本地文件开始查看</div>
    <div v-if="isLoading" class="overlay">模型加载中...</div>
    <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as OV from 'online-3d-viewer'

// 环境贴图（与 FbxFullViewerPage 保持一致）
const envUrls = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'].map(
  (s) => `/envmaps/fishermans_bastion/${s}.jpg`,
)

const viewerEl = ref<HTMLElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const isLoading = ref(false)
const modelLoaded = ref(false)
const errorMessage = ref('')
const fileName = ref('')
const autoRotateEnabled = ref(false)

const resumeDelayMs = 60_000
const autoRotateSpeed = Math.PI / 10
let resumeTimer: ReturnType<typeof setTimeout> | null = null
let animationFrameId = 0
let lastFrameTime = 0

let embeddedViewer: OV.EmbeddedViewer | null = null
let resizeObserver: ResizeObserver | null = null

const pickFile = () => fileInputEl.value?.click()

const getInternalViewer = (): OV.Viewer | null => (embeddedViewer?.GetViewer() as OV.Viewer) ?? null

const applyAutoRotate = (enabled: boolean) => {
  autoRotateEnabled.value = enabled
  if (!enabled) {
    lastFrameTime = 0
  }
}

const markUserInteraction = () => {
  applyAutoRotate(false)
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => applyAutoRotate(true), resumeDelayMs)
}

const rotateAroundAxis = (vector: OV.Coord3D, axis: OV.Coord3D, angle: number): OV.Coord3D => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dot = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z
  const crossX = axis.y * vector.z - axis.z * vector.y
  const crossY = axis.z * vector.x - axis.x * vector.z
  const crossZ = axis.x * vector.y - axis.y * vector.x

  return new OV.Coord3D(
    vector.x * cos + crossX * sin + axis.x * dot * (1 - cos),
    vector.y * cos + crossY * sin + axis.y * dot * (1 - cos),
    vector.z * cos + crossZ * sin + axis.z * dot * (1 - cos),
  )
}

const normalizeCoord = (coord: OV.Coord3D): OV.Coord3D => {
  const length = Math.hypot(coord.x, coord.y, coord.z)
  if (length === 0) return new OV.Coord3D(0, 1, 0)
  return new OV.Coord3D(coord.x / length, coord.y / length, coord.z / length)
}

const animateAutoRotate = (timestamp: number) => {
  animationFrameId = requestAnimationFrame(animateAutoRotate)

  if (!autoRotateEnabled.value || !modelLoaded.value) {
    lastFrameTime = timestamp
    return
  }

  const viewer = getInternalViewer()
  const camera = viewer?.GetCamera?.()
  if (!viewer || !camera) {
    lastFrameTime = timestamp
    return
  }

  if (lastFrameTime === 0) {
    lastFrameTime = timestamp
    return
  }

  const deltaSeconds = (timestamp - lastFrameTime) / 1000
  lastFrameTime = timestamp

  const offset = new OV.Coord3D(
    camera.eye.x - camera.center.x,
    camera.eye.y - camera.center.y,
    camera.eye.z - camera.center.z,
  )

  const axis = normalizeCoord(camera.up)
  const rotatedOffset = rotateAroundAxis(offset, axis, autoRotateSpeed * deltaSeconds)
  const nextCamera = new OV.Camera(
    new OV.Coord3D(
      camera.center.x + rotatedOffset.x,
      camera.center.y + rotatedOffset.y,
      camera.center.z + rotatedOffset.z,
    ),
    new OV.Coord3D(camera.center.x, camera.center.y, camera.center.z),
    new OV.Coord3D(camera.up.x, camera.up.y, camera.up.z),
    camera.fov,
  )

  viewer.SetCamera?.(nextCamera)
}

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
      const viewer = getInternalViewer()
      if (viewer) {
        const sphere = viewer.GetBoundingSphere?.(() => true)
        if (sphere) {
          viewer.FitSphereToWindow?.(sphere, false)

          // 明确把相机观察中心锁到模型包围球中心，确保首帧和后续旋转都围绕模型中心。
          const camera = viewer.GetCamera?.()
          if (camera && sphere.center) {
            const centeredCamera = new OV.Camera(
              new OV.Coord3D(camera.eye.x, camera.eye.y, camera.eye.z),
              new OV.Coord3D(sphere.center.x, sphere.center.y, sphere.center.z),
              new OV.Coord3D(camera.up.x, camera.up.y, camera.up.z),
              camera.fov,
            )
            viewer.SetCamera?.(centeredCamera)
          }
        }
      }

      applyAutoRotate(true)
    },
    onModelLoadFailed: () => {
      isLoading.value = false
      errorMessage.value = '模型加载失败，请检查文件是否完整或格式是否支持。'
    },
  })
}

const destroyViewer = () => {
  if (embeddedViewer) {
    embeddedViewer.Destroy()
    embeddedViewer = null
  }
}

const loadFiles = (files: FileList) => {
  if (!files.length) return
  if (!embeddedViewer) createViewer()
  errorMessage.value = ''
  isLoading.value = true
  modelLoaded.value = false
  applyAutoRotate(false)
  fileName.value = files[0]!.name
  embeddedViewer!.LoadModelFromFileList(Array.from(files))
}

const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files) loadFiles(input.files)
  input.value = ''
}

const onResize = () => embeddedViewer?.Resize()

onMounted(() => {
  createViewer()
  animationFrameId = requestAnimationFrame(animateAutoRotate)
  if (viewerEl.value) {
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(viewerEl.value)
    // 监听用户交互，暂停自动旋转
    viewerEl.value.addEventListener('pointerdown', markUserInteraction)
    viewerEl.value.addEventListener('wheel', markUserInteraction, { passive: true })
    viewerEl.value.addEventListener('touchstart', markUserInteraction, { passive: true })
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId)
  if (resumeTimer) clearTimeout(resumeTimer)
  if (viewerEl.value) {
    viewerEl.value.removeEventListener('pointerdown', markUserInteraction)
    viewerEl.value.removeEventListener('wheel', markUserInteraction)
    viewerEl.value.removeEventListener('touchstart', markUserInteraction)
  }
  resizeObserver?.disconnect()
  destroyViewer()
})
</script>

<style scoped>
.fbx-simple-page {
  position: relative;
  width: 100%;
  height: 100%;
  background: #f3f4f6;
}

.topbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.14);
}

.pick-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: #fff;
  background: #2563eb;
  cursor: pointer;
}

.pick-btn:hover {
  background: #1d4ed8;
}

.hint {
  font-size: 13px;
  color: #334155;
}

.viewer {
  width: 100%;
  height: 100%;
}

.hidden-input {
  display: none;
}

.overlay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 9;
  padding: 12px 16px;
  border-radius: 8px;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
}

.error {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 11;
  color: #b91c1c;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 8px 12px;
}
</style>
