'use strict';
// ===== Configuración: URL de la aplicación web de Apps Script (termina en /exec) =====
const URL_PUBLICADA = 'https://script.google.com/macros/s/AKfycbyOECLbtU6qtFeGH5vVOYUWpx_RJMmxbmiREBZbYpZEXIqM1DIx9YL2iZIB_J5Wxk2o/exec';
// =====================================================================================

const $ = s => document.querySelector(s);
const video = $('#video');
const params = new URLSearchParams(location.search);
const MODO_PRUEBA = !URL_PUBLICADA || params.has('local');
const URL_SCRIPT = (MODO_PRUEBA && params.get('script')) || URL_PUBLICADA;   // ?script= solo en pruebas locales
const LS_CAT = 'tv.catalogo', LS_CLAVE = 'tv.clave', LS_ESTADO = 'tv.estado.', LS_BLOQUEO = 'tv.bloqueo';

const BYTES_POR_PETICION = 3.5 * 1024 * 1024;  // el script entrega como mucho 4 MB por petición
const SEGUNDOS_POR_DELANTE = 60;                // cuánto vídeo se tiene cargado por delante
const SEGUNDOS_POR_DETRAS = 20;                 // lo ya visto que se conserva (el resto se libera)
const GUARDAR_CADA_MS = 20000;                  // cada cuánto se avisa al script de por dónde va
const PULSACION_REINICIAR_MS = 1600;

