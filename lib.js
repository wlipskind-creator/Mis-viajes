// Lógica pura (sin pantalla): agrupar fotos en viajes y días, armar los puntos
// del recorrido a partir del GPS, y armar títulos. Se usa en el navegador y
// también se puede probar en Node.
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');

  // Las fotos guardan la fecha "tal cual la marcó la cámara" (hora local del
  // lugar), como texto AAAA-MM-DDTHH:MM:SS, sin convertir zonas horarias.
  function textoDeFecha(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // "2019:07:03 14:22:10" (formato EXIF) -> "2019-07-03T14:22:10", o null si no sirve.
  function textoDeExif(str) {
    const m = typeof str === 'string' && str.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return null;
    const año = Number(m[1]);
    if (año < 1990 || año > new Date().getFullYear() + 1) return null;
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
  }

  const SIN_FECHA = 'sin-fecha';
  function diaDe(t) { return t ? t.slice(0, 10) : SIN_FECHA; }
  function horaDe(t) { return t ? t.slice(11, 16) : ''; }

  function utcDeDia(dia) {
    const [y, m, d] = dia.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function diffDias(a, b) {
    return Math.round((utcDeDia(b) - utcDeDia(a)) / 86400000);
  }

  function distKm(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function porFecha(a, b) { const x = a.t || '', y = b.t || ''; return x < y ? -1 : x > y ? 1 : 0; }

  // Separa en viajes: un viaje nuevo empieza cuando pasan más de `gapDias`
  // días seguidos sin ninguna foto.
  function agruparViajes(fotos, gapDias) {
    const orden = fotos.filter(f => f.t).sort(porFecha);
    const viajes = [];
    let actual = null, ultimoDia = null;
    for (const f of orden) {
      const dia = diaDe(f.t);
      if (!actual || diffDias(ultimoDia, dia) > gapDias) {
        actual = [];
        viajes.push(actual);
      }
      actual.push(f);
      ultimoDia = dia;
    }
    return viajes;
  }

  // Agrupa las fotos de un viaje por día (orden cronológico).
  function agruparDias(fotos) {
    const mapa = new Map();
    for (const f of fotos.slice().sort(porFecha)) {
      const dia = diaDe(f.t);
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia).push(f);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([fecha, lista]) => ({ fecha, fotos: lista }));
  }

  // Convierte las fotos GPS de un día en "paradas": fotos seguidas que están
  // cerca entre sí se juntan en un solo punto. Si salen demasiadas paradas se
  // agranda el radio hasta que entren en `maxPuntos`.
  function puntosDelDia(fotos, maxPuntos) {
    maxPuntos = maxPuntos || 40;
    const gps = fotos.filter(f => typeof f.lat === 'number' && typeof f.lon === 'number').sort(porFecha);
    if (!gps.length) return [];
    let puntos = [];
    for (const radio of [0.3, 0.6, 1.2, 2.5, 5, 10, 25]) {
      puntos = [];
      for (const f of gps) {
        const c = puntos[puntos.length - 1];
        if (c && distKm(c.lat, c.lon, f.lat, f.lon) <= radio) {
          c.n++;
          c.lat += (f.lat - c.lat) / c.n;
          c.lon += (f.lon - c.lon) / c.n;
          c.ids.push(f.id);
        } else {
          puntos.push({ lat: f.lat, lon: f.lon, t: f.t, n: 1, ids: [f.id] });
        }
      }
      if (puntos.length <= maxPuntos) break;
    }
    return puntos;
  }

  // Punto central (mediana) de las fotos con GPS, o null si no hay ninguna.
  function centro(fotos) {
    const gps = fotos.filter(f => typeof f.lat === 'number' && typeof f.lon === 'number');
    if (!gps.length) return null;
    const med = arr => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return { lat: med(gps.map(f => f.lat)), lon: med(gps.map(f => f.lon)) };
  }

  // Divide las fotos con GPS de un día en "tramos" por ciudad: mientras las
  // fotos sigan a menos de `umbralKm` del inicio del tramo, son el mismo
  // lugar; si se alejan más (otra ciudad, un vuelo), empieza un tramo nuevo.
  // Devuelve [{lat, lon, n}] en orden de hora (lat/lon = punto central).
  function tramosDelDia(fotos, umbralKm) {
    umbralKm = umbralKm || 40;
    const gps = fotos.filter(f => typeof f.lat === 'number' && typeof f.lon === 'number').sort(porFecha);
    const tramos = [];
    let actual = null;
    for (const f of gps) {
      if (!actual || distKm(actual.lat0, actual.lon0, f.lat, f.lon) > umbralKm) {
        actual = { lat0: f.lat, lon0: f.lon, puntos: [] };
        tramos.push(actual);
      }
      actual.puntos.push(f);
    }
    return tramos.map(t => {
      const c = centro(t.puntos);
      return { lat: c.lat, lon: c.lon, n: t.puntos.length };
    });
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function fechaLarga(dia) {
    if (dia === SIN_FECHA) return 'Fotos sin fecha';
    const [y, m, d] = dia.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return DIAS_SEMANA[dow] + ' ' + d + ' de ' + MESES[m - 1] + ' de ' + y;
  }

  function fechaCorta(dia) {
    if (dia === SIN_FECHA) return 'Sin fecha';
    const [y, m, d] = dia.split('-').map(Number);
    return d + ' ' + MESES[m - 1].slice(0, 3) + ' ' + y;
  }

  function rangoTexto(desde, hasta) {
    if (!desde) return '';
    if (!hasta || hasta === desde) return fechaCorta(desde);
    const [y1, m1, d1] = desde.split('-').map(Number);
    const [y2, m2, d2] = hasta.split('-').map(Number);
    if (y1 === y2 && m1 === m2) return d1 + '–' + d2 + ' ' + MESES[m1 - 1].slice(0, 3) + ' ' + y1;
    if (y1 === y2) return d1 + ' ' + MESES[m1 - 1].slice(0, 3) + ' – ' + d2 + ' ' + MESES[m2 - 1].slice(0, 3) + ' ' + y1;
    return fechaCorta(desde) + ' – ' + fechaCorta(hasta);
  }

  // Título sugerido: hasta 3 lugares distintos + año. Si no hay lugares
  // (fotos sin GPS) queda "Viaje de <mes> <año>".
  function tituloViaje(lugares, desde) {
    const [y, m] = desde.split('-').map(Number);
    const unicos = [];
    for (const l of lugares) if (l && !unicos.includes(l)) unicos.push(l);
    if (!unicos.length) return 'Viaje de ' + MESES[m - 1] + ' de ' + y;
    return unicos.slice(0, 3).join(' · ') + ' (' + y + ')';
  }

  // Título de un día: "Día N · Lugar" (o "Día N" si no se sabe el lugar).
  function tituloDia(n, lugar) {
    return 'Día ' + n + (lugar ? ' · ' + lugar : '');
  }

  // Vuelve a numerar los títulos "Día N · ..." según el orden cronológico,
  // respetando lo que haya escrito la persona después del número.
  function renumerarDias(dias) {
    dias.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)); // 'sin-fecha' queda al final
    let n = 0;
    dias.forEach(d => {
      if (d.fecha === SIN_FECHA) { d.titulo = d.titulo || 'Fotos sin fecha'; return; }
      n++;
      const resto = (d.titulo || '').replace(/^Día\s+\d+/i, '').trim();
      d.titulo = 'Día ' + n + (resto ? ' ' + resto : '');
    });
    return dias;
  }

  // Suma días nuevos a un viaje existente: si la fecha ya existe junta las
  // fotos en ese día; si no, crea el día. Sin duplicar fotos (por id).
  function unirDias(existentes, nuevos) {
    const porFechaDia = new Map(existentes.map(d => [d.fecha, d]));
    for (const n of nuevos) {
      const ya = porFechaDia.get(n.fecha);
      if (ya) {
        const ids = new Set(ya.fotos.map(f => f.id));
        for (const f of n.fotos) if (!ids.has(f.id)) ya.fotos.push(f);
        ya.fotos.sort(porFecha);
        if (!ya.lugar && n.lugar) ya.lugar = n.lugar;
      } else {
        existentes.push(n);
        porFechaDia.set(n.fecha, n);
      }
    }
    return renumerarDias(existentes);
  }

  // Resumen para la tarjeta de un viaje (lista de inicio).
  function resumenViaje(v) {
    const todas = v.dias.reduce((acc, d) => acc.concat(d.fotos), []);
    const fechas = v.dias.map(d => d.fecha).filter(f => f !== SIN_FECHA).sort();
    const lugares = [];
    for (const d of v.dias) if (d.lugar && !lugares.includes(d.lugar)) lugares.push(d.lugar);
    return {
      id: v.id,
      titulo: v.titulo,
      desde: fechas[0] || '',
      hasta: fechas[fechas.length - 1] || '',
      fotos: todas.length,
      portada: v.portada || (todas[0] && todas[0].id) || null,
      lugares: lugares.slice(0, 6)
    };
  }

  const api = {
    SIN_FECHA, textoDeExif, textoDeFecha, diaDe, horaDe, diffDias, distKm,
    agruparViajes, agruparDias, puntosDelDia, centro, tramosDelDia,
    fechaLarga, fechaCorta, rangoTexto, tituloViaje, tituloDia,
    renumerarDias, unirDias, resumenViaje
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Viajes = api;
})(typeof window !== 'undefined' ? window : globalThis);
