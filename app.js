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

  function getPassword() {
    try { return sessionStorage.getItem('clave-edicion'); } catch (e) { return null; }
  }
  function pedirPassword() {
    const pw = window.prompt('Ingresá la clave de edición:');
    if (pw) { try { sessionStorage.setItem('clave-edicion', pw); } catch (e) { /* sin storage: se pedirá de nuevo */ } }
    return pw;
  }
  function olvidarPassword() {
    try { sessionStorage.removeItem('clave-edicion'); } catch (e) { /* nada */ }
  }
  function asegurarPassword() { return getPassword() || pedirPassword(); }

  function urlFoto(id, mini) {
    return '/.netlify/functions/photo-get?id=' + encodeURIComponent(id) + (mini ? '&t=1' : '');
  }

  async function leerDato(key) {
    const res = await fetch('/.netlify/functions/data-get?key=' + encodeURIComponent(key));
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'No se pudo leer');
    return j.data;
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
        if (res.status === 401) { olvidarPassword(); return { ok: false, error: 'Clave incorrecta' }; }
        if (res.ok) return Object.assign({ ok: true }, j);
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

  window.App = {
    CALIDAD, esc, esperar, getPassword, pedirPassword, asegurarPassword,
    urlFoto, leerDato, guardarDato, postear, abrirVisor, dibujarMapa, COLORES
  };
})();