const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: la app sigue */ } };
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ---------- Clave de acceso ----------
const FORMATO_CLAVE = /^[A-Za-z0-9]{20,128}$/;
// Un enlace con #clave=... la guarda y la quita de la barra de direcciones (el # nunca llega a ningún servidor).
(function claveDesdeEnlace() {
  const m = location.hash.match(/^#clave=([A-Za-z0-9]{20,128})$/);
  if (m) escribir(LS_CLAVE, m[1]);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
})();
const clave = () => { const k = leer(LS_CLAVE, ''); return typeof k === 'string' && FORMATO_CLAVE.test(k) ? k : ''; };

class SinPermiso extends Error {}
async function llamar(a, extra, opciones = {}) {
  const k = clave();
  if (!k) throw new SinPermiso();
  if (!URL_SCRIPT) throw new Error('sin script');
  const r = await fetch(URL_SCRIPT, {
    method: 'POST', cache: 'no-store', credentials: 'omit', keepalive: !!opciones.keepalive, signal: opciones.signal,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // sin preflight: Apps Script no lo admite
    body: JSON.stringify({ k, a, ...extra })
  });
  if (!r.ok) throw new Error('script ' + r.status);
  const t = (await r.text()).trim();
  if (t === 'no') throw new SinPermiso();
  return t;
}
const llamarJSON = async (a, extra, op) => JSON.parse(await llamar(a, extra, op));

function base64ABytes(b64, maximo) {
  if (typeof b64 !== 'string' || b64.length > maximo * 1.4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('datos no válidos');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function mostrarCandado(error) {
  $('#candado').classList.add('visible');
  $('#candado').classList.toggle('error', !!error);
  const campo = $('#campo-clave');
  campo.value = '';
  setTimeout(() => campo.focus(), 50);
}
$('#form-clave').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#campo-clave').value.trim();
  if (!FORMATO_CLAVE.test(v)) { $('#candado').classList.add('error'); return; }
  escribir(LS_CLAVE, v);
  $('#candado').classList.remove('visible', 'error');
  cargarCatalogo();
});

function avisoSinConexion(si) { $('#aviso').classList.toggle('visible', !!si); }
$('#reintentar').addEventListener('click', () => { avisoSinConexion(false); if (canal) sintonizar(true); else cargarCatalogo(); });

// ---------- Catálogo (viene de fuera: se trata como no fiable) ----------
const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const idOk = v => typeof v === 'string' && ID_DRIVE.test(v);
function limpiarCapitulo(c) {
  if (!c || typeof c !== 'object') return null;
  const n = Number(c.n), bytes = Number(c.bytes);
  if (!Number.isInteger(n) || n < 0 || n > 9999 || !idOk(c.video) || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
  return { n, titulo: typeof c.titulo === 'string' ? c.titulo.slice(0, 200) : '', video: c.video, bytes, caratula: idOk(c.caratula) ? c.caratula : null };
}
function limpiarCatalogo(cat) {
  if (!cat || !Array.isArray(cat.series)) return [];
  return cat.series.slice(0, 50).map(s => {
    if (!s || !idOk(s.id) || !Array.isArray(s.capitulos)) return null;
    const vistos = new Set();
    const capitulos = s.capitulos.slice(0, 500).map(limpiarCapitulo)
      .filter(c => c && !vistos.has(c.n) && vistos.add(c.n)).sort((a, b) => a.n - b.n);
    return capitulos.length ? { id: s.id, nombre: typeof s.nombre === 'string' ? s.nombre.slice(0, 100) : '', portada: idOk(s.portada) ? s.portada : null,
      ajuste: s.ajuste === 'entera' ? 'entera' : 'llenar', capitulos } : null;
  }).filter(Boolean);
}

let series = [];
async function cargarCatalogo() {
  const guardado = limpiarCatalogo(leer(LS_CAT, null));
  if (guardado.length) { series = guardado; pintarMenu(); }
  if (!clave()) { mostrarCandado(false); return; }
  try {
    const cat = await llamarJSON('catalogo');
    const limpio = limpiarCatalogo(cat);
    escribir(LS_CAT, { series: limpio });
    series = limpio;
    pintarMenu();
    avisoSinConexion(false);
  } catch (e) {
    if (e instanceof SinPermiso) { escribir(LS_CLAVE, ''); mostrarCandado(true); }
    else if (!series.length) avisoSinConexion(true);
  }
}

// ---------- Imágenes (portadas y carátulas): por lotes a través del script; se quedan en el aparato ----------
const urlsImagen = new Map();      // id -> blob: URL
const esperando = new Map();       // id -> [img]
let cargandoImagenes = false;
const claveCache = id => new URL(`imagen-guardada/${id}`, location.href).href;
const abrirCache = () => ('caches' in window ? caches.open('imagenes').catch(() => null) : Promise.resolve(null));
function ponerImagen(img, id) {
  img.classList.remove('cargada');
  img.removeAttribute('src');
  if (!id) return;
  img.addEventListener('load', () => img.classList.add('cargada'), { once: true });
  if (urlsImagen.has(id)) { img.src = urlsImagen.get(id); return; }
  if (!esperando.has(id)) esperando.set(id, []);
  esperando.get(id).push(img);
  cargarImagenesPendientes();
}
function entregarImagen(id, blob) {
  const url = URL.createObjectURL(blob);
  urlsImagen.set(id, url);
  (esperando.get(id) || []).forEach(img => { img.src = url; });
  esperando.delete(id);
}
async function cargarImagenesPendientes() {
  if (cargandoImagenes) return;
  cargandoImagenes = true;
  try {
    const cache = await abrirCache();
    for (const id of [...esperando.keys()]) {
      const r = cache && await cache.match(claveCache(id)).catch(() => null);
      if (r) entregarImagen(id, await r.blob());
    }
    while (esperando.size) {
      const lote = [...esperando.keys()].slice(0, 8);
      const datos = await llamarJSON('caratulas', { ids: lote });
      for (const id of lote) {
        const d = datos && Object.prototype.hasOwnProperty.call(datos, id) ? datos[id] : null;
        if (!d || !/^image\/(jpeg|png|webp)$/.test(d.t)) { esperando.delete(id); continue; }
        const blob = new Blob([base64ABytes(d.b, 2 * 1024 * 1024)], { type: d.t });
        if (cache) cache.put(claveCache(id), new Response(blob, { headers: { 'Content-Type': d.t } })).catch(() => {});
        entregarImagen(id, blob);
      }
    }
  } catch (e) {
    if (e instanceof SinPermiso) mostrarCandado(true);
  } finally { cargandoImagenes = false; }
}

// ---------- Menú ----------
function crearTele() { return $('#plantilla-tele').content.firstElementChild.cloneNode(true); }
function pintarMenu() {
  const ul = $('#canales');
  ul.replaceChildren();
  series.forEach(s => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'canal-boton';
    b.setAttribute('aria-label', s.nombre || 'Canal');
    const tele = crearTele();
    ponerImagen(tele.querySelector('.portada'), s.portada);
    b.append(tele);
    b.addEventListener('click', () => entrarEnCanal(s));
    li.append(b);
    ul.append(li);
  });
}

// ---------- Nieve de la tele (mientras sintoniza o falla la señal) ----------
const nieve = $('#nieve'), ctxNieve = nieve.getContext('2d');
const imgNieve = ctxNieve.createImageData(nieve.width, nieve.height);
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
let nieveActiva = false, ultimoCuadro = 0;
function pintarNieve(ahora) {
  if (!nieveActiva) return;
  if (ahora - ultimoCuadro > 40) {
    ultimoCuadro = ahora;
    const d = imgNieve.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctxNieve.putImageData(imgNieve, 0, 0);
  }
  if (!sinMovimiento.matches) requestAnimationFrame(pintarNieve);
}
function mostrarNieve(modo) {   // modo: false | 'fuerte' | 'suave'
  nieve.classList.toggle('visible', modo === 'fuerte');
  nieve.classList.toggle('suave', modo === 'suave');
  if (modo && !nieveActiva) { nieveActiva = true; requestAnimationFrame(pintarNieve); }
  if (!modo) nieveActiva = false;
}

// ---------- Lectura del MP4 fragmentado (cabecera, índice de fragmentos) ----------
function leerCajas(b, desde, hasta, alEncontrar) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = desde;
  while (i + 8 <= hasta) {
    let tam = dv.getUint32(i), cab = 8;
    const tipo = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (tam === 1) { if (i + 16 > hasta) return i; tam = Number(dv.getBigUint64(i + 8)); cab = 16; }
    if (tam < cab) throw new Error('mp4 no válido');
    if (alEncontrar(tipo, i, tam, cab) === false) return i;
    i += tam;
  }
  return i;
}
function leerSidx(b, i, cab) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = i + cab;
  const version = b[p]; p += 4;
  p += 4;                                   // reference_ID
  const escala = dv.getUint32(p); p += 4;
  let inicio, desplaz;
  if (version === 0) { inicio = dv.getUint32(p); desplaz = dv.getUint32(p + 4); p += 8; }
  else { inicio = Number(dv.getBigUint64(p)); desplaz = Number(dv.getBigUint64(p + 8)); p += 16; }
  p += 2;
  const n = dv.getUint16(p); p += 2;
  return { escala, inicio, desplaz, n, p };
}
const cabeceras = new Map();   // id de vídeo -> { tipo, init, frags }
async function leerCabecera(cap, signal) {
  if (cabeceras.has(cap.video)) return cabeceras.get(cap.video);
  let tam = Math.min(65536, cap.bytes), b;
  for (;;) {
    b = await pedirBytes(cap, 0, tam - 1, signal);
    let moovFin = 0, sidx = null, completa = false;
    leerCajas(b, 0, b.length, (tipo, i, t, cab) => {
      if (i + t > b.length && tipo !== 'mdat' && tipo !== 'moof') return false;   // falta por leer
      if (tipo === 'moov') moovFin = i + t;
      if (tipo === 'sidx' && !sidx) sidx = { i, t, cab };
      if (tipo === 'moof') { completa = true; return false; }
    });
    if (completa && moovFin && sidx) {
      const s = leerSidx(b, sidx.i, sidx.cab);
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const frags = [];
      let off = sidx.i + sidx.t + s.desplaz, t = s.inicio, p = s.p;
      for (let k = 0; k < s.n; k++, p += 12) {
        const tamF = dv.getUint32(p) & 0x7fffffff, dur = dv.getUint32(p + 4);
        frags.push({ t0: t / s.escala, t1: (t + dur) / s.escala, d: off, h: off + tamF - 1 });
        off += tamF; t += dur;
      }
      const init = b.slice(0, moovFin);
      const pos = buscarBytes(init, 'avcC');
      if (pos < 0 || !frags.length || frags[frags.length - 1].h >= cap.bytes) throw new Error('mp4 no válido');
      const hex = x => x.toString(16).padStart(2, '0');
      const tipo = `video/mp4; codecs="avc1.${hex(init[pos + 5])}${hex(init[pos + 6])}${hex(init[pos + 7])}, mp4a.40.2"`;
      const res = { tipo, init, frags };
      cabeceras.set(cap.video, res);
      return res;
    }
    if (tam >= cap.bytes || tam >= 1024 * 1024) throw new Error('mp4 no fragmentado');
    tam = Math.min(tam * 4, cap.bytes, 1024 * 1024);
  }
}
function buscarBytes(b, texto) {
  const c = [...texto].map(x => x.charCodeAt(0));
  outer: for (let i = 0; i + c.length <= b.length; i++) { for (let j = 0; j < c.length; j++) if (b[i + j] !== c[j]) continue outer; return i; }
  return -1;
}
async function pedirBytes(cap, d, h, signal) {
  for (let intento = 0; ; intento++) {
    try {
      const b = base64ABytes(await llamar('trozo', { v: cap.video, d, h }, { signal }), 4 * 1024 * 1024);
      if (b.length !== h - d + 1) throw new Error('trozo incompleto');
      avisoSinConexion(false);
      return b;
    } catch (e) {
      if (e instanceof SinPermiso || (signal && signal.aborted)) throw e;
      if (intento >= 2) avisoSinConexion(true);
      await esperar(Math.min(1000 * 2 ** intento, 15000));
      if (signal && signal.aborted) throw new DOMException('cancelado', 'AbortError');
    }
  }
}

