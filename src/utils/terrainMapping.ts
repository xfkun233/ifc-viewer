import { Matrix3, Vector3 } from 'three'
import type { GeoCoordinate, TerrainCornerGeo, TerrainCornerLocal } from '@/types/geoPlacement'
import { projectGeoToMeters, unprojectMetersToGeo } from '@/utils/geoTransform'

const toHomogeneous = (x: number, y: number) => new Vector3(x, y, 1)

const buildMatrixFromPoints = (a: Vector3, b: Vector3, c: Vector3) => {
  return new Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z)
}

const getCorner = <T extends { id: 'nw' | 'ne' | 'se' | 'sw' }>(corners: T[], id: T['id']): T => {
  const found = corners.find((corner) => corner.id === id)
  if (!found) {
    throw new Error(`角点 ${id} 缺失，无法建立映射。`)
  }
  return found
}

export interface TerrainGeoMapping {
  toLocalXZ: (geo: GeoCoordinate) => { x: number; z: number }
  toGeo: (localX: number, localZ: number) => GeoCoordinate
}

export const createTerrainAffineMapping = (
  geoCorners: TerrainCornerGeo[],
  localCorners: TerrainCornerLocal[],
): TerrainGeoMapping => {
  const nwGeo = getCorner(geoCorners, 'nw')
  const neGeo = getCorner(geoCorners, 'ne')
  const swGeo = getCorner(geoCorners, 'sw')

  const nwLocal = getCorner(localCorners, 'nw')
  const neLocal = getCorner(localCorners, 'ne')
  const swLocal = getCorner(localCorners, 'sw')

  const a = projectGeoToMeters({ lat: nwGeo.lat, lon: nwGeo.lon })
  const b = projectGeoToMeters({ lat: neGeo.lat, lon: neGeo.lon })
  const c = projectGeoToMeters({ lat: swGeo.lat, lon: swGeo.lon })

  const geoMatrix = buildMatrixFromPoints(
    toHomogeneous(a.x, a.y),
    toHomogeneous(b.x, b.y),
    toHomogeneous(c.x, c.y),
  )

  const localMatrix = buildMatrixFromPoints(
    toHomogeneous(nwLocal.x, nwLocal.z),
    toHomogeneous(neLocal.x, neLocal.z),
    toHomogeneous(swLocal.x, swLocal.z),
  )

  const geoInverse = geoMatrix.clone().invert()
  if (!Number.isFinite(geoInverse.elements[0])) {
    throw new Error('地理角点不可逆，请检查角点顺序与输入是否共线。')
  }

  const localInverse = localMatrix.clone().invert()
  if (!Number.isFinite(localInverse.elements[0])) {
    throw new Error('地形局部角点不可逆，无法建立逆向映射。')
  }

  const geoToLocal = localMatrix.clone().multiply(geoInverse)
  const localToGeo = geoMatrix.clone().multiply(localInverse)

  return {
    toLocalXZ: (geo: GeoCoordinate) => {
      const meters = projectGeoToMeters(geo)
      const value = toHomogeneous(meters.x, meters.y).applyMatrix3(geoToLocal)
      return { x: value.x, z: value.y }
    },
    toGeo: (localX: number, localZ: number) => {
      const value = toHomogeneous(localX, localZ).applyMatrix3(localToGeo)
      return unprojectMetersToGeo({ x: value.x, y: value.y })
    },
  }
}
