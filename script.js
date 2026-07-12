const toggle = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = document.querySelectorAll(".mobile-menu a");

function setMenu(open) {
  toggle.setAttribute("aria-expanded", String(open));
  mobileMenu.classList.toggle("open", open);
  if (open) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

toggle.addEventListener("click", () => {
  setMenu(toggle.getAttribute("aria-expanded") !== "true");
});

mobileLinks.forEach((link) => link.addEventListener("click", () => setMenu(false)));

window.addEventListener("resize", () => {
  if (window.innerWidth > 760) setMenu(false);
});

const revealGroups = [
  [".section-heading, .strategy-top, .investor-heading, .academy-copy, .portal-copy, .lead-copy, .contact-details, .final-cta-inner, .request-grid, .exclusive-cta-inner", ""],
  [".principle-card, .strategy-card, .tool-card, .insight, .founder-card, .portal-console, .premium-form, .kyc-panel, .academy-visual, .strategy-principle-card, .process-card, .investor-free-card, .documents-card, .resource-card, .document-card, .premium-academy-panel", ""],
  [".investor-copy", "reveal-left"],
  [".portal-preview", "reveal-right"],
];

revealGroups.forEach(([selector, direction]) => {
  document.querySelectorAll(selector).forEach((element, index) => {
    element.classList.add("reveal");
    if (direction) element.classList.add(direction);
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 90}ms`;
  });
});

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.14, rootMargin: "0px 0px -35px" },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

document.querySelectorAll("[data-static-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = form.querySelector(".form-status");
    status.textContent =
      "Formulario validado. La conexión de envío se habilitará cuando se configure el backend.";
  });
});
