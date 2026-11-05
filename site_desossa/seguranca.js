function sanitizarHTML(html) {
  if (!window.DOMPurify) throw new Error('Sanitizador indisponível; conteúdo bloqueado.');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['iframe','object','embed','script'], FORBID_ATTR: ['srcdoc'] });
}
