const toggle = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = document.querySelectorAll(".mobile-menu a");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setMenu(open) {
  if (!toggle || !mobileMenu) return;
  toggle.setAttribute("aria-expanded", String(open));
  mobileMenu.classList.toggle("open", open);
  document.body.style.overflow = open ? "hidden" : "";
}

if (toggle && mobileMenu) {
  toggle.addEventListener("click", () => {
    setMenu(toggle.getAttribute("aria-expanded") !== "true");
  });

  mobileLinks.forEach((link) => link.addEventListener("click", () => setMenu(false)));

  const desktopQuery = window.matchMedia("(min-width: 761px)");
  const closeMenuOnDesktop = () => {
    if (desktopQuery.matches) setMenu(false);
  };

  if (desktopQuery.addEventListener) {
    desktopQuery.addEventListener("change", closeMenuOnDesktop);
  } else {
    desktopQuery.addListener(closeMenuOnDesktop);
  }
}

const revealGroups = [
  [
    ".section-heading, .strategy-top, .investor-heading, .academy-copy, .portal-copy, .lead-copy, .contact-details, .final-cta-inner, .request-grid, .exclusive-cta-inner",
    "",
  ],
  [
    ".principle-card, .strategy-card, .tool-card, .insight, .founder-card, .portal-console, .premium-form, .kyc-panel, .academy-visual, .strategy-principle-card, .process-card, .investor-free-card, .documents-card, .resource-card, .document-card, .premium-academy-panel",
    "",
  ],
  [".investor-copy", "reveal-left"],
  [".portal-preview", "reveal-right"],
];

revealGroups.forEach(([selector, direction]) => {
  document.querySelectorAll(selector).forEach((element, index) => {
    element.classList.add("reveal");
    if (direction) element.classList.add(direction);
    if (!reduceMotion) {
      element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    }
  });
});

const revealElements = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -60px" },
  );

  revealElements.forEach((element) => revealObserver.observe(element));
}

document.querySelectorAll("[data-static-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = form.querySelector(".form-status");
    if (status) {
      status.textContent =
        "Formulario validado. La conexión de envío se habilitará cuando se configure el backend.";
    }
  });
});
