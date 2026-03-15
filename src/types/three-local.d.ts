declare module '@/three/controls/OrbitControls' {
  import { Camera } from 'three'

  export class OrbitControls extends EventTarget {
    constructor(object: Camera, domElement?: HTMLElement)
    target: { copy(v: { x: number; y: number; z: number }): void }
    enableDamping: boolean
    dampingFactor: number
    dispose(): void
    update(): void
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  }
}

declare module '@/three/loaders/FBXLoader' {
  import { Group } from 'three'

  export class FBXLoader {
    load(
      url: string,
      onLoad: (object: Group) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (event: unknown) => void
    ): void
  }
}
