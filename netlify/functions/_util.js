// Utilidades compartidas por las funciones (el guion bajo evita que Netlify
// lo publique como si fuera una función).
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }
  });
}

export function claveCorrecta(password) {
  return !!process.env.EDIT_PASSWORD && password === process.env.EDIT_PASSWORD;
}

export async function leerJSON(req) {
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}
