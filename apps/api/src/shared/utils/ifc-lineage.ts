import { sha256 } from './hash.js';

const MARKER_START = '/* === CUSTOM_DATA_START === */';
const MARKER_END = '/* === CUSTOM_DATA_END === */';
const METADATA_MARKER_START = '/* IFC_VIEWER_METADATA_JSON_START */';
const METADATA_MARKER_END = '/* IFC_VIEWER_METADATA_JSON_END */';
const MARKER_SCAN_LIMIT = 5 * 1024 * 1024;

export interface IfcLineageMetadata {
  schemaVersion: number;
  sourceFingerprint: string;
  baseContentHash: string;
  importedFileHash?: string | null;
  exporter?: string;
  exportedAt?: string;
}

function findMarkerIndex(data: Uint8Array, marker: string, scanLimit = MARKER_SCAN_LIMIT): number {
  const markerBytes = new TextEncoder().encode(marker);
  const scanStart = Math.max(0, data.length - scanLimit);

  outer: for (let index = scanStart; index <= data.length - markerBytes.length; index += 1) {
    if (data[index] !== markerBytes[0]) continue;

    for (let offset = 1; offset < markerBytes.length; offset += 1) {
      if (data[index + offset] !== markerBytes[offset]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function findEndSecPosition(data: Uint8Array): number {
  const endSecBytes = new TextEncoder().encode('ENDSEC;');
  const scanStart = Math.max(0, data.length - MARKER_SCAN_LIMIT);
  let lastFound = -1;

  outer: for (let index = scanStart; index <= data.length - endSecBytes.length; index += 1) {
    if (data[index] !== endSecBytes[0]) continue;

    for (let offset = 1; offset < endSecBytes.length; offset += 1) {
      if (data[index + offset] !== endSecBytes[offset]) {
        continue outer;
      }
    }

    lastFound = index;
  }

  return lastFound;
}

export function getIfcBaseData(data: Uint8Array): Uint8Array {
  const markerIndex = findMarkerIndex(data, MARKER_START);
  if (markerIndex !== -1) {
    return data.slice(0, markerIndex);
  }

  const endSecIndex = findEndSecPosition(data);
  if (endSecIndex === -1) {
    return data.slice();
  }

  return data.slice(0, endSecIndex);
}

function extractCustomDataSection(data: Uint8Array): string | null {
  const startIndex = findMarkerIndex(data, MARKER_START);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = findMarkerIndex(data, MARKER_END);
  if (endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const sectionBytes = data.slice(startIndex + MARKER_START.length, endIndex);
  return new TextDecoder().decode(sectionBytes);
}

export function parseIfcLineageMetadata(data: Uint8Array): IfcLineageMetadata | null {
  const customSection = extractCustomDataSection(data);
  if (!customSection) {
    return null;
  }

  const startIndex = customSection.indexOf(METADATA_MARKER_START);
  const endIndex = customSection.indexOf(METADATA_MARKER_END);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const jsonPayload = customSection
    .slice(startIndex + METADATA_MARKER_START.length, endIndex)
    .trim()
    .replace(/^\/\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonPayload) as Partial<IfcLineageMetadata>;
    if (
      typeof parsed.schemaVersion === 'number' &&
      typeof parsed.sourceFingerprint === 'string' &&
      typeof parsed.baseContentHash === 'string'
    ) {
      return {
        schemaVersion: parsed.schemaVersion,
        sourceFingerprint: parsed.sourceFingerprint,
        baseContentHash: parsed.baseContentHash,
        importedFileHash: parsed.importedFileHash ?? null,
        exporter: parsed.exporter,
        exportedAt: parsed.exportedAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function deriveIfcLineage(buffer: Buffer) {
  const fileHash = sha256(buffer);
  const baseData = getIfcBaseData(buffer);
  const baseContentHash = sha256(Buffer.from(baseData));
  const embeddedMetadata = parseIfcLineageMetadata(buffer);
  const sourceFingerprint = embeddedMetadata?.sourceFingerprint ?? baseContentHash;

  return {
    fileHash,
    baseContentHash,
    sourceFingerprint,
    embeddedMetadata,
  };
}
