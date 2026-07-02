export type HotspotKey = 'marina' | 'lighthouse' | 'promenade' | 'grove';

export interface Hotspot {
  key: HotspotKey;
  name: string;
  sub: string;
  letter: string;
}

export const HOTSPOTS: Hotspot[] = [
  { key: 'marina', name: 'The Marina', sub: 'Boats & finger docks', letter: 'M' },
  { key: 'lighthouse', name: 'Lighthouse Point', sub: 'Coastal lookout trail', letter: 'L' },
  { key: 'promenade', name: 'The Promenade', sub: 'Waterfront walk', letter: 'P' },
  { key: 'grove', name: 'Cedar Grove', sub: 'Picnic lawns & pavilion', letter: 'C' },
];
