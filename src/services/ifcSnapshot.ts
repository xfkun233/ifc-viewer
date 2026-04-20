import type { FragmentsModel } from '@thatopen/fragments'
import type { IfcSnapshotElement, IfcSnapshotProperty, JsonValue, PropertyValueType } from '@/types/persistence'

interface RawIfcAttribute {
  value?: string | number | boolean | null
  type?: string
}

type RawIfcRecord = Record<string, unknown>

const PROPERTY_DEFINITION_TYPES = new Set(['IFCPROPERTYSET', 'IFCELEMENTQUANTITY'])

function readAttributeValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'value' in value) {
    const attr = value as RawIfcAttribute
    if (
      typeof attr.value === 'string' ||
      typeof attr.value === 'number' ||
      typeof attr.value === 'boolean' ||
      attr.value === null
    ) {
      return attr.value
    }
  }

  return null
}

function mapIfcValueType(valueTypeHint: unknown, value: string | number | boolean): PropertyValueType {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'REAL'

  const normalizedHint =
    typeof valueTypeHint === 'string'
      ? valueTypeHint.toUpperCase()
      : ''

  if (normalizedHint.includes('LABEL')) return 'LABEL'
  return 'STRING'
}

function normalizeBasicAttributes(item: RawIfcRecord): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {}

  for (const [key, rawValue] of Object.entries(item)) {
    if (key === 'IsDefinedBy' || key === 'IsTypedBy' || key === 'HasAssociations') continue
    attributes[key] = readAttributeValue(rawValue)
  }

  return attributes
}

function normalizeJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (depth > 12) {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => normalizeJsonValue(entry, depth + 1, seen))
      .filter((entry): entry is JsonValue => entry !== undefined)

    return normalized
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }

    seen.add(value)

    const normalizedRecord: Record<string, JsonValue> = {}
    for (const [key, nestedValue] of Object.entries(value as RawIfcRecord)) {
      const normalizedValue = normalizeJsonValue(nestedValue, depth + 1, seen)
      if (normalizedValue !== undefined) {
        normalizedRecord[key] = normalizedValue
      }
    }

    seen.delete(value)
    return normalizedRecord
  }

  return String(value)
}

function collectPropertyDefinitions(
  value: unknown,
  definitions: Map<number, string>,
  seen = new WeakSet<object>(),
) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (seen.has(value)) {
    return
  }

  seen.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPropertyDefinitions(entry, definitions, seen)
    }
    return
  }

  const record = value as RawIfcRecord
  const typeName = typeof record.type === 'string' ? record.type.toUpperCase() : ''
  const localId = readAttributeValue(record._localId)

  if (typeof localId === 'number' && PROPERTY_DEFINITION_TYPES.has(typeName)) {
    const rawName = readAttributeValue(record.Name)
    definitions.set(localId, typeof rawName === 'string' && rawName.trim() ? rawName : 'PropertySet')
  }

  for (const nestedValue of Object.values(record)) {
    collectPropertyDefinitions(nestedValue, definitions, seen)
  }
}

export async function getAllIfcExpressIds(model: FragmentsModel): Promise<number[]> {
  const allIdsByCategory = await model.getItemsOfCategories([/.*/])
  const uniqueIds = new Set<number>()

  for (const ids of Object.values(allIdsByCategory)) {
    for (const id of ids) {
      uniqueIds.add(id)
    }
  }

  return Array.from(uniqueIds).sort((a, b) => a - b)
}

