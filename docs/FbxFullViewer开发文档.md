# FbxFullViewerPage 开发与原理指南

`FbxFullViewerPage.vue` 是一个基于开源引擎 [Online3DViewer](https://github.com/kovacsv/Online3DViewer) 封装的全功能网页 3D 模型浏览器组件。它不仅支持 FBX，还支持包括 OBJ、STL、glTF、IFC、STEP 等 20 多种主流 3D 格式的加载与展示。

本文档将梳理该组件的核心架构、状态管理、Viewer 生命周期以及模型树的解析逻辑，方便后续二次开发或功能裁剪。

---

## 1. 核心技术栈与依赖

- **框架**: Vue 3 (Composition API, `<script setup>`)
- **3D 引擎**: `online-3d-viewer` (别名 `OV`)
- **构建/类型**: TypeScript 强类型支持
- **UI 方案**: 采用纯手写 CSS (无额外组件库依赖)，通过原生的 CSS Flexbox 与过渡动画 (`<Transition>`) 构建经典的类似于云端 CAD 的 “左中右+顶部工具栏” 的工程 UI 布局。

---

## 2. 界面区域拆解

界面采用了企业级 3D 软件标准的布局，分为 4 个主要区域：

1. **顶部 Header & 工具栏 (Toolbar)**:
   - 包含：打开文件、适应窗口、重置轴向 (Y朝上 / Z朝上 / 翻转)、相机正交/透视投影切换、显示线框、截图。
2. **左侧面板 (Left Panel)**:
   - **文件列表 (Files)**: 展示当前拖入或选中的文件名。
   - **网格树结构 (Meshes)**: 核心功能！提供“平级 (Flat)”和“树状 (Tree)”两种查看模式，支持独立控制每个网格甚至整个组的**显示/隐藏**状态。
3. **主视口 (Viewport)**:
   - 占据中心最大面积，承载底层的 `<canvas>` 3D 渲染。
   - 支持拖拽文件 (`Drag & Drop`) 直接加载模型。
4. **右侧面板 (Right Panel)**:
   - **属性/详情 (Details)**: 动态显示模型的顶点数、面数、包围盒尺寸 (X/Y/Z)，以及手动触发计算的体积 (Volume) 和表面积面积 (Surface)。
   - **设置 (Settings)**: 动态切换画布背景色、控制是否显示模型拓扑边线。

---

## 3. 生命周期的管理 (Viewer Lifecycle)

`online-3d-viewer` 的引擎对象比较重，为了不让 Vue 的 `Proxy` 代理导致内存泄漏或引发爆栈，在组件里所有的底层操作都遵循了最佳实践：

- **引擎脱离 Vue 响应式**：
  在全局定义了普通的 `let embeddedViewer: OV.EmbeddedViewer | null = null`，它保存着 Viewer 的实例，坚决不放在 `ref` 或 `reactive` 里。
- **与 Vue 同生共死**：
  - `onMounted`: 初始化 Viewer (`createViewer`)，并创建一个 `ResizeObserver` 监视外层占位 DOM。不管窗口怎么缩放或侧边栏侧滑，都能确保 3D 画布尺寸贴合 (`embeddedViewer?.Resize()`)。
  - `onUnmounted`: 销毁 `ResizeObserver`，并调用引擎自有的 `Destroy()` 释放 WebGL 内存的显存资源。

---

## 4. 网格结构解析逻辑 (Mesh Tree)

当模型加载成功（触发 `onModelLoaded` 回调）后，系统会主动调用 `refreshModelInfo` 函数解析模型结构。这是最底层但最重要的一环：

1. **查询基本数据**：通过 `model.VertexCount()` / `TriangleCount()` 直接喂给右侧详情面板。
2. **递归解析节点树**：
   - 因为复杂 FBX 支持组 (Group/Node) 概念，这里手写了一个 `walkNode(node, level, parentGroupKeys)` 函数。
   - 提取出扁平结构 (`meshNodes`)：用于支持“平级显示模式”，让使用者可以通过打勾快速控制所有的网格。
   - 提取出树状关系 (`meshTreeRows`)：给定每个节点的父级特征路径 `parentGroupKeys`。在“树状模式”下，通过对比 Vue `Set` 数据里的显隐状态 (`expandedTreeGroups`)，实时计算折叠与展开的深度视觉嵌套。

---

## 5. 模型可见性同步 (Visibility)

网格通过左侧的 `Vis-Btn (👁/🚫)` 切换显示时：
1. 改变 Vue 状态中的 `node.visible`。
2. 计算当前的过滤结果集合 (`meshVisibilityMap`)。
3. 调用引擎级 API： `v.SetMeshesVisibility` 传入一个闭包映射，由引擎瞬间完成重绘渲染。

---

## 6. 二次开发参考

如果你需要改造这个功能，可以着重看以下方法和状态：

- **如何扩充业务面板？**
  只需增加 `leftTab` 或 `rightTab` 的枚举状态，增加对应的 HTML `<template v-if="...">`，并在其内部绑定你自己的业务状态。
- **环境贴图修改？**
  系统默认使用 `envUrls`（渔人堡街景），如果你想修改环境反射贴图（尤其针对金属模型），可以替换 `public/envmaps/fishermans_bastion/` 下的 6 面贴图文件。
- **如何获取相机等高级状态？**
  统一使用 `getInternalViewer()` 从 `embeddedViewer` 里提取原生底层实例，上面挂载了 `GetCamera`, `SetProjectionMode`, `GetBoundingSphere` 等海量 API。

--- 
*本组件将复杂 3D 操作彻底内聚收敛，即插即用，极大地降低了对接各种工业制造模型（非 IFC 限定模型）的接入门槛。*