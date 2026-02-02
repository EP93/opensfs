/**
 * Train type data loading utilities.
 * Actual train definitions are loaded from public/data/trains/rolling-stock.json
 */

import type { TrainTypeSpec } from '@/types/train'

/** Rolling stock data file structure */
export interface RollingStockData {
  version: string
  trainTypes: TrainTypeSpec[]
}

/** Path to rolling stock data file */
export const ROLLING_STOCK_PATH = '/data/trains/rolling-stock.json'

/** Cache for loaded train types */
let cachedTrainTypes: TrainTypeSpec[] | null = null

/**
 * Load train types from JSON file
 */
export async function loadTrainTypes(): Promise<TrainTypeSpec[]> {
  if (cachedTrainTypes) {
    return cachedTrainTypes
  }

  const response = await fetch(ROLLING_STOCK_PATH)
  if (!response.ok) {
    throw new Error(`Failed to load rolling stock data: ${response.statusText}`)
  }

  const data = (await response.json()) as RollingStockData
  cachedTrainTypes = data.trainTypes
  return cachedTrainTypes
}

/**
 * Get cached train types (returns empty array if not loaded)
 */
export function getCachedTrainTypes(): TrainTypeSpec[] {
  return cachedTrainTypes ?? []
}

/**
 * Clear cached train types
 */
export function clearTrainTypeCache(): void {
  cachedTrainTypes = null
}

/**
 * Convert hex color string to number
 */
export function hexColorToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}