// ---------- Emisión: el capítulo llega a trozos y se va metiendo en el vídeo ----------
const MS = window.ManagedMediaSource || window.MediaSource;
let emision = null;   // { cap, ms, sb, cab, sig, control, url, terminada }

function pararEmision() {
  if (!emision) return;
  const e = emision;
  emision = null;
  e.control.abort();
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(e.url);
}
const unaVez = (obj, ev) => new Promise(r => obj.addEventListener(ev, r, { once: true }));
function anadir(e, bytes) {
  return new Promise((ok, mal) => {
    const fin = () => { e.sb.removeEventListener('error', err); ok(); };
    const err = () => { e.sb.removeEventListener('updateend', fin); mal(new Error('appendBuffer')); };
    e.sb.addEventListener('updateend', fin, { once: true });
    e.sb.addEventListener('error', err, { once: true });
    try { e.sb.appendBuffer(bytes); } catch (x) { e.sb.removeEventListener('updateend', fin); e.sb.removeEventListener('error', err); mal(x); }
  });
}
function quitar(e, desde, hasta) {
  if (hasta - desde < 1 || e.sb.updating) return Promise.resolve();
  return new Promise(ok => { e.sb.addEventListener('updateend', ok, { once: true }); try { e.sb.remove(desde, hasta); } catch { ok(); } });
}
function finCargado(t) {
  const b = video.buffered;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
  return t;
}
async function meterSiguienteTrozo(e) {
  const fr = e.cab.frags;
  const primero = e.sig;
  let ultimo = primero;
  while (ultimo + 1 < fr.length && fr[ultimo + 1].h - fr[primero].d + 1 <= BYTES_POR_PETICION) ultimo++;
  const d = fr[primero].d, h = fr[ultimo].h;
  let bytes;
  if (h - d + 1 <= BYTES_POR_PETICION) bytes = await pedirBytes(e.cap, d, h, e.control.signal);
  else {   // un fragmento enorme: se pide en varias partes
    bytes = new Uint8Array(h - d + 1);
    for (let p = d; p <= h; p += BYTES_POR_PETICION) {
      const q = Math.min(h, p + BYTES_POR_PETICION - 1);
      bytes.set(await pedirBytes(e.cap, p, q, e.control.signal), p - d);
    }
  }
  if (emision !== e) return;
  for (let intento = 0; ; intento++) {
    try { await anadir(e, bytes); break; }
    catch (x) {
      if (x && x.name === 'QuotaExceededError' && intento < 3) { await quitar(e, 0, Math.max(0, video.currentTime - 5)); continue; }
      throw x;
    }
  }
  e.sig = ultimo + 1;
}
async function bucleDeCarga(e) {
  try {
    while (emision === e) {
      if (e.sig >= e.cab.frags.length) {
        if (!e.sb.updating && e.ms.readyState === 'open') e.ms.endOfStream();
        return;
      }
      const ahora = video.currentTime;
      if (ahora - SEGUNDOS_POR_DETRAS > 1 && video.buffered.length && video.buffered.start(0) < ahora - SEGUNDOS_POR_DETRAS - 10) {
        await quitar(e, 0, ahora - SEGUNDOS_POR_DETRAS);
      }
      if (finCargado(ahora) - ahora < SEGUNDOS_POR_DELANTE) await meterSiguienteTrozo(e);
      else await esperar(1000);
    }
  } catch (x) {
    if (emision !== e || x.name === 'AbortError') return;
    if (x instanceof SinPermiso) { mostrarCandado(true); return; }
    console.error(x);
    avisoSinConexion(true);
  }
}

