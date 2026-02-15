<template>
  <div class="fbx-player-container">
    <div ref="rendererContainer" class="renderer-container"></div>
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-text">{{ loadingText }}</div>
    </div>
    <!-- 错误提示 -->
    <div v-if="errorMessage" class="error-overlay">
      <div class="error-content">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ errorMessage }}</div>
        <button class="retry-button" @click="handleRetry">重新加载</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, watch, nextTick } from 'vue'
// 静态导入Three.js
import * as THREE from 'three'
import { OrbitControls } from '@/three/controls/OrbitControls'
import { FBXLoader } from '@/three/loaders/FBXLoader'

// 定义props接收FBX文件路径
const props = defineProps<{
  fbxPath: string
}>()

// 渲染容器引用
const rendererContainer = ref<HTMLElement>()

// 直接使用 public 目录下的本地模型
const fbxDownloadUrl = '/20251024_100950_967_昆明长水国际机场.fbx'

// 加载状态和错误信息
const isLoading = ref(false)
const loadingText = ref('正在加载3D模型...')
const errorMessage = ref('')

// Three.js相关变量
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let fbxLoader: FBXLoader
let mixer: THREE.AnimationMixer | null = null
let fbxModel: THREE.Group | null = null
let animationId: number
let resizeObserver: ResizeObserver | null = null
// 添加标志位控制是否需要渲染
let needsRender = true
// 初始化Three.js场景
const initScene = () => {
  if (!rendererContainer.value || !THREE || !OrbitControls || !FBXLoader) return

  // 创建场景
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)

  // 创建相机
  const container = rendererContainer.value
  camera = new THREE.PerspectiveCamera(
    75,
    container.offsetWidth / container.offsetHeight,
    0.1,
    1000
  )
  camera.position.set(50, 50, 50)
  camera.lookAt(0, 0, 0)

  // 创建渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.offsetWidth, container.offsetHeight)
  renderer.setPixelRatio(window.devicePixelRatio)

  // 启用自动清除
  renderer.autoClear = true

  container.appendChild(renderer.domElement)

  container.addEventListener('mousemove', handleUserInteraction)
  container.addEventListener('touchmove', handleUserInteraction)

  // 添加轨道控制器
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.02

  // 监听控制器变化，仅在有交互时渲染
  controls.addEventListener('change', () => {
    needsRender = true
  })
  controls.addEventListener('start', () => {
    needsRender = true
  })
  controls.addEventListener('end', () => {
    needsRender = true
  })

  // 添加灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(50, 50, 50)
  scene.add(directionalLight)

  // 创建FBX加载器
  fbxLoader = new FBXLoader()

  // 添加坐标轴辅助
  const axesHelper = new THREE.AxesHelper(50)
  scene.add(axesHelper)

  // 开始动画循环
  animate(0)
}

// 加载FBX模型
const loadFBXModel = (url: string) => {
  if (!url || !fbxLoader || !scene) return

  // 重置状态
  errorMessage.value = ''
  isLoading.value = true
  loadingText.value = '正在加载3D模型...'

  // 移除旧模型
  if (fbxModel) {
    if (mixer) {
      mixer.stopAllAction()
      mixer = null
    }
    scene.remove(fbxModel)
    fbxModel = null
  }

  try {
    // 加载新模型
    fbxLoader.load(
      url,
      (object: any) => {
        const loadedModel = object as THREE.Group
        fbxModel = loadedModel
        scene.add(loadedModel)

        // 计算模型中心并居中显示
        const box = new THREE.Box3().setFromObject(loadedModel)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 100 / maxDim // 增加模型大小，从40改为100

        loadedModel.position.sub(center)
        loadedModel.scale.set(scale, scale, scale)

        // 检查是否有动画
        const firstClip = loadedModel.animations?.[0]
        if (firstClip) {
          mixer = new THREE.AnimationMixer(loadedModel)
          const action = mixer.clipAction(firstClip)
          action.play()
        }

        // 加载完成 - 触发首次渲染
        needsRender = true

        // 加载完成
        isLoading.value = false
      },
      (xhr: any) => {
        // 显示加载进度
        const percent = Math.round((xhr.loaded / xhr.total) * 100)
        loadingText.value = `正在加载3D模型... ${percent}%`
      },
      (error: any) => {
        console.error('Error loading FBX model:', error)
        isLoading.value = false
        errorMessage.value = '模型加载失败，请检查文件路径或网络连接'
      }
    )
  } catch (err) {
    console.error('Exception during FBX loading:', err)
    isLoading.value = false
    errorMessage.value = '加载过程中发生错误'
  }
}

