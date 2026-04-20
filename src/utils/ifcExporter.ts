/**
 * IFC Exporter - "Slice & Overwrite" Strategy
 * Treats IFC file as "Read-Only Base Layer" + "Writable User Layer"
 */

// ============================================================================
// Constants
// ============================================================================

export const MARKER_START = '/* === CUSTOM_DATA_START === */';
export const MARKER_END = '/* === CUSTOM_DATA_END === */';
export const METADATA_MARKER_START = '/* IFC_VIEWER_METADATA_JSON_START */';
export const METADATA_MARKER_END = '/* IFC_VIEWER_METADATA_JSON_END */';

// Performance: Only scan last 5MB for markers
const MARKER_SCAN_LIMIT = 5 * 1024 * 1024;

// Annotation markers within custom data section
const ANNOTATION_MARKER_START = '/* ANNOTATIONS_JSON_START */';
const ANNOTATION_MARKER_END = '/* ANNOTATIONS_JSON_END */';

// ============================================================================
// Types
// ============================================================================

export interface PendingPropertyWrite {
  /** Target element's Express ID (e.g., #12345) */
  elementId: string;
  /** Property set name */
  psetName: string;
  /** Property name */
  propertyName: string;
  /** Property value */
  value: string | number | boolean;
  /** Value type: STRING, REAL, INTEGER, BOOLEAN, LABEL */
  valueType: 'STRING' | 'REAL' | 'INTEGER' | 'BOOLEAN' | 'LABEL';
}

export interface IfcLineageMetadata {
  schemaVersion: number;
  sourceFingerprint: string;
  baseContentHash: string;
  importedFileHash?: string | null;
  exporter?: string;
  exportedAt?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Efficiently search for a marker string in Uint8Array
 * Scans only the last `scanLimit` bytes for performance
 */
export function findMarkerIndex(
  data: Uint8Array,
  marker: string,
  scanLimit: number = MARKER_SCAN_LIMIT
): number {
  const markerBytes = new TextEncoder().encode(marker);
  const markerLen = markerBytes.length;

  // Determine scan start position
  const scanStart = Math.max(0, data.length - scanLimit);

  // Boyer-Moore-Horspool simplified: scan byte-by-byte from scanStart
  outer: for (let i = scanStart; i <= data.length - markerLen; i++) {
    // Quick first-byte check
    if (data[i] !== markerBytes[0]) continue;

    // Full comparison
    for (let j = 1; j < markerLen; j++) {
      if (data[i + j] !== markerBytes[j]) continue outer;
    }

    return i;
  }

  return -1;
}

/**
 * Find the position of "ENDSEC;" in the data (scanning from end)
 * Returns the byte offset of 'E' in ENDSEC;
 */
export function findEndSecPosition(data: Uint8Array): number {
  const endSecBytes = new TextEncoder().encode('ENDSEC;');
  const endSecLen = endSecBytes.length;

  // Scan from end, within limit
  const scanStart = Math.max(0, data.length - MARKER_SCAN_LIMIT);

  // Find the LAST occurrence of ENDSEC;
  let lastFound = -1;

  outer: for (let i = scanStart; i <= data.length - endSecLen; i++) {
    if (data[i] !== endSecBytes[0]) continue;

    for (let j = 1; j < endSecLen; j++) {
      if (data[i + j] !== endSecBytes[j]) continue outer;
    }

    lastFound = i;
  }

  return lastFound;
}

export function getIfcBaseData(data: Uint8Array): Uint8Array {
  const markerIndex = findMarkerIndex(data, MARKER_START);
  if (markerIndex !== -1) {
    return data.slice(0, markerIndex);
  }

  const endSecPos = findEndSecPosition(data);
  if (endSecPos === -1) {
    return data.slice();
  }

  return data.slice(0, endSecPos);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return toHex(new Uint8Array(digest));
}

export async function computeIfcSourceFingerprint(data: Uint8Array): Promise<string> {
  return sha256Hex(getIfcBaseData(data));
}

/**
 * Find the maximum Express ID (#xxxx=) from binary data
 * Scans the entire base data to ensure correctness
 */
export function findMaxExpressIdFromBytes(data: Uint8Array): number {
  let maxId = 0;

  // State machine to parse #<digits>=
  let inId = false;
  let currentId = 0;

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;

    if (byte === 0x23) {
      // '#' character
      inId = true;
      currentId = 0;
    } else if (inId) {
      if (byte >= 0x30 && byte <= 0x39) {
        // '0'-'9'
        currentId = currentId * 10 + (byte - 0x30);
      } else if (byte === 0x3d) {
        // '=' character - valid ID end
        if (currentId > maxId) {
          maxId = currentId;
        }
        inId = false;
      } else {
        // Invalid character, reset
        inId = false;
      }
    }
  }

