// the page: entrances, the bar, the lit statement, the waitlist dialog (iOS → TestFlight, Android email-only), and the stone.

const TESTFLIGHT = "https://testflight.apple.com/join/2MvTg1jW";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

requestAnimationFrame(() => document.body.classList.add("ready"));

const bar = document.querySelector(".bar");
const frost = () => bar?.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", frost, { passive: true });
frost();

const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("seen");
      seen.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -10% 0px" },
);
document.querySelectorAll(".observe").forEach((el) => seen.observe(el));

const dialog = document.getElementById("waitlist");
const emailInput = dialog?.querySelector("[data-email]");
const formPanel = dialog?.querySelector('[data-panel="form"]');
const donePanel = dialog?.querySelector('[data-panel="done"]');
const errorEl = dialog?.querySelector("[data-error]");
const submitBtn = dialog?.querySelector("[data-submit]");
const platformLabel = dialog?.querySelector("[data-platform-label]");
const platformLead = dialog?.querySelector("[data-platform-lead]");
const doneTitle = dialog?.querySelector("[data-done-title]");
const doneLead = dialog?.querySelector("[data-done-lead]");
const testflight = dialog?.querySelector("[data-testflight]");
const platformButtons = dialog?.querySelectorAll("[data-set-platform]");

let platform = "iOS";
let submitting = false;

function copyFor(p) {
  if (p === "iOS") {
    return {
      kicker: "iOS beta",
      lead: "Leave your email to get the TestFlight invite.",
      submit: "Join iOS beta",
      doneTitle: "You're in.",
      doneLead: "Open TestFlight to install Sapphire.",
      showTestFlight: true,
    };
  }
  return {
    kicker: "Android waitlist",
    lead: "Android isn't out yet. We'll email you when it is.",
    submit: "Join Android waitlist",
    doneTitle: "You're on the list.",
    doneLead: "We'll email you when Android is ready.",
    showTestFlight: false,
  };
}

function setPlatform(next) {
  platform = next === "Android" ? "Android" : "iOS";
  const copy = copyFor(platform);
  platformLabel.textContent = copy.kicker;
  platformLead.textContent = copy.lead;
  submitBtn.textContent = copy.submit;
  platformButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.setPlatform === platform);
  });
}

function showForm() {
  formPanel.hidden = false;
  donePanel.hidden = true;
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (emailInput) emailInput.value = "";
  submitting = false;
  submitBtn.disabled = false;
  const copy = copyFor(platform);
  submitBtn.textContent = copy.submit;
}

function showDone() {
  const copy = copyFor(platform);
  formPanel.hidden = true;
  donePanel.hidden = false;
  doneTitle.textContent = copy.doneTitle;
  doneLead.textContent = copy.doneLead;
  testflight.hidden = !copy.showTestFlight;
  if (copy.showTestFlight) testflight.href = TESTFLIGHT;
}

function openWaitlist(initial = "iOS") {
  setPlatform(initial);
  showForm();
  dialog.showModal();
  queueMicrotask(() => emailInput?.focus());
}

document.querySelectorAll("[data-waitlist-open]").forEach((btn) => {
  btn.addEventListener("click", () => openWaitlist(btn.dataset.platform || "iOS"));
});

platformButtons.forEach((btn) => {
  btn.addEventListener("click", () => setPlatform(btn.dataset.setPlatform));
});

dialog?.addEventListener("close", () => {
  showForm();
});

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

async function joinWaitlist() {
  if (submitting) return;
  const email = String(emailInput?.value || "").trim();
  if (!email || !email.includes("@")) {
    errorEl.hidden = false;
    errorEl.textContent = "Please enter a valid email address.";
    emailInput?.focus();
    return;
  }

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";
  errorEl.hidden = true;

  try {
    // local preview: succeed without Notion so the UX can be checked offline
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      await new Promise((r) => setTimeout(r, 450));
      showDone();
      return;
    }

    const response = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, platform }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to join waitlist");
    }
    showDone();
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error instanceof Error ? error.message : "Something went wrong";
    submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = copyFor(platform).submit;
  }
}

submitBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  joinWaitlist();
});

emailInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinWaitlist();
  }
});

// links from other pages can open the waitlist directly: /?join=ios or /?join=android
const join = new URLSearchParams(location.search).get("join");
if (dialog && join) openWaitlist(join.toLowerCase() === "android" ? "Android" : "iOS");

// the statement lights word by word as it scrolls through the middle of the screen
const lit = document.querySelector("[data-lit]");
if (lit) {
  const words = lit.textContent.trim().split(/\s+/);
  lit.textContent = "";
  const spans = words.map((word, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = word;
    lit.append(span, i < words.length - 1 ? " " : "");
    return span;
  });
  if (reduced) {
    spans.forEach((s) => s.classList.add("on"));
  } else {
    let queued = false;
    const paint = () => {
      queued = false;
      const r = lit.getBoundingClientRect();
      // 0 when the block's top reaches 85% of the screen, 1 when its bottom reaches 45%
      const start = innerHeight * 0.85;
      const end = innerHeight * 0.45;
      const t = (start - r.top) / (start - end + r.height);
      const count = Math.round(Math.min(Math.max(t, 0), 1) * spans.length);
      spans.forEach((s, i) => s.classList.toggle("on", i < count));
    };
    addEventListener("scroll", () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(paint);
      }
    }, { passive: true });
    addEventListener("resize", paint);
    paint();
  }
}

// the stone loads after the page has painted. without webgl, the still image stays.
const canvas = document.getElementById("gem");
const hero = document.querySelector(".hero");
const slot = document.querySelector("[data-stone-slot]");
const heroCopy = document.querySelector("[data-hero-copy]");
// ?capture renders the stone alone on a transparent square, to refresh img/stone.png
const capture = new URLSearchParams(location.search).has("capture");
const webgl = (() => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
})();
if (canvas && webgl) {
  if (capture) {
    document.body.replaceChildren(canvas);
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    canvas.style.cssText = "position:fixed;inset:0;width:640px;height:640px;opacity:1";
  }
  const start = () =>
    import("./scene.js")
      .then(({ startScene }) =>
        startScene(canvas, capture ? { capture: true } : { slot, copy: heroCopy }),
      )
      .then(() => canvas.classList.add("live"))
      .catch(() => hero?.classList.add("no-gl"));
  if (capture) start();
  else if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1200 });
  else setTimeout(start, 300);
} else {
  hero?.classList.add("no-gl");
}
