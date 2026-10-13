// Ayudas comunes a las tres páginas: clave de edición, lectura/guardado de
// datos, direcciones de fotos, visor de fotos (lightbox) y mapa.
(function () {
  'use strict';

  const CALIDAD = {
    anchoGrande: 1400, calidadGrande: 0.72,   // foto que se ve en el visor
    anchoMini: 360, calidadMini: 0.7          // miniatura de las grillas
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

  // La clave se recuerda en la pestaña (sessionStorage) y, por si el navegador
  // no deja guardar nada (modo privado), también en memoria mientras la
  // página siga abierta. Así nunca se pide más de una vez.
  let claveEnMemoria = null;
  function getPassword() {
    let v = null;
    try { v = sessionStorage.getItem('clave-edicion'); } catch (e) { /* sin storage */ }
    if (!v) { try { v = localStorage.getItem('clave-edicion'); } catch (e) { /* sin storage */ } }
    return v || claveEnMemoria;
  }
  function guardarPassword(pw) {
    claveEnMemoria = pw;
    try { sessionStorage.setItem('clave-edicion', pw); } catch (e) { /* queda en memoria */ }
    try { localStorage.setItem('clave-edicion', pw); } catch (e) { /* solo esta pestaña */ }
  }
  function pedirPassword() {
    const pw = window.prompt('Ingresá la clave de edición:');
    if (pw) guardarPassword(pw);
    return pw;
  }
  function olvidarPassword() {
    claveEnMemoria = null;
    try { sessionStorage.removeItem('clave-edicion'); } catch (e) { /* nada */ }
    try { localStorage.removeItem('clave-edicion'); } catch (e) { /* nada */ }
  }
  function asegurarPassword() { return getPassword() || pedirPassword(); }

  // Firmas de las fotos: el servidor las entrega junto con el viaje (o la lista
  // de viajes) y hacen falta para pedir cada imagen.
  const firmas = {};
  function registrarFirmas(key, dato) {
    if (!dato) return;
    if (key === 'indice' && Array.isArray(dato)) dato.forEach(v => { if (v && v.portada && v.ps) firmas[v.portada] = v.ps; });
    else if (dato.dias) dato.dias.forEach(d => (d.fotos || []).forEach(f => { if (f.s) firmas[f.id] = f.s; }));
  }

  function urlFoto(id, mini) {
    return '/.netlify/functions/photo-get?id=' + encodeURIComponent(id) + (mini ? '&t=1' : '') +
      (firmas[id] ? '&s=' + firmas[id] : '');
  }

  // Lee un dato. Si hay clave guardada la manda (dueño); k = link secreto de un viaje.
  async function leerDato(key, k) {
    const cab = {};
    const pw = getPassword();
    if (pw) cab['x-clave'] = pw;
    const res = await fetch('/.netlify/functions/data-get?key=' + encodeURIComponent(key) + (k ? '&k=' + encodeURIComponent(k) : ''), { headers: cab });
    let j = {};
    try { j = await res.json(); } catch (e) { /* sin JSON */ }
    if (!res.ok) {
      const err = new Error(j.error || 'No se pudo leer');
      err.status = res.status;
      if (res.status === 401) olvidarPassword();
      throw err;
    }
    registrarFirmas(key, j.data);
    return j.data;
  }

  // Lectura que solo puede hacer el dueño: pide la clave si falta (o si estaba mal).
  async function leerDatoDueno(key) {
    for (let i = 0; i < 2; i++) {
      if (!asegurarPassword()) throw new Error('Cancelado');
      try { return await leerDato(key); }
      catch (e) { if (e.status !== 401 && e.status !== 403) throw e; olvidarPassword(); }
    }
    throw new Error('Clave incorrecta');
  }

  // POST con la clave y reintentos automáticos ante cortes de conexión.
  async function postear(funcion, cuerpo, intentos) {
    const password = asegurarPassword();
    if (!password) return { ok: false, error: 'Cancelado' };
    intentos = intentos || 3;
    let ultimoError = '';
    for (let i = 1; i <= intentos; i++) {
      try {
        const res = await fetch('/.netlify/functions/' + funcion, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ password }, cuerpo))
        });
        let j = {};
        try { j = await res.json(); } catch (e) { /* respuesta sin JSON */ }
        if (res.status === 401) { olvidarPassword(); return { ok: false, error: 'Clave incorrecta', claveMala: true }; }
        if (res.ok) { if (funcion === 'photo-upload' && j.id && j.s) firmas[j.id] = j.s; return Object.assign({ ok: true }, j); }
        if (res.status < 500) return { ok: false, error: j.error || ('Error ' + res.status) };
        ultimoError = j.error || ('Error ' + res.status);
      } catch (e) {
        ultimoError = 'Error de conexión: ' + (e && e.message ? e.message : e);
      }
      if (i < intentos) await esperar(i * 1500);
    }
    return { ok: false, error: ultimoError };
  }

  const guardarDato = (key, data) => postear('data-save', { key, data });

  // ---------- Lightbox ----------
  let lb = null;
  function crearLightbox() {
    const div = document.createElement('div');
    div.className = 'lightbox';
    div.innerHTML =
      '<button class="lb-close" type="button" aria-label="Cerrar">✕</button>' +
      '<button class="lb-nav lb-prev" type="button" aria-label="Anterior">‹</button>' +
      '<figure><img alt=""><figcaption></figcaption></figure>' +
      '<button class="lb-nav lb-next" type="button" aria-label="Siguiente">›</button>';
    document.body.appendChild(div);
    const estado = { div, img: div.querySelector('img'), cap: div.querySelector('figcaption'), lista: [], i: 0 };
    const mostrar = () => {
      const f = estado.lista[estado.i];
      estado.img.src = urlFoto(f.id, false);
      estado.cap.textContent = (f.cap || '') + (estado.lista.length > 1 ? '  ·  ' + (estado.i + 1) + '/' + estado.lista.length : '');
    };
    const mover = d => { estado.i = (estado.i + d + estado.lista.length) % estado.lista.length; mostrar(); };
    const cerrar = () => { div.classList.remove('abierto'); estado.img.src = ''; };
    div.querySelector('.lb-close').onclick = cerrar;
    div.querySelector('.lb-prev').onclick = () => mover(-1);
    div.querySelector('.lb-next').onclick = () => mover(1);
    div.addEventListener('click', e => { if (e.target === div) cerrar(); });
    document.addEventListener('keydown', e => {
      if (!div.classList.contains('abierto')) return;
      if (e.key === 'Escape') cerrar();
      if (e.key === 'ArrowLeft') mover(-1);
      if (e.key === 'ArrowRight') mover(1);
    });
    let x0 = null;
    div.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    div.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) mover(dx < 0 ? 1 : -1);
      x0 = null;
    });
    estado.mostrar = mostrar;
    return estado;
  }

  // lista: [{id, cap}], indice: cuál abrir primero
  function abrirVisor(lista, indice) {
    if (!lb) lb = crearLightbox();
    lb.lista = lista;
    lb.i = indice || 0;
    lb.div.classList.add('abierto');
    lb.mostrar();
  }

  // ---------- Mapa del recorrido ----------
  const COLORES = i => 'hsl(' + ((i * 47) % 360) + ',70%,45%)';

  // dias: [{fecha, fotos}], devuelve {mapa, enfocarDia(idx|null)}
  // Une las paradas de todos los días con una línea: continua si la distancia
  // entre paradas es corta, punteada si es larga (vuelos, traslados largos).
  function dibujarMapa(contenedorId, dias, alAbrirFoto) {
    if (typeof L === 'undefined') return null;
    const V = window.Viajes;
    const mapa = L.map(contenedorId, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap'
    }).addTo(mapa);

    const capas = [];            // una por día
    const todos = [];            // [lat, lon] de todo el recorrido
    let previo = null;
    dias.forEach((d, idx) => {
      const grupo = L.layerGroup().addTo(mapa);
      const paradas = V.puntosDelDia(d.fotos, 40);
      const color = COLORES(idx);
      const coords = [];
      paradas.forEach(p => {
        coords.push([p.lat, p.lon]);
        todos.push([p.lat, p.lon]);
        if (previo) {
          const largo = V.distKm(previo[0], previo[1], p.lat, p.lon) > 150;
          L.polyline([previo, [p.lat, p.lon]], { color: '#475569', weight: largo ? 2 : 3, opacity: largo ? 0.55 : 0.8, dashArray: largo ? '6 8' : null }).addTo(grupo);
        }
        previo = [p.lat, p.lon];
      });
      paradas.forEach(p => {
        const m = L.circleMarker([p.lat, p.lon], { radius: 6 + Math.min(6, Math.log2(p.n)), color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }).addTo(grupo);
        const cont = document.createElement('div');
        cont.className = 'popup-parada';
        cont.innerHTML = '<strong>Día ' + (idx + 1) + '</strong> · ' + V.horaDe(p.t) + ' · ' + p.n + (p.n === 1 ? ' foto' : ' fotos') +
          '<br><img src="' + urlFoto(p.ids[0], true) + '" alt="">';
        cont.querySelector('img').onclick = () => alAbrirFoto && alAbrirFoto(p.ids[0]);
        m.bindPopup(cont);
      });
      capas.push({ grupo, coords, color });
    });

    if (todos.length) mapa.fitBounds(L.latLngBounds(todos).pad(0.15), { maxZoom: 14 });
    else mapa.setView([20, 0], 2);

    function enfocarDia(idx) {
      capas.forEach((c, i) => {
        c.grupo.eachLayer(l => {
          if (l.setStyle) l.setStyle(idx == null || i === idx ? { opacity: l instanceof L.Polyline && !(l instanceof L.CircleMarker) ? 0.8 : 1, fillOpacity: 0.95 } : { opacity: 0.15, fillOpacity: 0.12 });
        });
      });
      if (idx == null) {
        if (todos.length) mapa.fitBounds(L.latLngBounds(todos).pad(0.15), { maxZoom: 14 });
      } else if (capas[idx].coords.length) {
        mapa.fitBounds(L.latLngBounds(capas[idx].coords).pad(0.3), { maxZoom: 16 });
      }
    }
    return { mapa, enfocarDia, hayPuntos: todos.length > 0 };
  }

  // ---------- Leer y reducir fotos (lo usan "Cargar fotos" y "Agregar fotos a un día") ----------
  function esImagen(f) {
    return /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name);
  }

  // ---------- Google Fotos (Takeout): archivos .json que acompañan a cada foto ----------
  function esJson(f) { return /\.json$/i.test(f.name); }

  // Lee todos los .json elegidos y arma un índice por nombre original de la foto.
  async function indexarJson(archivos) {
    const idx = new Map();
    await conPool(archivos.filter(esJson), 8, async f => {
      try {
        const j = JSON.parse(await f.text());
        if (!j || typeof j.title !== 'string' || !(j.photoTakenTime || j.geoData)) return;
        const k = j.title.toLowerCase();
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(j);
      } catch (e) { /* json que no es de Google Fotos: se ignora */ }
    });
    return idx;
  }

  // Busca el json de una foto: nombre exacto, sin "-edited"/"-editado", sin "(1)".
  function buscarJson(idx, nombre) {
    if (!idx || !idx.size) return null;
    const n = nombre.toLowerCase();
    const candidatos = [n,
      n.replace(/-(edited|editado|bearbeitet|modifié)(?=\.[^.]+$)/, ''),
      n.replace(/\(\d+\)(?=\.[^.]+$)/, ''),
      n.replace(/-(edited|editado)(\(\d+\))?(?=\.[^.]+$)/, '')];
    for (const c of candidatos) { const l = idx.get(c); if (l && l.length) return l[0]; }
    return null;
  }

  // Separa lo elegido en fotos y datos de Google Fotos.
  async function prepararSeleccion(archivos) {
    const lista = Array.from(archivos || []);
    const imagenes = lista.filter(esImagen);
    const jsons = lista.filter(esJson);
    const idx = jsons.length ? await indexarJson(jsons) : null;
    return { imagenes, idx, nJson: jsons.length };
  }

  // Lee fecha y ubicación de una foto (EXIF y, si hay, el .json de Google Fotos):
  // {file, src, t, lat, lon, deJson}
  async function leerMeta(file, idxJson) {
    const V = window.Viajes;
    const m = { file, src: file.name + '|' + file.size, t: null, lat: null, lon: null, deJson: false };
    try {
      const o = await window.exifr.parse(file, {
        gps: true, exif: true, tiff: true, reviveValues: false,
        pick: ['DateTimeOriginal', 'CreateDate']
      });
      if (o) {
        m.t = V.textoDeExif(o.DateTimeOriginal) || V.textoDeExif(o.CreateDate);
        if (Number.isFinite(o.latitude) && Number.isFinite(o.longitude) && !(o.latitude === 0 && o.longitude === 0)) {
          m.lat = Math.round(o.latitude * 1e5) / 1e5;
          m.lon = Math.round(o.longitude * 1e5) / 1e5;
        }
      }
    } catch (e) { /* sin datos EXIF: queda sin fecha */ }

    // Datos de Google Fotos (.json): completan lo que falte en la foto.
    const j = buscarJson(idxJson, file.name);
    if (j) {
      const g = [j.geoData, j.geoDataExif].find(x => x && Number.isFinite(x.latitude) && Number.isFinite(x.longitude) && !(x.latitude === 0 && x.longitude === 0));
      if (g) {
        const lat = Math.round(g.latitude * 1e5) / 1e5, lon = Math.round(g.longitude * 1e5) / 1e5;
        if (m.lat == null || m.lon == null) m.deJson = true;
        m.lat = lat; m.lon = lon; // la ubicación de Google Fotos incluye las correcciones hechas ahí
      }
      const seg = j.photoTakenTime && Number(j.photoTakenTime.timestamp);
      if (!m.t && seg) {
        // El json guarda la hora en UTC: se pasa a hora local del lugar (aprox. por longitud, o la de este equipo).
        const off = m.lon != null ? Math.round(m.lon / 15) : -new Date(seg * 1000).getTimezoneOffset() / 60;
        m.t = V.textoDeEpoch(seg, off);
        if (m.t) m.deJson = true;
      }
    }
    return m;
  }

  // Ejecuta fn sobre cada item con hasta n tareas en paralelo.
  async function conPool(items, n, fn) {
    let i = 0;
    const res = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        res[k] = await fn(items[k], k);
      }
    }));
    return res;
  }

  function cargarImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('formato no compatible con este navegador')); };
      img.src = url;
    });
  }

  async function abrirImagen(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, cerrar: () => bmp.close && bmp.close() };
    } catch (e) {
      const img = await cargarImg(file);
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, cerrar: () => {} };
    }
  }

  function aJpeg(origen, ancho, calidad) {
    let w = origen.w, h = origen.h;
    if (w > ancho) { h = Math.round(h * ancho / w); w = ancho; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(origen.src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', calidad);
  }

  // Devuelve {grande, mini} como data URLs JPEG (sin datos EXIF/GPS dentro).
  async function reducir(file) {
    const o = await abrirImagen(file);
    try {
      return {
        grande: aJpeg(o, CALIDAD.anchoGrande, CALIDAD.calidadGrande),
        mini: aJpeg(o, CALIDAD.anchoMini, CALIDAD.calidadMini)
      };
    } finally { o.cerrar(); }
  }

  // ---------- Nombres de lugares (OpenStreetMap / Nominatim, máx. 1 consulta por segundo) ----------
  const cacheLugares = new Map();
  let ultimaConsulta = 0;
  async function nombreDeLugar(lat, lon) {
    const clave = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (cacheLugares.has(clave)) return cacheLugares.get(clave);
    const espera = 1100 - (Date.now() - ultimaConsulta);
    if (espera > 0) await esperar(espera);
    ultimaConsulta = Date.now();
    let r = null;
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=es&lat=' + lat + '&lon=' + lon);
      if (res.ok) {
        const j = await res.json();
        const a = j.address || {};
        const lugar = a.city || a.town || a.village || a.municipality || a.county || a.state || a.region || null;
        if (lugar) r = { lugar, pais: a.country || '' };
      }
    } catch (e) { /* sin nombre */ }
    cacheLugares.set(clave, r);
    return r;
  }

  // Nombre(s) de los lugares de un día, en orden: "Venecia → Madrid".
  // Devuelve {lugar, pais} o null si no hubo GPS o no se pudo averiguar.
  async function nombresDelDia(fotos) {
    const tramos = window.Viajes.tramosDelDia(fotos, 40);
    const lugares = [], paises = [];
    for (const t of tramos) {
      const r = await nombreDeLugar(t.lat, t.lon);
      if (!r) continue;
      if (!lugares.includes(r.lugar)) lugares.push(r.lugar);
      if (r.pais && !paises.includes(r.pais)) paises.push(r.pais);
    }
    if (!lugares.length) return null;
    return { lugar: lugares.join(' → '), pais: paises.join(' → ') };
  }

  window.App = {
    CALIDAD, esc, esperar, getPassword, pedirPassword, asegurarPassword,
    urlFoto, leerDato, leerDatoDueno, guardarDato, postear, olvidarPassword, getPassword, guardarPassword, pedirPassword, asegurarPassword,
    esImagen, esJson, prepararSeleccion, leerMeta, conPool, reducir, nombreDeLugar, nombresDelDia, abrirVisor, dibujarMapa, COLORES
  };
})();
