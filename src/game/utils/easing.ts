/**
 * Easing utilities for smooth animations
 */

/**
 * Ease out cubic - smooth deceleration curve
 * Starts fast, slows down at the end
 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * Linear interpolation between two values
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}