// 重试加载
const handleRetry = async () => {
  errorMessage.value = ''
  isLoading.value = true
  loadingText.value = '正在重试...'

  try {
    await nextTick()
    initScene()

    if (fbxDownloadUrl) {
      loadFBXModel(fbxDownloadUrl)
    }
  } catch (error) {
    console.error('Retry failed:', error)
    errorMessage.value = '重试失败，请检查网络连接'
  } finally {
    isLoading.value = false
  }
}

let lastTime = 0
const targetFPS = 30 // 降低到30FPS
const frameInterval = 1000 / targetFPS

// 动画循环
const animate = (time: number) => {
  animationId = requestAnimationFrame(animate)

  // 控制帧率
  if (time - lastTime < frameInterval) {
    return
  }
  lastTime = time

  // 只在需要时更新和渲染
  if (needsRender || mixer) {
    // 更新控制器
    controls.update()

    // 更新动画混合器
    if (mixer) {
      mixer.update(0.016)
    }

    // 渲染场景
    renderer.render(scene, camera)
    needsRender = false // 重置标志
  }
}

// 处理窗口大小变化
const handleResize = () => {
  if (!rendererContainer.value || !camera || !renderer) return

  const container = rendererContainer.value
  const width = container.offsetWidth
  const height = container.offsetHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// 添加用户交互事件监听
const handleUserInteraction = () => {
  needsRender = true
}

// 添加页面可见性检测
const handleVisibilityChange = () => {
  if (document.hidden) {
    // 页面不可见时暂停动画
    if (animationId) {
      cancelAnimationFrame(animationId)
    }
  } else {
    // 页面可见时恢复动画
    animate(0)
  }
}

// 组件挂载时初始化
onMounted(async () => {
  try {
    await nextTick()
    initScene()

    if (fbxDownloadUrl) {
      loadFBXModel(fbxDownloadUrl)
    }

    // 使用ResizeObserver监听容器大小变化
    if (rendererContainer.value) {
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(rendererContainer.value)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
  } catch (err) {
    console.error('Error during component initialization:', err)
    isLoading.value = false
    errorMessage.value = '组件初始化失败'
  }
})

// 组件被激活时触发（用于keep-alive）
onActivated(async () => {
  console.log('onActivated 触发')
  try {
    await nextTick()
    // 触发重新渲染
    handleUserInteraction()
    // 确保渲染器大小正确
    handleResize()
  } catch (err) {
    console.error('Error during component activation:', err)
  }
})

// 监听fbxPath变化，重新加载模型
watch(
  () => props.fbxPath,
  (newPath) => {
    if (newPath && fbxDownloadUrl) {
      loadFBXModel(fbxDownloadUrl)
    } else {
      // 清空模型和错误信息
      errorMessage.value = ''
      if (fbxModel && scene) {
        if (mixer) {
          mixer.stopAllAction()
          mixer = null
        }
        scene.remove(fbxModel)
        fbxModel = null
      }
    }
  }
)

// 组件卸载时清理资源
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (animationId) {
    cancelAnimationFrame(animationId)
  }

  if (controls) {
    controls.dispose()
  }

  if (renderer && rendererContainer.value) {
    rendererContainer.value.removeChild(renderer.domElement)
    renderer.dispose()
  }

  // 断开ResizeObserver连接
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<style scoped>
.fbx-player-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background-color: #f5f5f5;
}

.renderer-container {
  width: 100%;
  height: 100%;
}

/* 加载状态样式 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 10;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 16px;
  color: #333;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* 错误提示样式 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.9);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
}

.error-content {
  text-align: center;
  padding: 24px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-width: 400px;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-text {
  font-size: 16px;
  color: #ff4d4f;
  margin-bottom: 20px;
}

.retry-button {
  padding: 8px 16px;
  background-color: var(--el-color-primary) /* var(--el-color-primary) */;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.retry-button:hover {
  background-color: #40a9ff;
}
</style>