async function emitir(cap, t, enGesto) {
  pararEmision();
  const e = { cap, sig: 0, control: new AbortController() };
  emision = e;
  e.ms = new MS();
  e.url = URL.createObjectURL(e.ms);
  video.disableRemotePlayback = true;    // lo pide ManagedMediaSource (iPhone/iPad)
  video.src = e.url;
  if (enGesto) video.play().catch(() => {});   // dentro del toque, para que el navegador deje reproducir con sonido
  if (e.ms.readyState !== 'open') await unaVez(e.ms, 'sourceopen');
  if (emision !== e) return;
  e.cab = await leerCabecera(cap, e.control.signal);
  if (emision !== e) return;
  if (!MS.isTypeSupported(e.cab.tipo)) throw new Error('este aparato no puede reproducir ' + e.cab.tipo);
  e.sb = e.ms.addSourceBuffer(e.cab.tipo);
  e.ms.duration = e.cab.frags[e.cab.frags.length - 1].t1;
  await anadir(e, e.cab.init);
  t = Math.max(0, Math.min(t, e.ms.duration - 1));
  e.sig = Math.max(0, e.cab.frags.findIndex(f => f.t1 > t));
  await meterSiguienteTrozo(e);
  if (emision !== e) return;
  video.currentTime = t;
  e.listo = true;
  bucleDeCarga(e);
}

