import type { ComponentCustomProperties } from 'vue'

declare module 'vue' {
  interface ComponentCustomProperties {
    $legacyT: (value: string) => string
  }
}

