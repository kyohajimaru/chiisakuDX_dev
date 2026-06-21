const menuButton = document.querySelector('.menu-button');
const globalNav = document.querySelector('.global-nav');

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.classList.toggle('active', !isOpen);
  globalNav.classList.toggle('open', !isOpen);
});

globalNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.classList.remove('active');
    globalNav.classList.remove('open');
  });
});
