/** Only preset indices are remembered. Browsing back never stores user input or consumes the bag. */
export function createExamples(count: number, access = () => localStorage, random = Math.random) {
  const key = `anything-to-color:presets:${count}`;

  function draw(avoid?: number) {
    let storage: Storage | undefined;
    let bag: number[] = [];
    try {
      storage = access();
      for (let i = storage.length - 1; i >= 0; i--) {
        const old = storage.key(i);
        if (old?.startsWith("anything-to-color:presets") && old !== key) storage.removeItem(old);
      }
      bag = (JSON.parse(storage.getItem(key) ?? "[]") as unknown[]).filter(
        (index): index is number =>
          Number.isInteger(index) && (index as number) >= 0 && (index as number) < count,
      );
    } catch {}
    if (!bag.length) {
      bag = Array.from({ length: count }, (_, index) => index);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    if (bag.length > 1 && bag[0] === avoid) [bag[0], bag[1]] = [bag[1], bag[0]];
    const next = bag.shift()!;
    try {
      storage?.setItem(key, JSON.stringify(bag));
    } catch {}
    return next;
  }

  const history = [draw()];
  let cursor = 0;
  return {
    get current() {
      return history[cursor];
    },
    move(direction: -1 | 1) {
      const next = cursor + direction;
      if (next < 0) {
        history.unshift(draw(history[cursor]));
        if (history.length > count) history.pop();
      } else if (next === history.length) {
        history.push(draw(history[cursor]));
        if (history.length > count) history.shift();
        else cursor++;
      } else cursor = next;
      return history[cursor];
    },
  };
}
