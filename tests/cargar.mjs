// Carga los datos y el motor de index.html en un contexto aislado, sin navegador.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

export function datos() {
  const m = /<script type="application\/json" id="datos">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m[1]);
}
export function motor(D = datos()) {
  const m = /<script id="motor">([\s\S]*?)<\/script>/.exec(html);
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  return ctx.RecetarioMotor.crear(D);
}
export function semilla() {
  const m = /var SEMILLA = (\{[\s\S]*?\n\});/.exec(html);
  return Function('return ' + m[1])();
}
export function salud(D = datos()) {
  const m = /<script id="salud">([\s\S]*?)<\/script>/.exec(html);
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  return { SA: ctx.RecetarioSalud.crear(D), mod: ctx.RecetarioSalud };
}
export function chat(D = datos()) {
  const db = JSON.parse(/<script type="application\/json" id="chat">([\s\S]*?)<\/script>/.exec(html)[1]);
  const m = /<script id="chat-motor">([\s\S]*?)<\/script>/.exec(html);
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  return { CH: ctx.RecetarioChat.crear(D, db), db };
}