// ---------- Canal ----------
let canal = null;            // { serie, cap, t }
const estadoLocal = id => { const v = leer(LS_ESTADO + id, null); return v && typeof v === 'object' ? v : {}; };
function capituloDe(serie, n) { return serie.capitulos.find(c => c.n === n) || null; }

async function posicionGuardada(serie) {
  const local = estadoLocal(serie.id);
  let mejor = local;
  try {
    const remoto = await Promise.race([llamarJSON('estado', { s: serie.id }), esperar(4000).then(() => null)]);
    if (remoto && remoto.b === true) bloquear(false);   // otro aparato acabó un capítulo: también aquí hace falta el PIN
    if (remoto && Number.isInteger(remoto.n) && (!local.ts || (Number(remoto.ts) || 0) >= local.ts)) mejor = remoto;
  } catch (e) { if (e instanceof SinPermiso) throw e; }
  const cap = capituloDe(serie, Number(mejor.n)) || serie.capitulos[0];
  const t = cap.n === Number(mejor.n) && typeof mejor.t === 'number' && isFinite(mejor.t) ? Math.max(0, mejor.t) : 0;
  return { cap, t };
}

let ultimoEnvio = 0;
function guardarPosicion(alScript) {
  if (!canal || !canal.cap) return;
  const t = emision && emision.listo && emision.cap === canal.cap ? video.currentTime : (canal.t || 0);
  escribir(LS_ESTADO + canal.serie.id, { n: canal.cap.n, t, ts: Date.now() });
  if (alScript) {
    ultimoEnvio = Date.now();
    llamar('guardar', { s: canal.serie.id, n: canal.cap.n, t }, { keepalive: true }).catch(() => {});
  }
}
video.addEventListener('timeupdate', () => {
  if (!canal || video.paused) return;
  canal.t = video.currentTime;
  guardarPosicion(Date.now() - ultimoEnvio > GUARDAR_CADA_MS);
});

