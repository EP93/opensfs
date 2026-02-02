/**
 * Train Type Registry - Central registry for rolling stock specifications.
 * Loads train types from JSON configuration files.
 */

import type { TrainCarSpec, TrainConsist, TrainTypeId, TrainTypeSpec } from '@/types/train'
import { loadTrainTypes } from '../data/trainTypes'

export class TrainTypeRegistry {
  private types: Map<TrainTypeId, TrainTypeSpec> = new Map()
  private loaded = false

  /**
   * Load train types from JSON data file
   */
  async load(): Promise<void> {
    if (this.loaded) return

    const trainTypes = await loadTrainTypes()
    for (const type of trainTypes) {
      this.types.set(type.id, normalizeTrainTypeSpec(type))
    }
    this.loaded = true
  }

  /**
   * Check if registry is loaded
   */
  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * Get a train type by ID
   */
  get(id: TrainTypeId): TrainTypeSpec | undefined {
    return this.types.get(id)
  }

  /**
   * Get a train type by ID, throwing if not found
   */
  getOrThrow(id: TrainTypeId): TrainTypeSpec {
    const type = this.types.get(id)
    if (!type) {
      throw new Error(`Unknown train type: ${id}`)
    }
    return type
  }

  /**
   * Check if a train type exists
   */
  has(id: TrainTypeId): boolean {
    return this.types.has(id)
  }

  /**
   * Get all registered train types
   */
  getAll(): TrainTypeSpec[] {
    return Array.from(this.types.values())
  }

  /**
   * Get train types for a specific service category
   */
  getByCategory(category: string): TrainTypeSpec[] {
    return this.getAll().filter((t) =>
      t.serviceCategories.includes(category as TrainTypeSpec['serviceCategories'][number])
    )
  }

  /**
   * Get train types by country
   */
  getByCountry(country: string): TrainTypeSpec[] {
    return this.getAll().filter((t) => t.country === country)
  }

  /**
   * Get train types by operator
   */
  getByOperator(operator: string): TrainTypeSpec[] {
    return this.getAll().filter((t) => t.operator === operator)
  }

  /**
   * Create a train consist from a type ID and unit count
   */
  createConsist(typeId: TrainTypeId, units = 1): TrainConsist {
    const typeSpec = this.getOrThrow(typeId)
    const clampedUnits = Math.max(1, Math.min(units, typeSpec.coupling.maxCoupledUnits))
    const perUnitCars = typeSpec.cars ?? []
    const cars = buildConsistCars(perUnitCars, clampedUnits)

    return {
      typeSpec,
      units: clampedUnits,
      cars,
      totalLength: cars.reduce((sum, car) => sum + car.lengthMeters, 0),
      totalSeatedCapacity: cars.reduce(
        (sum, car) => sum + car.capacity.seatedFirstClass + car.capacity.seatedSecondClass,
        0
      ),
      totalStandingCapacity: cars.reduce((sum, car) => sum + car.capacity.standing, 0),
      totalFirstClassSeats: cars.reduce((sum, car) => sum + car.capacity.seatedFirstClass, 0),
      totalWheelchairSpaces: cars.reduce((sum, car) => sum + car.capacity.wheelchairSpaces, 0),
      totalBicycleSpaces: cars.reduce((sum, car) => sum + car.capacity.bicycleSpaces, 0),
    }
  }

  /**
   * Calculate stopping distance for a train at given speed
   * Uses kinematic equation: s = v² / (2 × a)
   * @param typeId Train type ID
   * @param speedKmh Current speed in km/h
   * @param emergency Whether to use emergency braking
   * @returns Stopping distance in meters
   */
  calculateStoppingDistance(typeId: TrainTypeId, speedKmh: number, emergency = false): number {
    const typeSpec = this.getOrThrow(typeId)
    const speedMs = speedKmh / 3.6 // Convert km/h to m/s
    const deceleration = emergency
      ? typeSpec.performance.emergencyDeceleration
      : typeSpec.performance.deceleration
    return (speedMs * speedMs) / (2 * deceleration)
  }

  /**
   * Calculate time to reach target speed from current speed
   * @param typeId Train type ID
   * @param fromSpeedKmh Starting speed in km/h
   * @param toSpeedKmh Target speed in km/h
   * @returns Time in seconds
   */
  calculateAccelerationTime(typeId: TrainTypeId, fromSpeedKmh: number, toSpeedKmh: number): number {
    const typeSpec = this.getOrThrow(typeId)
    const fromMs = fromSpeedKmh / 3.6
    const toMs = toSpeedKmh / 3.6

    if (toMs > fromMs) {
      // Accelerating
      return (toMs - fromMs) / typeSpec.performance.acceleration
    } else {
      // Decelerating
      return (fromMs - toMs) / typeSpec.performance.deceleration
    }
  }

  /**
   * Calculate distance covered during acceleration/deceleration
   * @param typeId Train type ID
   * @param fromSpeedKmh Starting speed in km/h
   * @param toSpeedKmh Target speed in km/h
   * @returns Distance in meters
   */
  calculateAccelerationDistance(
    typeId: TrainTypeId,
    fromSpeedKmh: number,
    toSpeedKmh: number
  ): number {
    const typeSpec = this.getOrThrow(typeId)
    const fromMs = fromSpeedKmh / 3.6
    const toMs = toSpeedKmh / 3.6
    const rate =
      toMs > fromMs ? typeSpec.performance.acceleration : typeSpec.performance.deceleration

    // Using kinematic equation: v² = u² + 2as → s = (v² - u²) / (2a)
    return Math.abs((toMs * toMs - fromMs * fromMs) / (2 * rate))
  }

