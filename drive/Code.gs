/**
 * Televisión Retro: script de Google Drive que da a la app las series, las carátulas y los vídeos.
 *
 * En tu Drive tiene que haber una carpeta "TelevisionRetro" con una subcarpeta por serie:
 *   TelevisionRetro/
 *     LasTresMellizas/
 *       serie.jpg          -> la imagen de la serie en el menú (opcional)
 *       Video/             -> "Las Tres Mellizas Cap 01 Pulgarcito.mp4", ...  (los .avi se ignoran)
 *       Caratulas/         -> "01.jpg", "02.jpg", ...  (número del capítulo)
 *
 * Nada se comparte: todo pasa por este script y solo responde a quien tenga la clave.
 * Los vídeos se entregan a trozos (por rangos de bytes) porque Apps Script no puede devolver
 * un fichero de 150 MB de una vez.
 *
 * Pasos: ejecuta instalar() y generarClave() una vez y publícalo como aplicación web
 * (Ejecutar como: Yo; Acceso: Cualquier usuario). Para añadir capítulos o series, súbelos
 * y, si no aparecen en unos minutos, ejecuta actualizar(). Para quitar el acceso a todos los
 * aparatos, ejecuta generarClave() otra vez (habrá que meter la clave nueva en cada uno).
 *
 * PIN entre capítulos: al acabar un capítulo la tele se bloquea (en todos los canales) hasta que se
 * mete uno de los PIN. Aquí solo se guardan sus huellas (SHA-256 con sal). Para cambiarlos: en
 * Configuración del proyecto > Propiedades del script crea PINES_EN_CLARO con los PIN separados por
 * comas y ejecuta cambiarPines(), que guarda las huellas y borra esa propiedad.
 */

const NOMBRE_CARPETA = 'TelevisionRetro';
const MINUTOS_CACHE = 60;
const MAX_SERIES = 50;
const MAX_CAPITULOS = 500;
const MAX_BYTES_TROZO = 4 * 1024 * 1024;       // lo más que se entrega en una petición
const MAX_CARATULAS_POR_PETICION = 25;
const MAX_BYTES_CARATULA = 2 * 1024 * 1024;
const MAX_CUERPO = 4096;
const MAX_FALLOS_PIN = 5;                        // PIN mal seguidos antes de esperar
const MINUTOS_ESPERA_PIN = 5;                         // tamaño máximo de una petición
const URL_APP = 'https://clbrs.github.io/television-retro/';

function instalar() {
  const raiz = buscarCarpeta_(NOMBRE_CARPETA);
  PropertiesService.getScriptProperties().setProperty('RAIZ_ID', raiz.getId());
  CacheService.getScriptCache().remove('catalogo');
  const cat = construirCatalogo_();
  cat.series.forEach(function (s) {
    Logger.log('%s: %s capítulos (%s sin carátula)%s', s.nombre, s.capitulos.length,
      s.capitulos.filter(function (c) { return !c.caratula; }).length, s.portada ? '' : ', sin serie.jpg');
  });
  if (raiz.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    Logger.log('AVISO: la carpeta "%s" está compartida. Ponla en Restringido (Drive > Compartir).', NOMBRE_CARPETA);
  }
}

// Crea una clave nueva (la anterior deja de valer) y la muestra UNA vez en el registro.
function generarClave() {
  const clave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');  // 64 caracteres aleatorios (SecureRandom)
  PropertiesService.getScriptProperties().setProperty('CLAVE', clave);
  Logger.log('Clave nueva: %s', clave);
  Logger.log('Enlace para cada tablet o móvil (ábrelo una vez allí): %s#clave=%s', URL_APP, clave);
}

function actualizar() {
  CacheService.getScriptCache().remove('catalogo');
  const cat = catalogo_();
  Logger.log('Catálogo actualizado: %s series, %s capítulos.', cat.series.length,
    cat.series.reduce(function (n, s) { return n + s.capitulos.length; }, 0));
}

