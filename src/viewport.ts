// Keep the corner inside the visible viewport without moving the painting for the keyboard.
export function trackViewport(win: Window = window) {
  const viewport = win.visualViewport;
  if (!viewport || !win.matchMedia("(any-pointer: coarse)").matches) return () => {};

  const { document: doc } = win;
  const events = new AbortController();
  const options = { signal: events.signal };
  let fullHeight = viewport.height;
  let keyboard = false;
  let frame = 0;
  let timer = 0;

  function restore() {
    win.clearTimeout(timer);
    // Wait until the keyboard animation settles, including dismissal without blur.
    timer = win.setTimeout(() => {
      if (fullHeight - viewport!.height > 120) return;
      keyboard = false;
      win.scrollTo(0, 0);
      doc.documentElement.scrollTop = doc.body.scrollTop = 0;
      queue();
    }, 300);
  }

  function sync() {
    frame = 0;
    const { height, offsetTop } = viewport!;
    const editing = doc.activeElement?.matches("textarea, input, [contenteditable=true]");
    if (editing && fullHeight - height > 120) keyboard = true;
    // The keyboard's Done button can dismiss it without blurring the textarea.
    if (keyboard && height >= fullHeight - 100) {
      restore();
    }
    if (!keyboard) {
      doc.documentElement.style.setProperty("--viewport-bottom", `${height + offsetTop}px`);
    }
    if (!editing && !keyboard) fullHeight = height;
  }

  function queue() {
    if (!frame) frame = win.requestAnimationFrame(sync);
  }

  function focus() {
    win.clearTimeout(timer);
    fullHeight = Math.max(fullHeight, viewport!.height);
    queue();
  }

  function rotate() {
    win.clearTimeout(timer);
    fullHeight = win.innerHeight;
    keyboard = false;
    queue();
  }

  viewport.addEventListener("resize", queue, options);
  viewport.addEventListener("scroll", queue, options);
  doc.addEventListener("focusin", focus, options);
  doc.addEventListener("focusout", restore, options);
  win.addEventListener("orientationchange", rotate, options);
  win.addEventListener("pageshow", queue, options);
  sync();

  return () => {
    win.cancelAnimationFrame(frame);
    win.clearTimeout(timer);
    events.abort();
    doc.documentElement.style.removeProperty("--viewport-bottom");
  };
}
