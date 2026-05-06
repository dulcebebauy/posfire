// ============================================================
//  firebase-backend.js
//  Reemplaza el backend de Google Apps Script usando Firebase
//  Incluí este archivo en tu HTML con:
//  <script type="module" src="firebase-backend.js"></script>
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ── Configuración ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBLA7zH6hsCE7m5IUHgF2mN095aP6jCjjQ",
  authDomain: "posdb-f5a31.firebaseapp.com",
  projectId: "posdb-f5a31",
  storageBucket: "posdb-f5a31.firebasestorage.app",
  messagingSenderId: "104051381554",
  appId: "1:104051381554:web:1dabf13f8dfdf62f77332b",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── Helpers ──────────────────────────────────────────────────
function clean(str) {
  return String(str).replace(/[<>]/g, "");
}

// ── PRODUCTOS ────────────────────────────────────────────────

/**
 * Obtiene todos los productos.
 * @returns {Promise<Array>} Lista de productos
 */
export async function getProductos() {
  const snap = await getDocs(collection(db, "productos"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Agrega un nuevo producto.
 * @param {{ nombre: string, descripcion?: string, precio: number, categoria: string }} data
 * @returns {Promise<{ ok: boolean, id: string }>}
 */
export async function agregarProducto(data) {
  const id = `prod_${Date.now()}_${String(data.nombre).replace(/\s+/g, "_")}`;
  await setDoc(doc(db, "productos", id), {
    nombre: clean(data.nombre),
    descripcion: clean(data.descripcion || ""),
    precio: Number(data.precio),
    categoria: data.categoria,
  });
  return { ok: true, id };
}

/**
 * Edita un producto existente.
 * @param {{ id: string, nombre?: string, descripcion?: string, precio?: number, categoria?: string }} data
 * @returns {Promise<{ ok: boolean }>}
 */
export async function editarProducto(data) {
  if (!data.id) throw new Error("id requerido");
  const ref = doc(db, "productos", data.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("producto no encontrado");

  const updates = {};
  if (data.nombre !== undefined)      updates.nombre      = clean(data.nombre);
  if (data.descripcion !== undefined) updates.descripcion = clean(data.descripcion);
  if (data.precio !== undefined)      updates.precio      = Number(data.precio);
  if (data.categoria !== undefined)   updates.categoria   = data.categoria;

  await updateDoc(ref, updates);
  return { ok: true };
}

/**
 * Elimina un producto.
 * @param {string} id
 * @returns {Promise<{ ok: boolean }>}
 */
export async function eliminarProducto(id) {
  if (!id) throw new Error("id requerido");
  const ref = doc(db, "productos", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("producto no encontrado");
  await deleteDoc(ref);
  return { ok: true };
}

// ── VENTAS ───────────────────────────────────────────────────

/**
 * Registra una venta. Busca el precio real de cada producto en Firestore.
 * @param {{ items: Array<{ id: string, cantidad: number, nombre?: string, precio?: number, total?: number }>, metodo: 'efectivo'|'debito'|'credito' }} data
 * @returns {Promise<{ ok: boolean, count: number }>}
 */
export async function registrarVenta(data) {
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("Items inválidos");
  }
  if (!["efectivo", "debito", "credito"].includes(data.metodo)) {
    throw new Error("Método inválido");
  }

  // Traer todos los productos para validar precios
  const productosSnap = await getDocs(collection(db, "productos"));
  const productosMap = {};
  productosSnap.docs.forEach((d) => {
    productosMap[d.id] = { nombre: d.data().nombre, precio: Number(d.data().precio) };
  });

  const fecha = new Date().toISOString();
  const promises = [];

  for (const item of data.items) {
    if (!item.id) throw new Error("Item sin ID");
    if (!item.cantidad || item.cantidad <= 0) throw new Error("Cantidad inválida");

    let registro;

    if (item.id === "descuento") {
      registro = {
        fecha,
        nombre: item.nombre || "Descuento",
        cantidad: item.cantidad,
        precio: item.precio || 0,
        total: item.total || 0,
        metodo: data.metodo,
      };
    } else {
      const prod = productosMap[item.id];
      if (!prod) continue; // ignora productos inválidos
      const precio = prod.precio;
      registro = {
        fecha,
        nombre: prod.nombre,
        cantidad: item.cantidad,
        precio,
        total: precio * item.cantidad,
        metodo: data.metodo,
      };
    }

    promises.push(addDoc(collection(db, "ventas"), registro));
  }

  await Promise.all(promises);
  return { ok: true, count: promises.length };
}

// ── REPORTE ──────────────────────────────────────────────────

/**
 * Obtiene todas las ventas ordenadas por fecha.
 * @returns {Promise<Array>}
 */
export async function getReporte() {
  const q = query(collection(db, "ventas"), orderBy("fecha", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── BACKUP ───────────────────────────────────────────────────

/**
 * Descarga todas las ventas como archivo JSON.
 * @param {{ desde?: string, hasta?: string }} opciones  (fechas ISO opcionales)
 */
export async function descargarBackup({ desde, hasta } = {}) {
  let ventas = await getReporte();

  if (desde) ventas = ventas.filter((v) => v.fecha >= desde);
  if (hasta) ventas = ventas.filter((v) => v.fecha <= hasta);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const ts = Math.floor(Date.now() / 1000);
  const nombre = `${yyyy}${mm}${dd}_${ts}_ventas`;

  const blob = new Blob(
    [JSON.stringify({ nombre, total: ventas.length, generado: now.toISOString(), ventas }, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return { ok: true, nombre, total: ventas.length };
}
