(function () {
  'use strict';
  const V = window.Viajes;
  const A = window.App;
  const main = document.getElementById('main');
  const id = new URLSearchParams(location.search).get('id');

  let viaje = null;
  let editando = false;
  let sucio = false;            // hay cambios sin guardar
  let borrarIds = [];           // fotos quitadas, para borrarlas del servidor al guardar
  let mapaObj = null;

  function horaTexto(f) { return f.sh ? '' : V.horaDe(f.t); }
  function nFotos() { return viaje.dias.reduce((n, d) => n + d.fotos.length, 0); }
  function marcarSucio() { sucio = true; const b = document.getElementById('btn-guardar'); if (b) b.disabled = false; }

  async function iniciar() {
    if (!id) { main.innerHTML = '<div class="vacio">Falta indicar el viaje. <a href="/">Volver al inicio</a></div>'; return; }
    try {
      viaje = await A.leerDato('viaje-' + id);
    } catch (e) { viaje = null; }
    if (!viaje) { main.innerHTML = '<div class="vacio">No se encontró este viaje. <a href="/">Volver al inicio</a></div>'; return; }
    document.title = viaje.titulo;
    dibujar();
  }

  // ---------- Pantalla ----------
  function dibujar() {
    const resumen = V.resumenViaje(viaje);
    const dias = viaje.dias;
    let html = '<div class="hero"><div style="flex:1;min-width:240px">';
    if (editando) {
      html += '<input type="text" id="ed-titulo" class="titulo-edit edit" value="' + A.esc(viaje.titulo) + '" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:8px">';
    } else {
      html += '<h1>' + A.esc(viaje.titulo) + '</h1>';
    }
    html += '<p class="sub">' + A.esc(V.rangoTexto(resumen.desde, resumen.hasta)) + ' · ' + dias.filter(d => d.fecha !== V.SIN_FECHA).length + ' días · ' + nFotos() + ' fotos</p>';
    if (editando) {
      html += '<textarea id="ed-desc" class="edit" placeholder="Una descripción del viaje (opcional)" style="width:100%;min-height:60px;padding:.5rem;border:1px solid var(--border);border-radius:8px;font-family:inherit">' + A.esc(viaje.descripcion || '') + '</textarea>';
    } else if (viaje.descripcion) {
      html += '<p style="white-space:pre-wrap">' + A.esc(viaje.descripcion) + '</p>';
    }
    html += '</div><div class="barra">';
    if (!editando) {
      html += '<a class="btn btn-secondary" href="/importar.html?viaje=' + encodeURIComponent(viaje.id) + '">➕ Agregar fotos</a>' +
        '<button class="btn btn-secondary" id="btn-editar" type="button">✏️ Editar</button>';
    } else {
      html += '<button class="btn btn-primary" id="btn-guardar" type="button"' + (sucio ? '' : ' disabled') + '>💾 Guardar cambios</button>' +
        '<button class="btn btn-secondary" id="btn-cancelar" type="button">Cerrar edición</button>' +
        '<button class="btn btn-danger" id="btn-borrar-viaje" type="button">🗑️ Borrar viaje</button>';
    }
    html += '</div></div>';

    // mapa y chips
    html += '<div id="mapa-viaje"></div>';
    html += '<div class="chips" id="chips"><button class="chip activo" data-dia="">Todo el recorrido</button>';
    dias.forEach((d, i) => {
      if (d.fecha === V.SIN_FECHA) return;
      html += '<button class="chip" data-dia="' + i + '" style="border-left:5px solid ' + A.COLORES(i) + '">' + A.esc(d.titulo.replace(/^(Día\s+\d+).*$/i, '$1')) + '</button>';
    });
    html += '</div>';

    // días
    dias.forEach((d, i) => { html += htmlDia(d, i); });
    main.innerHTML = html;
    activarEventos();
    montarMapa();
  }

  function htmlDia(d, i) {
    const sin = d.fecha === V.SIN_FECHA;
    let h = '<section class="dia" id="dia-' + i + '"><div class="dia-cab">';
    if (editando) {
      h += '<input type="text" class="edit titulo-edit" data-campo="titulo" data-dia="' + i + '" value="' + A.esc(d.titulo) + '" style="flex:1;min-width:200px;padding:.4rem;border:1px solid var(--border);border-radius:8px">';
    } else {
      h += '<h2>' + A.esc(d.titulo) + '</h2>';
    }
    if (!sin) h += '<span class="fecha">' + A.esc(V.fechaLarga(d.fecha)) + (d.pais ? ' · ' + A.esc(d.pais) : '') + '</span>';
    h += '</div>';

    if (editando) {
      h += '<textarea class="edit" data-campo="comentarios" data-dia="' + i + '" placeholder="Qué hicimos este día, anécdotas, recuerdos…" style="width:100%;margin-top:.5rem;padding:.5rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:70px">' + A.esc(d.comentarios || '') + '</textarea>';
    } else if (d.comentarios) {
      h += '<p class="comentario">' + A.esc(d.comentarios) + '</p>';
    }

    h += '<div class="dia-acciones">';
    if (!sin && V.puntosDelDia(d.fotos).length) h += '<button class="btn-mini" data-accion="ver-mapa" data-dia="' + i + '">📍 Ver este día en el mapa</button>';
    if (editando && !d.fotos.length) h += '<button class="btn-mini peligro" data-accion="borrar-dia" data-dia="' + i + '">Quitar día vacío</button>';
    h += '</div><div class="fotos">';
    d.fotos.forEach((f, k) => {
      const esPortada = viaje.portada === f.id;
      h += '<div class="foto' + (esPortada ? ' portada' : '') + '"><img loading="lazy" src="' + A.urlFoto(f.id, true) + '" data-accion="abrir" data-dia="' + i + '" data-k="' + k + '" alt="">' +
        (f.lat != null ? '<span class="gps" title="Tiene ubicación">📍</span>' : '') +
        '<span class="hora">' + A.esc(horaTexto(f)) + '</span>';
      if (editando) {
        h += '<div class="foto-ctrl">' +
          '<button title="Quitar foto" data-accion="quitar" data-dia="' + i + '" data-k="' + k + '">✕</button>' +
          '<button title="Usar de portada" data-accion="portada" data-dia="' + i + '" data-k="' + k + '">⭐</button>' +
          '<button title="Mover a otro día" data-accion="mover" data-dia="' + i + '" data-k="' + k + '">↔️</button></div>';
      }
      h += '</div>';
    });
    h += '</div></section>';
    return h;
  }

  // ---------- Mapa ----------
  function montarMapa() {
    if (mapaObj && mapaObj.mapa) { mapaObj.mapa.remove(); mapaObj = null; }
    const conFechas = viaje.dias.map(d => ({ fecha: d.fecha, fotos: d.fotos }));
    const hayGps = conFechas.some(d => V.puntosDelDia(d.fotos).length);
    const cont = document.getElementById('mapa-viaje');
    if (!hayGps || typeof L === 'undefined') {
      cont.style.display = 'none';
      document.getElementById('chips').style.display = 'none';
      return;
    }
    mapaObj = A.dibujarMapa('mapa-viaje', conFechas, fotoId => {
      for (const d of viaje.dias) {
        const k = d.fotos.findIndex(f => f.id === fotoId);
        if (k >= 0) { abrirVisor(viaje.dias.indexOf(d), k); return; }
      }
    });
  }

  function enfocar(idx) {
    if (!mapaObj) return;
    mapaObj.enfocarDia(idx);
    document.querySelectorAll('#chips .chip').forEach(c => c.classList.toggle('activo', (c.dataset.dia === '' && idx == null) || c.dataset.dia === String(idx)));
  }

  function abrirVisor(i, k) {
    const d = viaje.dias[i];
    const lista = d.fotos.map(f => ({ id: f.id, cap: [d.titulo, horaTexto(f)].filter(Boolean).join(' · ') }));
    A.abrirVisor(lista, k);
  }

  // ---------- Eventos ----------
  function activarEventos() {
    document.querySelectorAll('#chips .chip').forEach(c => {
      c.onclick = () => enfocar(c.dataset.dia === '' ? null : Number(c.dataset.dia));
    });

    const bEd = document.getElementById('btn-editar');
    if (bEd) bEd.onclick = () => { if (!A.asegurarPassword()) return; editando = true; dibujar(); };
    const bCa = document.getElementById('btn-cancelar');
    if (bCa) bCa.onclick = () => {
      if (sucio && !confirm('Hay cambios sin guardar. ¿Cerrar la edición y descartarlos?')) return;
      if (sucio) { location.reload(); return; }
      editando = false; dibujar();
    };
    const bGu = document.getElementById('btn-guardar');
    if (bGu) bGu.onclick = guardar;
    const bBv = document.getElementById('btn-borrar-viaje');
    if (bBv) bBv.onclick = borrarViaje;

    const t = document.getElementById('ed-titulo');
    if (t) t.oninput = () => { viaje.titulo = t.value; marcarSucio(); };
    const ds = document.getElementById('ed-desc');
    if (ds) ds.oninput = () => { viaje.descripcion = ds.value; marcarSucio(); };

    main.querySelectorAll('[data-campo]').forEach(el => {
      el.oninput = () => { viaje.dias[Number(el.dataset.dia)][el.dataset.campo] = el.value; marcarSucio(); };
    });

    main.querySelectorAll('[data-accion]').forEach(el => {
      el.onclick = () => {
        const i = Number(el.dataset.dia), k = Number(el.dataset.k);
        switch (el.dataset.accion) {
          case 'abrir': abrirVisor(i, k); break;
          case 'ver-mapa':
            enfocar(i);
            document.getElementById('mapa-viaje').scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          case 'quitar': quitarFoto(i, k); break;
          case 'portada': viaje.portada = viaje.dias[i].fotos[k].id; marcarSucio(); dibujar(); break;
          case 'mover': moverFoto(i, k); break;
          case 'borrar-dia': viaje.dias.splice(i, 1); marcarSucio(); dibujar(); break;
        }
      };
    });
  }

  function quitarFoto(i, k) {
    if (!confirm('¿Quitar esta foto del viaje? Se borra también del sitio al guardar.')) return;
    const [f] = viaje.dias[i].fotos.splice(k, 1);
    borrarIds.push(f.id);
    if (viaje.portada === f.id) viaje.portada = null;
    marcarSucio();
    dibujar();
  }

  function moverFoto(i, k) {
    const msg = 'Escribí el número del día de destino:\n\n' + viaje.dias.map((d, j) => (j + 1) + ') ' + d.titulo + ' — ' + V.fechaCorta(d.fecha)).join('\n') +
      '\n\n(o escribí una fecha nueva AAAA-MM-DD para crear un día)';
    const resp = prompt(msg);
    if (!resp) return;
    let destino;
    if (/^\d{4}-\d{2}-\d{2}$/.test(resp.trim())) {
      destino = viaje.dias.find(d => d.fecha === resp.trim());
      if (!destino) {
        destino = { fecha: resp.trim(), titulo: '', lugar: '', comentarios: '', fotos: [] };
        viaje.dias.push(destino);
      }
    } else {
      destino = viaje.dias[Number(resp) - 1];
    }
    if (!destino || destino === viaje.dias[i]) return;
    const [f] = viaje.dias[i].fotos.splice(k, 1);
    if (destino.fecha !== V.SIN_FECHA) {
      if (f.t) { f.t = destino.fecha + f.t.slice(10); } else { f.t = destino.fecha + 'T12:00:00'; f.sh = 1; }
    }
    destino.fotos.push(f);
    destino.fotos.sort((a, b) => ((a.t || '') < (b.t || '') ? -1 : 1));
    V.renumerarDias(viaje.dias);
    marcarSucio();
    dibujar();
  }

  async function guardar() {
    const b = document.getElementById('btn-guardar');
    b.disabled = true; b.textContent = 'Guardando…';
    let r = await A.guardarDato('viaje-' + viaje.id, viaje);
    if (r.ok) {
      let indice = [];
      try { const x = await A.leerDato('indice'); indice = Array.isArray(x) ? x : []; } catch (e) { /* se reconstruye abajo */ }
      const res = V.resumenViaje(viaje);
      const pos = indice.findIndex(v => v.id === viaje.id);
      if (pos >= 0) indice[pos] = res; else indice.push(res);
      r = await A.guardarDato('indice', indice);
    }
    if (r.ok && borrarIds.length) {
      await A.postear('photo-delete', { ids: borrarIds });
      borrarIds = [];
    }
    if (!r.ok) {
      alert('No se pudo guardar: ' + r.error);
      b.disabled = false; b.textContent = '💾 Guardar cambios';
      return;
    }
    sucio = false;
    b.textContent = '✅ Guardado';
    setTimeout(() => { const x = document.getElementById('btn-guardar'); if (x) { x.textContent = '💾 Guardar cambios'; x.disabled = true; } }, 1500);
  }

  async function borrarViaje() {
    if (!confirm('¿Borrar el viaje «' + viaje.titulo + '» completo, con todas sus fotos? No se puede deshacer.')) return;
    if (!confirm('Última confirmación: se borran ' + nFotos() + ' fotos del sitio. ¿Seguro?')) return;
    const ids = viaje.dias.reduce((acc, d) => acc.concat(d.fotos.map(f => f.id)), []).concat(borrarIds);
    for (let i = 0; i < ids.length; i += 100) {
      const r = await A.postear('photo-delete', { ids: ids.slice(i, i + 100) });
      if (!r.ok) { alert('No se pudieron borrar las fotos: ' + r.error); return; }
    }
    let r = await A.guardarDato('viaje-' + viaje.id, null);
    if (r.ok) {
      let indice = [];
      try { const x = await A.leerDato('indice'); indice = Array.isArray(x) ? x : []; } catch (e) { /* nada */ }
      r = await A.guardarDato('indice', indice.filter(v => v.id !== viaje.id));
    }
    if (!r.ok) { alert('No se pudo terminar de borrar: ' + r.error); return; }
    sucio = false;
    location.href = '/';
  }

  window.addEventListener('beforeunload', e => { if (sucio) { e.preventDefault(); e.returnValue = ''; } });
  iniciar();
})();
