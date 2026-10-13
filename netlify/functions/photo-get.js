import { getStore } from "@netlify/blobs";
import { firmaValida } from "./_util.js";

// Hace falta la firma ?s=... (la entrega data-get a quien puede ver el viaje).
// GET ?id=...        -> foto grande
// GET ?id=...&t=1    -> miniatura (si no existe, devuelve la grande)
export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return new Response("id inválido", { status: 400 });
  if (!firmaValida(id, url.searchParams.get("s"))) return new Response("Sin permiso", { status: 403 });
  try {
    const store = getStore("fotos");
    let res = null;
    if (url.searchParams.get("t")) res = await store.getWithMetadata(id + "-t", { type: "arrayBuffer" });
    if (!res) res = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!res) return new Response("No encontrada", { status: 404 });
    return new Response(res.data, {
      headers: {
        "Content-Type": (res.metadata && res.metadata.contentType) || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (err) {
    return new Response("Error leyendo la foto", { status: 500 });
  }
};
