import { IfcAPI } from 'web-ifc';
import type { SnapshotElementInput, SnapshotPropertyInput } from './model.schemas.js';

interface RawIfcAttribute {
  value?: string | number | boolean | null;
  type?: string;
}

type RawIfcRecord = Record<string, unknown>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const INVERSE_RELATION_KEYS = new Set(['IsDefinedBy', 'IsTypedBy', 'HasAssociations', 'AssignedItems']);
const PROPERTY_COLLECTION_KEYS = ['HasProperties', 'Quantities', 'Properties'];
const VALUE_CANDIDATE_KEYS = [
  'NominalValue',
  'LengthValue',
  'AreaValue',
  'VolumeValue',
  'CountValue',
  'WeightValue',
  'TimeValue',
  'NumberValue',
  'BooleanValue',
  'RatioValue',
];

function readAttributeValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'value' in value) {
    const attribute = value as RawIfcAttribute;
    if (
      typeof attribute.value === 'string' ||
      typeof attribute.value === 'number' ||
      typeof attribute.value === 'boolean' ||
      attribute.value === null
    ) {
      return attribute.value;
    }
  }

  return null;
}

function mapIfcValueType(valueTypeHint: unknown, value: string | number | boolean) {
  if (typeof value === 'boolean') {
    return 'BOOLEAN' as const;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? ('INTEGER' as const) : ('REAL' as const);
  }

  const normalizedHint = typeof valueTypeHint === 'string' ? valueTypeHint.toUpperCase() : '';

  if (normalizedHint.includes('LABEL')) {
    return 'LABEL' as const;
  }

  return 'STRING' as const;
}

function normalizeBasicAttributes(item: RawIfcRecord): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {};

  for (const [key, rawValue] of Object.entries(item)) {
    if (INVERSE_RELATION_KEYS.has(key)) {
      continue;
    }

    attributes[key] = readAttributeValue(rawValue);
  }

  return attributes;
}

function normalizeJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth > 12) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeJsonValue(entry, depth + 1, seen))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    const record: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value as RawIfcRecord)) {
      const normalized = normalizeJsonValue(nestedValue, depth + 1, seen);
      if (normalized !== undefined) {
        record[key] = normalized;
      }
    }

    seen.delete(value);
    return record;
  }

  return String(value);
}

function readNamedRecord(record: RawIfcRecord, fallback: string) {
  const name = readAttributeValue(record.Name);
  return typeof name === 'string' && name.trim() ? name : fallback;
}

function extractSimpleValue(record: RawIfcRecord): { value: string | number | boolean; typeHint?: string } | null {
  const nominalValue = record.NominalValue as RawIfcAttribute | undefined;
  const nominal = readAttributeValue(nominalValue);
  if (nominal !== null) {
    return {
      value: nominal,
      typeHint: nominalValue?.type,
    };
  }

  for (const key of VALUE_CANDIDATE_KEYS) {
    const rawValue = record[key];
    const value = readAttributeValue(rawValue);
    if (value !== null) {
      return {
        value,
        typeHint: typeof rawValue === 'object' && rawValue !== null && 'type' in rawValue ? (rawValue as RawIfcAttribute).type : undefined,
      };
    }
  }

  const enumValues = Array.isArray(record.EnumerationValues) ? record.EnumerationValues : [];
  const normalizedEnums = enumValues
    .map((entry) => readAttributeValue(entry))
    .filter((entry): entry is string | number | boolean => entry !== null);

  if (normalizedEnums.length > 0) {
    return {
      value: normalizedEnums.join(', '),
    };
  }

  return null;
}

