/**
 * ZoomController - Manages smooth animated zoom transitions
 */

import { easeOutCubic, lerp } from '@/game/utils/easing'
import type { Viewport } from '@/types/game'

interface ZoomAnimationState {
  isAnimating: boolean
  startTime: number
  duration: number
  startZoom: number
  targetZoom: number
  startX: number
  startY: number
  targetX: number
  targetY: number
}

interface ZoomConfig {
  minZoom: number
  maxZoom: number
  animationDuration: number
  zoomInFactor: number
  zoomOutFactor: number
}

const DEFAULT_CONFIG: ZoomConfig = {
  minZoom: 0.00005,
  maxZoom: 3.0,
  animationDuration: 150,
  zoomInFactor: 1.15,
  zoomOutFactor: 0.85,
}

export class ZoomController {
  private config: ZoomConfig
  private animation: ZoomAnimationState

  constructor(config: Partial<ZoomConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.animation = {
      isAnimating: false,
      startTime: 0,
      duration: this.config.animationDuration,
      startZoom: 1,
      targetZoom: 1,
      startX: 0,
      startY: 0,
      targetX: 0,
      targetY: 0,
    }
  }

  /**
   * Handle wheel event to initiate or update zoom animation
   * Returns true if the event was handled and systems should be invalidated
   */
  handleWheel(event: WheelEvent, viewport: Viewport, canvasRect: DOMRect): boolean {
    const mouseX = event.clientX - canvasRect.left
    const mouseY = event.clientY - canvasRect.top

    // Calculate world position under mouse
    const worldX = (mouseX - viewport.width / 2) / viewport.zoom + viewport.x
    const worldY = -(mouseY - viewport.height / 2) / viewport.zoom + viewport.y

    // Determine zoom direction
    const zoomDirection = event.deltaY > 0 ? -1 : 1

    // Calculate target zoom from current target (for smooth accumulation)
    const baseZoom = this.animation.isAnimating ? this.animation.targetZoom : viewport.zoom

    const factor = zoomDirection > 0 ? this.config.zoomInFactor : this.config.zoomOutFactor
    const newTargetZoom = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, baseZoom * factor)
    )

    // Calculate new viewport position to keep mouse point stationary
    const newTargetX = worldX - (mouseX - viewport.width / 2) / newTargetZoom
    const newTargetY = worldY + (mouseY - viewport.height / 2) / newTargetZoom

    // Start or update animation
    const now = performance.now()

    if (!this.animation.isAnimating) {
      // Start new animation from current position
      this.animation = {
        isAnimating: true,
        startTime: now,
        duration: this.config.animationDuration,
        startZoom: viewport.zoom,
        targetZoom: newTargetZoom,
        startX: viewport.x,
        startY: viewport.y,
        targetX: newTargetX,
        targetY: newTargetY,
      }
    } else {
      // Update target while preserving animation progress
      // Reset animation with current interpolated values as new start
      const elapsed = now - this.animation.startTime
      const rawT = Math.min(1, elapsed / this.animation.duration)
      const easedT = easeOutCubic(rawT)

      this.animation = {
        isAnimating: true,
        startTime: now,
        duration: this.config.animationDuration,
        startZoom: lerp(this.animation.startZoom, this.animation.targetZoom, easedT),
        targetZoom: newTargetZoom,
        startX: lerp(this.animation.startX, this.animation.targetX, easedT),
        startY: lerp(this.animation.startY, this.animation.targetY, easedT),
        targetX: newTargetX,
        targetY: newTargetY,
      }
    }

    return true
  }

  /**
   * Update zoom animation each frame
   * Returns true if viewport was modified and systems should be invalidated
   */
  update(viewport: Viewport): boolean {
    if (!this.animation.isAnimating) {
      return false
    }

    const now = performance.now()
    const elapsed = now - this.animation.startTime
    const rawT = Math.min(1, elapsed / this.animation.duration)
    const easedT = easeOutCubic(rawT)

    // Interpolate zoom and position
    viewport.zoom = lerp(this.animation.startZoom, this.animation.targetZoom, easedT)
    viewport.x = lerp(this.animation.startX, this.animation.targetX, easedT)
    viewport.y = lerp(this.animation.startY, this.animation.targetY, easedT)

    // Check if animation is complete
    if (rawT >= 1) {
      this.animation.isAnimating = false
    }

    return true
  }

  /**
   * Check if currently animating
   */
  isAnimating(): boolean {
    return this.animation.isAnimating
  }

  /**
   * Get the target zoom level (useful for UI display)
   */
  getTargetZoom(): number {
    return this.animation.isAnimating ? this.animation.targetZoom : this.animation.startZoom
  }
}
