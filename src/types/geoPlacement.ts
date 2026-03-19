export interface GeoCoordinate {
  lat: number
  lon: number
}

export interface RotationAngles {
  heading: number
  pitch: number
  roll: number
}

export interface LocalPoint {
  x: number
  y: number
  z: number
}

export interface PlacementPoint {
  id: string
  local: [number, number, number]
  geo: [number, number]
}

export interface PlacementUnitInfo {
  meter_per_unit: number
  unit_scale_factor?: number
  source?: 'manual' | 'fbx-metadata' | 'default'
}

export interface PlacementExportJson {
  model_name: string
  rotation: RotationAngles
  points: PlacementPoint[]
  unit?: PlacementUnitInfo
}

export interface TerrainCornerGeo {
  id: 'nw' | 'ne' | 'se' | 'sw'
  lat: number
  lon: number
}

export interface TerrainCornerLocal {
  id: 'nw' | 'ne' | 'se' | 'sw'
  x: number
  z: number
}

export interface Vector2Like {
  x: number
  y: number
}
