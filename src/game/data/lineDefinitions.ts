/**
 * Line definitions for the Rheintal corridor (Basel–Freiburg–Offenburg–Karlsruhe).
 * Timings are approximate and intended for gameplay.
 *
 * Station IDs reference station nodes (not platform stop nodes).
 */

import type { LineDefinition } from '@/types/timetable'

/**
 * RE 7 Rheintalbahn - Express service (simplified)
 * Basel Bad Bf - Freiburg - Offenburg - Baden-Baden - Karlsruhe
 */
export const RE7_RHEINTALBAHN: LineDefinition = {
  id: 'RE7',
  name: 'RE 7 Rheintalbahn',
  category: 'RE',
  defaultTypeId: 'BR462', // Desiro HC
  defaultUnits: 1,
  color: 0xec0016, // DB Red
  route: [
    'station-node/3080746010', // Basel Badischer Bahnhof
    'station-node/21769883', // Freiburg (Breisgau) Hauptbahnhof
    'station-node/2931428598', // Offenburg
    'station-node/2931245709', // Baden-Baden
    'station-node/2574283615', // Karlsruhe Hauptbahnhof
  ],
  stationNames: [
    'Basel Bad Bf',
    'Freiburg (Brsg) Hbf',
    'Offenburg',
    'Baden-Baden',
    'Karlsruhe Hbf',
  ],
  // Journey times in minutes from origin
  journeyTimes: [0, 50, 85, 110, 140],
  // Dwell times at each station in minutes
  dwellTimes: [0, 2, 2, 1, 0],
  taktTemplate: {
    departureMinute: 20, // xx:20 departure pattern
    intervalMinutes: 60, // Hourly
    firstHour: 5,
    lastHour: 22,
    operatingDays: [1, 2, 3, 4, 5, 6, 0], // All week
  },
  bidirectional: true,
}

/**
 * RB 27 Rheintal Süd - Regional service (all stops)
 * Basel Bad Bf - Freiburg
 */
export const RB27_RHEINTAL_SUD: LineDefinition = {
  id: 'RB27',
  name: 'RB 27 Rheintal Süd',
  category: 'RB',
  defaultTypeId: 'BR463', // Mireo
  defaultUnits: 1,
  color: 0x006f8f, // DB Petrol
  route: [
    'station-node/3080746010', // Basel Badischer Bahnhof
    'station-node/2691597727', // Weil am Rhein
    'station-node/2696207577', // Haltingen
    'station-node/2696241802', // Eimeldingen
    'station-node/3248040312', // Efringen-Kirchen
    'station-node/2429012748', // Bad Bellingen
    'station-node/3260353073', // Schliengen
    'station-node/2870459336', // Auggen
    'station-node/2870447635', // Müllheim im Markgräflerland
    'station-node/2870400675', // Buggingen
    'station-node/27358206', // Heitersheim
    'station-node/1584720252', // Bad Krozingen
    'station-node/2427852431', // Schallstadt
    'station-node/2870258631', // Freiburg-Sankt Georgen
    'station-node/21769883', // Freiburg (Breisgau) Hauptbahnhof
  ],
  stationNames: [
    'Basel Bad Bf',
    'Weil am Rhein',
    'Haltingen',
    'Eimeldingen',
    'Efringen-Kirchen',
    'Bad Bellingen',
    'Schliengen',
    'Auggen',
    'Müllheim (Baden)',
    'Buggingen',
    'Heitersheim',
    'Bad Krozingen',
    'Schallstadt',
    'Freiburg St. Georgen',
    'Freiburg (Brsg) Hbf',
  ],
  // Journey times in minutes from Basel Bad Bf (reverse of the old Freiburg-origin timing)
  journeyTimes: [0, 7, 10, 13, 16, 20, 24, 28, 32, 37, 41, 47, 53, 58, 63],
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
    'station-node/3623217824', // Gundelfingen (Breisgau)
    'station-node/2870145095', // Denzlingen
    'station-node/2870063084', // Emmendingen
    'station-node/2858010890', // Riegel-Malterdingen
    'station-node/2857866102', // Herbolzheim (Breisgau)
    'station-node/2410872059', // Kenzingen
    'station-node/6535358086', // Orschweier
    'station-node/3123473867', // Lahr (Schwarzwald)
    'station-node/1637496016', // Friesenheim (Baden)
    'station-node/2931428598', // Offenburg
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

/**
 * RB 25 Rheintal Nord - Regional service north of Offenburg (simplified)
 * Offenburg - Baden-Baden - Karlsruhe (all stops)
 */
export const RB25_RHEINTAL_NORD: LineDefinition = {
  id: 'RB25',
  name: 'RB 25 Rheintal Nord',
  category: 'RB',
  defaultTypeId: 'BR463',
  defaultUnits: 1,
  color: 0x006f8f,
  route: [
    'station-node/2931428598', // Offenburg
    'station-node/2572551585', // Appenweier
    'station-node/3780858667', // Renchen
    'station-node/2572552393', // Achern
    'station-node/21386662', // Bühl (Baden)
    'station-node/2931245709', // Baden-Baden
    'station-node/21322676', // Rastatt
    'station-node/2574283615', // Karlsruhe Hauptbahnhof
  ],
  stationNames: [
    'Offenburg',
    'Appenweier',
    'Renchen',
    'Achern',
    'Bühl (Baden)',
    'Baden-Baden',
    'Rastatt',
    'Karlsruhe Hbf',
  ],
  journeyTimes: [0, 6, 12, 20, 28, 40, 50, 62],
  dwellTimes: [0, 1, 1, 1, 1, 1, 1, 0],
  taktTemplate: {
    departureMinute: 20,
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
  RB25_RHEINTAL_NORD,
]

/** Line definitions by ID */
export const LINE_DEFINITIONS_MAP: Map<string, LineDefinition> = new Map(
  LINE_DEFINITIONS.map((l) => [l.id, l])
)
