/** GeoJSON Types for Railway Data */

export interface GeoJSONPoint {
  type: 'Point'
  coordinates: [number, number]
}

export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface GeoJSONMultiLineString {
  type: 'MultiLineString'
  coordinates: [number, number][][]
}

export interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export type GeoJSONGeometry =
  | GeoJSONPoint
  | GeoJSONLineString
  | GeoJSONMultiLineString
  | GeoJSONPolygon

export interface GeoJSONFeature<
  G extends GeoJSONGeometry = GeoJSONGeometry,
  P = GeoJSONProperties,
> {
  type: 'Feature'
  id?: string | number
  geometry: G
  properties: P
}

export interface GeoJSONFeatureCollection<
  G extends GeoJSONGeometry = GeoJSONGeometry,
  P = GeoJSONProperties,
> {
  type: 'FeatureCollection'
  features: GeoJSONFeature<G, P>[]
}

/** Common OSM properties for railway features */
export interface GeoJSONProperties {
  [key: string]: unknown
}

/** Railway-specific OSM properties */
export interface RailwayProperties extends GeoJSONProperties {
  '@id'?: string
  railway?: string
  name?: string
  ref?: string
  maxspeed?: string
  electrified?: string
  gauge?: string
  usage?: string
  service?: string
  operator?: string
  voltage?: string
  frequency?: string
}

/** Station-specific OSM properties */
export interface StationProperties extends GeoJSONProperties {
  '@id'?: string
  railway?: 'station' | 'halt' | 'stop'
  name?: string
  ref?: string
  operator?: string
  platforms?: string
  public_transport?: string
  train?: string
  uic_ref?: string
}

/** Typed feature collections */
export type RailwayFeatureCollection = GeoJSONFeatureCollection<
  GeoJSONLineString | GeoJSONMultiLineString,
  RailwayProperties
>

export type StationFeatureCollection = GeoJSONFeatureCollection<GeoJSONPoint, StationProperties>

/** Bounding box [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number]

/** Region configuration */
export interface RegionConfig {
  id: string
  name: string
  bbox: BBox
  center: [number, number]
  zoom: number
}