  return maxId;
}

/**
 * Generate IFC-compliant GUID (22 characters, base64-like encoding)
 * IFC uses a specific 64-character set for encoding
 */
export function generateIfcGuid(): string {
  // IFC base64 character set (different from standard base64)
  const chars =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  // Generate 128 bits of randomness (16 bytes)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Convert to IFC GUID format (22 characters)
  let guid = '';

  // Process 16 bytes into 22 base64 characters
  // Each group of 3 bytes becomes 4 characters (with padding at end)
  for (let i = 0; i < 16; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;

    const n =
      i + 2 < 16
        ? (b0 << 16) | (b1 << 8) | b2
        : i + 1 < 16
          ? (b0 << 16) | (b1 << 8)
          : b0 << 16;

    const charCount = i + 2 < 16 ? 4 : i + 1 < 16 ? 3 : 2;

    for (let j = 0; j < charCount; j++) {
      const shift = 18 - j * 6;
      const index = (n >> shift) & 0x3f;
      guid += chars[index];
    }
  }

  return guid;
}

/**
 * Escape string value for IFC format
 */
function escapeIfcString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Format property value based on type for IFC
 */
function formatIfcValue(
  value: string | number | boolean,
  valueType: PendingPropertyWrite['valueType']
): string {
  switch (valueType) {
    case 'STRING':
      return `IFCTEXT('${escapeIfcString(String(value))}')`;
    case 'LABEL':
      return `IFCLABEL('${escapeIfcString(String(value))}')`;
    case 'REAL':
      return `IFCREAL(${Number(value)})`;
    case 'INTEGER':
      return `IFCINTEGER(${Math.floor(Number(value))})`;
    case 'BOOLEAN':
      return `IFCBOOLEAN(.${value ? 'T' : 'F'}.)`;
    default:
      return `IFCTEXT('${escapeIfcString(String(value))}')`;
  }
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Create an updated IFC Blob with custom properties using "Slice & Overwrite" strategy
 *
 * @param originalData - The loaded IFC file buffer
 * @param allProperties - List of ALL custom properties to be saved
 * @returns Blob containing the updated IFC file
 */
export async function createUpdatedIfcBlob(
  originalData: Uint8Array,
  allProperties: PendingPropertyWrite[],
  annotations?: AnnotationPoint[],
  lineageMetadata?: IfcLineageMetadata | null
): Promise<Blob> {
  // =========================================================================
  // Step 1: Find Split Point
  // =========================================================================
  const markerIndex = findMarkerIndex(originalData, MARKER_START);
  const endSecPos = findEndSecPosition(originalData);
  const baseData = getIfcBaseData(originalData);

  if (markerIndex !== -1) {
    console.log(`[IFC Export] Marker found at byte ${markerIndex}, overwriting existing custom data`);
  } else if (endSecPos !== -1) {
    console.log(`[IFC Export] No marker found, first-time write at byte ${endSecPos}`);
  } else {
    throw new Error('Invalid IFC file: Could not find ENDSEC; marker');
  }

  // =========================================================================
  // Step 3: Get Max Express ID
  // =========================================================================
  const maxId = findMaxExpressIdFromBytes(baseData);
  let nextId = maxId + 1;

  console.log(`[IFC Export] Max Express ID in base: #${maxId}, starting new IDs from #${nextId}`);

  // =========================================================================
  // Step 4: Generate New Content
  // =========================================================================
  const lines: string[] = [];

  // Start marker with newline
  lines.push('');
  lines.push(MARKER_START);

  // Timestamp comment
  const timestamp = new Date().toISOString();
  lines.push(`/* Generated: ${timestamp} */`);
  lines.push(`/* Properties count: ${allProperties.length} */`);
  if (lineageMetadata) {
    lines.push(METADATA_MARKER_START);
    lines.push(`/* ${JSON.stringify(lineageMetadata)} */`);
    lines.push(METADATA_MARKER_END);
  }
  lines.push('');

  // Group properties by element and pset for efficient generation
  const groupedProperties = groupPropertiesByElementAndPset(allProperties);

  // Generate IFC entities for each group
  for (const [elementId, psets] of groupedProperties) {
    for (const [psetName, properties] of psets) {
      const propertyIds: number[] = [];

      // Generate IFCPROPERTYSINGLEVALUE for each property
      for (const prop of properties) {
        const propId = nextId++;
        propertyIds.push(propId);

        const formattedValue = formatIfcValue(prop.value, prop.valueType);

        lines.push(
          `#${propId}=IFCPROPERTYSINGLEVALUE('${escapeIfcString(prop.propertyName)}',$,${formattedValue},$);`
        );
      }

      // Generate IFCPROPERTYSET
      const psetId = nextId++;
      const psetGuid = generateIfcGuid();
      const propertyRefs = propertyIds.map((id) => `#${id}`).join(',');

      lines.push(
        `#${psetId}=IFCPROPERTYSET('${psetGuid}',$,'${escapeIfcString(psetName)}',$,(${propertyRefs}));`
      );

      // Generate IFCRELDEFINESBYPROPERTIES
      const relId = nextId++;
      const relGuid = generateIfcGuid();

      // Parse element ID (remove # if present)
      const cleanElementId = elementId.startsWith('#')
        ? elementId
        : `#${elementId}`;

      lines.push(
        `#${relId}=IFCRELDEFINESBYPROPERTIES('${relGuid}',$,$,$,(${cleanElementId}),#${psetId});`
      );

      lines.push('');
    }
  }

  // Add point annotations if any
  if (annotations && annotations.length > 0) {
    lines.push('');
    lines.push(ANNOTATION_MARKER_START);
    lines.push(`/* ${JSON.stringify(annotations)} */`);
    lines.push(ANNOTATION_MARKER_END);
  }

  // End marker and file footer
  lines.push(MARKER_END);
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  lines.push('');

  const newContent = lines.join('\n');

  console.log(`[IFC Export] Generated ${lines.length} lines, next ID would be #${nextId}`);

  // =========================================================================
  // Step 5: Blob Assembly
  // =========================================================================
  const newContentBytes = new TextEncoder().encode(newContent);

  // Create ArrayBuffer copies to avoid SharedArrayBuffer issues
  const baseBuffer = new ArrayBuffer(baseData.byteLength);
  new Uint8Array(baseBuffer).set(baseData);

  const contentBuffer = new ArrayBuffer(newContentBytes.byteLength);
  new Uint8Array(contentBuffer).set(newContentBytes);

  // Create blob from two ArrayBuffer parts
  const blob = new Blob(
    [baseBuffer, contentBuffer],
    { type: 'application/x-step' }
  );

  console.log(`[IFC Export] Created blob: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

  return blob;
}

/**
 * Group properties by element ID and property set name
 */
function groupPropertiesByElementAndPset(
  properties: PendingPropertyWrite[]
): Map<string, Map<string, PendingPropertyWrite[]>> {
  const grouped = new Map<string, Map<string, PendingPropertyWrite[]>>();

  for (const prop of properties) {
    if (!grouped.has(prop.elementId)) {
      grouped.set(prop.elementId, new Map());
    }

    const elementMap = grouped.get(prop.elementId)!;

    if (!elementMap.has(prop.psetName)) {
      elementMap.set(prop.psetName, []);
    }

    elementMap.get(prop.psetName)!.push(prop);
  }

  return grouped;
}

// ============================================================================
// Utility Functions for Reading Custom Data
// ============================================================================

/**
 * Extract existing custom properties from IFC data (if any)
 * Useful for loading previously saved custom data
 */
export function extractCustomDataSection(data: Uint8Array): string | null {
  const startIndex = findMarkerIndex(data, MARKER_START);

  if (startIndex === -1) {
    return null;
  }

  const endIndex = findMarkerIndex(data, MARKER_END);

  if (endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  // Extract the section between markers
  const sectionBytes = data.slice(
    startIndex + MARKER_START.length,
    endIndex
  );

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
  } catch (error) {
    console.error('[IFC Parser] Failed to parse lineage metadata:', error);
  }

  return null;
}

/**
 * Check if IFC data has custom properties section
 */
export function hasCustomDataSection(data: Uint8Array): boolean {
  return findMarkerIndex(data, MARKER_START) !== -1;
}

// ============================================================================
// Parse Custom Properties from IFC Data
// ============================================================================

/**
 * Parsed custom property from IFC file
 */
export interface ParsedCustomProperty {
  elementId: string;
  psetName: string;
  propertyName: string;
  value: string | number | boolean;
  valueType: PendingPropertyWrite['valueType'];
}

/**
 * Parse IFC value from string (e.g., "IFCTEXT('hello')" -> { value: 'hello', type: 'STRING' })
 */
function parseIfcValue(valueStr: string): { value: string | number | boolean; type: PendingPropertyWrite['valueType'] } | null {
  valueStr = valueStr.trim();

  // IFCTEXT('...')
  const textMatch = valueStr.match(/^IFCTEXT\('(.*)'\)$/i);
  if (textMatch) {
    return { value: unescapeIfcString(textMatch[1] || ''), type: 'STRING' };
  }

  // IFCLABEL('...')
  const labelMatch = valueStr.match(/^IFCLABEL\('(.*)'\)$/i);
  if (labelMatch) {
    return { value: unescapeIfcString(labelMatch[1] || ''), type: 'LABEL' };
  }

  // IFCREAL(...)
  const realMatch = valueStr.match(/^IFCREAL\(([-\d.eE+]+)\)$/i);
  if (realMatch) {
    return { value: parseFloat(realMatch[1] || '0'), type: 'REAL' };
  }

  // IFCINTEGER(...)
  const intMatch = valueStr.match(/^IFCINTEGER\(([-\d]+)\)$/i);
  if (intMatch) {
    return { value: parseInt(intMatch[1] || '0', 10), type: 'INTEGER' };
  }

  // IFCBOOLEAN(.T.) or IFCBOOLEAN(.F.)
  const boolMatch = valueStr.match(/^IFCBOOLEAN\(\.([TF])\.\)$/i);
  if (boolMatch) {
    return { value: boolMatch[1]?.toUpperCase() === 'T', type: 'BOOLEAN' };
  }

  return null;
}

/**
 * Unescape IFC string value
 */
function unescapeIfcString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/''/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

/**
 * Parse custom properties from the custom data section of an IFC file
 * Returns an array of parsed properties that can be used to populate pendingProperties
 */
export function parseCustomProperties(data: Uint8Array): ParsedCustomProperty[] {
  const customSection = extractCustomDataSection(data);

  if (!customSection) {
    return [];
  }

  const properties: ParsedCustomProperty[] = [];

  // Parse the IFC entities from the custom section
  // We need to find: IFCPROPERTYSINGLEVALUE, IFCPROPERTYSET, IFCRELDEFINESBYPROPERTIES

  // Storage for parsed entities
  const singleValues: Map<number, { name: string; value: string | number | boolean; type: PendingPropertyWrite['valueType'] }> = new Map();
  const propertySets: Map<number, { name: string; propertyIds: number[] }> = new Map();
  const relations: Array<{ psetId: number; elementIds: number[] }> = [];

  // Split into lines and parse
  const lines = customSection.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip comments and empty lines
    if (!trimmedLine || trimmedLine.startsWith('/*') || trimmedLine.startsWith('//')) {
      continue;
    }

    // Parse IFCPROPERTYSINGLEVALUE: #123=IFCPROPERTYSINGLEVALUE('Name',$,IFCTEXT('Value'),$);
    const singleValueMatch = trimmedLine.match(/^#(\d+)=IFCPROPERTYSINGLEVALUE\('([^']*)',[^,]*,([^,]+),[^)]*\);$/i);
    if (singleValueMatch) {
      const id = parseInt(singleValueMatch[1] || '0', 10);
      const name = unescapeIfcString(singleValueMatch[2] || '');
      const valueStr = singleValueMatch[3] || '';
      const parsed = parseIfcValue(valueStr);

      if (parsed) {
        singleValues.set(id, { name, value: parsed.value, type: parsed.type });
      }
      continue;
    }

    // Parse IFCPROPERTYSET: #456=IFCPROPERTYSET('guid',$,'PsetName',$,(#123,#124));
    const psetMatch = trimmedLine.match(/^#(\d+)=IFCPROPERTYSET\('[^']*',[^,]*,'([^']*)',[^,]*,\(([^)]+)\)\);$/i);
    if (psetMatch) {
      const id = parseInt(psetMatch[1] || '0', 10);
      const name = unescapeIfcString(psetMatch[2] || '');
      const propRefsStr = psetMatch[3] || '';
      const propertyIds = propRefsStr.split(',')
        .map(ref => parseInt(ref.trim().replace('#', ''), 10))
        .filter(n => !isNaN(n));

      propertySets.set(id, { name, propertyIds });
      continue;
    }

    // Parse IFCRELDEFINESBYPROPERTIES: #789=IFCRELDEFINESBYPROPERTIES('guid',$,$,$,(#100,#101),#456);
    const relMatch = trimmedLine.match(/^#(\d+)=IFCRELDEFINESBYPROPERTIES\('[^']*',[^,]*,[^,]*,[^,]*,\(([^)]+)\),#(\d+)\);$/i);
    if (relMatch) {
      const elementRefsStr = relMatch[2] || '';
      const psetId = parseInt(relMatch[3] || '0', 10);
      const elementIds = elementRefsStr.split(',')
        .map(ref => parseInt(ref.trim().replace('#', ''), 10))
        .filter(n => !isNaN(n));

      relations.push({ psetId, elementIds });
      continue;
    }
  }

  // Build the properties list by traversing the relations
  for (const rel of relations) {
    const pset = propertySets.get(rel.psetId);
    if (!pset) continue;

    for (const elementId of rel.elementIds) {
      for (const propId of pset.propertyIds) {
        const prop = singleValues.get(propId);
        if (!prop) continue;

        properties.push({
          elementId: `#${elementId}`,
          psetName: pset.name,
          propertyName: prop.name,
          value: prop.value,
          valueType: prop.type
        });
      }
    }
  }

  console.log(`[IFC Parser] Parsed ${properties.length} custom properties from file`);

  return properties;
}

