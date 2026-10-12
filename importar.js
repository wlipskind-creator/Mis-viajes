(function () {
  'use strict';
  const V = window.Viajes;
  const A = window.App;
  const $ = id => document.getElementById(id);

  let metas = [];            // fotos leídas: {file, src, t, lat, lon}
  let indice = [];           // lista de viajes cargados
  let viaje = null;          // viaje destino (existente o recién armado), en memoria
  let cargando = false;

  // ---------- Paso 1: elegir viaje ----------
  async function iniciar() {
    try {
      const r = await A.leerDato('indice');
      indice = Array.isArray(r) ? r : [];
    } catch (e) {
      $('nota-viaje').textContent = 'No se pudo leer la lista de viajes existentes (podés crear uno nuevo igual).';
    }
    indice.slice().sort((a, b) => (a.desde < b.desde ? 1 : -1)).forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.titulo + ' (' + V.rangoTexto(v.desde, v.hasta) + ')';
      $('sel-viaje').appendChild(o);
    });
    const pre = new URLSearchParams(location.search).get('viaje');
    if (pre && indice.some(v => v.id === pre)) $('sel-viaje').value = pre;
    await alCambiarViaje();
  }

  async function alCambiarViaje() {
    const id = $('sel-viaje').value;
    $('campo-nombre').classList.toggle('oculto', !!id);
    viaje = null;
    if (id) {
      $('nota-viaje').textContent = 'Cargando datos del viaje…';
      try {
        viaje = await A.leerDato('viaje-' + id);
        $('nota-viaje').textContent = 'Las fotos nuevas se suman a «' + viaje.titulo + '» (' + viaje.dias.reduce((n, d) => n + d.fotos.length, 0) + ' fotos ya cargadas).';
      } catch (e) {
        $('nota-viaje').textContent = 'No se pudo leer ese viaje. Probá de nuevo.';
      }
    } else {
      $('nota-viaje').textContent = '';
    }
    if (metas.length) mostrarRevision();
  }

  // ---------- Paso 2: leer fecha y ubicación de cada foto ----------
  function esImagen(f) {
    return /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name);
  }

  async function leerMeta(file) {
    const m = { file, src: file.name + '|' + file.size, t: null, lat: null, lon: null };
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
    return m;
  }

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

  async function alElegirArchivos(ev) {
    const lista = Array.from(ev.target.files || []).filter(esImagen);
    if (!lista.length) return;
    $('p-revision').classList.add('oculto');
    $('p-progreso').classList.add('oculto');
    let hechas = 0;
    $('estado-lectura').textContent = 'Leyendo fecha y ubicación de las fotos… 0/' + lista.length;
    metas = await conPool(lista, 6, async f => {
      const m = await leerMeta(f);
      hechas++;
      if (hechas % 10 === 0 || hechas === lista.length) $('estado-lectura').textContent = 'Leyendo fecha y ubicación de las fotos… ' + hechas + '/' + lista.length;
      return m;
    });
    $('estado-lectura').textContent = lista.length + ' fotos leídas.';
    mostrarRevision();
  }

  // ---------- Paso 3: resumen ----------
  function srcExistentes() {
    const s = new Set();
    if (viaje) for (const d of viaje.dias) for (const f of d.fotos) if (f.src) s.add(f.src);
    return s;
  }

  function mostrarRevision() {
    const ya = srcExistentes();
    const nuevas = metas.filter(m => !ya.has(m.src));
    const repetidas = metas.length - nuevas.length;
    const conFecha = nuevas.filter(m => m.t);
    const sinFecha = nuevas.length - conFecha.length;
    const conGps = nuevas.filter(m => m.lat != null).length;
    const dias = new Set(conFecha.map(m => V.diaDe(m.t)));
    const fechas = Array.from(dias).sort();

    const dato = (n, txt) => '<div class="dato"><b>' + n + '</b>' + txt + '</div>';
    $('resumen').innerHTML =
      dato(nuevas.length, 'fotos para cargar') +
      dato(dias.size, dias.size === 1 ? 'día detectado' : 'días detectados') +
      dato(conGps, 'con ubicación (mapa)') +
      dato(sinFecha, 'sin fecha') +
      (repetidas ? dato(repetidas, 'ya estaban cargadas') : '');

    let avisos = '';
    if (fechas.length) {
      avisos += '<p>📅 Del <strong>' + A.esc(V.fechaCorta(fechas[0])) + '</strong> al <strong>' + A.esc(V.fechaCorta(fechas[fechas.length - 1])) + '</strong>.</p>';
      const grupos = V.agruparViajes(conFecha.map(m => ({ t: m.t })), 10);
      if (grupos.length > 1) {
        avisos += '<div class="aviso">Ojo: hay saltos de más de 10 días sin ninguna foto (por ejemplo, después del ' +
          A.esc(V.fechaCorta(V.diaDe(grupos[0][grupos[0].length - 1].t))) + '). Si algunas fotos son de otro viaje, conviene cargarlas por separado.</div>';
      }
    }
    if (conGps === 0 && nuevas.length) {
      avisos += '<div class="aviso">Ninguna de estas fotos tiene ubicación guardada, así que el viaje quedará sin mapa. (Pasa con fotos descargadas de WhatsApp o redes, o si la cámara tenía el GPS apagado.)</div>';
    }
    $('avisos').innerHTML = avisos;
    $('lbl-sin-fecha').classList.toggle('oculto', sinFecha === 0);

    // tira de ejemplo
    const tira = $('tira');
    tira.innerHTML = '';
    nuevas.slice(0, 8).forEach(m => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(m.file);
      img.onload = () => URL.revokeObjectURL(img.src);
      tira.appendChild(img);
    });
    $('btn-cargar').disabled = nuevas.length === 0;
    $('btn-cargar').textContent = nuevas.length ? '⬆️ Cargar ' + nuevas.length + ' fotos en el viaje' : 'No hay fotos nuevas para cargar';
    $('p-revision').classList.remove('oculto');
  }

  // ---------- Reducir y subir fotos ----------
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

  async function reducir(file) {
    const o = await abrirImagen(file);
    try {
      return {
        grande: aJpeg(o, A.CALIDAD.anchoGrande, A.CALIDAD.calidadGrande),
        mini: aJpeg(o, A.CALIDAD.anchoMini, A.CALIDAD.calidadMini)
      };
    } finally { o.cerrar(); }
  }

  // ---------- Nombres de lugares (OpenStreetMap / Nominatim) ----------
  const cacheLugares = new Map();
  let ultimaConsulta = 0;
  async function nombreDeLugar(lat, lon) {
    const clave = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (cacheLugares.has(clave)) return cacheLugares.get(clave);
    const espera = 1100 - (Date.now() - ultimaConsulta);
    if (espera > 0) await A.esperar(espera);
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
    } catch (e) { /* sin nombre: el día queda solo con la fecha */ }
    cacheLugares.set(clave, r);
    return r;
  }

  // ---------- Carga ----------
  function log(txt) {
    const li = document.createElement('li');
    li.textContent = txt;
    $('prog-log').appendChild(li);
    $('prog-log').scrollTop = 1e9;
  }
  function progreso(hecho, total, extra) {
    $('prog-barra').style.width = (total ? Math.round(hecho * 100 / total) : 0) + '%';
    $('prog-texto').textContent = hecho + ' de ' + total + ' fotos' + (extra ? ' · ' + extra : '');
  }

  async function guardarViajeEIndice() {
    let r = await A.guardarDato('viaje-' + viaje.id, viaje);
    if (!r.ok) throw new Error(r.error);
    let actual = [];
    try { const x = await A.leerDato('indice'); actual = Array.isArray(x) ? x : []; } catch (e) { actual = indice; }
    const res = V.resumenViaje(viaje);
    const pos = actual.findIndex(v => v.id === viaje.id);
    if (pos >= 0) actual[pos] = res; else actual.push(res);
    r = await A.guardarDato('indice', actual);
    if (!r.ok) throw new Error(r.error);
    indice = actual;
  }

  function sumarFotos(fotosNuevas) {
    const conFecha = fotosNuevas.filter(f => f.t);
    const sinFecha = fotosNuevas.filter(f => !f.t);
    const dias = V.agruparDias(conFecha).map(d => ({ fecha: d.fecha, titulo: '', lugar: '', comentarios: '', fotos: d.fotos }));
    if (sinFecha.length) dias.push({ fecha: V.SIN_FECHA, titulo: 'Fotos sin fecha', lugar: '', comentarios: '', fotos: sinFecha });
    viaje.dias = V.unirDias(viaje.dias, dias);
    if (!viaje.portada) {
      const todas = viaje.dias.reduce((acc, d) => acc.concat(d.fotos), []);
      if (todas.length) viaje.portada = todas[Math.floor(todas.length / 2)].id;
    }
  }

  async function ponerNombresDeLugares() {
    const pendientes = viaje.dias.filter(d => !d.lugar && d.fecha !== V.SIN_FECHA && V.centro(d.fotos));
    let i = 0;
    for (const d of pendientes) {
      i++;
      $('prog-texto').textContent = 'Buscando nombres de lugares… ' + i + '/' + pendientes.length;
      const c = V.centro(d.fotos);
      const r = await nombreDeLugar(c.lat, c.lon);
      if (r) {
        d.lugar = r.lugar;
        d.pais = r.pais;
        d.titulo = (d.titulo || 'Día 0').replace(/^(Día\s+\d+).*$/i, '$1') + ' · ' + r.lugar;
      }
    }
    V.renumerarDias(viaje.dias);
  }

  async function cargar() {
    if (cargando) return;
    const idSel = $('sel-viaje').value;
    if (!idSel && !$('nombre-viaje').value.trim()) {
      alert('Escribí un nombre para el viaje nuevo.');
      $('nombre-viaje').focus();
      return;
    }
    if (!A.asegurarPassword()) return;

    cargando = true;
    $('btn-cargar').disabled = true;
    $('p-progreso').classList.remove('oculto');
    $('prog-final').innerHTML = '';
    $('prog-titulo').textContent = 'Cargando…';
    $('prog-log').innerHTML = '';
    const evitarCierre = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', evitarCierre);
    let pantalla = null;
    try { if (navigator.wakeLock) pantalla = await navigator.wakeLock.request('screen'); } catch (e) { /* opcional */ }

    if (!viaje) {
      viaje = {
        id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        titulo: $('nombre-viaje').value.trim(),
        descripcion: '', portada: null, dias: []
      };
    }

    const incluirSinFecha = $('chk-sin-fecha').checked;
    const ya = srcExistentes();
    const pendientes = metas.filter(m => !ya.has(m.src) && (m.t || incluirSinFecha));
    const fallidas = [];
    let hechas = 0;
    const total = pendientes.length;
    progreso(0, total);

    try {
      const LOTE = 60; // se guarda el avance cada 60 fotos: si algo se corta, no se pierde lo ya subido
      for (let i = 0; i < total; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE);
        const resultados = await conPool(lote, 3, async m => {
          try {
            const { grande, mini } = await reducir(m.file);
            const r = await A.postear('photo-upload', { dataUrl: grande, thumbUrl: mini, filename: m.file.name });
            if (!r.ok) throw new Error(r.error);
            progreso(++hechas, total, fallidas.length ? fallidas.length + ' con problemas' : '');
            const f = { id: r.id, t: m.t, src: m.src };
            if (m.lat != null) { f.lat = m.lat; f.lon = m.lon; }
            return f;
          } catch (e) {
            fallidas.push({ nombre: m.file.name, motivo: e && e.message ? e.message : String(e) });
            progreso(++hechas, total, fallidas.length + ' con problemas');
            return null;
          }
        });
        const subidas = resultados.filter(Boolean);
        if (subidas.length) {
          sumarFotos(subidas);
          await guardarViajeEIndice();
          log('Guardado: ' + Math.min(i + LOTE, total) + ' de ' + total);
        }
      }

      await ponerNombresDeLugares();
      await guardarViajeEIndice();

      $('prog-titulo').textContent = '¡Listo!';
      progreso(total, total, fallidas.length ? fallidas.length + ' con problemas' : '');
      let html = '<div class="ok">✅ Se cargaron ' + (total - fallidas.length) + ' fotos en «' + A.esc(viaje.titulo) + '».</div>' +
        '<p><a class="btn btn-primary" href="/viaje.html?id=' + encodeURIComponent(viaje.id) + '">Ver el viaje</a></p>';
      if (fallidas.length) {
        html += '<div class="aviso"><strong>' + fallidas.length + ' fotos no se pudieron cargar</strong> (podés volver a elegirlas y se cargan solo esas):<ul>' +
          fallidas.slice(0, 15).map(f => '<li>' + A.esc(f.nombre) + ': ' + A.esc(f.motivo) + '</li>').join('') +
          (fallidas.length > 15 ? '<li>…y ' + (fallidas.length - 15) + ' más</li>' : '') + '</ul>' +
          '<p class="nota">Las fotos en formato HEIC solo se pueden leer desde Safari; en otros navegadores conviene exportarlas como JPEG.</p></div>';
      }
      $('prog-final').innerHTML = html;
    } catch (e) {
      $('prog-titulo').textContent = 'Se interrumpió la carga';
      $('prog-final').innerHTML = '<div class="aviso">No se pudo guardar: ' + A.esc(e.message || e) + '. Lo ya guardado no se pierde. ' +
        'Volvé a tocar “Cargar” para continuar: se saltean las fotos que ya están.</div>';
      $('btn-cargar').disabled = false;
    } finally {
      window.removeEventListener('beforeunload', evitarCierre);
      if (pantalla) { try { pantalla.release(); } catch (e) { /* nada */ } }
      cargando = false;
    }
  }

  $('sel-viaje').addEventListener('change', alCambiarViaje);
  $('archivos').addEventListener('change', alElegirArchivos);
  $('btn-cargar').addEventListener('click', cargar);
  iniciar();
})();
