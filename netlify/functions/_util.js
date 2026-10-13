// Utilidades compartidas por las funciones (el guion bajo evita que Netlify
// lo publique como si fuera una función).
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }
  });
}

function iguales(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function claveCorrecta(password) {
  return !!process.env.EDIT_PASSWORD && typeof password === "string" && iguales(password, process.env.EDIT_PASSWORD);
}

// Firma de una foto: solo la reciben quienes pueden ver el viaje (dueño o link
// secreto), y sin ella la foto no se entrega. Así un id de foto no sirve solo.
export function firmar(id) {
  return createHmac("sha256", "mv1|" + (process.env.EDIT_PASSWORD || "")).update(String(id)).digest("hex").slice(0, 24);
}
export function firmaValida(id, s) {
  return !!process.env.EDIT_PASSWORD && typeof s === "string" && iguales(s, firmar(id));
}

export function idNuevo() {
  return Date.now().toString(36) + "-" + randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function leerJSON(req) {
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}
