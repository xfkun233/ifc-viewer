export type PropertyValueType = 'STRING' | 'LABEL' | 'REAL' | 'INTEGER' | 'BOOLEAN'
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface PersistedModelSummary {
  id: string
  originalFileName: string
  storedFileName: string
  mimeType: string
  fileSize: number
  fileHash: string
  sourceFingerprint: string
  syncStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  syncQueuedAt: string | null
  syncError: string | null
  syncProcessedElements: number
  totalElements: number
  totalProperties: number
  syncStartedAt: string | null
  syncCompletedAt: string | null
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PersistedCustomProperty {
  id: string
  expressId: number
  psetName: string
  propertyName: string
  valueType: PropertyValueType
  value: string | number | boolean
  createdAt: string
  updatedAt: string
}

export interface PersistedAnnotation {
  id: string
  databaseId: string
  x: number
  y: number
  z: number
  text: string
  createdAt: string
  updatedAt: string
}

export interface IfcSnapshotProperty {
  psetName: string
  propertyName: string
  valueType: PropertyValueType
  value: string | number | boolean
}

export interface IfcSnapshotElement {
  expressId: number
  globalId: string | null
  entityType: string | null
  name: string | null
  objectType: string | null
  predefinedType: string | null
  attributes: Record<string, string | number | boolean | null>
  rawData: JsonValue | null
  properties: IfcSnapshotProperty[]
}

export interface CustomPropertyMutation {
  expressId: number
  psetName: string
  propertyName: string
  valueType: PropertyValueType
  value: string | number | boolean
}

export interface AnnotationMutation {
  clientId: string
  x: number
  y: number
  z: number
  text: string
}
