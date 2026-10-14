// Demo-Daten für den Mock-Modus: vereinfachte Strecken und Bahnhöfe in Österreich.
// Koordinaten sind gerundet und nur zur Darstellung gedacht.

import { LngLat, TrackUsage, TrainType } from '../../models/api.models';

export interface SeedStation {
  id: string;
  name: string;
  code: string;
  at: LngLat;
}

export const STATIONS: SeedStation[] = [
  { id: 'st-wien-hbf', name: 'Wien Hbf', code: 'WHB', at: [16.3755, 48.1851] },
  { id: 'st-wien-meidling', name: 'Wien Meidling', code: 'WME', at: [16.3335, 48.1745] },
  { id: 'st-wien-west', name: 'Wien Westbahnhof', code: 'WWB', at: [16.3378, 48.1966] },
  { id: 'st-wien-mitte', name: 'Wien Mitte', code: 'WMI', at: [16.385, 48.206] },
  { id: 'st-flughafen', name: 'Flughafen Wien', code: 'FWI', at: [16.563, 48.121] },
  { id: 'st-tullnerfeld', name: 'Tullnerfeld', code: 'TUF', at: [15.9933, 48.3036] },
  { id: 'st-st-poelten', name: 'St. Pölten Hbf', code: 'STP', at: [15.6243, 48.2083] },
  { id: 'st-melk', name: 'Melk', code: 'MLK', at: [15.333, 48.228] },
  { id: 'st-amstetten', name: 'Amstetten', code: 'AMS', at: [14.8727, 48.1232] },
  { id: 'st-linz', name: 'Linz Hbf', code: 'LHB', at: [14.2915, 48.2903] },
  { id: 'st-wels', name: 'Wels Hbf', code: 'WLS', at: [14.0272, 48.1655] },
  { id: 'st-attnang', name: 'Attnang-Puchheim', code: 'ATP', at: [13.718, 48.0108] },
  { id: 'st-voecklabruck', name: 'Vöcklabruck', code: 'VBR', at: [13.652, 48.005] },
  { id: 'st-salzburg', name: 'Salzburg Hbf', code: 'SHB', at: [13.0457, 47.813] },
  { id: 'st-hallein', name: 'Hallein', code: 'HAL', at: [13.092, 47.687] },
  { id: 'st-bischofshofen', name: 'Bischofshofen', code: 'BHO', at: [13.2172, 47.4173] },
  { id: 'st-schwarzach', name: 'Schwarzach-St. Veit', code: 'SSV', at: [13.144, 47.32] },
  { id: 'st-zell-am-see', name: 'Zell am See', code: 'ZAS', at: [12.798, 47.32] },
  { id: 'st-saalfelden', name: 'Saalfelden', code: 'SAA', at: [12.848, 47.426] },
  { id: 'st-kitzbuehel', name: 'Kitzbühel', code: 'KIT', at: [12.391, 47.447] },
  { id: 'st-woergl', name: 'Wörgl Hbf', code: 'WOE', at: [12.0663, 47.4867] },
  { id: 'st-kufstein', name: 'Kufstein', code: 'KUF', at: [12.164, 47.583] },
  { id: 'st-jenbach', name: 'Jenbach', code: 'JEN', at: [11.758, 47.389] },
  { id: 'st-innsbruck', name: 'Innsbruck Hbf', code: 'IHB', at: [11.401, 47.2633] },
  { id: 'st-oetztal', name: 'Ötztal', code: 'OEZ', at: [10.915, 47.235] },
  { id: 'st-landeck', name: 'Landeck-Zams', code: 'LAN', at: [10.566, 47.147] },
  { id: 'st-st-anton', name: 'St. Anton am Arlberg', code: 'SAN', at: [10.264, 47.129] },
  { id: 'st-bludenz', name: 'Bludenz', code: 'BLU', at: [9.815, 47.155] },
  { id: 'st-feldkirch', name: 'Feldkirch', code: 'FEL', at: [9.604, 47.241] },
  { id: 'st-dornbirn', name: 'Dornbirn', code: 'DOR', at: [9.744, 47.414] },
  { id: 'st-bregenz', name: 'Bregenz', code: 'BRE', at: [9.742, 47.503] },
  { id: 'st-brenner', name: 'Brennero/Brenner', code: 'BRN', at: [11.507, 47.004] },
  { id: 'st-wr-neustadt', name: 'Wiener Neustadt Hbf', code: 'WRN', at: [16.237, 47.813] },
  { id: 'st-baden', name: 'Baden', code: 'BAD', at: [16.234, 48.007] },
  { id: 'st-semmering', name: 'Semmering', code: 'SEM', at: [15.829, 47.637] },
  { id: 'st-muerzzuschlag', name: 'Mürzzuschlag', code: 'MZZ', at: [15.672, 47.606] },
  { id: 'st-bruck-mur', name: 'Bruck an der Mur', code: 'BRM', at: [15.27, 47.414] },
  { id: 'st-leoben', name: 'Leoben Hbf', code: 'LEO', at: [15.092, 47.388] },
  { id: 'st-graz', name: 'Graz Hbf', code: 'GHB', at: [15.418, 47.072] },
  { id: 'st-weststeiermark', name: 'Weststeiermark', code: 'WST', at: [15.29, 46.86] },
  { id: 'st-lavanttal', name: 'Lavanttal', code: 'LAV', at: [14.86, 46.73] },
  { id: 'st-knittelfeld', name: 'Knittelfeld', code: 'KNI', at: [14.825, 47.216] },
  { id: 'st-st-veit', name: 'St. Veit an der Glan', code: 'SVG', at: [14.36, 46.768] },
  { id: 'st-klagenfurt', name: 'Klagenfurt Hbf', code: 'KHB', at: [14.313, 46.616] },
  { id: 'st-villach', name: 'Villach Hbf', code: 'VHB', at: [13.848, 46.619] },
  { id: 'st-spittal', name: 'Spittal-Millstätter See', code: 'SPM', at: [13.496, 46.798] },
  { id: 'st-mallnitz', name: 'Mallnitz-Obervellach', code: 'MAL', at: [13.17, 46.989] },
  { id: 'st-bad-gastein', name: 'Bad Gastein', code: 'BGA', at: [13.134, 47.116] },
  { id: 'st-bruck-leitha', name: 'Bruck an der Leitha', code: 'BRL', at: [16.782, 48.026] },
  { id: 'st-nickelsdorf', name: 'Nickelsdorf', code: 'NIC', at: [17.065, 47.94] },
];

