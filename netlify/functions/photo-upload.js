import { getStore } from "@netlify/blobs";
import { json, claveCorrecta, leerJSON } from "./_util.js";

const MAX_BYTES = 3 * 1024 * 1024;

function decodificar(dataUrl) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

// Sube una foto ya reducida (dataUrl) y, opcionalmente, su miniatura (thumbUrl).
// Guarda la grande con el id y la miniatura con el id + "-t".
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = await leerJSON(req);
  if (!body) return json({ error: "JSON inválido" }, 400);
  const { password, dataUrl, thumbUrl, filename } = body;
  if (!claveCorrecta(password)) return json({ error: "Clave incorrecta" }, 401);

  const grande = decodificar(dataUrl);
  if (!grande) return json({ error: "Formato de imagen inválido" }, 400);
  if (grande.buffer.length > MAX_BYTES) return json({ error: "La imagen es demasiado pesada" }, 413);
  const mini = thumbUrl ? decodificar(thumbUrl) : null;

  const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  try {
    const store = getStore("fotos");
    await store.set(id, grande.buffer, { metadata: { contentType: grande.contentType, filename: filename || id } });
    if (mini) await store.set(id + "-t", mini.buffer, { metadata: { contentType: mini.contentType } });
    return json({ ok: true, id });
  } catch (err) {
    return json({ error: "Error guardando la imagen", detalle: String(err) }, 500);
  }
};