// Prueba completa sin sacar la clave del script: catálogo, un trozo de vídeo y que sin clave no da nada.
function probar() {
  const k = PropertiesService.getScriptProperties().getProperty('CLAVE');
  const pide = function (o) { return doPost({ postData: { contents: JSON.stringify(Object.assign({ k: k }, o)) } }).getContent(); };
  const cat = JSON.parse(pide({ a: 'catalogo' }));
  const s = cat.series[0], c = s.capitulos[0];
  const t = Utilities.base64Decode(pide({ a: 'trozo', v: c.video, d: 0, h: 65535 }));
  const m = Utilities.base64Decode(pide({ a: 'trozo', v: c.video, d: c.bytes - 1000, h: c.bytes - 1 }));
  Logger.log('%s series; %s: %s capítulos; trozo inicial %s bytes (%s), trozo final %s bytes',
    cat.series.length, s.nombre, s.capitulos.length, t.length, Utilities.newBlob(t.slice(4, 8)).getDataAsString(), m.length);
  Logger.log('Guardar: %s; estado: %s', pide({ a: 'guardar', s: s.id, n: c.n, t: 0 }), pide({ a: 'estado', s: s.id }));
  Logger.log('Sin clave: %s; trozo demasiado grande: %s', doPost({ postData: { contents: '{"k":"x","a":"catalogo"}' } }).getContent(),
    pide({ a: 'trozo', v: c.video, d: 0, h: MAX_BYTES_TROZO }));
}

// Por GET no se entrega nada: así la dirección del script, aunque sea pública, no sirve sin la clave.
function doGet() {
  return texto_('no');
}

// La app pide todo por POST con la clave en el cuerpo (nunca en la dirección).
function doPost(e) {
  let pet;
  try {
    if (!e || !e.postData || e.postData.contents.length > MAX_CUERPO) return texto_('no');
    pet = JSON.parse(e.postData.contents);
  } catch (err) { return texto_('no'); }
  if (!pet || typeof pet !== 'object' || !claveValida_(pet.k)) {
    Utilities.sleep(400);  // frena a quien pruebe claves
    return texto_('no');
  }
  try {
    switch (pet.a) {
      case 'catalogo': return json_(catalogoParaApp_());
      case 'caratulas': return caratulas_(pet.ids);
      case 'trozo': return trozo_(pet.v, pet.d, pet.h);
      case 'estado': return json_(estado_(pet.s));
      case 'guardar': return guardar_(pet.s, pet.n, pet.t);
      case 'bloquear': PropertiesService.getScriptProperties().setProperty('BLOQUEO', '1'); return texto_('ok');
      case 'pin': return pin_(pet.p);
    }
  } catch (err) {
    console.error(err);   // el detalle se queda en el registro del script, nunca va a la app
  }
  return texto_('no');
}

function claveValida_(k) {
  return igual_(PropertiesService.getScriptProperties().getProperty('CLAVE'), k);
}

// Compara dos textos en tiempo constante (no da pistas de cuántos caracteres acierta).
function igual_(buena, otra) {
  if (!buena || typeof otra !== 'string' || otra.length !== buena.length) return false;
  let dif = 0;
  for (let i = 0; i < buena.length; i++) dif |= buena.charCodeAt(i) ^ otra.charCodeAt(i);
  return dif === 0;
}

// ---------- PIN entre capítulos ----------

function huella_(sal, pin) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + pin, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function pin_(p) {
  if (typeof p !== 'string' || !/^\d{4,12}$/.test(p)) return texto_('mal');
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('pin_fallos') || 0);
  if (fallos >= MAX_FALLOS_PIN) return texto_('espera');
  const props = PropertiesService.getScriptProperties();
  const sal = props.getProperty('PIN_SAL');
  let huellas = [];
  try { huellas = JSON.parse(props.getProperty('PINES') || '[]'); } catch (err) { huellas = []; }
  if (!sal || !Array.isArray(huellas) || !huellas.length) return texto_('mal');
  const h = huella_(sal, p);
  let ok = false;
  huellas.forEach(function (x) { if (igual_(x, h)) ok = true; });   // se comparan todas, acierte o no
  if (!ok) {
    cache.put('pin_fallos', String(fallos + 1), MINUTOS_ESPERA_PIN * 60);
    Utilities.sleep(500);
    return texto_('mal');
  }
  cache.remove('pin_fallos');
  props.deleteProperty('BLOQUEO');
  return texto_('ok');
}

