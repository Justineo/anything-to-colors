import assert from "node:assert/strict";
import { test } from "node:test";
import { trackViewport } from "./viewport.ts";

function browser() {
  const styles = new Map();
  const frames = new Map();
  const timers = new Map();
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
  const doc = Object.assign(new EventTarget(), {
    activeElement: null,
    documentElement: {
      scrollTop: 0,
      style: { setProperty: (k, v) => styles.set(k, v), removeProperty: (k) => styles.delete(k) },
    },
    body: { scrollTop: 0 },
  });
  let id = 0;
  let scrolls = 0;
  const win = Object.assign(new EventTarget(), {
    visualViewport: viewport,
    document: doc,
    innerHeight: 800,
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    scrollTo: (x, y) => {
      assert.deepEqual([x, y], [0, 0]);
      scrolls++;
    },
  });
  const flush = (jobs) => {
    const pending = [...jobs.values()];
    jobs.clear();
    pending.forEach((fn) => fn());
  };
  return {
    win,
    doc,
    viewport,
    styles,
    get scrolls() {
      return scrolls;
    },
    frames: () => flush(frames),
    timers: () => flush(timers),
    focus() {
      doc.activeElement = { matches: () => true };
      doc.dispatchEvent(new Event("focusin"));
    },
    resize(height, offsetTop = 0) {
      Object.assign(viewport, { height, offsetTop });
      viewport.dispatchEvent(new Event("resize"));
      flush(frames);
    },
  };
}

test("follows the visible viewport as in-app browser controls resize or scroll it", () => {
  const b = browser();
  b.viewport.height = 640;
  const stop = trackViewport(b.win);
  assert.equal(b.styles.get("--viewport-bottom"), "640px");
  b.resize(720);
  assert.equal(b.styles.get("--viewport-bottom"), "720px");
  b.viewport.offsetTop = 20;
  b.viewport.dispatchEvent(new Event("scroll"));
  b.frames();
  assert.equal(b.styles.get("--viewport-bottom"), "740px");
  assert.equal(b.scrolls, 0);
  stop();
  assert.equal(b.styles.size, 0);
});

test("keeps the corner still during keyboard animation and restores after dismissal without blur", () => {
  const b = browser();
  const stop = trackViewport(b.win);
  b.focus();
  b.resize(450, 90);
  assert.equal(b.styles.get("--viewport-bottom"), "800px");
  b.timers();
  assert.equal(b.scrolls, 0);
  b.doc.documentElement.scrollTop = 90;
  b.resize(776, 24); // WebKit can leave a small height discrepancy after dismissal.
  b.timers();
  b.frames();
  assert.equal(b.scrolls, 1);
  assert.equal(b.doc.documentElement.scrollTop, 0);
  b.viewport.offsetTop = 0;
  b.viewport.dispatchEvent(new Event("scroll"));
  b.frames();
  assert.equal(b.styles.get("--viewport-bottom"), "776px");
  stop();
});

test("delays blur recovery and cancels it when the user resumes editing", () => {
  const b = browser();
  const stop = trackViewport(b.win);
  b.focus();
  b.resize(450);
  b.doc.activeElement = null;
  b.doc.dispatchEvent(new Event("focusout"));
  assert.equal(b.scrolls, 0);
  b.focus();
  b.timers();
  assert.equal(b.scrolls, 0);
  b.doc.activeElement = null;
  b.doc.dispatchEvent(new Event("focusout"));
  b.resize(800);
  b.timers();
  assert.equal(b.scrolls, 1);
  stop();
});

test("handles orientation changes and cleans up pending work and listeners", () => {
  const b = browser();
  const stop = trackViewport(b.win);
  b.win.innerHeight = 390;
  b.win.dispatchEvent(new Event("orientationchange"));
  b.resize(390);
  assert.equal(b.styles.get("--viewport-bottom"), "390px");
  b.focus();
  b.resize(210);
  b.doc.activeElement = null;
  b.doc.dispatchEvent(new Event("focusout"));
  stop();
  b.resize(390);
  b.timers();
  b.frames();
  assert.equal(b.scrolls, 0);
  assert.equal(b.styles.size, 0);
});

test("waits for the viewport to recover even if blur precedes a slow keyboard animation", () => {
  const b = browser();
  const stop = trackViewport(b.win);
  b.focus();
  b.resize(450, 90);
  b.doc.activeElement = null;
  b.doc.dispatchEvent(new Event("focusout"));
  b.timers();
  assert.equal(b.scrolls, 0);
  b.resize(640, 40);
  b.timers();
  assert.equal(b.scrolls, 0);
  b.resize(776, 24);
  b.resize(800);
  b.timers();
  assert.equal(b.scrolls, 1);
  b.frames();
  assert.equal(b.styles.get("--viewport-bottom"), "800px");
  stop();
});

test("leaves desktop and browsers without VisualViewport unchanged", () => {
  for (const desktop of [true, false]) {
    const b = browser();
    if (desktop) b.win.matchMedia = () => ({ matches: false });
    else b.win.visualViewport = null;
    const stop = trackViewport(b.win);
    b.resize(450);
    assert.equal(b.styles.size, 0);
    stop();
  }
});
