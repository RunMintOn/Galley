export function setupOverlayScrollbars(scrollers) {
  for (const scroller of scrollers) {
    const thumb = document.createElement("div");
    thumb.className = "overlay-scrollbar";
    thumb.setAttribute("aria-hidden", "true");
    scroller.parentElement.append(thumb);
    let timer, startY, startScroll, dragging = false;
    const update = () => {
      const height = scroller.clientHeight;
      const range = scroller.scrollHeight - height;
      thumb.hidden = height === 0 || range <= 0;
      const size = Math.min(height, Math.max(24, height * height / scroller.scrollHeight));
      thumb.style.height = size + "px";
      thumb.style.top = scroller.offsetTop + (range > 0 ? scroller.scrollTop / range * (height - size) : 0) + "px";
    };
    const reveal = () => {
      update();
      thumb.classList.add("visible");
      clearTimeout(timer);
      if (!dragging) timer = setTimeout(() => thumb.classList.remove("visible"), 800);
    };
    scroller.addEventListener("scroll", reveal);
    thumb.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startY = event.clientY;
      startScroll = scroller.scrollTop;
      thumb.setPointerCapture(event.pointerId);
      reveal();
    });
    thumb.addEventListener("pointermove", event => {
      if (!dragging) return;
      const travel = scroller.clientHeight - thumb.offsetHeight;
      if (travel > 0) scroller.scrollTop = startScroll +
        (event.clientY - startY) * (scroller.scrollHeight - scroller.clientHeight) / travel;
    });
    thumb.addEventListener("pointerup", event => thumb.releasePointerCapture(event.pointerId));
    thumb.addEventListener("lostpointercapture", () => { dragging = false; reveal(); });
    new ResizeObserver(update).observe(scroller);
    update();
  }
}