export async function extractIfcSnapshotChunk(
  model: FragmentsModel,
  expressIds: number[],
): Promise<IfcSnapshotElement[]> {
  if (expressIds.length === 0) {
    return []
  }

  const itemsData = (await model.getItemsData(expressIds, {
    attributesDefault: true,
    relations: {
      IsDefinedBy: { attributes: true, relations: true },
      IsTypedBy: { attributes: true, relations: true },
      HasAssociations: { attributes: true, relations: true },
    },
    relationsDefault: { attributes: true, relations: false },
  })) as RawIfcRecord[]

  const baseElements = new Map<number, IfcSnapshotElement>()
  const psetToElementIds = new Map<number, Set<number>>()
  const psetNameMap = new Map<number, string>()

  for (let index = 0; index < expressIds.length; index += 1) {
    const expressId = expressIds[index]!
    const item = itemsData[index] ?? {}
    const attributes = normalizeBasicAttributes(item)
    const rawData = normalizeJsonValue(item) ?? null

    baseElements.set(expressId, {
      expressId,
      globalId: typeof attributes.GlobalId === 'string' ? attributes.GlobalId : null,
      entityType: typeof item.type === 'string' ? item.type : null,
      name: typeof attributes.Name === 'string' ? attributes.Name : null,
      objectType: typeof attributes.ObjectType === 'string' ? attributes.ObjectType : null,
      predefinedType: typeof attributes.PredefinedType === 'string' ? attributes.PredefinedType : null,
      attributes,
      rawData,
      properties: [],
    })

    const definitions = new Map<number, string>()
    collectPropertyDefinitions(item.IsDefinedBy, definitions)
    collectPropertyDefinitions(item.IsTypedBy, definitions)

    for (const [psetId, psetName] of definitions.entries()) {
      const relatedElementIds = psetToElementIds.get(psetId) ?? new Set<number>()
      relatedElementIds.add(expressId)
      psetToElementIds.set(psetId, relatedElementIds)
      psetNameMap.set(psetId, psetName)
    }
  }

  const psetIds = Array.from(psetToElementIds.keys())
  if (psetIds.length === 0) {
    return expressIds.map((id) => baseElements.get(id)!).filter(Boolean)
  }

  const psetData = (await model.getItemsData(psetIds, {
    attributesDefault: false,
    relations: {
      HasProperties: { attributes: true, relations: false },
      Quantities: { attributes: true, relations: false },
    },
    relationsDefault: { attributes: false, relations: false },
  })) as RawIfcRecord[]

  const propertyIdToDescriptor = new Map<number, { psetId: number; kind: 'property' | 'quantity' }>()
  const detailedPropertyIdsSet = new Set<number>()

  for (let index = 0; index < psetIds.length; index += 1) {
    const psetId = psetIds[index]!
    const psetRecord = psetData[index] ?? {}
    const hasProperties = Array.isArray(psetRecord.HasProperties) ? (psetRecord.HasProperties as RawIfcRecord[]) : []
    const quantities = Array.isArray(psetRecord.Quantities) ? (psetRecord.Quantities as RawIfcRecord[]) : []

    for (const rawProperty of hasProperties) {
      const propertyId = readAttributeValue(rawProperty._localId)
      if (typeof propertyId === 'number') {
        propertyIdToDescriptor.set(propertyId, { psetId, kind: 'property' })
        detailedPropertyIdsSet.add(propertyId)
      }
    }

    for (const rawQuantity of quantities) {
      const quantityId = readAttributeValue(rawQuantity._localId)
      if (typeof quantityId === 'number') {
        propertyIdToDescriptor.set(quantityId, { psetId, kind: 'quantity' })
        detailedPropertyIdsSet.add(quantityId)
      }
    }
  }

  const detailedPropertyIds = Array.from(detailedPropertyIdsSet)

  if (detailedPropertyIds.length === 0) {
    return expressIds.map((id) => baseElements.get(id)!).filter(Boolean)
  }

  const propertyData = (await model.getItemsData(detailedPropertyIds, {
    attributesDefault: true,
    relationsDefault: { attributes: false, relations: false },
  })) as RawIfcRecord[]

  const propertiesByPset = new Map<number, IfcSnapshotProperty[]>()
  const propertyKeysByPset = new Map<number, Set<string>>()

  for (let index = 0; index < detailedPropertyIds.length; index += 1) {
    const propertyId = detailedPropertyIds[index]!
    const propertyRecord = propertyData[index] ?? {}
    const descriptor = propertyIdToDescriptor.get(propertyId)
    if (!descriptor) continue

    const propertyName = readAttributeValue(propertyRecord.Name)
    if (typeof propertyName !== 'string' || !propertyName.trim()) continue

    let propertyValue: string | number | boolean | null = null
    let valueTypeHint: string | undefined

    const nominalValue = propertyRecord.NominalValue as RawIfcAttribute | undefined
    if (descriptor.kind === 'property' && nominalValue) {
      propertyValue = readAttributeValue(nominalValue)
      valueTypeHint = nominalValue.type
    } else {
      for (const quantityKey of ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue']) {
        const quantityValue = readAttributeValue(propertyRecord[quantityKey])
        if (quantityValue !== null) {
          propertyValue = quantityValue
          break
        }
      }
    }

    if (propertyValue === null) continue

    const psetProperties = propertiesByPset.get(descriptor.psetId) ?? []
    const propertyKeys = propertyKeysByPset.get(descriptor.psetId) ?? new Set<string>()
    const propertyKey = `${propertyName}`

    if (propertyKeys.has(propertyKey)) {
      continue
    }

    psetProperties.push({
      psetName: psetNameMap.get(descriptor.psetId) ?? 'PropertySet',
      propertyName,
      value: propertyValue,
      valueType: mapIfcValueType(valueTypeHint, propertyValue),
    })
    propertiesByPset.set(descriptor.psetId, psetProperties)
    propertyKeys.add(propertyKey)
    propertyKeysByPset.set(descriptor.psetId, propertyKeys)
  }

  for (const [psetId, elementIds] of psetToElementIds.entries()) {
    const properties = propertiesByPset.get(psetId) ?? []
    for (const expressId of elementIds) {
      const element = baseElements.get(expressId)
      if (!element) continue
      element.properties.push(...properties)
    }
  }

  return expressIds.map((id) => baseElements.get(id)!).filter(Boolean)
}
