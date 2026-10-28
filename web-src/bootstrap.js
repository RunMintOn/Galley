export {};

const message = document.getElementById("boot-message");
const retry = document.getElementById("retry");
const query = new URLSearchParams(location.search);
const scope = "console";
const standby = query.has("standby");
const previewPath = scope === "legacy" ? location.pathname : `${location.pathname}?${new URLSearchParams({ session: scope })}`;
retry.addEventListener("click", () => standby ? location.replace(previewPath) : location.reload());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

if (standby) {
  message.textContent = "Preview moved to another tab. You can close this tab.";
  retry.textContent = "Open preview";
  retry.hidden = false;
} else {
  // Each session owns its own receiver. Old shared receivers must not consume these links.
  const channel = new BroadcastChannel(`review-console-v4:${scope}`);
  const lockName = scope === "legacy" ? "review-console" : `review-console:${scope}`;
  let replaced = false;
  const isPreviewVisible = () => document.visibilityState === "visible" && document.hasFocus();

  async function handOff() {
    const id = crypto.randomUUID();
    let protectedPage = false;
    const received = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      channel.onmessage = ({ data }) => {
        if (data?.type !== "received" || data.id !== id) return;
        clearTimeout(timeout);
        if (data.protected) {
          protectedPage = true;
        }
        resolve(data.visible === true || data.protected === true);
      };
      channel.postMessage({ type: "reply", id, hash: location.hash });
    });
    channel.onmessage = null;
    if (received) {
      channel.close();
      message.textContent = protectedPage ? "已有审查台有未保存修改。请返回原页面；此页可关闭。" : "已转到现有审查台；此页可关闭。";
      window.close();
    }
    return received;
  }

  async function openPreview() {
    const app = import("./app.js");
    let queue = Promise.resolve();
    channel.onmessage = ({ data }) => {
      if (data?.type !== "reply" || typeof data.hash !== "string") return;
      queue = queue.then(async () => {
        const preview = await app;
        if (replaced) return;
        window.focus();
        const visible = isPreviewVisible();
        if (visible) {
          if (data.hash) await preview.focusSession(data.hash);
        } else {
          if (preview.hasUnsavedChanges()) {
            channel.postMessage({ type: "received", id: data.id, visible: false, protected: true });
            return;
          }
          // Background timers are throttled. Save the reading position and let the clicked tab open immediately.
          preview.savePosition();
        }
        if (replaced) return;
        channel.postMessage({ type: "received", id: data.id, visible: visible && isPreviewVisible() });
      }).catch(() => {
        // The incoming tab can take over if delivery fails.
      });
    };
    try {
      await app;
      if (replaced) return;
      document.body.classList.remove("booting");
      await new Promise((resolve) => window.addEventListener("pagehide", resolve, { once: true }));
    } finally {
      channel.close();
    }
  }

  try {
    // Keep healthy handoffs lightweight, but do not let a sleeping tab block a reply.
    const received = await navigator.locks.request(lockName, { ifAvailable: true },
      (lock) => lock ? openPreview() : handOff());
    if (received === false) {
      message.textContent = "Opening preview here…";
      await navigator.locks.request(lockName, { steal: true }, openPreview);
    }
  } catch (error) {
    channel.close();
    if (error.name === "AbortError") {
      // Stealing a lock rejects its former owner's request, even if that tab resumes later.
      replaced = true;
      window.dispatchEvent(new Event("review-console-replaced"));
      window.close();
      location.replace(`${previewPath}${scope === "legacy" ? "?" : "&"}standby`);
    } else {
      message.textContent = "Could not load the preview. Please retry.";
      retry.hidden = false;
    }
  }
}

