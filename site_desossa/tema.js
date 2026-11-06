// Preferência visual local, compartilhada pelas páginas do aplicativo.
(() => {
  const chave = 'desossa-test-theme';
  const raiz = document.documentElement;
  const sistema = window.matchMedia('(prefers-color-scheme: dark)');
  let preferencia;
  function lerPreferencia() {
    try {
      const valor = localStorage.getItem(chave);
      return ['light', 'dark'].includes(valor) ? valor : null;
    } catch { return null; }
  }
  function aplicar() {
    const escuro = (preferencia || (sistema.matches ? 'dark' : 'light')) === 'dark';
    raiz.dataset.theme = escuro ? 'dark' : 'light';
    raiz.style.colorScheme = escuro ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#151c19' : '#f4f5f3');
    document.querySelectorAll('[data-theme-toggle]').forEach(botao => {
      botao.textContent = escuro ? 'Modo claro' : 'Modo escuro';
      botao.setAttribute('aria-pressed', String(escuro));
      botao.setAttribute('aria-label', escuro ? 'Ativar modo claro' : 'Ativar modo escuro');
    });
  }
  preferencia = lerPreferencia();
  aplicar(); // Executado antes do CSS para evitar piscar com o tema incorreto.
  document.addEventListener('DOMContentLoaded', () => {
    aplicar();
    const barra = document.getElementById('app-chrome');
    if (barra) {
      const ajustar = () => raiz.style.setProperty('--app-chrome-height', `${barra.getBoundingClientRect().height}px`);
      ajustar();
      new ResizeObserver(ajustar).observe(barra);
    }
  });
  document.addEventListener('click', evento => {
    const botao = evento.target.closest('[data-theme-toggle]');
    if (!botao || botao.disabled) return;
    preferencia = raiz.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(chave, preferencia); } catch { /* O tema continua funcionando nesta aba. */ }
    aplicar();
  });
  sistema.addEventListener('change', () => { if (!preferencia) aplicar(); });
  window.addEventListener('storage', evento => {
    if (evento.key === chave || evento.key === null) {
      preferencia = lerPreferencia();
      aplicar();
    }
  });
})();
