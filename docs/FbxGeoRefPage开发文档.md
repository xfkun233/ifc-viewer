# FbxGeoRefPage 开发文档

## 1. 模块概述

`FbxGeoRefPage.vue` 是一个用于 **3D FBX 模型地理配准（Geo-Referencing）与空间数据生成**的 Vue 3 核心组件。它的主要业务目标是将单纯的 3D 模型局部坐标系（Local Coordinates）与真实的现实世界地理坐标系（经度、纬度、海拔）以及真实的物理尺寸（米级）建立精确的映射关系。

该组件支持多模型（多资产）同屏对比、自由视角的 3D 拾取、基于顶点的精准吸附、姿态角调整（Heading, Pitch, Roll），并最终可将标定好的空间配准数据导出为标准的 JSON 格式文件，供下游应用（如 Cesium、Mapbox 或其他大屏系统）加载使用。

## 2. 技术架构与核心依赖

- **框架**: Vue 3 (Composition API)
- **3D 引擎**: Three.js (`Scene`, `PerspectiveCamera`, `WebGLRenderer`, `Raycaster`, `FBXLoader`)
- **控制器**: `OrbitControls` (用于相机视角的拖拽、缩放、旋转)
- **状态隔离设计**：为避免 Vue 的 `Proxy` 代理引发严重的性能问题和内存泄漏，所有 Three.js 的核心实例（如 `scene`、`camera`、`renderer`、`controls`、`modelRoot`）**均未声明为响应式变量**，而是作为普通的模块级变量存在，这一点极其重要。

## 3. 核心数据结构

组件通过维护一套多资产树来管理不同模型的属性，关键接口 `GeoAsset` 定义如下：

```typescript
interface GeoAsset {
  id: string;               // 资产唯一ID
  name: string;             // 文件名
  model: Group;             // Three.js 模型根节点组
  baseModelY: number;       // 初始Y轴高度
  baseModelScale: Vector3;  // 初始缩放比例
  baseGeo: GeoCoordinate;   // 绑定的基准地理经纬度 (lat, lon)
  height: number;           // 基准面海拔高度
  rotation: RotationAngles; // 姿态角 (heading, pitch, roll)
  pickedPoints: PickedPoint[]; // 用户在模型上拾取的局部点位
  geoPointMap: Record<string, [number, number]>; // 拾取点位对应的经纬度映射
  fbxUnitScaleFactor: number; // FBX自身元数据解析出的缩放因子
  fbxUnitFromMetadata: boolean; // 缩放因子是否来自元数据
  manualMeterPerUnit: number | null; // 手动指定的计价单位（1 Unit = ? 米）
  visible: boolean;         // 资产显示/隐藏状态
}
```

## 4. 核心算法与业务流程详细拆解

### 4.1 响应式模型选取与数据同步方案
由于同时存在多模型（`assets` 数组）与当前激活试图（UI 面板直接绑定的表单变量如 `baseGeo`, `rotation` 等），组件内部设计了一套双向同步机制：
- **`updateUiFromActiveAsset()`**：当切换资产时，从对应的 `GeoAsset` 提取数据覆盖到左侧 UI 的表单 `ref` / `reactive` 变量中，方便用户编辑。
- **`syncActiveAssetFromUi()`**：当 UI 表单项（经纬度、高度、自旋转）被修改时，将输入的新值写回当前的 `GeoAsset` 对象。

### 4.2 三维模型的单位解析与材质重置
FBX 模型的尺寸在不同的建模软件（Blender, 3dMax, Revit）中差异巨大。
1. **自动提取元数据**：通过 `readUnitScaleFromModel` 尝试从加载的 FBX `group.userData.unitScaleFactor` 中读取原生单位因子，决定当前模型“1单位代表多少米”。
2. **双面材质强制生效**：为了避免有些未闭合或法线朝内侧的网格出现透明穿模，`applyOvLikeDoubleSide` 函数会遍历模型，将所有网格的 `Material.side` 强制设为 `DoubleSide`。

### 4.3 顶点吸附（Vertex Snapping）与空间拾取
为了保证提取的空间点位坐标完全精准，系统实现了高级的**表面射线检测与顶点自动吸附算法**。
在 `updateSnappedVertex` 函数中：
1. **发射射线**：将鼠标的屏幕坐标转换到 Normalized Device Coordinates (NDC)，利用 `Raycaster` 与当前模型的 Mesh 进行求交（Intersect）。
2. **提取碰撞面**：获取射线命中的三角形面 `face` (包含 a, b, c 三个顶点索引)。
3. **寻找最近顶点**：不直接使用击中点，而是分别把面上的三个顶点（`va`, `vb`, `vc`）转为世界坐标，通过 `distanceToSquared` 计算出鼠标碰撞点距离哪个顶点最近。
4. **视觉反馈**：
   - 3D 空间内有绿色小球 `hoverMarker` 吸附在顶点上。
   - 2D HTML 空间（屏幕 DOM）有一个同步的环形圈 `snapCursor`，通过 `project(camera)` 将 3D 世界坐标投影回 2D 屏幕，实现精准追踪。

