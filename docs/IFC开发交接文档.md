# IFC 开发交接文档


## 1. 目标与范围

当前 IFC 模块实现了以下能力：

- IFC 模型加载与三维查看（旋转/缩放/平移/行走）
- 构件选择与属性读取（含属性集 PropertySet）
- 自定义属性编辑（内存中维护、可回显、可导出）
- 标注点（点位 + 文本）新增/删除/导出/回读
- IFC 文件导出（基于“原始数据 + 自定义数据段”策略）

---

## 2. 快速上手

### 2.1 运行

```bash
npm install
npm run dev
```

默认路由：`/`（`IfcViewer.vue`）。

### 2.2 必读文件（按顺序）

1. `src/components/IfcViewer.vue`：主业务入口，UI + 交互 + 状态 + 3D 控制
2. `src/utils/ifcExporter.ts`：IFC 自定义数据写入/解析核心
---

## 3. 技术栈职责划分

- **Vue + Element Plus**：页面状态、表单、弹窗、工具栏、属性面板
- **ThatOpen Components（OBC/OBCF）**：IFC 模型加载、选择、高亮、裁剪、空间树
- **Three.js**：底层场景对象（如 `THREE.Group`、标注球体、射线检测）
- **ifcExporter.ts**：把“待写入属性 + 标注”转换为 IFC 文本追加段并下载

一句话理解：

- 查看器交互主要靠 ThatOpen；
- 标注可视化与点击判定靠 Three.js；
- 最终落盘由 `ifcExporter.ts` 负责。

---

## 4. 核心数据模型

### 4.1 自定义属性（待导出）

`src/utils/ifcExporter.ts`：

```ts
interface PendingPropertyWrite {
  elementId: string; // 例如 #123
  psetName: string;
  propertyName: string;
  value: string | number | boolean;
  valueType: 'STRING' | 'REAL' | 'INTEGER' | 'BOOLEAN' | 'LABEL';
}
```

`IfcViewer.vue` 中，所有“用户新增/编辑但尚未导出”的属性都维护在：

- `pendingProperties: Ref<PendingPropertyWrite[]>`

### 4.2 标注点

`src/utils/ifcExporter.ts`：

```ts
interface AnnotationPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
}
```

`IfcViewer.vue` 中维护：

- `annotations: Ref<AnnotationPoint[]>`
- `annotationGroup: THREE.Group`（场景内标注 Mesh 容器）
- `annotationMarkerMap: Map<THREE.Mesh, AnnotationPoint>`（点击映射）

### 4.3 IFC 原始字节

- `currentIfcData: Uint8Array | null`

用途：

1. 载入时解析已有自定义数据段
2. 导出时作为 base layer 进行“切片 + 覆写”

---

## 5. 运行时主流程

## 5.1 初始化（`initViewer`）

关键动作：

1. 创建 `OBC.Components` 与 `World`（场景、相机、渲染器）
2. 初始化 `FragmentsManager`，指定本地 worker：`/wasm/fragment-worker.mjs`
3. 初始化 `IfcLoader`，指定 wasm 路径：`/wasm/`
4. 配置 `Highlighter` 选择回调 -> `handleSelection`
5. 配置 `Clipper`（剖切）
6. 创建标注组 `annotationGroup` 并加入场景
7. 绑定双击事件：
   - 标注模式：落点并弹出标注输入
   - 剖切模式：创建剖切面

## 5.2 加载 IFC（`loadIfcFile`）

流程顺序非常重要：

1. 防重入锁 `isLoadingLock`
2. 清理旧模型、旧 web-ifc 缓存、旧 pending 属性、旧标注
3. 缓存原始 IFC 字节到 `currentIfcData`
4. 调用 `parseCustomProperties(currentIfcData)` 回读已有自定义属性
5. 调用 `parseAnnotationsFromCustomSection(currentIfcData)` 回读标注
6. `ifcLoader.load(...)` 加载三维模型
7. `fitToModel()` 调整视角
8. 根据回读结果重建标注球体

## 5.3 构件选择与属性展示

- 入口：`highlighter.events.select?.onHighlight` -> `handleSelection`
- `handleSelection` 会提取首个 `(modelId, expressId)`
- 然后调用 `getElementProperties(model, expressId)`