function collectProperties(
  value: unknown,
  fallbackPsetName: string,
  sink: Map<string, SnapshotPropertyInput>,
  seen = new WeakSet<object>(),
) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectProperties(entry, fallbackPsetName, sink, seen);
    }
    return;
  }

  const record = value as RawIfcRecord;
  const currentPsetName = readNamedRecord(record, fallbackPsetName);

  for (const collectionKey of PROPERTY_COLLECTION_KEYS) {
    const collection = Array.isArray(record[collectionKey]) ? (record[collectionKey] as RawIfcRecord[]) : [];

    for (const propertyRecord of collection) {
      const propertyName = readAttributeValue(propertyRecord.Name);
      if (typeof propertyName !== 'string' || !propertyName.trim()) {
        continue;
      }

      const extracted = extractSimpleValue(propertyRecord);
      if (!extracted) {
        continue;
      }

      const dedupeKey = `${currentPsetName}::${propertyName}`;
      if (sink.has(dedupeKey)) {
        continue;
      }

      sink.set(dedupeKey, {
        psetName: currentPsetName,
        propertyName,
        value: extracted.value,
        valueType: mapIfcValueType(extracted.typeHint, extracted.value),
      });
    }
  }

  for (const nestedValue of Object.values(record)) {
    collectProperties(nestedValue, currentPsetName, sink, seen);
  }
}

function vectorToArray(vector: { size(): number; get(index: number): number }) {
  const result: number[] = [];

  for (let index = 0; index < vector.size(); index += 1) {
    result.push(vector.get(index));
  }

  return result;
}

async function extractElementSnapshot(api: IfcAPI, modelId: number, expressId: number): Promise<SnapshotElementInput> {
  const [item, propertySets, typeProperties, materialProperties] = await Promise.all([
    api.properties.getItemProperties(modelId, expressId, false, true),
    api.properties.getPropertySets(modelId, expressId, true, true),
    api.properties.getTypeProperties(modelId, expressId, true),
    api.properties.getMaterialsProperties(modelId, expressId, true, true),
  ]);

  const itemRecord = (item ?? {}) as RawIfcRecord;
  const attributes = normalizeBasicAttributes(itemRecord);
  const propertySink = new Map<string, SnapshotPropertyInput>();

  collectProperties(propertySets, 'PropertySet', propertySink);
  collectProperties(typeProperties, 'TypePropertySet', propertySink);
  collectProperties(materialProperties, 'Material', propertySink);

  return {
    expressId,
    globalId: typeof attributes.GlobalId === 'string' ? attributes.GlobalId : null,
    entityType: typeof itemRecord.type === 'string' ? itemRecord.type : null,
    name: typeof attributes.Name === 'string' ? attributes.Name : null,
    objectType: typeof attributes.ObjectType === 'string' ? attributes.ObjectType : null,
    predefinedType: typeof attributes.PredefinedType === 'string' ? attributes.PredefinedType : null,
    attributes,
    rawData: normalizeJsonValue({
      item,
      propertySets,
      typeProperties,
      materialProperties,
    }) ?? null,
    properties: Array.from(propertySink.values()),
  };
}

export class BackendIfcSnapshotExtractor {
  private readonly api = new IfcAPI();

  private initialized = false;

  public async init() {
    if (this.initialized) {
      return;
    }

    await this.api.Init();
    this.initialized = true;
  }

  public async extractFromBuffer(
    data: Uint8Array,
    onChunk: (chunk: { elements: SnapshotElementInput[]; processedElements: number; totalElements: number }) => Promise<void>,
  ) {
    await this.init();

    const modelId = this.api.OpenModel(data);

    try {
      const entityTypes = this.api.GetIfcEntityList(modelId);
      const expressIds = new Set<number>();

      for (const entityType of entityTypes) {
        if (!this.api.IsIfcElement(entityType)) {
          continue;
        }

        const ids = vectorToArray(this.api.GetLineIDsWithType(modelId, entityType, true));
        for (const expressId of ids) {
          expressIds.add(expressId);
        }
      }

      const orderedExpressIds = Array.from(expressIds).sort((left, right) => left - right);
      const chunkSize = 20;

      for (let index = 0; index < orderedExpressIds.length; index += chunkSize) {
        const chunkIds = orderedExpressIds.slice(index, index + chunkSize);
        const elements = await Promise.all(chunkIds.map((expressId) => extractElementSnapshot(this.api, modelId, expressId)));

        await onChunk({
          elements,
          processedElements: Math.min(index + chunkIds.length, orderedExpressIds.length),
          totalElements: orderedExpressIds.length,
        });
      }

      return {
        totalElements: orderedExpressIds.length,
      };
    } finally {
      this.api.CloseModel(modelId);
    }
  }
}

export const backendIfcSnapshotExtractor = new BackendIfcSnapshotExtractor();