function ponerPausa(si) { $('#canal').classList.toggle('en-pausa', si); }
video.addEventListener('playing', () => { ponerPausa(false); mostrarNieve(false); pedirPantallaEncendida(); clearTimeout(senalTimer); });
video.addEventListener('pause', soltarPantallaEncendida);
let senalTimer = 0;
video.addEventListener('waiting', () => { clearTimeout(senalTimer); senalTimer = setTimeout(() => { if (canal && !video.paused) mostrarNieve('suave'); }, 1500); });
video.addEventListener('ended', () => { if (canal) aContinuacion(); });

async function entrarEnCanal(serie) {
  canal = { serie, cap: null, t: 0 };
  video.classList.toggle('entera', serie.ajuste === 'entera');   // imagen más ancha que 4:3: se ve entera
  $('#menu').hidden = true;
  $('#canal').hidden = false;
  ponerPausa(false);
  $('#siguiente').classList.remove('visible');
  ocultarPin();
  mostrarNieve('fuerte');
  // el toque que abre el canal sirve de permiso para reproducir con sonido
  video.muted = false;
  video.play().catch(() => {});
  try {
    const { cap, t } = await posicionGuardada(serie);
    if (canal?.serie !== serie) return;
    canal.cap = cap; canal.t = t;
    ponerImagen($('#siguiente'), cap.caratula);
    if (bloqueado()) { mostrarCaratula(); mostrarPin(); return; }
    await sintonizar(false);
  } catch (e) {
    if (e instanceof SinPermiso) mostrarCandado(true); else { console.error(e); avisoSinConexion(true); }
  }
}

async function sintonizar(enGesto) {
  if (!canal || !canal.cap) return;
  if (bloqueado()) { mostrarCaratula(); mostrarPin(); return; }
  const c = canal;
  mostrarNieve('fuerte');
  try {
    await emitir(c.cap, c.t, enGesto);
    if (canal !== c) return;
    $('#siguiente').classList.remove('visible');
    try { await video.play(); }
    catch { ponerPausa(true); mostrarNieve(false); }   // el navegador pide un toque: sale el botón de ver
  } catch (e) {
    if (canal !== c || e.name === 'AbortError') return;
    if (e instanceof SinPermiso) mostrarCandado(true); else { console.error(e); avisoSinConexion(true); }
  }
}

// Fin del capítulo: se prepara el siguiente y la tele queda bloqueada hasta que se meta un PIN.
function aContinuacion() {
  const c = canal;
  const caps = c.serie.capitulos;
  const sig = caps[(caps.indexOf(c.cap) + 1) % caps.length];
  c.cap = sig; c.t = 0;
  guardarPosicion(true);
  bloquear(true);
  pararEmision();
  ponerPausa(false);
  ponerImagen($('#siguiente'), sig.caratula);
  mostrarCaratula();
  mostrarPin();
}
function mostrarCaratula() {
  $('#siguiente').classList.add('visible');
  mostrarNieve(canal && canal.cap && canal.cap.caratula ? false : 'fuerte');
}