/** Punkte: Bahnhofs-ID oder Zwischenpunkt. */
export interface SeedTrack {
  id: string;
  name: string;
  usage: TrackUsage;
  electrified: boolean;
  points: (string | LngLat)[];
}

export const TRACKS: SeedTrack[] = [
  {
    id: 'tr-westbahn-1',
    name: 'Westbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-wien-hbf', 'st-wien-meidling', [16.29, 48.19], [16.2, 48.23], [16.08, 48.28], 'st-tullnerfeld',
      [15.83, 48.27], [15.72, 48.23], 'st-st-poelten', [15.48, 48.22], 'st-melk', [15.21, 48.212],
      [15.08, 48.173], 'st-amstetten', [14.7, 48.15], [14.528, 48.175], [14.474, 48.212], [14.37, 48.26], 'st-linz',
    ],
  },
  {
    id: 'tr-westbahn-wb',
    name: 'Westbahn (Wien Westbahnhof)',
    usage: 'main',
    electrified: true,
    points: ['st-wien-west', [16.3, 48.199], [16.25, 48.205], [16.2, 48.23]],
  },
  {
    id: 'tr-westbahn-2',
    name: 'Westbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-linz', [14.2, 48.24], [14.11, 48.193], 'st-wels', [13.872, 48.092], 'st-attnang', 'st-voecklabruck',
      [13.53, 47.99], [13.422, 47.985], [13.22, 47.95], [13.1, 47.86], 'st-salzburg',
    ],
  },
  {
    id: 'tr-salzachtal',
    name: 'Salzburg-Tiroler-Bahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-salzburg', [13.07, 47.76], 'st-hallein', [13.164, 47.598], [13.192, 47.476], 'st-bischofshofen',
      [13.2, 47.35], 'st-schwarzach', [13.05, 47.3], [12.96, 47.29], [12.85, 47.3], 'st-zell-am-see',
    ],
  },
  {
    id: 'tr-giselabahn',
    name: 'Giselabahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-zell-am-see', [12.82, 47.38], 'st-saalfelden', [12.62, 47.47], [12.545, 47.477], [12.426, 47.525],
      'st-kitzbuehel', [12.314, 47.445], [12.155, 47.45], 'st-woergl',
    ],
  },
  {
    id: 'tr-unterinntal',
    name: 'Unterinntalbahn',
    usage: 'main',
    electrified: true,
    points: ['st-kufstein', [12.12, 47.54], 'st-woergl', [11.9, 47.44], 'st-jenbach', [11.709, 47.35], [11.506, 47.283], 'st-innsbruck'],
  },
  {
    id: 'tr-arlberg',
    name: 'Arlbergbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-innsbruck', [11.25, 47.28], [11.07, 47.3], 'st-oetztal', [10.744, 47.229], 'st-landeck', [10.45, 47.13],
      'st-st-anton', [10.122, 47.131], [9.95, 47.14], 'st-bludenz', [9.7, 47.2], 'st-feldkirch',
    ],
  },
  {
    id: 'tr-vorarlberg',
    name: 'Vorarlbergbahn',
    usage: 'main',
    electrified: true,
    points: ['st-feldkirch', [9.65, 47.3], [9.69, 47.364], 'st-dornbirn', [9.73, 47.46], 'st-bregenz'],
  },
  {
    id: 'tr-brenner',
    name: 'Brennerbahn',
    usage: 'main',
    electrified: true,
    points: ['st-innsbruck', [11.41, 47.2], [11.45, 47.13], [11.48, 47.06], 'st-brenner'],
  },
  {
    id: 'tr-suedbahn-1',
    name: 'Südbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-wien-hbf', 'st-wien-meidling', [16.29, 48.085], 'st-baden', [16.24, 47.9], 'st-wr-neustadt',
      [16.05, 47.72], [15.939, 47.675], 'st-semmering', 'st-muerzzuschlag', [15.449, 47.505], [15.293, 47.444], 'st-bruck-mur',
    ],
  },
  {
    id: 'tr-suedbahn-2',
    name: 'Südbahn',
    usage: 'main',
    electrified: true,
    points: ['st-bruck-mur', [15.32, 47.27], [15.37, 47.16], 'st-graz'],
  },
  {
    id: 'tr-koralmbahn',
    name: 'Koralmbahn',
    usage: 'main',
    electrified: true,
    points: ['st-graz', [15.4, 46.98], 'st-weststeiermark', [15.1, 46.78], 'st-lavanttal', [14.63, 46.65], [14.45, 46.62], 'st-klagenfurt'],
  },
  {
    id: 'tr-rudolfsbahn',
    name: 'Rudolfsbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-bruck-mur', 'st-leoben', 'st-knittelfeld', [14.663, 47.172], [14.439, 47.203], [14.4, 47.05],
      [14.408, 46.952], 'st-st-veit', 'st-klagenfurt',
    ],
  },
  {
    id: 'tr-kaerntner',
    name: 'Drautalbahn',
    usage: 'main',
    electrified: true,
    points: ['st-klagenfurt', [14.16, 46.636], [14.044, 46.613], 'st-villach'],
  },
  {
    id: 'tr-tauern',
    name: 'Tauernbahn',
    usage: 'main',
    electrified: true,
    points: [
      'st-schwarzach', [13.1, 47.17], 'st-bad-gastein', [13.15, 47.05], 'st-mallnitz', [13.25, 46.9],
      [13.35, 46.83], 'st-spittal', [13.65, 46.72], 'st-villach',
    ],
  },
  {
    id: 'tr-flughafen',
    name: 'Flughafenschnellbahn',
    usage: 'branch',
    electrified: true,
    points: ['st-wien-mitte', [16.42, 48.19], [16.48, 48.16], 'st-flughafen'],
  },
  {
    id: 'tr-ostbahn',
    name: 'Ostbahn',
    usage: 'main',
    electrified: true,
    points: ['st-wien-hbf', [16.45, 48.15], [16.6, 48.08], 'st-bruck-leitha', [16.95, 47.99], 'st-nickelsdorf'],
  },
  {
    id: 'tr-verbindung',
    name: 'Verbindungsbahn',
    usage: 'branch',
    electrified: true,
    points: ['st-wien-hbf', [16.39, 48.195], 'st-wien-mitte'],
  },
  {
    id: 'tr-mariazell',
    name: 'Mariazellerbahn',
    usage: 'tourism',
    electrified: true,
    points: ['st-st-poelten', [15.62, 48.1], [15.5, 47.95], [15.33, 47.78]],
  },
];

