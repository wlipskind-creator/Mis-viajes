import { getStore } from "@netlify/blobs";
import { json, claveCorrecta, leerJSON } from "./_util.js";

// Borra fotos (y sus miniaturas) del almacenamiento. Requiere la clave.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = await leerJSON(req);
  if (!body) return json({ error: "JSON inválido" }, 400);
  const { password, ids } = body;
  if (!claveCorrecta(password)) return json({ error: "Clave incorrecta" }, 401);
  if (!Array.isArray(ids)) return json({ error: "Faltan los ids" }, 400);
  try {
    const store = getStore("fotos");
    let borradas = 0;
    for (const id of ids) {
      if (typeof id !== "string" || !/^[a-z0-9-]{1,60}$/.test(id)) continue;
      await store.delete(id);
      await store.delete(id + "-t");
      borradas++;
    }
    return json({ ok: true, borradas });
  } catch (err) {
    return json({ error: "Error borrando fotos", detalle: String(err) }, 500);
  }
};
