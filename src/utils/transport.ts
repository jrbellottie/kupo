import type { TransportTimer } from "../types";
import { pad2, uid } from "./time";

export type TransportPreset = {
  id: string;
  label: string;
  departureMinutes: number[];
  arrivalMinutes: number[];
};

export type TransportGroup = {
  label: string;
  sourceUrl: string;
  routes: TransportPreset[];
};

// Published departures and destination arrivals. Each route repeats daily.
export const TRANSPORT_GROUPS: TransportGroup[] = [
  {
    label: "Ferries",
    sourceUrl: "https://github.com/LandSandBoat/server/blob/3e73b0bd38626df86481547133332f0c1e59dc1d/scripts/globals/transport.lua",
    routes: [
      { id: "selbina-mhaura", label: "Selbina to Mhaura", departureMinutes: [0, 480, 960], arrivalMinutes: [400, 880, 1360] },
      { id: "mhaura-selbina", label: "Mhaura to Selbina", departureMinutes: [0, 480, 960], arrivalMinutes: [400, 880, 1360] },
      { id: "mhaura-whitegate", label: "Mhaura to Aht Urhgan Whitegate", departureMinutes: [240, 720, 1200], arrivalMinutes: [160, 640, 1120] },
      { id: "whitegate-mhaura", label: "Aht Urhgan Whitegate to Mhaura", departureMinutes: [240, 720, 1200], arrivalMinutes: [160, 640, 1120] },
      { id: "whitegate-nashmau", label: "Aht Urhgan Whitegate to Nashmau", departureMinutes: [0, 480, 960], arrivalMinutes: [300, 780, 1260] },
      { id: "nashmau-whitegate", label: "Nashmau to Aht Urhgan Whitegate", departureMinutes: [0, 480, 960], arrivalMinutes: [300, 780, 1260] },
    ],
  },
  {
    label: "Manaclipper",
    sourceUrl: "https://horizonffxi.wiki/Manaclipper/Schedule",
    routes: [
      { id: "bibiki-purgonorgo", label: "Bibiki Bay (Sunset Docks) to Purgonorgo Isle", departureMinutes: [330, 1050], arrivalMinutes: [510, 1230] },
      { id: "purgonorgo-bibiki", label: "Purgonorgo Isle to Bibiki Bay (Sunset Docks)", departureMinutes: [555, 1275], arrivalMinutes: [10, 730] },
      { id: "dhalmel-rock", label: "Bibiki Bay: Dhalmel Rock tour", departureMinutes: [50], arrivalMinutes: [290] },
      { id: "maliyakaleya-reef", label: "Bibiki Bay: Maliyakaleya Reef tour", departureMinutes: [770], arrivalMinutes: [1010] },
    ],
  },
  {
    label: "Phanauet Channel barge",
    sourceUrl: "https://horizonffxi.wiki/Phanauet_Channel",
    routes: [
      { id: "south-central", label: "South Landing to Central Landing (Emfea Waterway)", departureMinutes: [50], arrivalMinutes: [275] },
      { id: "central-south", label: "Central Landing to South Landing (Newtpool)", departureMinutes: [310, 1190], arrivalMinutes: [535, 1415] },
      { id: "south-north", label: "South Landing to North Landing", departureMinutes: [610], arrivalMinutes: [960] },
      { id: "north-central", label: "North Landing to Central Landing", departureMinutes: [1045], arrivalMinutes: [1155] },
    ],
  },
  {
    label: "San d'Oria airship",
    sourceUrl: "https://horizonffxi.wiki/San_d%27Oria-Jeuno_Airship",
    routes: [
      { id: "sandoria-jeuno", label: "Port San d'Oria to Port Jeuno", departureMinutes: [252, 612, 972, 1332], arrivalMinutes: [11, 371, 731, 1091] },
      { id: "jeuno-sandoria", label: "Port Jeuno to Port San d'Oria", departureMinutes: [73, 433, 793, 1153], arrivalMinutes: [190, 550, 910, 1270] },
    ],
  },
  {
    label: "Bastok airship",
    sourceUrl: "https://horizonffxi.wiki/Bastok-Jeuno_Airship",
    routes: [
      { id: "bastok-jeuno", label: "Port Bastok to Port Jeuno", departureMinutes: [72, 432, 792, 1152], arrivalMinutes: [191, 551, 911, 1271] },
      { id: "jeuno-bastok", label: "Port Jeuno to Port Bastok", departureMinutes: [254, 614, 974, 1334], arrivalMinutes: [13, 373, 733, 1093] },
    ],
  },
  {
    label: "Windurst airship",
    sourceUrl: "https://horizonffxi.wiki/Windurst-Jeuno_Airship",
    routes: [
      { id: "windurst-jeuno", label: "Port Windurst to Port Jeuno", departureMinutes: [343, 703, 1063, 1423], arrivalMinutes: [101, 461, 821, 1181] },
      { id: "jeuno-windurst", label: "Port Jeuno to Port Windurst", departureMinutes: [163, 523, 883, 1243], arrivalMinutes: [287, 647, 1007, 1367] },
    ],
  },
  {
    label: "Kazham airship",
    sourceUrl: "https://horizonffxi.wiki/Kazham-Jeuno_Airship",
    routes: [
      { id: "kazham-jeuno", label: "Kazham to Port Jeuno", departureMinutes: [162, 522, 882, 1242], arrivalMinutes: [289, 649, 1009, 1369] },
      { id: "jeuno-kazham", label: "Port Jeuno to Kazham", departureMinutes: [337, 697, 1057, 1417], arrivalMinutes: [108, 468, 828, 1188] },
    ],
  },
];

export function formatTransportDepartures(minutes: readonly number[]): string {
  return minutes.map((minute) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`).join(", ");
}

export function getTransportArrivalMinutes(timer: TransportTimer): number[] | undefined {
  if (timer.arrivalMinutes !== undefined) return timer.arrivalMinutes;
  // Timers saved before arrivals were added have no route ID or arrival timetable.
  return TRANSPORT_GROUPS.flatMap(group => group.routes).find(route =>
    route.label === timer.label &&
    route.departureMinutes.length === timer.departureMinutes.length &&
    route.departureMinutes.every((minute, index) => minute === timer.departureMinutes[index])
  )?.arrivalMinutes;
}

export function createTransportTimer(preset: TransportPreset, offsetHours: number, nowMs: number): TransportTimer {
  return {
    id: uid(),
    kind: "TRANSPORT",
    label: preset.label,
    enabled: true,
    createdAtMs: nowMs,
    departureMinutes: [...preset.departureMinutes],
    arrivalMinutes: [...preset.arrivalMinutes],
    offsetHours,
  };
}
