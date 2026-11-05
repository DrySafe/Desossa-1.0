const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const config = {
  SUPABASE_URL: process.env.DESOSSA_TEST_SUPABASE_URL || 'https://dkiyakjftqcbbnfrgnmh.supabase.co',
  SUPABASE_ANON_KEY: process.env.DESOSSA_TEST_SUPABASE_PUBLIC_KEY || ''
};
const context = { window: { DESOSSA_TEST_CONFIG: config }, URL, atob };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'site_desossa/config.js'), 'utf8'), context);
vm.runInContext('validarConfiguracaoTeste()', context);

const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const name of fs.readdirSync(output)) fs.rmSync(path.join(output, name), { recursive: true, force: true });
for (const name of fs.readdirSync(path.join(root, 'site_desossa'))) {
  if (/\.(html|css|js|json|png|svg|ico)$/.test(name) && name !== 'workflow-desossa.json') {
    fs.copyFileSync(path.join(root, 'site_desossa', name), path.join(output, name));
  }
}
fs.writeFileSync(path.join(output, 'runtime-config.js'), 'window.DESOSSA_TEST_CONFIG = ' + JSON.stringify(config).replace(/</g, '\\u003c') + ';\n');
console.log('Build isolado de testes gerado em dist.');

fs.cpSync(path.join(root, 'site_desossa/vendor'), path.join(output, 'vendor'), { recursive: true });
