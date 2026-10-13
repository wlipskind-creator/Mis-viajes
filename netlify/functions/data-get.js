import { getStore } from "@netlify/blobs";
import { json, claveCorrecta, firmar } from "./_util.js";

// Lectura con permisos:
//  - La lista de viajes ("indice") y todo lo demás: solo con la clave del dueño (cabecera x-clave).
//  - Un viaje ("viaje-xxxx"): con la clave del dueño o con el link secreto de ese viaje (?k=...).
// Las fotos de la respuesta llevan una firma "s" que hace falta para pedir cada imagen.
export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(key)) return json({ error: "Clave de dato inválida" }, 400);

  const clave = req.headers.get("x-clave");
  const dueno = claveCorrecta(clave);
  if (clave && !dueno) return json({ error: "Clave incorrecta" }, 401);

  try {
    const store = getStore("datos");
    const data = await store.get(key, { type: "json" });

    if (!/^viaje-/.test(key)) {
      if (!dueno) return json({ error: "privado" }, 403);
      if (key === "indice" && Array.isArray(data)) data.forEach(v => { if (v && v.portada) v.ps = firmar(v.portada); });
      return json({ ok: true, data: data === undefined ? null : data });
    }

    if (data === undefined || data === null) return json({ ok: true, data: null }, dueno ? 200 : 403);
    const k = url.searchParams.get("k") || "";
    const conLink = !!data.compartir && typeof data.compartir === "string" && k.length >= 16 && k === data.compartir;
    if (!dueno && !conLink) return json({ error: "privado" }, 403);

    (data.dias || []).forEach(d => (d.fotos || []).forEach(f => { f.s = firmar(f.id); }));
    if (!dueno) delete data.compartir; // quien ve por link no necesita el dato
    return json({ ok: true, data, dueno });
  } catch (err) {
    return json({ error: "Error leyendo datos", detalle: String(err) }, 500);
  }
};