### 4.4 局部坐标到地理坐标的推算逻辑
拾取点通常包含 `Point_A_Base`作为绝对锚准点，由于 A 点具有用户输入的硬性基准经纬度以及绝对海拔，计算其余附加点位地球坐标的流程如下 (`calculatedPoints` 计算属性)：
1. 获得其他拾取点相对于 `Point_A_Base` 的 Local Delta $(dx, dy, dz)$。
2. 结合组件当前设定的姿态角 `rotation`（Heading, Pitch, Roll），运行 `rotateLocalDelta` 进行欧拉角旋转变换矩阵运算，修正模型朝向对相对偏移的影响。
3. 将修正后的 Local Delta 乘以 `meterPerModelUnit`，转换为真实的物理“米”偏差。
4. 调用工具类 `applyMetersOffsetOnGeo`，根据墨卡托投影近似或高斯数学模型，基于 A 点的大地经纬度，累加横向和纵向米的偏差，推算出其他点极度精确的大致经纬度。

### 4.5 多资产空间位置自动配准算法 (`applyAssetsSpatialAlignment`)
当存在多份 FBX 时，所有模型需处在同一个基准参考系以进行同屏对比。
该函数找出第一个含有全局坐标（`Point_A_Base`）的模型作为 **原点（Absolute Anchor）**，提取该点的大地投影坐标（Meters）。
接着遍历其它资产，计算其对应 `Point_A_Base` 与 Absolute Anchor 的大地米级坐标差 $(targetX, targetZ)$ 以及海拔差 $(targetY)$。
为了确保模型的配准原点对齐而不是其默认中心原点对齐，需要先通过 `localToWorld` / `applyEuler` 等运算推算出被旋转且缩放后的本地偏移量，反向将资产模型的基点平移，以此实现在同一个 3D 场景里按照真实地理坐标实现完美无缝叠合。

## 5. 生命周期与内存管理

复杂 WEBGL 组件的核心挑战之一就是内存泄漏管控。`FbxGeoRefPage.vue` 具有极高严格的销毁标准 (`onUnmounted`)：
1. **停止渲染循环**：调用 `cancelAnimationFrame(animationFrameId)`。
2. **事件卸载**：取消挂载的 `pointermove`, `pointerdown`, `contextmenu` 和 `resizeObserver`，切断 DOM 和 JS 的引用。
3. **材质与几何体深度释放** (`disposeAllAssets` & `removeAssetGroup`)：
   - 必须通过 `scene.remove(group)` 移出渲染树。
   - 彻底遍历每一个 Mesh，对 `mesh.geometry.dispose()` 以及 `mesh.material.dispose()` （如果为材质数组则迭代销毁）执行底层 GPU 内存清理指令。
4. **Three.js 对象指针清空**：`controls?.dispose()`，`renderer?.dispose()` 并将引用置 `null` 确保垃圾回收器完全回收上下文。

## 6. 配置导入导出机制

- **导出 `exportJson`**：将当前场景配置、经纬度、缩放因子、多点位映射封装为 `PlacementExportJson` 格式进行下载。
- **导入 `onImportJsonChange`**：逆向读取用户上传的 `.json` 标定文件，自动复现表单、姿态角和所有点位气泡（Markers），省去反复校对的流程，快速继续上次的工作流。

---

## 7. 算法缺陷


### 7.1 【精度】大尺度投影系数 (Scale Factor) 会随纬度变形
* **现状盲区**：`getAssetHeadingAndScaleFromGeoPoints` 中，通过测算拾取点的米量级相对偏移量 $(worldDz / worldDx)$ 直接套用 `Math.atan2` 来计算地球正北航向角偏差。如果在赤道附近或针对百米级小建筑（普通 BIM 项目）是极度精准的。但若在纬度极高的地区且资产横跨几十公里（如高铁、特大桥 FBX 数据），这种纯二维欧式几何计算会因为墨卡托投影或地球曲率产生“角度撕裂”与长度失真。
* **优化要求**：若业务限制在建筑单体，目前算法完全胜任。若未来需支持百公里级的 GIS 路线配准，需将二维相减升级为三维地心地固坐标系 (ECEF) 或东北天局部坐标系 (ENU) 下的具体基向量投影。

