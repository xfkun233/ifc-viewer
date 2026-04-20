import type {
  AnnotationMutation,
  CustomPropertyMutation,
  IfcSnapshotElement,
  PersistedAnnotation,
  PersistedCustomProperty,
  PersistedModelSummary,
} from '@/types/persistence'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3001/api'

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${input}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const fallback = await response.text()
    throw new Error(fallback || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function listPersistedModels(): Promise<PersistedModelSummary[]> {
  const response = await requestJson<{ items: PersistedModelSummary[] }>('/models')
  return response.items
}

export async function listSyncQueueModels(): Promise<PersistedModelSummary[]> {
  const response = await requestJson<{ items: PersistedModelSummary[] }>('/sync-queue')
  return response.items
}

export async function uploadIfcModel(file: File): Promise<PersistedModelSummary> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/models/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const data = (await response.json()) as { item: PersistedModelSummary }
  return data.item
}

export async function fetchPersistedModelFile(modelId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/models/${modelId}/file`)

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.blob()
}

export async function requeueModelSync(modelId: string): Promise<PersistedModelSummary> {
  const response = await requestJson<{ item: PersistedModelSummary }>(`/models/${modelId}/requeue-sync`, {
    method: 'POST',
  })

  return response.item
}

export async function startModelSnapshotSync(
  modelId: string,
  input: { totalElements: number; totalChunks: number },
): Promise<void> {
  await requestJson(`/models/${modelId}/snapshot/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function uploadModelSnapshotChunk(
  modelId: string,
  input: { chunkIndex: number; elements: IfcSnapshotElement[] },
): Promise<void> {
  await requestJson(`/models/${modelId}/snapshot/chunk`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function completeModelSnapshotSync(
  modelId: string,
  input: { totalElements: number; totalProperties: number },
): Promise<void> {
  await requestJson(`/models/${modelId}/snapshot/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function failModelSnapshotSync(
  modelId: string,
  input: { reason: string | null },
): Promise<void> {
  await requestJson(`/models/${modelId}/snapshot/fail`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function bootstrapModelOverlays(
  modelId: string,
  input: {
    customProperties: CustomPropertyMutation[]
    annotations: AnnotationMutation[]
  },
): Promise<{
  customProperties: PersistedCustomProperty[]
  annotations: PersistedAnnotation[]
}> {
  const response = await requestJson<{
    item: {
      customProperties: PersistedCustomProperty[]
      annotations: PersistedAnnotation[]
    }
  }>(`/models/${modelId}/overlays/bootstrap`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return response.item
}

export async function getModelOverlays(modelId: string): Promise<{
  customProperties: PersistedCustomProperty[]
  annotations: PersistedAnnotation[]
}> {
  const response = await requestJson<{
    item: {
      customProperties: PersistedCustomProperty[]
      annotations: PersistedAnnotation[]
    }
  }>(`/models/${modelId}/overlays`)

  return response.item
}

export async function upsertModelCustomProperty(
  modelId: string,
  payload: CustomPropertyMutation,
): Promise<PersistedCustomProperty> {
  const response = await requestJson<{ item: PersistedCustomProperty }>(`/models/${modelId}/custom-properties`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

  return response.item
}

export async function deleteModelCustomProperty(modelId: string, propertyId: string): Promise<void> {
  await requestJson(`/models/${modelId}/custom-properties/${propertyId}`, {
    method: 'DELETE',
  })
}

export async function upsertModelAnnotation(
  modelId: string,
  payload: AnnotationMutation,
): Promise<PersistedAnnotation> {
  const response = await requestJson<{ item: PersistedAnnotation }>(`/models/${modelId}/annotations`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

  return response.item
}

export async function deleteModelAnnotation(modelId: string, annotationId: string): Promise<void> {
  await requestJson(`/models/${modelId}/annotations/${annotationId}`, {
    method: 'DELETE',
  })
}