`getElementProperties` 采用“三段查询”：

1. 查构件基础属性 + `IsDefinedBy`
2. 通过 `IsDefinedBy` 拿到 PropertySet 的 `HasProperties/Quantities`
3. 再查具体 Property 的 `Name/NominalValue`

最后将 `pendingProperties` 中该构件的自定义属性追加到右侧面板，键名带 `✏️` 前缀表示可编辑。

## 5.4 自定义属性编辑

- 对话框新增属性：先进入 `customProperties` 临时列表
- 点击写入：`writePropertiesToIfc` 把临时属性写入 `pendingProperties`
- 右侧面板支持内联编辑：`startInlineEdit/saveInlineEdit`
- 属性管理器支持全局编辑/删除：`startEditProperty/saveEditProperty/deletePendingProperty`

注意：这些操作默认都只改内存状态，不会立即写回 IFC 文件。

## 5.5 导出 IFC（`exportModifiedIfc`）

调用：

```ts
createUpdatedIfcBlob(currentIfcData, pendingProperties, annotations)
```

再通过 `downloadIfcBlob` 下载。

---

## 6. IFC 导出与回读机制

核心文件：`src/utils/ifcExporter.ts`

### 6.1 Slice & Overwrite 策略

标记常量：

- `MARKER_START = /* === CUSTOM_DATA_START === */`
- `MARKER_END = /* === CUSTOM_DATA_END === */`

导出规则：

1. 如果原文件已存在 `MARKER_START`：
   - 截断到 marker 起点（删除旧自定义段）
2. 如果不存在：
   - 查找最后 `ENDSEC;` 作为插入点
3. 扫描 base 段最大 Express ID（`findMaxExpressIdFromBytes`）
4. 生成新的 `IFCPROPERTYSINGLEVALUE / IFCPROPERTYSET / IFCRELDEFINESBYPROPERTIES`
5. 附加标注 JSON 注释块
6. 追加 `MARKER_END` 与 IFC 文件尾

### 6.2 标注存储格式

标注写在自定义段中，采用注释包裹 JSON：

- `/* ANNOTATIONS_JSON_START */`
- `/* [ ...AnnotationPoint[]... ] */`
- `/* ANNOTATIONS_JSON_END */`

回读时 `parseAnnotationsFromCustomSection` 会提取并 `JSON.parse`。

### 6.3 自定义属性回读逻辑

`parseCustomProperties` 在自定义段里解析三类 IFC 实体并关联：

- `IFCPROPERTYSINGLEVALUE`
- `IFCPROPERTYSET`
- `IFCRELDEFINESBYPROPERTIES`

通过 relation 将 `elementId <-> pset <-> property` 拼回 `ParsedCustomProperty[]`。

---

## 7. 常见开发任务入口

### 7.1 新增属性值类型

改动点：

1. `PendingPropertyWrite['valueType']` 扩展类型
2. `formatIfcValue` 增加导出格式
3. `parseIfcValue` 增加反解析逻辑
4. `IfcViewer.vue` 中类型映射：
   - `mapValueType`
   - `mapValueTypeReverse`

### 7.2 修改标注外观/交互

改动点：

- 标注创建：`createAnnotationMarker`
- 标注点击：`handleAnnotationClick`
- 标注模式切换：`toggleAnnotationMode`

如果模型尺度差异大，优先调整 `getAnnotationMarkerRadius`。

### 7.3 调整属性面板显示字段

改动点：

- 属性查询：`getElementProperties`
- 右侧可编辑前缀规则：`isEditableProperty/parseEditableKey`
- 内联编辑保存：`saveInlineEdit`

---

## 8. 排错清单

### 8.1 模型加载失败

优先检查：

1. `/wasm/` 目录是否被正确打包与访问
2. `fragment-worker.mjs` 地址是否可访问
3. 是否重复触发加载（看 `isLoadingLock` 提示）

### 8.2 能选中构件但右侧属性为空

检查：

1. `handleSelection` 是否拿到 `modelId + expressId`
2. `getElementProperties` 三段查询是否返回数据
3. IFC 模型中该构件是否真的有 `IsDefinedBy` 与 `NominalValue`