// ---------- PIN entre capítulos (vale para todos los canales; lo comprueba el script) ----------
const bloqueado = () => leer(LS_BLOQUEO, false) === true;
function bloquear(avisarAlScript) {
  escribir(LS_BLOQUEO, true);
  if (avisarAlScript) llamar('bloquear', {}, { keepalive: true }).catch(() => {});
}
const LONGITUD_PIN = 8;
let pinTecleado = '', comprobandoPin = false;
function pintarPin() {
  $('#pin-puntos').querySelectorAll('span').forEach((p, i) => p.classList.toggle('lleno', i < pinTecleado.length));
}
function mostrarPin() {
  pinTecleado = '';
  pintarPin();
  $('#pin').classList.remove('mal', 'espera');
  $('#pin').hidden = false;
  ponerPausa(true);
}
function ocultarPin() { $('#pin').hidden = true; pinTecleado = ''; }
async function teclaPin(t) {
  if (comprobandoPin || $('#pin').hidden) return;
  $('#pin').classList.remove('mal');
  if (t === 'borrar') pinTecleado = pinTecleado.slice(0, -1);
  else if (/^\d$/.test(t) && pinTecleado.length < LONGITUD_PIN) pinTecleado += t;
  pintarPin();
  if (pinTecleado.length < LONGITUD_PIN) return;
  comprobandoPin = true;
  $('#pin').classList.add('comprobando');
  try {
    const r = await llamar('pin', { p: pinTecleado });
    if (r === 'ok') {
      escribir(LS_BLOQUEO, false);
      ocultarPin();
      if (canal && canal.cap) sintonizar(true);
    } else {
      $('#pin').classList.add(r === 'espera' ? 'espera' : 'mal');
      pinTecleado = '';
      pintarPin();
    }
  } catch (e) {
    if (e instanceof SinPermiso) mostrarCandado(true); else avisoSinConexion(true);
    pinTecleado = '';
    pintarPin();
  } finally {
    comprobandoPin = false;
    $('#pin').classList.remove('comprobando');
  }
}
$('#pin-teclas').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) teclaPin(b.dataset.t); });
document.addEventListener('keydown', e => {
  if ($('#pin').hidden) return;
  if (/^\d$/.test(e.key)) teclaPin(e.key);
  else if (e.key === 'Backspace') teclaPin('borrar');
});

function salirDelCanal() {
  if (!canal) return;
  guardarPosicion(true);
  canal = null;
  ocultarPin();
  pararEmision();
  mostrarNieve(false);
  soltarPantallaEncendida();
  $('#canal').hidden = true;
  $('#menu').hidden = false;
}

function alternarPausa() {
  if (!canal || !canal.cap) return;
  if (bloqueado()) { mostrarPin(); return; }
  if (!emision) { sintonizar(true); return; }    // estaba en "a continuación" o sin conexión
  if (video.paused) { ponerPausa(false); video.play().catch(() => ponerPausa(true)); }
  else { video.pause(); ponerPausa(true); guardarPosicion(true); }
}
$('#play').addEventListener('click', alternarPausa);
$('#pantalla').addEventListener('click', alternarPausa);   // tocar la pantalla (o el botón de ver que sale encima) también pausa/sigue
$('#casa').addEventListener('click', salirDelCanal);

// Volver a empezar el capítulo: hay que mantener pulsado (así no se reinicia sin querer).
(function botonReiniciar() {
  const b = $('#reiniciar');
  let timer = 0;
  const empezar = ev => {
    if (ev.type === 'keydown' && (ev.repeat || (ev.key !== 'Enter' && ev.key !== ' '))) return;
    ev.preventDefault();
    clearTimeout(timer);
    b.classList.add('cargando', 'pulsado');
    timer = setTimeout(() => {
      b.classList.remove('cargando', 'pulsado');
      if (!canal || !canal.cap || bloqueado()) return;
      canal.t = 0;
      guardarPosicion(true);
      sintonizar(true);
    }, PULSACION_REINICIAR_MS);
  };
  const soltar = () => { clearTimeout(timer); b.classList.remove('cargando', 'pulsado'); };
  b.addEventListener('pointerdown', empezar);
  b.addEventListener('keydown', empezar);
  ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach(ev => b.addEventListener(ev, soltar));
  b.addEventListener('contextmenu', ev => ev.preventDefault());
})();

// Si la app se va a segundo plano, se pausa y se guarda por dónde iba.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && canal) { if (!video.paused) { video.pause(); ponerPausa(true); } guardarPosicion(true); }
});
window.addEventListener('pagehide', () => guardarPosicion(true));

