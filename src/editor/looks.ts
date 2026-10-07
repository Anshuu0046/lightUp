/** Colour grading and effects for a clip. Every number is 0 at "unchanged"; most run -1..1. */
export type Grade = {
  brightness: number; contrast: number; saturation: number
  warmth: number; tint: number
  fade: number; vignette: number; grain: number; blur: number
  mono: boolean
}
export type Fx = {
  /** slow push-in over the clip (Ken Burns) */
  zoom: number
  shake: number
  glow: number
  glitch: number
  /** cinematic letterbox */
  bars: boolean
  /** white flash as the clip starts */
  flash: boolean
  fadeIn: number
  fadeOut: number
}

export const NO_GRADE: Grade = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, fade: 0, vignette: 0, grain: 0, blur: 0, mono: false }
export const NO_FX: Fx = { zoom: 0, shake: 0, glow: 0, glitch: 0, bars: false, flash: false, fadeIn: 0, fadeOut: 0 }

export type Preset = { id: string; name: string; grade: Partial<Grade>; fx?: Partial<Fx> }
export const PRESETS: Preset[] = [
  { id: 'none', name: 'Original', grade: {} },
  { id: 'cinematic', name: 'Cinematic', grade: { contrast: 0.22, saturation: -0.12, warmth: 0.22, tint: -0.08, vignette: 0.35, fade: 0.06 }, fx: { bars: true } },
  { id: 'golden', name: 'Golden hour', grade: { brightness: 0.05, contrast: 0.1, saturation: 0.18, warmth: 0.55, vignette: 0.2 } },
  { id: 'vivid', name: 'Vivid', grade: { contrast: 0.18, saturation: 0.45, brightness: 0.03 } },
  { id: 'moody', name: 'Moody', grade: { brightness: -0.12, contrast: 0.25, saturation: -0.3, warmth: -0.2, vignette: 0.55 } },
  { id: 'vintage', name: 'Vintage', grade: { contrast: -0.08, saturation: -0.25, warmth: 0.35, fade: 0.28, grain: 0.45, vignette: 0.3 } },
  { id: 'cool', name: 'Cool', grade: { contrast: 0.08, saturation: 0.05, warmth: -0.45, tint: 0.05 } },
  { id: 'fade', name: 'Soft fade', grade: { contrast: -0.15, saturation: -0.1, fade: 0.35, brightness: 0.05 } },
  { id: 'bw', name: 'Black & white', grade: { mono: true, contrast: 0.2 } },
  { id: 'noir', name: 'Noir', grade: { mono: true, contrast: 0.5, brightness: -0.08, vignette: 0.7, grain: 0.35 } },
  { id: 'dream', name: 'Dreamy', grade: { brightness: 0.08, contrast: -0.1, saturation: 0.1, fade: 0.15, warmth: 0.15 }, fx: { glow: 0.5 } },
  { id: 'teal', name: 'Teal & orange', grade: { contrast: 0.25, saturation: 0.15, warmth: 0.3, tint: -0.2, vignette: 0.25 } },
]

/** A cheap CSS-filter stand-in for a grade, used to show presets on thumbnails */
export function thumbFilter(g: Partial<Grade>) {
  const x = { ...NO_GRADE, ...g }
  return `brightness(${1 + x.brightness * 0.6}) contrast(${1 + x.contrast * 0.7}) saturate(${x.mono ? 0 : 1 + x.saturation}) sepia(${Math.max(0, x.warmth) * 0.4 + x.fade * 0.3}) hue-rotate(${x.warmth < 0 ? x.warmth * 25 : 0}deg)`
}