  /**
   * Calculate braking curve start distance
   * Returns the distance from station where braking should begin
   * @param typeId Train type ID
   * @param currentSpeedKmh Current speed in km/h
   * @param safetyMargin Extra margin in meters (default 500m)
   */
  calculateBrakingStartDistance(
    typeId: TrainTypeId,
    currentSpeedKmh: number,
    safetyMargin = 500
  ): number {
    return this.calculateStoppingDistance(typeId, currentSpeedKmh, false) + safetyMargin
  }

  /**
   * Get effective max speed for a track segment
   * @param typeId Train type ID
   * @param trackMaxSpeed Track's speed limit in km/h
   * @returns Effective max speed (minimum of train and track)
   */
  getEffectiveMaxSpeed(typeId: TrainTypeId, trackMaxSpeed: number): number {
    const typeSpec = this.getOrThrow(typeId)
    return Math.min(typeSpec.performance.maxOperationalSpeed, trackMaxSpeed)
  }

  /**
   * Register a custom train type (for runtime additions)
   */
  register(type: TrainTypeSpec): void {
    this.types.set(type.id, normalizeTrainTypeSpec(type))
  }

  /**
   * Get total type count
   */
  get count(): number {
    return this.types.size
  }
}

/** Default singleton instance */
export const trainTypeRegistry = new TrainTypeRegistry()

function normalizeTrainTypeSpec(type: TrainTypeSpec): TrainTypeSpec {
  if (type.cars && type.cars.length > 0) return type

  const totalLength = type.specifications.length
  const carsPerUnit = clamp(Math.round(totalLength / 26), 2, 12)
  const carLength = roundTo(totalLength / carsPerUnit, 0.1)
  const firstClassCars =
    type.capacity.seatedFirstClass > 0 ? Math.max(1, Math.round(carsPerUnit * 0.2)) : 0

  const carIds = buildCarIds(carsPerUnit)

  const secondClassCars = Math.max(0, carsPerUnit - firstClassCars)
  const firstClassAlloc =
    firstClassCars > 0
      ? distribute(type.capacity.seatedFirstClass, new Array(firstClassCars).fill(1))
      : []
  const secondClassAlloc =
    secondClassCars > 0
      ? distribute(type.capacity.seatedSecondClass, new Array(secondClassCars).fill(1))
      : []

  const carSeatCap: number[] = []
  for (let i = 0; i < carsPerUnit; i++) {
    if (i < firstClassCars) {
      carSeatCap.push(firstClassAlloc[i] ?? 0)
    } else {
      carSeatCap.push(secondClassAlloc[i - firstClassCars] ?? 0)
    }
  }

  const seatWeights = carSeatCap.map((v) => (v > 0 ? v : 1))
  const standingAlloc = distribute(type.capacity.standing, seatWeights)
  const wheelchairAlloc = distribute(type.capacity.wheelchairSpaces, seatWeights)
  const bicycleAlloc = distribute(type.capacity.bicycleSpaces, seatWeights)

  const cars: TrainCarSpec[] = []
  for (let i = 0; i < carsPerUnit; i++) {
    const isFirst = i < firstClassCars
    const seatedFirstClass = isFirst ? (firstClassAlloc[i] ?? 0) : 0
    const secondIndex = i - firstClassCars
    const seatedSecondClass = !isFirst ? (secondClassAlloc[secondIndex] ?? 0) : 0

    cars.push({
      id: carIds[i] ?? String(i + 1),
      class: isFirst ? 'first' : 'second',
      kind: 'standard',
      lengthMeters: carLength,
      capacity: {
        seatedFirstClass,
        seatedSecondClass,
        standing: standingAlloc[i] ?? 0,
        wheelchairSpaces: wheelchairAlloc[i] ?? 0,
        bicycleSpaces: bicycleAlloc[i] ?? 0,
      },
    })
  }

  return { ...type, cars }
}

function buildConsistCars(perUnitCars: TrainCarSpec[], units: number): TrainConsist['cars'] {
  const cars: TrainConsist['cars'] = []
  let offset = 0
  let number = 1

  for (let unitIndex = 0; unitIndex < units; unitIndex++) {
    for (const spec of perUnitCars) {
      const lengthMeters = spec.lengthMeters
      const centerOffset = offset + lengthMeters / 2
      cars.push({
        number,
        id: spec.id,
        class: spec.class,
        kind: spec.kind,
        lengthMeters,
        offsetFromFrontMeters: centerOffset,
        capacity: { ...spec.capacity },
        occupancy: {
          seatedFirstClass: 0,
          seatedSecondClass: 0,
          standing: 0,
          total: 0,
          loadRatio: 0,
        },
      })
      number += 1
      offset += lengthMeters
    }
  }

  return cars
}

function buildCarIds(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(String.fromCharCode(65 + (i % 26)))
  }
  return out
}

function distribute(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    const base = Math.floor(total / weights.length)
    const out = weights.map(() => base)
    let remaining = total - base * weights.length
    for (let i = 0; i < weights.length && remaining > 0; i++) {
      out[i] = (out[i] ?? 0) + 1
      remaining -= 1
    }
    return out
  }

  const raw = weights.map((w) => (w / sum) * total)
  const base = raw.map((v) => Math.floor(v))
  let remaining = total - base.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => ({ i, frac: v - (base[i] ?? 0) })).sort((a, b) => b.frac - a.frac)
  let idx = 0
  while (remaining > 0) {
    const entry = order[idx % order.length]
    if (!entry) break
    base[entry.i] = (base[entry.i] ?? 0) + 1
    remaining -= 1
    idx += 1
  }
  return base
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}
