# Desossa — ambiente de testes isolado

Versão de homologação com API na Vercel, compatibilidade com registros legados,
conferência de pesos, fila offline preservada e integração n8n separada.

Leia [TESTES-ISOLADOS.md](TESTES-ISOLADOS.md) para configuração, segurança,
provisionamento e recuperação. O banco de produção e o n8n atual não devem ser acessados.

```
npm ci
npm test
npm run test:browser
```

Os testes de navegador exigem Chromium. Os SQLs atuais estão em
`supabase/migrations`; arquivos antigos em `site_desossa` são históricos.