// Lee los PIN de la propiedad PINES_EN_CLARO, guarda solo sus huellas con una sal nueva y borra los PIN en claro.
function cambiarPines() {
  const props = PropertiesService.getScriptProperties();
  const claro = props.getProperty('PINES_EN_CLARO');
  if (!claro) throw new Error('Crea antes la propiedad PINES_EN_CLARO con los PIN separados por comas.');
  const pines = claro.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^\d{4,12}$/.test(x); });
  props.deleteProperty('PINES_EN_CLARO');
  if (!pines.length) throw new Error('No hay ningún PIN válido (de 4 a 12 cifras).');
  const sal = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperties({ PIN_SAL: sal, PINES: JSON.stringify(pines.map(function (x) { return huella_(sal, x); })) });
  Logger.log('Guardados %s PIN (solo sus huellas). La propiedad PINES_EN_CLARO se ha borrado.', pines.length);
}

// ---------- Catálogo ----------

function catalogo_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('catalogo');
  if (guardado) return JSON.parse(guardado);
  const cat = construirCatalogo_();
  const json = JSON.stringify(cat);
  if (json.length < 100000) cache.put('catalogo', json, MINUTOS_CACHE * 60);
  return cat;
}

// A la app solo le hace falta esto (sin tamaños ni nada más de Drive).
function catalogoParaApp_() {
  return {
    series: catalogo_().series.map(function (s) {
      return {
        id: s.id, nombre: s.nombre, portada: s.portada,
        capitulos: s.capitulos.map(function (c) {
          return { n: c.n, titulo: c.titulo, video: c.video, bytes: c.bytes, caratula: c.caratula };
        })
      };
    })
  };
}

function construirCatalogo_() {
  const raizId = PropertiesService.getScriptProperties().getProperty('RAIZ_ID');
  if (!raizId) throw new Error('Ejecuta primero instalar()');
  const series = [];
  const its = DriveApp.getFolderById(raizId).getFolders();
  while (its.hasNext() && series.length < MAX_SERIES) {
    const carpeta = its.next();
    const s = leerSerie_(carpeta);
    if (s.capitulos.length) series.push(s);
  }
  series.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return { series: series, generado: new Date().toISOString() };
}

function leerSerie_(carpeta) {
  const s = { id: carpeta.getId(), nombre: carpeta.getName().slice(0, 100), portada: null, capitulos: [] };
  const fs = carpeta.getFiles();
  while (fs.hasNext()) {
    const f = fs.next();
    if (/^serie\.(jpe?g|png|webp)$/i.test(f.getName()) && f.getSize() <= MAX_BYTES_CARATULA) { s.portada = f.getId(); break; }
  }
  const caratulas = {};
  const ic = carpeta.getFoldersByName('Caratulas');
  if (ic.hasNext()) {
    const it = ic.next().getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const m = f.getName().match(/^(\d{1,4})\.(jpe?g|png|webp)$/i);
      if (m && f.getSize() <= MAX_BYTES_CARATULA) caratulas[Number(m[1])] = f.getId();
    }
  }
  const iv = carpeta.getFoldersByName('Video');
  if (!iv.hasNext()) return s;
  const vistos = {};
  const it = iv.next().getFiles();
  while (it.hasNext() && s.capitulos.length < MAX_CAPITULOS) {
    const f = it.next();
    const m = numeroYTitulo_(f.getName());
    if (!m) continue;
    const n = Number(m[1]);
    if (vistos[n]) continue;
    vistos[n] = true;
    s.capitulos.push({ n: n, titulo: m[2].trim().slice(0, 200), video: f.getId(), bytes: f.getSize(), caratula: caratulas[n] || null });
  }
  s.capitulos.sort(function (a, b) { return a.n - b.n; });
  return s;
}

// Lo que se puede pedir: solo ficheros que están en el catálogo (es decir, dentro de TelevisionRetro).
function permitidos_() {
  const videos = {}, imagenes = {}, series = {};
  catalogo_().series.forEach(function (s) {
    const ns = {};
    if (s.portada) imagenes[s.portada] = true;
    s.capitulos.forEach(function (c) {
      videos[c.video] = c.bytes;
      ns[c.n] = true;
      if (c.caratula) imagenes[c.caratula] = true;
    });
    series[s.id] = ns;
  });
  return { videos: videos, imagenes: imagenes, series: series };
}

