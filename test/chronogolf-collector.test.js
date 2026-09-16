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
  const quoteBody = JSON.parse(requests[1].options.body);
  assert.equal(quoteBody.rounds_attributes.length, 2);
  assert.equal(quoteBody.nb_holes, "18");
});