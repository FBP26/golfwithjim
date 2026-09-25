import assert from "node:assert/strict";
import test from "node:test";
import { collectChronogolfDay } from "../src/collectors/chronogolf.js";

function response(payload, headers = {}) {
  return { ok: true, json: async () => payload, headers: new Headers(headers) };
}

test("collects exact two-player 18-hole Chronogolf quotes", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("reservations/options")) return response([{
      holes: 18,
      invoice: { total: 116 },
    }]);
    if (String(url).includes("/teetimes/time-uuid")) return response({
      id: 528981028,
      max_player_size: 4,
      affiliation_types_availability: [{ bookable_holes: [{
        hole: 18,
        affiliation_types: [{ affiliation_type_id: 58874, affiliation_type: "Public" }],
      }] }],
    });
    return response({ teetimes: [{
      id: 528981028,
      uuid: "time-uuid",
      start_time: "10:00",
      max_player_size: 4,
      course: { bookable_holes: [9, 18] },
    }] }, { total: "1" });
  };

  const result = await collectChronogolfDay({
    courseUuid: "course-uuid",
    affiliationTypeId: "58874",
    date: "2026-09-18",
    course: "Sycamore Creek Golf Course",
    distanceMiles: 20,
    url: "https://www.chronogolf.com/club/sycamore-creek-golf-course-virginia",
    fetchImpl,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].time, "10:00 AM");
  assert.equal(result[0].allInPrice, 58);
  assert.equal(result[0].holes, 18);
  assert.equal(requests.length, 2);
  const listingUrl = new URL(requests[0].url);
  assert.equal(listingUrl.searchParams.get("start_date"), "2026-09-18");
  assert.equal(listingUrl.searchParams.get("course_ids"), "course-uuid");
  const quoteBody = JSON.parse(requests[1].options.body);
  assert.equal(quoteBody.rounds_attributes.length, 2);
  assert.equal(quoteBody.nb_holes, "18");
});

test("quotes single openings with one player and a per-player total", async () => {
  let quotedPlayers;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("reservations/options")) {
      quotedPlayers = JSON.parse(options.body).rounds_attributes.length;
      return response([{ holes: 18, invoice: { total: 58 } }]);
    }
    return response({ teetimes: [{ id: 1, uuid: "single", start_time: "10:00", max_player_size: 1, course: { bookable_holes: [18] } }] }, { total: "1" });
  };
  const result = await collectChronogolfDay({ courseUuid: "course", affiliationTypeId: "58874", date: "2026-09-26", course: "Test", distanceMiles: 20, url: "https://example.com", fetchImpl });
  assert.equal(quotedPlayers, 1);
  assert.equal(result[0].availablePlayers, 1);
  assert.equal(result[0].allInPrice, 58);
});

test("falls back from a blocked proxy without forwarding authorization", async context => {
  for (const [name, value] of Object.entries({ CHRONOGOLF_PROXY_URL: "https://proxy.example/chronogolf", CHRONOGOLF_PROXY_TOKEN: "test-token" })) {
    const previous = process.env[name];
    process.env[name] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  let directRequests = 0;
  const fetchImpl = async (url, options = {}) => {
    if (new URL(url).hostname === "proxy.example") {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return { ok: false, status: 403 };
    }
    directRequests += 1;
    assert.equal(options.headers.Authorization, undefined);
    if (String(url).includes("reservations/options")) {
      assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).nb_holes, "18");
      return response([{ holes: 18, invoice: { total: 116 } }]);
    }
    return response({ teetimes: [{ id: 1, start_time: "10:00", max_player_size: 4, course: { bookable_holes: [18] } }] }, { total: "1" });
  };
  const result = await collectChronogolfDay({
    courseUuid: "course", affiliationTypeId: "58874", date: "2026-09-25",
    course: "Sycamore Creek Golf Course", distanceMiles: 17, url: "https://example.com", fetchImpl,
  });
  assert.equal(directRequests, 2);
  assert.equal(result[0].allInPrice, 58);
});

test("reports failed quotes instead of successful empty inventory", async () => {
  const fetchImpl = async url => {
    if (String(url).includes("reservations/options")) throw new Error("Quote unavailable");
    return response({ teetimes: [{ id: 1, start_time: "10:00", max_player_size: 4, course: { bookable_holes: [18] } }] }, { total: "1" });
  };
  await assert.rejects(collectChronogolfDay({
    courseUuid: "course", affiliationTypeId: "58874", date: "2026-09-25",
    course: "Sycamore Creek Golf Course", distanceMiles: 17, url: "https://example.com", fetchImpl,
  }), /Quote unavailable/);
});

test("keeps successful Chronogolf quotes when another quote is blocked", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("reservations/options")) {
      const teeTimeId = JSON.parse(options.body).teetime_id;
      if (teeTimeId === "1") return { ok: false, status: 403 };
      return response([{ holes: 18, invoice: { total: 90 } }]);
    }
    return response({ teetimes: [
      { id: 1, uuid: "blocked", start_time: "10:00", max_player_size: 4, course: { bookable_holes: [18] } },
      { id: 2, uuid: "available", start_time: "10:10", max_player_size: 4, course: { bookable_holes: [18] } },
    ] }, { total: "2" });
  };

  const result = await collectChronogolfDay({
    courseUuid: "course-uuid",
    affiliationTypeId: "58874",
    date: "2026-09-18",
    course: "Sycamore Creek Golf Course",
    distanceMiles: 20,
    url: "https://www.chronogolf.com/club/sycamore-creek-golf-course-virginia",
    fetchImpl,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "chronogolf-2");
  assert.equal(result[0].allInPrice, 45);
});