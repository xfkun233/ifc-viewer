import proj4 from 'proj4'
import type { GeoCoordinate, Vector2Like } from '@/types/geoPlacement'

const WGS84 = 'EPSG:4326'
const WEB_MERCATOR = 'EPSG:3857'

export const projectGeoToMeters = (geo: GeoCoordinate): Vector2Like => {
  const [x, y] = proj4(WGS84, WEB_MERCATOR, [geo.lon, geo.lat]) as [number, number]
  return { x, y }
}

export const unprojectMetersToGeo = (meters: Vector2Like): GeoCoordinate => {
  const [lon, lat] = proj4(WEB_MERCATOR, WGS84, [meters.x, meters.y]) as [number, number]
  return { lat, lon }
}

export const applyMetersOffsetOnGeo = (
  baseGeo: GeoCoordinate,
  offsetEastMeters: number,
  offsetNorthMeters: number,
): GeoCoordinate => {
  const base = projectGeoToMeters(baseGeo)
  return unprojectMetersToGeo({
    x: base.x + offsetEastMeters,
    y: base.y + offsetNorthMeters,
  })
}

export const isGeoCoordinateValid = (geo: GeoCoordinate): boolean => {
  return Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && geo.lat >= -90 && geo.lat <= 90 && geo.lon >= -180 && geo.lon <= 180
}
