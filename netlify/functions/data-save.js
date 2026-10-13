import { getStore } from "@netlify/blobs";
import { json, claveCorrecta, leerJSON } from "./_util.js";

// Guardar (o borrar, con data = null) un dato. Requiere la clave de edición.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = await leerJSON(req);
  if (!body) return json({ error: "JSON inválido" }, 400);
  const { password, key, data } = body;
  if (!claveCorrecta(password)) return json({ error: "Clave incorrecta" }, 401);
  if (typeof key !== "string" || !/^[a-z0-9-]{1,60}$/.test(key)) return json({ error: "Clave de dato inválida" }, 400);
  try {
    const store = getStore("datos");
    if (data === null || data === undefined) {
      await store.delete(key);
    } else {
      // Las firmas y el token de lectura se calculan al leer; no se guardan en las fotos.
      if (Array.isArray(data)) data.forEach(v => { if (v && typeof v === "object") { delete v.ps; delete v.s; } });
      else if (data && Array.isArray(data.dias)) data.dias.forEach(d => (d.fotos || []).forEach(f => { delete f.s; }));
      const texto = JSON.stringify(data);
      if (texto.length > 4 * 1024 * 1024) return json({ error: "Los datos son demasiado grandes" }, 413);
      await store.set(key, texto);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: "Error guardando datos", detalle: String(err) }, 500);
  }
};
