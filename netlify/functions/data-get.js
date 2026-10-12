import { getStore } from "@netlify/blobs";
import { json } from "./_util.js";

// Lectura pública (cualquiera con el link puede ver los viajes).
// GET /.netlify/functions/data-get?key=indice   |   ?key=viaje-abc123
export default async (req) => {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(key)) return json({ error: "Clave de dato inválida" }, 400);
  try {
    const store = getStore("datos");
    const data = await store.get(key, { type: "json" });
    return json({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    return json({ error: "Error leyendo datos", detalle: String(err) }, 500);
  }
};