### 8.3 导出后再导入看不到自定义属性

检查：

1. 导出前 `pendingProperties` 是否非空
2. 导出文件是否包含 `CUSTOM_DATA_START/END` 段
3. 解析正则是否匹配当前写出的 IFC 行格式

### 8.4 标注导出/回读异常

检查：

1. `ANNOTATIONS_JSON_START/END` 是否成对出现
2. 注释包裹 JSON 是否被手工改坏
3. `JSON.parse` 报错日志


## 10. 当前设计取舍

- 自定义属性不是“原生写回模型结构树”，而是追加到文件尾自定义段
- 优点：实现稳定、可回写、便于增量扩展
- 代价：依赖 marker 与文本解析规则，格式变更要同步更新解析器

---

## 11. 逐函数详解

> 说明：以下按“函数名 -> 做什么 -> 输入/输出 -> 关键作用”描述，便于按名称快速定位。  
> 范围仅包含 `src/components/IfcViewer.vue` 与 `src/utils/ifcExporter.ts` 的 IFC 相关函数。

### 11.1 `IfcViewer.vue`

- `initViewer`：初始化 ThatOpen/Three 场景与交互；输入无；返回 `Promise<void>`；作用是创建 `components/world/ifcLoader/highlighter/clipper`、绑定事件、启动行走循环。
- `initSpatialTree`：创建空间树 UI 组件并挂载到左侧容器；输入无；返回 `void`；作用是设置 `spatialTreeElement`、`updateSpatialTree`。
- `updateModelTree`：把当前 fragments 模型列表同步到空间树；输入无；返回 `void`；作用是更新 `hasModel`。
- `handleSelection`：处理高亮选择结果并刷新右侧属性；输入选择映射；返回 `Promise<void>`；作用是更新 `selectedModelId/selectedExpressId/selectedProperties`。
- `getElementProperties`：三段查询构件属性与属性集；输入 `model + expressId`；返回 `Promise<PropertyRecord | null>`；作用是构造可展示键值对。
- `openPropertyDialog`：打开“添加属性”对话框；输入无；返回 `void`；作用是重置表单并校验是否已选中构件。
- `openPropertyManager`：打开属性管理器对话框；输入无；返回 `void`；作用是 `showPropertyManager = true`。
- `addPropertyToList`：把输入框属性加入临时列表 `customProperties`；输入无；返回 `void`；作用是做重名/类型校验并清空输入。
- `removeProperty`：删除临时属性；输入 `index`；返回 `void`；作用是修改 `customProperties`。
- `mapValueType`：把 UI 类型映射到导出类型；输入 `'string'|'number'|'boolean'`；返回 `PendingPropertyWrite['valueType']`；无额外作用。
- `mapValueTypeReverse`：把导出类型反向映射给 UI；输入导出类型；返回 UI 类型；无额外作用。
- `getPendingPropertiesForElement`：筛选某构件的待写属性；输入 `expressId`；返回 `PendingPropertyWrite[]`；无额外作用。
- `getPendingPropertiesForPset`：筛选某构件某属性集待写属性；输入 `expressId + psetName`；返回 `PendingPropertyWrite[]`；无额外作用。
- `getPendingPsetNames`：提取某构件已有待写属性集名；输入 `expressId`；返回 `string[]`；无额外作用。
- `writePropertiesToIfc`：把临时属性落入 `pendingProperties`（仅内存）；输入无；返回 `Promise<void>`；作用是去重写入、刷新右侧属性、关闭对话框。
- `refreshSelectedProperties`：刷新当前选中构件属性面板；输入无；返回 `Promise<void>`；作用是重新查询属性并叠加 `✏️` 可编辑字段。
- `deletePendingProperty`：删除一条待写属性；输入 `index`；返回 `void`；作用是提示并刷新选中属性。
- `clearAllPendingProperties`：清空全部待写属性；输入无；返回 `void`；作用是提示并刷新选中属性。
- `startEditProperty`：进入属性管理器编辑态；输入 `prop + index`；返回 `void`；作用是填充编辑表单状态。
- `saveEditProperty`：保存属性管理器编辑结果；输入无；返回 `void`；作用是更新 `pendingProperties` 并刷新显示。
- `isEditableProperty`：判断属性键是否可内联编辑；输入 `key`；返回 `boolean`；规则是是否以 `✏️ ` 开头。
- `parseEditableKey`：从显示键名拆出 `psetName/propertyName`；输入显示键；返回对象或 `null`；无额外作用。
- `startInlineEdit`：右侧属性面板进入内联编辑；输入 `key + currentValue`；返回 `void`；作用是设置 `inlineEditingKey/inlineEditValue`。
- `saveInlineEdit`：保存右侧内联编辑；输入 `key`；返回 `void`；作用是按类型解析并更新目标 `pendingProperties` 项与显示值。
- `cancelInlineEdit`：取消内联编辑；输入无；返回 `void`；作用是清空 `inlineEditingKey`。
- `deleteCustomProperty`：从右侧面板删除一条自定义属性；输入显示键；返回 `void`；作用是删除匹配的 pending 项并刷新属性面板。
- `cancelEditProperty`：取消属性管理器编辑；输入无；返回 `void`；作用是清空 `editingProperty`。
- `exportModifiedIfc`：导出当前模型为 IFC；输入无；返回 `Promise<void>`；作用是调用 `createUpdatedIfcBlob`、触发下载、显示进度与结果消息。
- `loadIfcFile`：加载 IFC 文件并恢复历史自定义数据；输入 `File`；返回 `Promise<void>`；作用是清理旧状态、解析旧属性/标注、加载模型、更新视角与提示。
- `expandAllTree`：展开空间树节点；输入无；返回 `void`；作用是设置 `table.expanded = true`。
- `collapseAllTree`：收起空间树节点；输入无；返回 `void`；作用是通过两步切换 `expanded` 强制收拢。
- `isEditableTarget`：判断键盘事件目标是否输入类控件；输入 `EventTarget`；返回 `boolean`；用于避免编辑时拦截按键。
- `handleKeyDown`：处理全局按键（Delete/Escape/行走键）；输入 `KeyboardEvent`；返回 `void`；作用是剖切删除、退出标注模式、更新移动状态。
- `handleKeyUp`：处理行走键抬起；输入 `KeyboardEvent`；返回 `void`；作用是更新 `moveKeys/isWalking`。
- `startWalkLoop`：启动相机行走动画循环；输入无；返回 `void`；作用是 `requestAnimationFrame` 持续按键移动相机与目标点。
- `toggleAnnotationMode`：切换标注模式；输入无；返回 `void`；作用是与剖切模式互斥并隐藏弹出层。
- `handleAnnotationDoubleClick`：标注模式下双击拾取落点；输入无；返回 `Promise<void>`；作用是写入待确认坐标并弹出文本输入对话框。
- `handleAnnotationClick`：检测是否点击到标注球体；输入 `MouseEvent`；返回 `void`；作用是控制标注信息弹窗显示与定位。
- `confirmAnnotation`：确认新增标注；输入无；返回 `void`；作用是生成 `AnnotationPoint`、写入数组并创建 3D 标记。
- `getAnnotationMarkerRadius`：按模型包围盒估算标注球半径；输入无；返回 `number`；无额外作用。
- `createAnnotationMarker`：创建并添加单个标注球 Mesh；输入 `AnnotationPoint`；返回 `void`；作用是更新 `annotationGroup` 与 `annotationMarkerMap`。
- `loadAnnotationMarkers`：按 `annotations` 全量重建标注球体；输入无；返回 `void`；作用是先清再建。
- `clearAnnotationMarkers`：清空所有标注球并释放几何体/材质；输入无；返回 `void`；作用是资源释放避免内存泄漏。
- `deleteAnnotation`：删除指定标注点及其 Mesh；输入 `id`；返回 `void`；作用是更新数据、释放对象并关闭弹窗。
- `fitToModel`：相机自动框选模型；输入无；返回 `void`；作用是调用 controls `setLookAt`。
- `zoomIn`：相机放大；输入无；返回 `void`；作用是 `dolly(2, true)`。
- `zoomOut`：相机缩小；输入无；返回 `void`；作用是 `dolly(-2, true)`。
- `resetView`：重置视角（有模型则框选，无模型则默认位置）；输入无；返回 `void`。
- `toggleClipping`：切换剖切模式；输入无；返回 `void`；作用是启停 `clipper.enabled` 并提示操作方式。
- `deleteAllClips`：删除所有剖切面；输入无；返回 `void`；作用是调用 `clipper.deleteAll()`。
- `getAllExpressIds`：获取模型全部构件 ID；输入 `FragmentsModel`；返回 `Promise<number[]>`；用于批量显示/隐藏。
- `isolateSelected`：隔离显示当前选中构件；输入无；返回 `Promise<void>`；作用是先隐藏全部再显示选中项。
- `showAll`：显示所有构件；输入无；返回 `Promise<void>`；作用是遍历模型批量可见。
- `hideSelected`：隐藏当前选中构件；输入无；返回 `void`；作用是隐藏后清空高亮选择。
- `handleResize`：容器尺寸变化时重设 renderer 大小；输入无；返回 `void`。
- `handleUploadChange`：处理上传组件变更并触发加载；输入 `uploadFile`；返回 `false`（阻止默认上传流程）。
- `handleDrop`：处理拖拽文件；输入 `DragEvent`；返回 `void`；作用是校验后缀并触发 `loadIfcFile`。
- `handleDragOver`：允许拖拽释放；输入 `DragEvent`；返回 `void`；作用是 `preventDefault()`。

