import { Euler, Matrix4, Vector3 } from 'three'
import type { LocalPoint, RotationAngles } from '@/types/geoPlacement'

const degreeToRad = (degree: number) => (degree * Math.PI) / 180

const normalizeAngle = (degree: number) => {
  if (!Number.isFinite(degree)) return 0
  let value = degree % 360
  if (value > 180) value -= 360
  if (value < -180) value += 360
  return value
}

export const normalizeRotationAngles = (angles: RotationAngles): RotationAngles => ({
  heading: normalizeAngle(angles.heading),
  pitch: normalizeAngle(angles.pitch),
  roll: normalizeAngle(angles.roll),
})

export const toThreeEuler = (angles: RotationAngles): Euler => {
  const normalized = normalizeRotationAngles(angles)
  return new Euler(
    degreeToRad(normalized.pitch),
    degreeToRad(normalized.heading),
    degreeToRad(normalized.roll),
    'YXZ',
  )
}

export const buildRotationMatrix = (angles: RotationAngles): Matrix4 => {
  const euler = toThreeEuler(angles)
  return new Matrix4().makeRotationFromEuler(euler)
}

export const rotateLocalDelta = (delta: LocalPoint, angles: RotationAngles): LocalPoint => {
  const matrix = buildRotationMatrix(angles)
  const vector = new Vector3(delta.x, delta.y, delta.z).applyMatrix4(matrix)
  return { x: vector.x, y: vector.y, z: vector.z }
}
