import { test } from "node:test";
import assert from "node:assert/strict";

import { candidates } from "../src/lib/serverBase.js";

test("a bare network address tries http first, with /v1 first", () => {
  assert.deepEqual(candidates("192.168.1.77:8888"), [
    "http://192.168.1.77:8888/v1",
    "http://192.168.1.77:8888",
    "https://192.168.1.77:8888/v1",
    "https://192.168.1.77:8888",
  ]);
});

test("https typed for a network server still falls back to http", () => {
  assert.deepEqual(candidates("https://192.168.1.77:8888/"), [
    "https://192.168.1.77:8888/v1",
    "https://192.168.1.77:8888",
    "http://192.168.1.77:8888/v1",
    "http://192.168.1.77:8888",
  ]);
});

test("a path given is kept; an internet host stays on https", () => {
  assert.deepEqual(candidates("http://10.0.0.5:1234/api/v1"), ["http://10.0.0.5:1234/api/v1", "https://10.0.0.5:1234/api/v1"]);
  assert.deepEqual(candidates("api.example.com"), ["https://api.example.com/v1", "https://api.example.com"]);
  assert.deepEqual(candidates(""), []);
});
