import assert from "node:assert/strict";
import { test } from "node:test";
import { createExamples } from "./examples.ts";

function store(bag = [0, 1, 2, 3]) {
  const data = new Map([["anything-to-color:presets:4", JSON.stringify(bag)]]);
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index],
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test("new examples consume the saved shuffle; browsing back and forward reuses the same examples", () => {
  const storage = store();
  const examples = createExamples(4, () => storage);
  assert.equal(examples.current, 0);
  assert.equal(examples.move(1), 1);
  assert.equal(examples.move(1), 2);
  const remaining = storage.getItem("anything-to-color:presets:4");
  assert.equal(examples.move(-1), 1);
  assert.equal(examples.move(-1), 0);
  assert.equal(examples.move(1), 1);
  assert.equal(examples.move(1), 2);
  assert.equal(storage.getItem("anything-to-color:presets:4"), remaining);
  assert.equal(examples.move(1), 3);
});

test("going backward from the opening example explores a new one, then forward returns to the opening", () => {
  const storage = store();
  const examples = createExamples(4, () => storage);
  assert.equal(examples.move(-1), 1);
  assert.equal(examples.move(-1), 2);
  assert.equal(examples.move(1), 1);
  assert.equal(examples.move(1), 0);
  assert.equal(examples.move(1), 3);
});

test("a refilled shuffle avoids immediately repeating its current example", () => {
  const storage = store([3]);
  const examples = createExamples(
    4,
    () => storage,
    () => 0.99,
  );
  assert.equal(examples.current, 3);
  storage.setItem("anything-to-color:presets:4", "[3,0,1,2]");
  assert.equal(examples.move(1), 0);
  assert.equal(examples.move(-1), 3);
});

test("navigation remains valid beyond its bounded history in either direction", () => {
  for (const direction of [-1, 1]) {
    const storage = store();
    const examples = createExamples(
      4,
      () => storage,
      () => 0.5,
    );
    const visited = [examples.current];
    for (let i = 0; i < 20; i++) visited.push(examples.move(direction));
    const saved = storage.getItem("anything-to-color:presets:4");
    for (let i = 1; i <= 3; i++) assert.equal(examples.move(-direction), visited.at(-1 - i));
    assert.equal(storage.getItem("anything-to-color:presets:4"), saved);
    assert.ok(visited.every((index) => index >= 0 && index < 4));
  }
});

test("invalid saved indices are discarded and only obsolete preset bags are removed", () => {
  const storage = store([null, -1, 4, 1.5, "2", 2, 3]);
  storage.data.set("anything-to-color:presets:3", "[0]");
  storage.data.set("unrelated", "keep");
  const examples = createExamples(4, () => storage);
  assert.equal(examples.current, 2);
  assert.equal(examples.move(1), 3);
  assert.equal(storage.data.has("anything-to-color:presets:3"), false);
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("blocked or corrupt storage never prevents browsing, including the single-preset case", () => {
  const storage = store();
  storage.data.set("anything-to-color:presets:4", "invalid");
  storage.setItem = () => {
    throw new Error("Storage disabled");
  };
  for (const access of [
    () => storage,
    () => {
      throw new Error("Storage disabled");
    },
  ]) {
    const examples = createExamples(4, access, () => 0.5);
    assert.ok(examples.current >= 0 && examples.current < 4);
    const next = examples.move(1);
    examples.move(-1);
    assert.equal(examples.move(1), next);
  }
  const single = createExamples(1, () => {
    throw new Error("Storage disabled");
  });
  assert.equal(single.current, 0);
  assert.equal(single.move(1), 0);
  assert.equal(single.move(-1), 0);
});
