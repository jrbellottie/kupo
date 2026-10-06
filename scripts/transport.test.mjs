import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { buildSync } from "esbuild";

async function load(entry) {
  const bundle = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

const { nextEarthMsForVanaDailySchedule: nextAlert, getVanaNow, DEFAULT_CALIBRATION } = await load("src\\vanadiel.ts");
const { TRANSPORT_GROUPS, createTransportTimer, formatTransportDepartures, getTransportArrivalMinutes, getTransportPorts } = await load("src\\utils\\transport.ts");
const { formatCountdown } = await load("src\\utils\\time.ts");
const routes = TRANSPORT_GROUPS.flatMap(group => group.routes);
const MINUTE = 2400;
const DAY = 1440 * MINUTE;
const cal = { timeOffsetMs: 0, newMoonStartEarthMs: 0 };

test("every transport route names its departure dock and destination, including round-trip tours", () => {
  const expected = {
    "selbina-mhaura": ["Selbina", "Mhaura"],
    "mhaura-selbina": ["Mhaura", "Selbina"],
    "mhaura-whitegate": ["Mhaura", "Aht Urhgan Whitegate"],
    "whitegate-mhaura": ["Aht Urhgan Whitegate", "Mhaura"],
    "whitegate-nashmau": ["Aht Urhgan Whitegate", "Nashmau"],
    "nashmau-whitegate": ["Nashmau", "Aht Urhgan Whitegate"],
    "bibiki-purgonorgo": ["Bibiki Bay (Sunset Docks)", "Purgonorgo Isle"],
    "purgonorgo-bibiki": ["Purgonorgo Isle", "Bibiki Bay (Sunset Docks)"],
    "dhalmel-rock": ["Bibiki Bay (Sunset Docks)", "Bibiki Bay (Sunset Docks)"],
    "maliyakaleya-reef": ["Bibiki Bay (Sunset Docks)", "Bibiki Bay (Sunset Docks)"],
    "south-central": ["South Landing", "Central Landing"],
    "central-south": ["Central Landing", "South Landing"],
    "south-north": ["South Landing", "North Landing"],
    "north-central": ["North Landing", "Central Landing"],
    "sandoria-jeuno": ["Port San d'Oria", "Port Jeuno"],
    "jeuno-sandoria": ["Port Jeuno", "Port San d'Oria"],
    "bastok-jeuno": ["Port Bastok", "Port Jeuno"],
    "jeuno-bastok": ["Port Jeuno", "Port Bastok"],
    "windurst-jeuno": ["Port Windurst", "Port Jeuno"],
    "jeuno-windurst": ["Port Jeuno", "Port Windurst"],
    "kazham-jeuno": ["Kazham", "Port Jeuno"],
    "jeuno-kazham": ["Port Jeuno", "Kazham"],
  };
  assert.deepEqual(Object.fromEntries(routes.map(route => [route.id, [route.departurePort, route.arrivalPort]])), expected);
});

test("port names survive saving and renaming, and existing timers resolve without a migration", () => {
  for (const route of routes) {
    const expected = { departurePort: route.departurePort, arrivalPort: route.arrivalPort };
    const timer = JSON.parse(JSON.stringify(createTransportTimer(route, 2, 1000)));
    assert.deepEqual(getTransportPorts(timer), expected);
    assert.deepEqual(getTransportPorts({ ...timer, label: "My transport reminder" }), expected);
    const legacy = { ...timer };
    delete legacy.departurePort;
    delete legacy.arrivalPort;
    const before = JSON.stringify(legacy);
    assert.deepEqual(getTransportPorts(legacy), expected);
    assert.equal(JSON.stringify(legacy), before, "port resolution must not change the saved timer or schedules");
    assert.equal(getTransportPorts({ ...legacy, label: "Unknown route" }), undefined);
    assert.equal(getTransportPorts({ ...legacy, departureMinutes: [42] }), undefined);
    assert.deepEqual(getTransportPorts({ ...legacy, departurePort: " ", arrivalPort: "" }), expected);
  }
});

test("all 22 directional routes use the published departure columns, not boarding or out-of-service times", () => {
  const expected = {
    "selbina-mhaura": "00:00, 08:00, 16:00",
    "mhaura-selbina": "00:00, 08:00, 16:00",
    "mhaura-whitegate": "04:00, 12:00, 20:00",
    "whitegate-mhaura": "04:00, 12:00, 20:00",
    "whitegate-nashmau": "00:00, 08:00, 16:00",
    "nashmau-whitegate": "00:00, 08:00, 16:00",
    "bibiki-purgonorgo": "05:30, 17:30",
    "purgonorgo-bibiki": "09:15, 21:15",
    "dhalmel-rock": "00:50",
    "maliyakaleya-reef": "12:50",
    "south-central": "00:50",
    "central-south": "05:10, 19:50",
    "south-north": "10:10",
    "north-central": "17:25",
    "sandoria-jeuno": "04:12, 10:12, 16:12, 22:12",
    "jeuno-sandoria": "01:13, 07:13, 13:13, 19:13",
    "bastok-jeuno": "01:12, 07:12, 13:12, 19:12",
    "jeuno-bastok": "04:14, 10:14, 16:14, 22:14",
    "windurst-jeuno": "05:43, 11:43, 17:43, 23:43",
    "jeuno-windurst": "02:43, 08:43, 14:43, 20:43",
    "kazham-jeuno": "02:42, 08:42, 14:42, 20:42",
    "jeuno-kazham": "05:37, 11:37, 17:37, 23:37",
  };
  assert.equal(routes.length, 22);
  assert.equal(new Set(routes.map(route => route.id)).size, 22);
  for (const group of TRANSPORT_GROUPS) assert.ok(URL.canParse(group.sourceUrl));
  assert.deepEqual(Object.fromEntries(routes.map(route => [route.id, formatTransportDepartures(route.departureMinutes)])), expected);
});

test("every route fires at every daily departure with offsets 0 through 23 and survives serialization", () => {
  for (const route of routes) {
    for (let offsetHours = 0; offsetHours <= 23; offsetHours++) {
      const timer = JSON.parse(JSON.stringify(createTransportTimer(route, offsetHours, 1000)));
      assert.equal(timer.kind, "TRANSPORT");
      assert.equal(timer.enabled, true);
      assert.equal(timer.createdAtMs, 1000);
      assert.equal(timer.offsetHours, offsetHours);
      for (const departure of route.departureMinutes) {
        const due = DAY + (departure - offsetHours * 60) * MINUTE;
        assert.equal(nextAlert({ ...timer, cal, nowEarthMs: due - 1 }), due, route.id);
        assert.equal(nextAlert({ ...timer, cal, nowEarthMs: due - 250 }), due, "scheduler tick must cross the exact boundary");
        const following = nextAlert({ ...timer, cal, nowEarthMs: due });
        assert.ok(following > due && following <= due + DAY);
        assert.equal(nextAlert({ ...timer, cal, nowEarthMs: due + DAY - 1 }), due + DAY, "repeat tomorrow, not next week");
      }
    }
  }
});

test("all routes use destination arrivals, including return times for sightseeing tours", () => {
  const expected = {
    "selbina-mhaura": "06:40, 14:40, 22:40",
    "mhaura-selbina": "06:40, 14:40, 22:40",
    "mhaura-whitegate": "02:40, 10:40, 18:40",
    "whitegate-mhaura": "02:40, 10:40, 18:40",
    "whitegate-nashmau": "05:00, 13:00, 21:00",
    "nashmau-whitegate": "05:00, 13:00, 21:00",
    "bibiki-purgonorgo": "08:30, 20:30",
    "purgonorgo-bibiki": "00:10, 12:10",
    "dhalmel-rock": "04:50",
    "maliyakaleya-reef": "16:50",
    "south-central": "04:35",
    "central-south": "08:55, 23:35",
    "south-north": "16:00",
    "north-central": "19:15",
    "sandoria-jeuno": "00:11, 06:11, 12:11, 18:11",
    "jeuno-sandoria": "03:10, 09:10, 15:10, 21:10",
    "bastok-jeuno": "03:11, 09:11, 15:11, 21:11",
    "jeuno-bastok": "00:13, 06:13, 12:13, 18:13",
    "windurst-jeuno": "01:41, 07:41, 13:41, 19:41",
    "jeuno-windurst": "04:47, 10:47, 16:47, 22:47",
    "kazham-jeuno": "04:49, 10:49, 16:49, 22:49",
    "jeuno-kazham": "01:48, 07:48, 13:48, 19:48",
  };
  assert.deepEqual(Object.fromEntries(routes.map(route => [route.id, formatTransportDepartures(route.arrivalMinutes)])), expected);
});

test("arrivals stay on the current trip through departure and roll forward only at arrival", () => {
  for (const route of routes) {
    for (const departureMinute of route.departureMinutes) {
      const departure = DAY + departureMinute * MINUTE;
      const nextDeparture = nextAlert({ nowEarthMs: departure, cal, departureMinutes: route.departureMinutes, offsetHours: 0 });
      const args = { cal, departureMinutes: route.arrivalMinutes, offsetHours: 0 };
      const arrival = nextAlert({ ...args, nowEarthMs: departure - 1 });
      assert.ok(arrival > departure && arrival < nextDeparture, route.id);
      for (const nowEarthMs of [departure, departure + 1000, arrival - 1000, arrival - 1]) {
        assert.equal(nextAlert({ ...args, nowEarthMs }), arrival, route.id);
      }
      assert.equal(formatCountdown(arrival - (arrival - 1000)), "00:00:01");
      assert.ok(nextAlert({ ...args, nowEarthMs: arrival }) > arrival);
    }
  }
});

test("arrival countdown crosses midnight with calibration and ignores reminder offsets", () => {
  const route = routes.find(route => route.id === "purgonorgo-bibiki");
  const calibration = DEFAULT_CALIBRATION;
  const arrival = 8 * DAY + 10 * MINUTE - calibration.timeOffsetMs;
  const nowEarthMs = 8 * DAY - MINUTE - calibration.timeOffsetMs;
  for (const offset of [0, 2, 23]) {
    const timer = createTransportTimer(route, offset, nowEarthMs);
    assert.equal(nextAlert({ nowEarthMs, cal: calibration, departureMinutes: getTransportArrivalMinutes(timer), offsetHours: 0 }), arrival);
  }
  assert.equal(formatCountdown(arrival - nowEarthMs), "00:00:26");
  assert.equal(getVanaNow(arrival, calibration).weekday, "Firesday");
  assert.equal(getVanaNow(arrival, calibration).minute, 10);
});

test("new timers save independent arrival data and old route timers resolve arrivals without changing alerts", () => {
  for (const route of routes) {
    const timer = createTransportTimer(route, 2, 1000);
    assert.notEqual(timer.arrivalMinutes, route.arrivalMinutes);
    assert.deepEqual(getTransportArrivalMinutes(JSON.parse(JSON.stringify(timer))), route.arrivalMinutes);
    const legacy = { ...timer };
    delete legacy.arrivalMinutes;
    assert.deepEqual(getTransportArrivalMinutes(legacy), route.arrivalMinutes);
    assert.equal(legacy.arrivalMinutes, undefined, "resolution must not mutate existing timers");
    assert.equal(legacy.offsetHours, 2);
    assert.deepEqual(legacy.departureMinutes, route.departureMinutes);
    assert.equal(getTransportArrivalMinutes({ ...legacy, label: "Unknown route" }), undefined);
    assert.equal(getTransportArrivalMinutes({ ...legacy, departureMinutes: [42] }), undefined);
  }
});

test("missed lead times advance to the next alert rather than an unannounced departure", () => {
  const args = { departureMinutes: [0, 480, 960], offsetHours: 2, cal };
  assert.equal(nextAlert({ ...args, nowEarthMs: 5 * 60 * MINUTE }), 6 * 60 * MINUTE);
  assert.equal(nextAlert({ ...args, nowEarthMs: 6 * 60 * MINUTE }), 14 * 60 * MINUTE);
  assert.equal(nextAlert({ ...args, nowEarthMs: 7 * 60 * MINUTE }), 14 * 60 * MINUTE);
  assert.equal(nextAlert({ ...args, nowEarthMs: 23 * 60 * MINUTE }), DAY + 6 * 60 * MINUTE);
});

test("offsets cross midnight and Darksday into Firesday without losing the intended departure", () => {
  const due = 8 * DAY - 2 * 60 * MINUTE;
  const alert = nextAlert({ nowEarthMs: due - 1000, cal, departureMinutes: [0], offsetHours: 2 });
  assert.equal(alert, due);
  const alertVana = getVanaNow(alert, cal);
  const departureVana = getVanaNow(alert + 2 * 60 * MINUTE, cal);
  assert.equal(alertVana.weekday, "Darksday");
  assert.equal(alertVana.hour, 22);
  assert.equal(departureVana.weekday, "Firesday");
  assert.equal(departureVana.hour, 0);
});

test("next departure countdown continues past the alert and rolls over only at departure", () => {
  const departureMinutes = [0, 480, 960];
  const departure = 480 * MINUTE;
  for (const minute of [359, 360, 361, 420, 479]) {
    const nowEarthMs = minute * MINUTE;
    const nextDeparture = nextAlert({ nowEarthMs, cal, departureMinutes, offsetHours: 0 });
    assert.equal(nextDeparture, departure);
    if (minute >= 360) {
      const alert = nextAlert({ nowEarthMs, cal, departureMinutes, offsetHours: 2 });
      assert.ok(alert > nextDeparture, "next alert must not hide the imminent departure");
    }
  }
  assert.equal(formatCountdown(departure - 360 * MINUTE), "00:04:48");
  assert.equal(formatCountdown(departure - 420 * MINUTE), "00:02:24");
  assert.equal(formatCountdown(departure - (departure - 1000)), "00:00:01");
  assert.equal(nextAlert({ nowEarthMs: departure, cal, departureMinutes, offsetHours: 0 }), 960 * MINUTE);
  assert.equal(nextAlert({ nowEarthMs: 1439 * MINUTE, cal, departureMinutes, offsetHours: 0 }), DAY);
});

test("calibration and fractional-second ticks keep exact departure boundaries", () => {
  for (const timeOffsetMs of [DEFAULT_CALIBRATION.timeOffsetMs, -9876543, 17]) {
    const calibration = { ...cal, timeOffsetMs };
    const departure = 100 * DAY + 337 * MINUTE - timeOffsetMs;
    const args = { cal: calibration, departureMinutes: [337, 697, 1057, 1417], offsetHours: 0 };
    for (const delta of [1, 17, 39, 250, 1000]) {
      assert.equal(nextAlert({ ...args, nowEarthMs: departure - delta }), departure);
    }
    assert.equal(nextAlert({ ...args, nowEarthMs: departure }), departure + 360 * MINUTE);
    const vana = getVanaNow(departure, calibration);
    assert.equal(vana.hour, 5);
    assert.equal(vana.minute, 37);
  }
});

test("transport timers capture independent schedules and retain the selected lead time", () => {
  const route = routes[0];
  const first = createTransportTimer(route, 2, 1000);
  const second = createTransportTimer(route, 0, 2000);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.departureMinutes, route.departureMinutes);
  second.departureMinutes.push(42);
  assert.deepEqual(first.departureMinutes, [0, 480, 960]);
  assert.deepEqual(route.departureMinutes, [0, 480, 960]);
  assert.equal(first.offsetHours, 2);
});

test("invalid schedules fail explicitly", () => {
  const valid = { nowEarthMs: 0, cal, departureMinutes: [0], offsetHours: 2 };
  for (const departureMinutes of [[], [-1], [1440], [0.5], [NaN]]) {
    assert.throws(() => nextAlert({ ...valid, departureMinutes }), /Invalid/);
  }
  for (const offsetHours of [-1, 24, 0.5, NaN]) {
    assert.throws(() => nextAlert({ ...valid, offsetHours }), /Invalid/);
  }
  assert.throws(() => nextAlert({ ...valid, nowEarthMs: NaN }), /Invalid/);
  assert.throws(() => nextAlert({ ...valid, cal: { ...cal, timeOffsetMs: NaN } }), /Invalid/);
});