补充（虽非命名函数，但调试时常看）：

- `watch(treeFilterText, ...)`：把搜索词同步到空间树 `queryString`。
- `onMounted(() => initViewer())`：组件挂载后启动查看器。
- `onUnmounted(() => ...)`：组件卸载时移除事件、停止动画、清理 3D 资源。

### 11.2 `ifcExporter.ts`

- `findMarkerIndex`：在字节数组中查找 marker 首位置；输入 `data + marker + scanLimit`；返回索引（未找到为 `-1`）。
- `findEndSecPosition`：查找最后一个 `ENDSEC;` 位置；输入 `data`；返回字节偏移（未找到 `-1`）。
- `findMaxExpressIdFromBytes`：扫描 `#123=` 模式取最大 Express ID；输入 `data`；返回 `number`。
- `generateIfcGuid`：生成 IFC 22 位 GUID；输入无；返回 `string`。
- `escapeIfcString`：对字符串做 IFC 文本转义；输入 `string`；返回转义后的 `string`。
- `formatIfcValue`：把 JS 值格式化为 IFC 值表达式；输入 `value + valueType`；返回 `IFCTEXT/IFCREAL/...` 字符串。
- `createUpdatedIfcBlob`：核心导出流程（切片、重建自定义段、拼接 blob）；输入原始 IFC、属性列表、可选标注；返回 `Promise<Blob>`。
- `groupPropertiesByElementAndPset`：按构件和属性集分组待写属性；输入属性数组；返回嵌套 `Map`。
- `extractCustomDataSection`：提取 `MARKER_START/END` 之间文本；输入 `data`；返回 section 字符串或 `null`。
- `hasCustomDataSection`：判断是否存在自定义段；输入 `data`；返回 `boolean`。
- `parseIfcValue`：解析 IFC 值表达式为 JS 值及类型；输入值字符串；返回 `{ value, type } | null`。
- `unescapeIfcString`：把 IFC 转义文本还原为普通字符串；输入 `string`；返回 `string`。
- `parseCustomProperties`：解析自定义段中的三类 IFC 实体并还原属性列表；输入 `data`；返回 `ParsedCustomProperty[]`。
- `downloadIfcBlob`：触发浏览器下载 blob；输入 `blob + filename`；返回 `void`；作用是创建临时链接并回收 URL。
- `exportIfcWithCustomProperties`：导出快捷封装；输入原始数据、属性、文件名；返回 `Promise<void>`；内部串联 `createUpdatedIfcBlob + downloadIfcBlob`。
- `parseAnnotationsFromCustomSection`：解析自定义段中的标注 JSON；输入 `data`；返回 `AnnotationPoint[]`（解析失败时空数组）。
