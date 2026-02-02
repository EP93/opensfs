/**
 * Line definitions for the Rheintalbahn corridor.
 * Based on real Deutsche Bahn timetable data for RE 7 and RB 27 services.
 *
 * Station IDs are from the freiburg region GeoJSON data.
 */

import type { LineDefinition } from '@/types/timetable'

/**
 * RE 7 Rheintalbahn - Express service
 * Offenburg - Freiburg - Basel
 * Stops at major stations only
 */
export const RE7_RHEINTALBAHN: LineDefinition = {
  id: 'RE7',
  name: 'RE 7 Rheintalbahn',
  category: 'RE',
  defaultTypeId: 'BR462', // Desiro HC
  defaultUnits: 1,
  color: 0xec0016, // DB Red
  route: [
    'station-node/21386947', // Offenburg
    'station-node/3123473867', // Lahr (Schwarzwald)
    'station-node/21769922', // Emmendingen
    'station-node/21769883', // Freiburg (Breisgau) Hauptbahnhof
    'station-node/339755956', // Bad Krozingen
    'station-node/27358194', // Müllheim im Markgräflerland
    'station-node/2437251950', // Weil am Rhein
    'station-node/3080746011', // Basel SBB (SBB)
  ],
  stationNames: [
    'Offenburg',
    'Lahr (Schwarzwald)',
    'Emmendingen',
    'Freiburg (Brsg) Hbf',
    'Bad Krozingen',
    'Müllheim (Baden)',
    'Weil am Rhein',
    'Basel SBB',
  ],
  // Journey times in minutes from origin
  journeyTimes: [0, 13, 24, 40, 52, 64, 75, 85],
  // Dwell times at each station in minutes
  dwellTimes: [0, 1, 1, 2, 1, 1, 1, 0],
  taktTemplate: {
    departureMinute: 38, // xx:38 departure pattern
    intervalMinutes: 60, // Hourly
    firstHour: 5, // First train at 05:38
    lastHour: 22, // Last train at 22:38
    operatingDays: [1, 2, 3, 4, 5, 6, 0], // All week
  },
  bidirectional: true,
}

/**
 * RB 27 Rheintal Süd - Regional service (simplified route)
 * Freiburg - Bad Krozingen - Müllheim - Basel
 */
export const RB27_RHEINTAL_SUD: LineDefinition = {
  id: 'RB27',
  name: 'RB 27 Rheintal Süd',
  category: 'RB',
  defaultTypeId: 'BR463', // Mireo
  defaultUnits: 1,
  color: 0x006f8f, // DB Petrol
  route: [
    'station-node/21769883', // Freiburg (Breisgau) Hauptbahnhof
    'station-node/27339628', // Freiburg-Sankt Georgen
    'station-node/875971244', // Schallstadt
    'station-node/339755956', // Bad Krozingen
    'station-node/27358206', // Heitersheim
    'station-node/310683068', // Buggingen
    'station-node/27358194', // Müllheim im Markgräflerland
    'station-node/2870459336', // Auggen
    'station-node/2428962411', // Schliengen
    'station-node/232638811', // Bad Bellingen
    'station-node/317807461', // Efringen-Kirchen
    'station-node/1109008480', // Eimeldingen
    'station-node/2696207577', // Haltingen
    'station-node/2437251950', // Weil am Rhein
    'station-node/750741463', // Basel Badischer Bahnhof
  ],
  stationNames: [
    'Freiburg (Brsg) Hbf',
    'Freiburg St. Georgen',
    'Schallstadt',
    'Bad Krozingen',
    'Heitersheim',
    'Buggingen',
    'Müllheim (Baden)',
    'Auggen',
    'Schliengen',
    'Bad Bellingen',
    'Efringen-Kirchen',
    'Eimeldingen',
    'Haltingen',
    'Weil am Rhein',
    'Basel Bad Bf',
  ],
  // Journey times in minutes from Freiburg
  journeyTimes: [0, 5, 10, 16, 22, 26, 31, 35, 39, 43, 47, 50, 53, 56, 63],
  // Dwell times at each station
  dwellTimes: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  taktTemplate: {
    departureMinute: 8, // xx:08 departure pattern
    intervalMinutes: 60, // Hourly
    firstHour: 5,
    lastHour: 23,
    operatingDays: [1, 2, 3, 4, 5, 6, 0],
  },
  bidirectional: true,
}

/**
 * RB 26 Rheintal Nord - Regional service north of Freiburg (simplified)
 * Freiburg - Emmendingen - Offenburg
 */
export const RB26_RHEINTAL_NORD: LineDefinition = {
  id: 'RB26',
  name: 'RB 26 Rheintal Nord',
  category: 'RB',
  defaultTypeId: 'BR463',
  defaultUnits: 1,
  color: 0x006f8f,
  route: [
    'station-node/21769883', // Freiburg (Breisgau) Hauptbahnhof
    'station-node/73280120', // Gundelfingen (Breisgau)
    'station-node/21770174', // Denzlingen
    'station-node/21769922', // Emmendingen
    'station-node/21769951', // Riegel-Malterdingen
    'station-node/2857866102', // Herbolzheim (Breisgau)
    'station-node/312426117', // Kenzingen
    'station-node/299230210', // Orschweier
    'station-node/3123473867', // Lahr (Schwarzwald)
    'station-node/1637496016', // Friesenheim (Baden)
    'station-node/21386947', // Offenburg
  ],
  stationNames: [
    'Freiburg (Brsg) Hbf',
    'Gundelfingen',
    'Denzlingen',
    'Emmendingen',
    'Riegel-Malterdingen',
    'Herbolzheim',
    'Kenzingen',
    'Orschweier',
    'Lahr (Schwarzwald)',
    'Friesenheim',
    'Offenburg',
  ],
  journeyTimes: [0, 5, 9, 14, 20, 25, 29, 33, 38, 43, 50],
  dwellTimes: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  taktTemplate: {
    departureMinute: 23,
    intervalMinutes: 60,
    firstHour: 5,
    lastHour: 23,
    operatingDays: [1, 2, 3, 4, 5, 6, 0],
  },
  bidirectional: true,
}

/** All available line definitions */
export const LINE_DEFINITIONS: LineDefinition[] = [
  RE7_RHEINTALBAHN,
  RB27_RHEINTAL_SUD,
  RB26_RHEINTAL_NORD,
]

/** Line definitions by ID */
export const LINE_DEFINITIONS_MAP: Map<string, LineDefinition> = new Map(
  LINE_DEFINITIONS.map((l) => [l.id, l])
)