// ============================================================================
// Download Helper
// ============================================================================

/**
 * Trigger download of the IFC blob
 */
export function downloadIfcBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ifc') ? filename : `${filename}.ifc`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Full export workflow: create blob and download
 */
export async function exportIfcWithCustomProperties(
  originalData: Uint8Array,
  allProperties: PendingPropertyWrite[],
  filename: string
): Promise<void> {
  const blob = await createUpdatedIfcBlob(originalData, allProperties);
  downloadIfcBlob(blob, filename);
}

// ============================================================================
// Annotation Point Support
// ============================================================================

/**
 * Annotation point data stored in the IFC custom section
 */
export interface AnnotationPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
}

/**
 * Parse annotation points from the IFC custom data section
 */
export function parseAnnotationsFromCustomSection(data: Uint8Array): AnnotationPoint[] {
  const section = extractCustomDataSection(data);
  if (!section) return [];

  const startIdx = section.indexOf(ANNOTATION_MARKER_START);
  const endIdx = section.indexOf(ANNOTATION_MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];

  const content = section
    .slice(startIdx + ANNOTATION_MARKER_START.length, endIdx)
    .trim();

  // Remove /* and */ comment wrappers
  const jsonStr = content.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      console.log(`[IFC Parser] Parsed ${parsed.length} annotation points from file`);
      return parsed as AnnotationPoint[];
    }
    return [];
  } catch (e) {
    console.error('[IFC Parser] Failed to parse annotations:', e);
    return [];
  }
}
