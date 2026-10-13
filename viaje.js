(function () {
  'use strict';
  const V = window.Viajes;
  const A = window.App;
  const main = document.getElementById('main');
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const kLink = params.get('k') || '';   // link secreto de este viaje (para quien no es el dueño)

  let viaje = null;
  let editando = false;         // edición de todo el viaje (título, descripción y todos los días)
  let diaEditando = null;       // edición de un solo día (el objeto del día) o null
  let sucio = false;            // hay cambios sin guardar
  let borrarIds = [];           // fotos quitadas: se borran del servidor al guardar
  let mapaObj = null;
  let diaActual = -1;           // día que se está viendo (-1 = arriba, antes del primer día)
  let navFlotante = null;
  let soyDueno = false;         // false = entró por link secreto: solo puede mirar

  const $ = sel => document.querySelector(sel);
  const enEdicion = i => editando || (diaEditando !== null && viaje.dias[i] === diaEditando);
  function horaTexto(f) { return f.sh ? '' : V.horaDe(f.t); }
  function nFotos() { return viaje.dias.reduce((n, d) => n + d.fotos.length, 0); }
  function tituloCorto(d) { return d.titulo.replace(/^(Día\s+\d+).*$/i, '$1'); }

  function marcarSucio() {
    sucio = true;
    document.querySelectorAll('.js-guardar').forEach(b => { b.disabled = false; });
  }

  async function iniciar() {
    const vEl = document.getElementById('version');
    if (vEl && !/viaje\.js/.test(vEl.textContent)) vEl.textContent += ' · viaje.js v7';
    if (!id) { main.innerHTML = '<div class="vacio">Falta indicar el viaje. <a href="/">Volver al inicio</a></div>'; return; }
    let error = null;
    viaje = null;
    for (let intento = 0; intento < 2 && !viaje; intento++) {
      try { viaje = await A.leerDato('viaje-' + id, kLink); error = null; }
      catch (e) { error = e; if (e.status !== 401) break; } // 401: la clave guardada estaba mal; se reintenta sin ella
    }
    if (!viaje) {
      if (error && (error.status === 403 || error.status === 401)) {
        main.innerHTML = '<div class="vacio"><p><strong>🔒 Este viaje es privado.</strong></p>' +
          '<p>Para verlo hace falta el link que te compartieron. Si el link dejó de funcionar, pedile uno nuevo a quien te lo envió.</p>' +
          '<p><button class="btn btn-secondary" id="btn-soy-dueno" type="button">Soy el dueño: ingresar mi clave</button></p></div>';
        document.getElementById('btn-soy-dueno').onclick = () => { if (A.pedirPassword()) location.reload(); };
      } else {
        main.innerHTML = '<div class="vacio">No se encontró este viaje. <a href="/">Volver al inicio</a></div>';
      }
      document.body.classList.add('lector');
      return;
    }
    soyDueno = !!A.getPassword();
    if (!soyDueno) document.body.classList.add('lector'); // quien entra por link solo mira
    document.title = viaje.titulo;
    dibujar();
    crearNavFlotante();
  }

  // Antes de entrar a editar se comprueba la clave una vez, para no
  // descubrir que está mal recién al guardar.
  async function verificarClave() {
    if (!A.asegurarPassword()) return false;
    const r = await A.postear('photo-delete', { ids: [] }, 1);
    if (!r.ok) {
      alert(r.claveMala
        ? 'La clave no coincide con la que está cargada en Netlify (EDIT_PASSWORD).'
        : 'No se pudo verificar la clave: ' + r.error);
      return false;
    }
    return true;
  }

  // ---------- Pantalla ----------
  function dibujar() {
    const y = window.scrollY;
    const dias = viaje.dias;
    let html = '<div class="hero"><div style="flex:1;min-width:240px">';
    if (editando) {
      html += '<input type="text" id="ed-titulo" class="titulo-edit edit" value="' + A.esc(viaje.titulo) + '" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:8px">';
    } else {
      html += '<h1>' + A.esc(viaje.titulo) + '</h1>';
    }
    html += '<p class="sub" id="sub-viaje"></p>';
    if (editando) {
      html += '<textarea id="ed-desc" class="edit" placeholder="Una descripción del viaje (opcional)" style="width:100%;min-height:60px;padding:.5rem;border:1px solid var(--border);border-radius:8px;font-family:inherit">' + A.esc(viaje.descripcion || '') + '</textarea>';
    } else if (viaje.descripcion) {
      html += '<p style="white-space:pre-wrap">' + A.esc(viaje.descripcion) + '</p>';
    }
    html += '</div><div class="barra">';
    if (!editando) {
      html += '<a class="btn btn-secondary" href="/importar.html?viaje=' + encodeURIComponent(viaje.id) + '">➕ Cargar más fotos</a>' +
        '<button class="btn btn-secondary" id="btn-editar" type="button">✏️ Editar todo el viaje</button>';
    } else {
      html += '<button class="btn btn-primary js-guardar" id="btn-guardar" type="button"' + (sucio ? '' : ' disabled') + '>💾 Guardar cambios</button>' +
        '<button class="btn btn-secondary" id="btn-cancelar" type="button">Cerrar edición</button>' +
        '<button class="btn btn-secondary" id="btn-lugares" type="button" title="Vuelve a calcular el nombre del lugar de cada día con el GPS de sus fotos">🔄 Recalcular lugares</button>' +
        '<button class="btn btn-danger" id="btn-borrar-viaje" type="button">🗑️ Borrar viaje</button>';
    }
    html += '</div></div>';

    if (editando) html += htmlCompartir();

    // mapa
    html += '<div id="mapa-viaje"></div>' +
      '<div id="mapa-info" class="aviso-mapa oculto"></div>';

    // menú de días (queda fijo arriba al hacer scroll)
    html += '<nav class="chips menu" id="chips"><button class="chip activo" data-dia="">🗺️ Recorrido</button>';
    dias.forEach((d, i) => {
      if (d.fecha === V.SIN_FECHA) {
        html += '<button class="chip" data-dia="' + i + '">Sin fecha</button>';
      } else {
        html += '<button class="chip" data-dia="' + i + '" style="border-left:5px solid ' + A.COLORES(i) + '">' + A.esc(tituloCorto(d)) + '</button>';
      }
    });
    html += '</nav>';

    dias.forEach((d, i) => { html += htmlDia(d, i); });
    main.innerHTML = html;
    actualizarResumen();
    ligarGlobal();
    main.querySelectorAll('.dia').forEach(ligarDia);
    montarMapa();
    window.scrollTo(0, y);
    detectarDiaActual();
  }

  // ---------- Compartir este viaje con un link secreto ----------
  function linkDeViaje() {
    return location.origin + '/viaje.html?id=' + encodeURIComponent(viaje.id) + '&k=' + encodeURIComponent(viaje.compartir);
  }
  function tokenNuevo() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  function htmlCompartir() {
    let h = '<div class="panel panel-compartir"><h3>🔗 Compartir este viaje</h3>';
    if (!viaje.compartir) {
      h += '<p class="nota">Ahora este viaje es <strong>privado</strong>: solo lo ves vos. Si lo compartís, quien reciba el link verá <strong>solo este viaje</strong> (sin usuarios ni claves), no el resto de tu sitio.</p>' +
        '<button class="btn btn-primary" id="btn-comp-crear" type="button">Crear link para compartir</button>';
    } else {
      h += '<p class="nota">Cualquiera que tenga este link puede <strong>ver</strong> este viaje (no puede editar ni ver tus otros viajes):</p>' +
        '<input type="text" id="comp-link" readonly value="' + A.esc(linkDeViaje()) + '" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:8px">' +
        '<div class="barra" style="margin-top:.5rem">' +
        '<button class="btn btn-primary" id="btn-comp-copiar" type="button">📋 Copiar link</button>' +
        (navigator.share ? '<button class="btn btn-secondary" id="btn-comp-enviar" type="button">📤 Enviar…</button>' : '') +
        '<button class="btn btn-secondary" id="btn-comp-nuevo" type="button" title="El link anterior deja de funcionar">🔄 Cambiar link</button>' +
        '<button class="btn btn-danger" id="btn-comp-quitar" type="button">Dejar de compartir</button></div>' +
        '<p class="nota">“Cambiar link” o “Dejar de compartir” hacen que el link anterior deje de funcionar al instante.</p>';
    }
    return h + '</div>';
  }
  async function cambiarCompartir(token) {
    if (token) viaje.compartir = token; else delete viaje.compartir;
    const r = await guardarCambios();
    if (!r.ok) { alert('No se pudo guardar: ' + r.error); return; }
    dibujar();
  }
  function ligarCompartir() {
    const bc = $('#btn-comp-crear');
    if (bc) bc.onclick = () => cambiarCompartir(tokenNuevo());
    const bn = $('#btn-comp-nuevo');
    if (bn) bn.onclick = () => { if (confirm('El link anterior dejará de funcionar. ¿Crear uno nuevo?')) cambiarCompartir(tokenNuevo()); };
    const bq = $('#btn-comp-quitar');
    if (bq) bq.onclick = () => { if (confirm('Nadie con el link podrá ver más este viaje. ¿Dejar de compartir?')) cambiarCompartir(null); };
    const bk = $('#btn-comp-copiar');
    if (bk) bk.onclick = async () => {
      const inp = $('#comp-link');
      try { await navigator.clipboard.writeText(linkDeViaje()); bk.textContent = '✅ Copiado'; }
      catch (e) { inp.focus(); inp.select(); bk.textContent = 'Seleccionado: copialo'; }
      setTimeout(() => { bk.textContent = '📋 Copiar link'; }, 2500);
    };
    const be = $('#btn-comp-enviar');
    if (be) be.onclick = () => { navigator.share({ title: viaje.titulo, url: linkDeViaje() }).catch(() => {}); };
    const inp = $('#comp-link');
    if (inp) inp.onfocus = () => inp.select();
  }

  function actualizarResumen() {
    const r = V.resumenViaje(viaje);
    const el = document.getElementById('sub-viaje');
    if (el) el.textContent = V.rangoTexto(r.desde, r.hasta) + ' · ' + viaje.dias.filter(d => d.fecha !== V.SIN_FECHA).length + ' días · ' + nFotos() + ' fotos';
  }

  function htmlDia(d, i) {
    const sin = d.fecha === V.SIN_FECHA;
    const edit = enEdicion(i);
    let h = '<section class="dia' + (edit ? ' editando' : '') + '" id="dia-' + i + '" data-dia="' + i + '"><div class="dia-cab">';
    if (edit) {
      h += '<input type="text" class="edit titulo-edit" data-campo="titulo" data-dia="' + i + '" value="' + A.esc(d.titulo) + '" style="flex:1;min-width:200px;padding:.4rem;border:1px solid var(--border);border-radius:8px">';
    } else {
      h += '<h2>' + A.esc(d.titulo) + '</h2>';
    }
    if (!sin) h += '<span class="fecha">' + A.esc(V.fechaLarga(d.fecha)) + (d.pais ? ' · ' + A.esc(d.pais) : '') + '</span>';
    h += '</div>';

    if (edit) {
      h += '<textarea class="edit" data-campo="comentarios" data-dia="' + i + '" placeholder="Qué hicimos este día, anécdotas, recuerdos…" style="width:100%;margin-top:.5rem;padding:.5rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:70px">' + A.esc(d.comentarios || '') + '</textarea>';
    } else if (d.comentarios) {
      h += '<p class="comentario">' + A.esc(d.comentarios) + '</p>';
    }

    h += '<div class="dia-acciones">';
    if (!edit) {
      if (!sin && V.puntosDelDia(d.fotos).length) h += '<button class="btn-mini" data-accion="ver-mapa" data-dia="' + i + '">📍 Ver este día en el mapa</button>';
      h += '<button class="btn-mini" data-accion="editar-dia" data-dia="' + i + '">✏️ Editar este día</button>';
    } else {
      h += '<button class="btn-mini principal" data-accion="agregar-fotos" data-dia="' + i + '">➕ Agregar fotos</button>' +
        '<input type="file" class="oculto" multiple accept="image/*,.heic,.heif,.json" data-sube="' + i + '">';
      if (diaEditando === d) {
        h += '<button class="btn-mini principal js-guardar" data-accion="guardar-dia" data-dia="' + i + '"' + (sucio ? '' : ' disabled') + '>💾 Guardar</button>' +
          '<button class="btn-mini" data-accion="cerrar-dia" data-dia="' + i + '">Cerrar edición</button>';
      }
      if (!sin && V.puntosDelDia(d.fotos).length) h += '<button class="btn-mini" data-accion="ver-mapa" data-dia="' + i + '">📍 Ver en el mapa</button>';
      if (!d.fotos.length) h += '<button class="btn-mini peligro" data-accion="borrar-dia" data-dia="' + i + '">Quitar día vacío</button>';
    }
    h += '<span class="nota" id="sube-' + i + '"></span></div><div class="fotos">';
    d.fotos.forEach((f, k) => {
      const esPortada = viaje.portada === f.id;
      h += '<div class="foto' + (esPortada ? ' portada' : '') + '"><img loading="lazy" src="' + A.urlFoto(f.id, true) + '" data-accion="abrir" data-dia="' + i + '" data-k="' + k + '" alt="">' +
        (f.lat != null ? '<span class="gps" title="Tiene ubicación">📍</span>' : '') +
        '<span class="hora">' + A.esc(horaTexto(f)) + '</span>';
      if (edit) {
        h += '<div class="foto-ctrl">' +
          '<button title="Quitar foto" data-accion="quitar" data-dia="' + i + '" data-k="' + k + '">✕</button>' +
          '<button title="Usar de portada" data-accion="portada" data-dia="' + i + '" data-k="' + k + '">⭐</button>' +
          '<button title="Mover a otro día" data-accion="mover" data-dia="' + i + '" data-k="' + k + '">↔️</button></div>' +
          '<div class="orden"><button title="Mover antes" data-accion="antes" data-dia="' + i + '" data-k="' + k + '"' + (k === 0 ? ' disabled' : '') + '>◀</button>' +
          '<button title="Mover después" data-accion="despues" data-dia="' + i + '" data-k="' + k + '"' + (k === d.fotos.length - 1 ? ' disabled' : '') + '>▶</button></div>';
      }
      h += '</div>';
    });
    if (!d.fotos.length) h += '<p class="nota">Este día todavía no tiene fotos.</p>';
    h += '</div></section>';
    return h;
  }

  // Vuelve a dibujar un solo día (sin mover la pantalla).
  function redibujarDia(i) {
    const viejo = document.getElementById('dia-' + i);
    if (!viejo) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlDia(viaje.dias[i], i);
    const nuevo = tmp.firstElementChild;
    viejo.replaceWith(nuevo);
    ligarDia(nuevo);
    actualizarResumen();
  }

  // ---------- Mapa ----------
  function montarMapa() {
    if (mapaObj && mapaObj.mapa) { mapaObj.mapa.remove(); mapaObj = null; }
    const conFechas = viaje.dias.map(d => ({ fecha: d.fecha, fotos: d.fotos }));
    const hayGps = conFechas.some(d => V.puntosDelDia(d.fotos).length);
    const cont = $('#mapa-viaje');
    const chipMapa = document.querySelector('#chips .chip[data-dia=""]');
    if (!hayGps || typeof L === 'undefined') {
      cont.style.display = 'none';
      if (chipMapa) chipMapa.style.display = 'none';
      return;
    }
    cont.style.display = '';
    if (chipMapa) chipMapa.style.display = '';
    mapaObj = A.dibujarMapa('mapa-viaje', conFechas, fotoId => {
      for (const d of viaje.dias) {
        const k = d.fotos.findIndex(f => f.id === fotoId);
        if (k >= 0) { abrirVisor(viaje.dias.indexOf(d), k); return; }
      }
    });
  }

  // Muestra un día (o todo el recorrido) en el mapa y lleva la pantalla al mapa.
  function verEnMapa(idx) {
    if (!mapaObj) return;
    mapaObj.enfocarDia(idx);
    const info = $('#mapa-info');
    if (idx == null) {
      info.classList.add('oculto');
    } else {
      const d = viaje.dias[idx];
      info.innerHTML = '<span>📍 Mostrando <strong>' + A.esc(d.titulo) + '</strong></span>' +
        '<button class="btn-mini" data-info="todo">Ver todo el recorrido</button>' +
        '<button class="btn-mini principal" data-info="dia">Ir a este día ↓</button>';
      info.classList.remove('oculto');
      info.querySelector('[data-info=todo]').onclick = () => verEnMapa(null);
      info.querySelector('[data-info=dia]').onclick = () => irADia(idx);
    }
    $('#mapa-viaje').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function abrirVisor(i, k) {
    const d = viaje.dias[i];
    const lista = d.fotos.map(f => ({ id: f.id, cap: [d.titulo, horaTexto(f)].filter(Boolean).join(' · ') }));
    A.abrirVisor(lista, k);
  }

  // ---------- Navegación: menú de días y flechas ----------
  function irADia(i) {
    const el = document.getElementById('dia-' + i);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function irArriba() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function detectarDiaActual() {
    const secciones = Array.from(document.querySelectorAll('.dia'));
    let actual = -1;
    for (const s of secciones) {
      if (s.getBoundingClientRect().top <= 140) actual = Number(s.dataset.dia);
      else break;
    }
    if (actual === diaActual && document.querySelector('#chips .chip.activo')) return;
    diaActual = actual;
    const barra = $('#chips');
    if (!barra) return;
    barra.querySelectorAll('.chip').forEach(c => {
      const activo = actual === -1 ? c.dataset.dia === '' : c.dataset.dia === String(actual);
      c.classList.toggle('activo', activo);
      if (activo) {
        const izq = c.offsetLeft - (barra.clientWidth - c.clientWidth) / 2;
        barra.scrollTo({ left: Math.max(0, izq), behavior: 'smooth' });
      }
    });
  }

  function crearNavFlotante() {
    navFlotante = document.createElement('div');
    navFlotante.className = 'nav-flotante';
    navFlotante.innerHTML =
      '<button type="button" data-nav="arriba" title="Volver arriba (mapa y menú de días)" aria-label="Volver arriba">⤒</button>' +
      '<button type="button" data-nav="prev" title="Día anterior" aria-label="Día anterior">▲</button>' +
      '<button type="button" data-nav="next" title="Día siguiente" aria-label="Día siguiente">▼</button>';
    document.body.appendChild(navFlotante);
    navFlotante.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const n = viaje.dias.length;
      if (b.dataset.nav === 'arriba') irArriba();
      if (b.dataset.nav === 'prev') { if (diaActual <= 0) irArriba(); else irADia(diaActual - 1); }
      if (b.dataset.nav === 'next') { if (diaActual < n - 1) irADia(diaActual + 1); }
    });
    let espera = false;
    window.addEventListener('scroll', () => {
      if (espera) return;
      espera = true;
      requestAnimationFrame(() => { espera = false; detectarDiaActual(); });
    }, { passive: true });
  }

  // ---------- Eventos ----------
  function ligarGlobal() {
    document.querySelectorAll('#chips .chip').forEach(c => {
      c.onclick = () => {
        if (c.dataset.dia === '') {
          if (mapaObj) verEnMapa(null); else irArriba();
        } else {
          irADia(Number(c.dataset.dia));
        }
      };
    });

    const bEd = $('#btn-editar');
    if (bEd) bEd.onclick = async () => { if (!(await verificarClave())) return; editando = true; dibujar(); };
    const bCa = $('#btn-cancelar');
    if (bCa) bCa.onclick = async () => {
      if (sucio) {
        if (confirm('Hay cambios sin guardar. ¿Guardarlos ahora?')) { if (!(await guardar(null))) return; }
        else if (confirm('¿Descartar los cambios?')) { location.reload(); return; }
        else return;
      }
      editando = false; dibujar();
    };
    const bGu = $('#btn-guardar');
    if (bGu) bGu.onclick = () => guardar(bGu);
    const bBv = $('#btn-borrar-viaje');
    if (bBv) bBv.onclick = borrarViaje;
    ligarCompartir();
    const bLu = $('#btn-lugares');
    if (bLu) bLu.onclick = () => recalcularLugares(bLu);

    const t = $('#ed-titulo');
    if (t) t.oninput = () => { viaje.titulo = t.value; marcarSucio(); };
    const ds = $('#ed-desc');
    if (ds) ds.oninput = () => { viaje.descripcion = ds.value; marcarSucio(); };
  }

  function ligarDia(root) {
    root.querySelectorAll('[data-campo]').forEach(el => {
      el.oninput = () => { viaje.dias[Number(el.dataset.dia)][el.dataset.campo] = el.value; marcarSucio(); };
    });

    root.querySelectorAll('[data-accion]').forEach(el => {
      el.onclick = async () => {
        const i = Number(el.dataset.dia), k = Number(el.dataset.k);
        switch (el.dataset.accion) {
          case 'abrir': abrirVisor(i, k); break;
          case 'ver-mapa': verEnMapa(i); break;
          case 'editar-dia': await editarDia(i); break;
          case 'cerrar-dia': await cerrarDia(i); break;
          case 'guardar-dia': await guardar(el); break;
          case 'agregar-fotos': root.querySelector('[data-sube]').click(); break;
          case 'quitar': quitarFoto(i, k); break;
          case 'portada': ponerPortada(i, k); break;
          case 'mover': moverFoto(i, k); break;
          case 'antes': reordenar(i, k, k - 1); break;
          case 'despues': reordenar(i, k, k + 1); break;
          case 'borrar-dia': viaje.dias.splice(i, 1); marcarSucio(); diaEditando = null; dibujar(); break;
        }
      };
    });

    // Arrastrar para ordenar (con el dedo hay que mantener apretado un instante).
    const grilla = root.querySelector('.fotos');
    if (grilla && root.classList.contains('editando') && window.Sortable) {
      const di = Number(root.id.replace('dia-', ''));
      window.Sortable.create(grilla, {
        draggable: '.foto', filter: 'button', preventOnFilter: false,
        delay: 180, delayOnTouchOnly: true, touchStartThreshold: 6, animation: 150,
        onEnd: ev => { if (ev.oldIndex !== ev.newIndex) reordenar(di, ev.oldIndex, ev.newIndex); }
      });
    }

    const inp = root.querySelector('[data-sube]');
    if (inp) inp.onchange = () => { const lista = Array.from(inp.files); inp.value = ''; agregarFotos(Number(inp.dataset.sube), lista); };
  }

  async function editarDia(i) {
    if (!(await verificarClave())) return;
    const anterior = diaEditando ? viaje.dias.indexOf(diaEditando) : -1;
    diaEditando = viaje.dias[i];
    if (anterior >= 0 && anterior !== i) redibujarDia(anterior);
    redibujarDia(i);
  }

  async function cerrarDia(i) {
    if (sucio) {
      if (confirm('Hay cambios sin guardar. ¿Guardarlos ahora?')) { if (!(await guardar(null))) return; }
      else if (confirm('¿Descartar los cambios?')) { location.reload(); return; }
      else return;
    }
    diaEditando = null;
    redibujarDia(i);
  }

  function diaDeFoto(fid) {
    return viaje.dias.findIndex(d => d.fotos.some(f => f.id === fid));
  }

  // Cambia una foto de lugar dentro del mismo día; el día queda en orden manual.
  function reordenar(i, de, a) {
    const d = viaje.dias[i];
    if (a < 0 || a >= d.fotos.length || de === a) { redibujarDia(i); return; }
    const [f] = d.fotos.splice(de, 1);
    d.fotos.splice(a, 0, f);
    d.manual = true;
    marcarSucio();
    redibujarDia(i);
  }

  function quitarFoto(i, k) {
    if (!confirm('¿Quitar esta foto del viaje? Se borra también del sitio al guardar.')) return;
    const [f] = viaje.dias[i].fotos.splice(k, 1);
    borrarIds.push(f.id);
    if (viaje.portada === f.id) viaje.portada = null;
    marcarSucio();
    redibujarDia(i);
    montarMapa();
  }

  function ponerPortada(i, k) {
    const anterior = viaje.portada ? diaDeFoto(viaje.portada) : -1;
    viaje.portada = viaje.dias[i].fotos[k].id;
    marcarSucio();
    redibujarDia(i);
    if (anterior >= 0 && anterior !== i) redibujarDia(anterior);
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
    if (!destino.manual) destino.fotos.sort((a, b) => ((a.t || '') < (b.t || '') ? -1 : 1));
    V.renumerarDias(viaje.dias);
    marcarSucio();
    dibujar();
  }

  // ---------- Agregar fotos a un día ----------
  async function agregarFotos(i, lista) {
    const d = viaje.dias[i];
    const estado = document.getElementById('sube-' + i);
    const sel = await A.prepararSeleccion(lista);
    const archivos = sel.imagenes;
    if (!archivos.length) return;
    estado.textContent = ' Leyendo fotos…';

    const metas = await A.conPool(archivos, 6, f => A.leerMeta(f, sel.idx));
    const ya = new Set();
    viaje.dias.forEach(x => x.fotos.forEach(f => { if (f.src) ya.add(f.src); }));
    const nuevas = metas.filter(m => !ya.has(m.src));
    const repetidas = metas.length - nuevas.length;
    if (!nuevas.length) {
      estado.textContent = ' ' + (repetidas === 1 ? 'Esa foto ya estaba' : 'Esas ' + repetidas + ' fotos ya estaban') + ' cargada(s) en este viaje.';
      return;
    }

    let hechas = 0, claveMala = false;
    const fallidas = [];
    const subidas = await A.conPool(nuevas, 3, async m => {
      if (claveMala) return null;
      try {
        const { grande, mini } = await A.reducir(m.file);
        const r = await A.postear('photo-upload', { dataUrl: grande, thumbUrl: mini, filename: m.file.name });
        if (!r.ok) { if (r.claveMala) claveMala = true; throw new Error(r.error); }
        estado.textContent = ' Subiendo ' + (++hechas) + ' de ' + nuevas.length + '…';
        // La foto queda en ESTE día, aunque su fecha original sea otra: se conserva la hora.
        const f = { id: r.id, src: m.src, t: null };
        if (d.fecha !== V.SIN_FECHA) {
          if (m.t) f.t = d.fecha + m.t.slice(10); else { f.t = d.fecha + 'T12:00:00'; f.sh = 1; }
        } else if (m.t) {
          f.t = null;
        }
        if (m.lat != null) { f.lat = m.lat; f.lon = m.lon; }
        return f;
      } catch (e) {
        if (!claveMala) fallidas.push(m.file.name + ': ' + (e && e.message ? e.message : e));
        return null;
      }
    });

    const ok = subidas.filter(Boolean);
    if (ok.length) {
      ok.forEach(f => d.fotos.push(f));
      if (!d.manual) d.fotos.sort((a, b) => ((a.t || '') < (b.t || '') ? -1 : 1));
      if (!viaje.portada) viaje.portada = d.fotos[0].id;
      marcarSucio();
      estado.textContent = ' Guardando…';
      const r = await guardarCambios();
      if (!r.ok) alert('Las fotos se subieron pero no se pudo guardar el viaje: ' + r.error + '\nTocá “Guardar” para reintentar.');
    }
    redibujarDia(i);
    montarMapa();
    const est2 = document.getElementById('sube-' + i);
    if (est2) est2.textContent = ok.length ? ' ✅ ' + ok.length + (ok.length === 1 ? ' foto agregada' : ' fotos agregadas') + (repetidas ? ' (' + repetidas + ' ya estaban)' : '') : '';
    if (claveMala) alert('La clave dejó de ser válida. Volvé a intentar e ingresala de nuevo.');
    if (fallidas.length) alert(fallidas.length + ' fotos no se pudieron cargar:\n\n' + fallidas.slice(0, 8).join('\n'));
  }

  // Vuelve a calcular el nombre del lugar de cada día con el GPS de sus fotos.
  // Si un día tiene fotos de varias ciudades queda "Venecia → Madrid". Los
  // títulos que se escribieron a mano no se tocan (solo los armados solos).
  async function recalcularLugares(btn) {
    if (!confirm('Se vuelven a buscar los nombres de lugar de cada día según el GPS de sus fotos (una consulta por segundo, puede tardar un poco). Los títulos que escribiste a mano no se tocan. ¿Seguir?')) return;
    const texto = btn.textContent;
    btn.disabled = true;
    const dias = viaje.dias.filter(d => d.fecha !== V.SIN_FECHA && V.tramosDelDia(d.fotos).length);
    let i = 0, cambios = 0;
    for (const d of dias) {
      btn.textContent = 'Buscando lugares… ' + (++i) + '/' + dias.length;
      const r = await A.nombresDelDia(d.fotos);
      if (!r) continue;
      const viejo = d.lugar || '';
      if (r.lugar === viejo && (r.pais || '') === (d.pais || '')) continue;
      const resto = (d.titulo || '').replace(/^Día\s+\d+/i, '').trim();
      if (resto === '' || resto === '· ' + viejo) d.titulo = (d.titulo || 'Día 0').replace(/^(Día\s+\d+).*$/i, '$1') + ' · ' + r.lugar;
      d.lugar = r.lugar;
      d.pais = r.pais;
      cambios++;
    }
    V.renumerarDias(viaje.dias);
    btn.textContent = texto;
    btn.disabled = false;
    if (cambios) {
      marcarSucio();
      dibujar();
      alert(cambios + (cambios === 1 ? ' día actualizado' : ' días actualizados') + '. Tocá “Guardar cambios” para conservarlos.');
    } else {
      alert('Los nombres de lugar ya estaban al día.');
    }
  }

  // ---------- Guardar ----------
  async function guardarCambios() {
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
      const b = await A.postear('photo-delete', { ids: borrarIds });
      if (b.ok) borrarIds = [];
    }
    if (r.ok) sucio = false;
    return r;
  }

  async function guardar(btn) {
    const texto = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    const r = await guardarCambios();
    if (!r.ok) {
      alert('No se pudo guardar: ' + r.error);
      if (btn) { btn.disabled = false; btn.textContent = texto; }
      return false;
    }
    document.querySelectorAll('.js-guardar').forEach(b => { b.disabled = true; });
    if (btn) {
      btn.textContent = '✅ Guardado';
      setTimeout(() => { if (btn.isConnected) btn.textContent = texto; }, 1500);
    }
    return true;
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
