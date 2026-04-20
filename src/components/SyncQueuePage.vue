<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { listSyncQueueModels, requeueModelSync } from '@/services/api'
import type { PersistedModelSummary } from '@/types/persistence'

const models = ref<PersistedModelSummary[]>([])
const isLoading = ref(false)
const retryingModelId = ref<string | null>(null)
let refreshTimer: number | null = null

const queueSummary = computed(() => ({
  processing: models.value.filter((model) => model.syncStatus === 'PROCESSING').length,
  pending: models.value.filter((model) => model.syncStatus === 'PENDING').length,
  failed: models.value.filter((model) => model.syncStatus === 'FAILED').length,
  ready: models.value.filter((model) => model.syncStatus === 'READY').length,
}))

function formatDateTime(value: string | null) {
  if (!value) {
    return '--'
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
  })
}

function formatProgress(model: PersistedModelSummary) {
  if (model.syncStatus === 'READY') {
    return `${model.totalElements} / ${model.totalElements}`
  }

  if (model.totalElements <= 0) {
    return model.syncStatus === 'PENDING' ? '等待后端处理' : '准备中'
  }

  return `${model.syncProcessedElements} / ${model.totalElements}`
}

function syncStatusTagType(model: PersistedModelSummary) {
  switch (model.syncStatus) {
    case 'READY':
      return 'success'
    case 'FAILED':
      return 'danger'
    case 'PROCESSING':
      return 'warning'
    default:
      return 'info'
  }
}

function syncStatusLabel(model: PersistedModelSummary) {
  switch (model.syncStatus) {
    case 'READY':
      return '已完成'
    case 'FAILED':
      return '失败'
    case 'PROCESSING':
      return '同步中'
    default:
      return '排队中'
  }
}

async function refreshQueue() {
  isLoading.value = true

  try {
    models.value = await listSyncQueueModels()
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载同步队列失败'
    ElMessage.error(message)
  } finally {
    isLoading.value = false
  }
}

async function retrySync(modelId: string) {
  retryingModelId.value = modelId

  try {
    await requeueModelSync(modelId)
    ElMessage.success('已重新加入后台同步队列')
    await refreshQueue()
  } catch (error) {
    const message = error instanceof Error ? error.message : '重试失败'
    ElMessage.error(message)
  } finally {
    retryingModelId.value = null
  }
}

onMounted(() => {
  void refreshQueue()
  refreshTimer = window.setInterval(() => {
    void refreshQueue()
  }, 3000)
})

onUnmounted(() => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
  }
})
</script>

<template>
  <div class="sync-queue-page">
    <div class="page-header">
      <div>
        <p class="eyebrow">Background Sync</p>
        <h1>IFC 同步队列</h1>
        <p class="page-copy">上传只负责入队，真正的属性提取和入库都由后端持续执行。</p>
      </div>
      <div class="header-actions">
        <RouterLink class="ghost-link" to="/">返回查看器</RouterLink>
        <button class="primary-button" type="button" @click="refreshQueue" :disabled="isLoading">刷新</button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <span class="summary-label">同步中</span>
        <strong>{{ queueSummary.processing }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">排队中</span>
        <strong>{{ queueSummary.pending }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">失败</span>
        <strong>{{ queueSummary.failed }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">已完成</span>
        <strong>{{ queueSummary.ready }}</strong>
      </div>
    </div>

    <div class="table-card">
      <ElTable :data="models" v-loading="isLoading" stripe>
        <ElTableColumn prop="originalFileName" label="文件名" min-width="220" />
        <ElTableColumn label="状态" width="120">
          <template #default="{ row }">
            <ElTag :type="syncStatusTagType(row)">{{ syncStatusLabel(row) }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="进度" min-width="150">
          <template #default="{ row }">
            {{ formatProgress(row) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="属性数" width="110">
          <template #default="{ row }">
            {{ row.totalProperties }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="排队时间" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.syncQueuedAt) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="开始时间" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.syncStartedAt) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="完成时间" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.syncCompletedAt) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="错误信息" min-width="260">
          <template #default="{ row }">
            <span class="error-text">{{ row.syncError ?? '--' }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <ElButton
              v-if="row.syncStatus === 'FAILED'"
              size="small"
              type="primary"
              :loading="retryingModelId === row.id"
              @click="retrySync(row.id)"
            >
              重试
            </ElButton>
            <span v-else class="muted-action">--</span>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
  </div>
</template>

<style scoped>
.sync-queue-page {
  min-height: 100vh;
  padding: 32px;
  background:
    radial-gradient(circle at top left, rgba(29, 78, 216, 0.16), transparent 28%),
    linear-gradient(180deg, #f3f6fb 0%, #e7edf7 100%);
  color: #10233d;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #476a93;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.05;
}

.page-copy {
  margin: 12px 0 0;
  max-width: 620px;
  color: #445a78;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.ghost-link,
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 600;
  text-decoration: none;
}

.ghost-link {
  border: 1px solid rgba(16, 35, 61, 0.15);
  color: #10233d;
  background: rgba(255, 255, 255, 0.74);
}

.primary-button {
  border: none;
  color: white;
  background: linear-gradient(135deg, #0f766e, #0b5ed7);
  cursor: pointer;
}

.primary-button:disabled {
  cursor: progress;
  opacity: 0.7;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card,
.table-card {
  border: 1px solid rgba(16, 35, 61, 0.08);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
}

.summary-card {
  padding: 18px 20px;
}

.summary-card strong {
  display: block;
  margin-top: 8px;
  font-size: 28px;
}

.summary-label {
  color: #59708f;
}

.table-card {
  padding: 18px;
}

.error-text {
  color: #8b1e3f;
}

.muted-action {
  color: #7d8aa0;
}

@media (max-width: 960px) {
  .sync-queue-page {
    padding: 20px;
  }

  .page-header {
    flex-direction: column;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .header-actions {
    width: 100%;
  }

  .ghost-link,
  .primary-button {
    flex: 1;
  }
}
</style>