// Que la pantalla no se apague mientras se ve la tele.
let bloqueoPantalla = null;
async function pedirPantallaEncendida() {
  if (window.TeleTV) { try { window.TeleTV.pantallaEncendida(true); } catch { /* app de la tele */ } }
  try { if ('wakeLock' in navigator && !bloqueoPantalla) { bloqueoPantalla = await navigator.wakeLock.request('screen'); bloqueoPantalla.addEventListener('release', () => { bloqueoPantalla = null; }); } } catch { /* no disponible */ }
}
function soltarPantallaEncendida() {
  if (window.TeleTV) { try { window.TeleTV.pantallaEncendida(false); } catch { /* app de la tele */ } }
  if (bloqueoPantalla) bloqueoPantalla.release().catch(() => {});
  bloqueoPantalla = null;
}

// ---------- Mando de la tele (flechas, OK, Atrás, play/pausa) ----------
const MODO_TV = params.has('tv');
if (MODO_TV) document.documentElement.classList.add('modo-tv');
function visible(el) {
  if (!el || el.disabled) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}
function botonesActivos() {
  let raiz;
  if ($('#candado').classList.contains('visible')) raiz = $('#candado');
  else if (!$('#canal').hidden) raiz = $('#canal');
  else raiz = $('#menu');
  const pinVisible = !$('#pin').hidden;
  return [...raiz.querySelectorAll('button, input')]
    .filter(el => visible(el) && !(pinVisible && el.id === 'tocar-play'));   // con el PIN delante, el botón de ver queda tapado
}
// Mueve el foco al botón más cercano en la dirección de la flecha.
function moverFoco(dir) {
  const lista = botonesActivos();
  if (!lista.length) return;
  const actual = document.activeElement;
  if (!lista.includes(actual)) { enfocarPrincipal(); return; }
  const a = actual.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let mejor = null, mejorPeso = Infinity;
  for (const el of lista) {
    if (el === actual) continue;
    const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
    const principal = { ArrowRight: dx, ArrowLeft: -dx, ArrowDown: dy, ArrowUp: -dy }[dir];
    const lateral = (dir === 'ArrowRight' || dir === 'ArrowLeft') ? Math.abs(dy) : Math.abs(dx);
    if (principal <= 4) continue;
    const peso = principal + lateral * 2;
    if (peso < mejorPeso) { mejorPeso = peso; mejor = el; }
  }
  if (mejor) mejor.focus();
}
function enfocarPrincipal() {
  if ($('#candado').classList.contains('visible')) { $('#campo-clave').focus(); return; }
  if (!$('#canal').hidden) {
    if (!$('#pin').hidden) { const b = $('#pin-teclas button'); if (b) b.focus(); return; }
    $('#play').focus();
    return;
  }
  const b = $('.canal-boton');
  if (b) b.focus();
}
document.addEventListener('keydown', e => {
  if (e.key.startsWith('Arrow')) {
    if (e.target && e.target.tagName === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault();
    moverFoco(e.key);
  } else if ((e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') && canal) {
    e.preventDefault();
    if ((e.key === 'MediaPlay' && !video.paused) || (e.key === 'MediaPause' && video.paused)) return;
    alternarPausa();
  }
});
// Botón Atrás del mando: dentro de un canal vuelve al menú; en el menú sale de la app.
window.atrasTV = () => {
  if (canal) { salirDelCanal(); setTimeout(enfocarPrincipal, 50); return true; }
  return false;
};
if (MODO_TV) {
  // Al cambiar de pantalla, el foco va al botón principal para poder seguir con el mando.
  new MutationObserver(() => setTimeout(() => { if (!botonesActivos().includes(document.activeElement)) enfocarPrincipal(); }, 30))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  setTimeout(enfocarPrincipal, 300);
}

// ---------- Arranque ----------
if ('serviceWorker' in navigator && !MODO_PRUEBA) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!MS) { avisoSinConexion(true); console.error('Este navegador no admite MediaSource'); }
cargarCatalogo();
