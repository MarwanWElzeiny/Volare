const menuToggle = document.getElementById("menu-toggle");
const menuClose = document.getElementById("menu-close");
const mobileMenu = document.getElementById("mobile-menu");
menuToggle.addEventListener("click", () => {
  mobileMenu.classList.add("active");
});
menuClose.addEventListener("click", () => {
  mobileMenu.classList.remove("active");
});
mobileMenu.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("active");
  });
});