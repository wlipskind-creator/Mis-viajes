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
      const texto = JSON.stringify(data);
      if (texto.length > 4 * 1024 * 1024) return json({ error: "Los datos son demasiado grandes" }, 413);
      await store.set(key, texto);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: "Error guardando datos", detalle: String(err) }, 500);
  }
};