export interface SeedCompany {
  id: string;
  name: string;
  code: string;
}

export const COMPANIES: SeedCompany[] = [
  { id: 'co-oebb', name: 'ÖBB Personenverkehr', code: 'OEBB' },
  { id: 'co-westbahn', name: 'WESTbahn', code: 'WB' },
  { id: 'co-gkb', name: 'Graz-Köflacher Bahn', code: 'GKB' },
];

export interface SeedLine {
  id: string;
  companyId: string;
  name: string;
  code: string;
  color: string;
  trainType: TrainType;
  numberBase: number;
  /** Halte (Hinrichtung) */
  stops: string[];
  /** Fahrzeit ab Start in Minuten je Halt (Ankunft) */
  minutes: number[];
  /** Erste Abfahrt (Minuten ab 0:00), Takt in Minuten, letzte Abfahrt */
  first: number;
  every: number;
  last: number;
}

export const LINES: SeedLine[] = [
  {
    id: 'li-rj-west', companyId: 'co-oebb', name: 'RJ Westbahn', code: 'RJ', color: '#C8102E', trainType: 'HIGH_SPEED',
    numberBase: 540,
    stops: ['st-wien-hbf', 'st-wien-meidling', 'st-st-poelten', 'st-amstetten', 'st-linz', 'st-wels', 'st-attnang', 'st-salzburg'],
    minutes: [0, 8, 33, 60, 82, 98, 115, 148],
    first: 6 * 60 + 25, every: 60, last: 21 * 60 + 25,
  },
  {
    id: 'li-wb', companyId: 'co-westbahn', name: 'WESTbahn', code: 'WB', color: '#0F7A3D', trainType: 'INTERCITY',
    numberBase: 900,
    stops: ['st-wien-west', 'st-tullnerfeld', 'st-st-poelten', 'st-melk', 'st-amstetten', 'st-linz', 'st-wels', 'st-attnang', 'st-voecklabruck', 'st-salzburg'],
    minutes: [0, 20, 35, 52, 68, 92, 108, 126, 132, 165],
    first: 6 * 60 + 8, every: 60, last: 20 * 60 + 8,
  },
  {
    id: 'li-rj-sued', companyId: 'co-oebb', name: 'RJ Südbahn', code: 'RJ', color: '#B3123A', trainType: 'HIGH_SPEED',
    numberBase: 650,
    stops: ['st-wien-hbf', 'st-wien-meidling', 'st-wr-neustadt', 'st-semmering', 'st-muerzzuschlag', 'st-bruck-mur', 'st-graz'],
    minutes: [0, 7, 32, 70, 82, 108, 142],
    first: 6 * 60 + 58, every: 120, last: 20 * 60 + 58,
  },
  {
    id: 'li-koralm', companyId: 'co-oebb', name: 'RJX Koralm', code: 'RJX', color: '#7A1FA2', trainType: 'HIGH_SPEED',
    numberBase: 770,
    stops: ['st-graz', 'st-weststeiermark', 'st-lavanttal', 'st-klagenfurt', 'st-villach'],
    minutes: [0, 16, 30, 45, 70],
    first: 6 * 60 + 5, every: 60, last: 22 * 60 + 5,
  },
  {
    id: 'li-ic-tauern', companyId: 'co-oebb', name: 'IC Tauern', code: 'IC', color: '#1565C0', trainType: 'INTERCITY',
    numberBase: 690,
    stops: ['st-salzburg', 'st-hallein', 'st-bischofshofen', 'st-schwarzach', 'st-bad-gastein', 'st-mallnitz', 'st-spittal', 'st-villach', 'st-klagenfurt'],
    minutes: [0, 17, 45, 58, 85, 100, 126, 150, 176],
    first: 7 * 60 + 12, every: 120, last: 19 * 60 + 12,
  },
  {
    id: 'li-rj-arlberg', companyId: 'co-oebb', name: 'RJ Arlberg', code: 'RJ', color: '#D84315', trainType: 'HIGH_SPEED',
    numberBase: 360,
    stops: ['st-innsbruck', 'st-oetztal', 'st-landeck', 'st-st-anton', 'st-bludenz', 'st-feldkirch', 'st-dornbirn', 'st-bregenz'],
    minutes: [0, 30, 50, 75, 105, 120, 137, 150],
    first: 6 * 60 + 40, every: 120, last: 20 * 60 + 40,
  },
  {
    id: 'li-rex-gisela', companyId: 'co-oebb', name: 'REX Giselabahn', code: 'REX', color: '#00838F', trainType: 'REGIONAL',
    numberBase: 1510,
    stops: ['st-salzburg', 'st-hallein', 'st-bischofshofen', 'st-schwarzach', 'st-zell-am-see', 'st-saalfelden', 'st-kitzbuehel', 'st-woergl', 'st-jenbach', 'st-innsbruck'],
    minutes: [0, 20, 50, 62, 92, 105, 150, 180, 197, 222],
    first: 5 * 60 + 50, every: 120, last: 19 * 60 + 50,
  },
  {
    id: 'li-rex-inntal', companyId: 'co-oebb', name: 'REX Unterinntal', code: 'REX', color: '#2E7D32', trainType: 'REGIONAL',
    numberBase: 5330,
    stops: ['st-kufstein', 'st-woergl', 'st-jenbach', 'st-innsbruck'],
    minutes: [0, 12, 30, 52],
    first: 5 * 60 + 35, every: 30, last: 22 * 60 + 35,
  },
  {
    id: 'li-s7', companyId: 'co-oebb', name: 'S7', code: 'S7', color: '#0091EA', trainType: 'REGIONAL',
    numberBase: 2420,
    stops: ['st-wien-mitte', 'st-flughafen'],
    minutes: [0, 24],
    first: 5 * 60 + 2, every: 30, last: 23 * 60 + 32,
  },
  {
    id: 'li-cjx-ost', companyId: 'co-oebb', name: 'CJX Ostbahn', code: 'CJX', color: '#5D4037', trainType: 'REGIONAL',
    numberBase: 7720,
    stops: ['st-wien-hbf', 'st-bruck-leitha', 'st-nickelsdorf'],
    minutes: [0, 28, 48],
    first: 6 * 60 + 15, every: 60, last: 21 * 60 + 15,
  },
  {
    id: 'li-ec-brenner', companyId: 'co-oebb', name: 'EC Brenner', code: 'EC', color: '#283593', trainType: 'INTERCITY',
    numberBase: 80,
    stops: ['st-innsbruck', 'st-brenner'],
    minutes: [0, 34],
    first: 7 * 60 + 31, every: 120, last: 19 * 60 + 31,
  },
  {
    id: 'li-gkb-s', companyId: 'co-gkb', name: 'IC Klagenfurt–Leoben', code: 'IC', color: '#6A1B9A', trainType: 'INTERCITY',
    numberBase: 530,
    stops: ['st-klagenfurt', 'st-st-veit', 'st-knittelfeld', 'st-leoben', 'st-bruck-mur', 'st-graz'],
    minutes: [0, 18, 85, 105, 115, 148],
    first: 7 * 60 + 45, every: 240, last: 19 * 60 + 45,
  },
  {
    id: 'li-nj', companyId: 'co-oebb', name: 'Nightjet', code: 'NJ', color: '#1A237E', trainType: 'NIGHT',
    numberBase: 246,
    stops: ['st-wien-hbf', 'st-st-poelten', 'st-linz', 'st-salzburg', 'st-woergl', 'st-innsbruck', 'st-landeck', 'st-feldkirch', 'st-bregenz'],
    minutes: [0, 35, 95, 180, 290, 320, 390, 470, 500],
    first: 21 * 60 + 40, every: 24 * 60, last: 21 * 60 + 40,
  },
];