// Saca el número de capítulo y el título del nombre del fichero. Valen estas formas:
//   "Las Tres Mellizas Cap 01 Pulgarcito.mp4"
//   "D'Artacán y los tres mosqueperros - 01 - El viaje de d'Artacán.mp4"
//   "01 - Pulgarcito.mp4"
function numeroYTitulo_(nombre) {
  return nombre.match(/^(?:.*?\bCap(?:[ií]tulo)?\.?\s*)(\d{1,4})\s*[-.]?\s*(.*)\.mp4$/i) ||
         nombre.match(/^.*? - (\d{1,4}) - (.*)\.mp4$/i) ||
         nombre.match(/^(\d{1,4})\s*[-.]?\s*(.*)\.mp4$/i);
}

function idValido_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(id); }

// ---------- Ficheros ----------

function caratulas_(ids) {
  if (!Array.isArray(ids)) return texto_('no');
  const ok = permitidos_().imagenes;
  const out = {};
  ids.slice(0, MAX_CARATULAS_POR_PETICION).forEach(function (id) {
    if (!idValido_(id) || !ok[id]) return;
    try {
      const b = DriveApp.getFileById(id).getBlob();
      const tipo = b.getContentType();
      const bytes = b.getBytes();
      if (/^image\/(jpeg|png|webp)$/.test(tipo) && bytes.length <= MAX_BYTES_CARATULA) {
        out[id] = { t: tipo, b: Utilities.base64Encode(bytes) };
      }
    } catch (err) { /* se salta esa carátula */ }
  });
  return json_(out);
}

// Un trozo del vídeo: bytes d..h (ambos incluidos), pedidos a Drive por rango.
function trozo_(v, d, h) {
  if (!idValido_(v)) return texto_('no');
  const tam = permitidos_().videos[v];
  if (!tam || !Number.isSafeInteger(d) || !Number.isSafeInteger(h)) return texto_('no');
  if (d < 0 || h < d || h >= tam || h - d + 1 > MAX_BYTES_TROZO) return texto_('no');
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(v) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + d + '-' + h },
    muteHttpExceptions: true, followRedirects: true
  });
  const cod = r.getResponseCode();
  let bytes = r.getContent();
  if (cod === 200 && bytes.length === tam) bytes = bytes.slice(d, h + 1);   // por si Drive ignorara el rango
  else if (cod !== 206) { console.error('Drive respondió ' + cod); return texto_('no'); }
  if (bytes.length !== h - d + 1) return texto_('no');
  return texto_(Utilities.base64Encode(bytes));
}

// ---------- Por dónde va cada canal (compartido entre todos los aparatos) ----------

function estado_(serie) {
  const props = PropertiesService.getScriptProperties();
  const b = props.getProperty('BLOQUEO') === '1';     // la tele está esperando un PIN (vale para todos los canales)
  if (!idValido_(serie) || !permitidos_().series[serie]) return { b: b };
  const v = props.getProperty('E_' + serie);
  if (!v) return { b: b };
  try {
    const e = JSON.parse(v);
    return { n: e.n, t: e.t, ts: e.ts, b: b };
  } catch (err) { return { b: b }; }
}

function guardar_(serie, n, t) {
  if (!idValido_(serie)) return texto_('no');
  const caps = permitidos_().series[serie];
  if (!caps || !Number.isInteger(n) || !caps[n]) return texto_('no');
  if (typeof t !== 'number' || !isFinite(t) || t < 0 || t > 6 * 3600) return texto_('no');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return texto_('no');
  try {
    PropertiesService.getScriptProperties().setProperty('E_' + serie,
      JSON.stringify({ n: n, t: Math.round(t * 10) / 10, ts: Date.now() }));
  } finally { lock.releaseLock(); }
  return texto_('ok');
}

// ---------- Utilidades ----------

function buscarCarpeta_(nombre) {
  const it = DriveApp.getFoldersByName(nombre);
  if (!it.hasNext()) throw new Error('No encuentro la carpeta "' + nombre + '" en tu Drive.');
  const c = it.next();
  if (it.hasNext()) throw new Error('Hay más de una carpeta "' + nombre + '" en tu Drive. Deja solo una.');
  return c;
}

function texto_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
