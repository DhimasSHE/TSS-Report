const DB_NAME = "TSSFieldReportDB";
const STORE = "reports";
const $ = (id) => document.getElementById(id);
let currentPhoto = null;

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(record) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function dbAll() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result.sort((a,b)=>b.createdAt-a.createdAt)); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function dbDelete(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function setNetwork() {
  const online = navigator.onLine;
  $("network").textContent = online ? "● Online — siap membagikan laporan" : "● Offline — laporan tetap dapat disimpan";
  $("network").className = "status " + (online ? "online" : "offline");
}
function toLocalInputValue(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset()*60000);
  return d.toISOString().slice(0,16);
}
async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Pilih file foto yang valid.");
  if (file.size > 8*1024*1024) throw new Error("Ukuran foto awal melebihi 8 MB.");
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.78));
}
$("tanggal").value = toLocalInputValue(new Date());
$("foto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  $("preview").hidden = true;
  currentPhoto = null;
  if (!file) return;
  try {
    currentPhoto = await compressImage(file);
    $("preview").src = URL.createObjectURL(currentPhoto);
    $("preview").hidden = false;
  } catch(err) {
    alert(err.message);
    e.target.value = "";
  }
});
$("reportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inlet = Number($("inlet").value), outlet = Number($("outlet").value), ph = Number($("ph").value);
  const tawas = Number($("tawas").value), flokullan = Number($("flokullan").value);
  if (!currentPhoto) { alert("Foto dokumentasi wajib dipilih."); return; }
  if (![inlet,outlet,ph,tawas,flokullan].every(Number.isFinite) ||
      inlet < 0 || outlet < 0 || ph < 0 || ph > 14 || tawas < 0 || flokullan < 0) {
    alert("Periksa kembali nilai TSS, pH, dan penggunaan chemical."); return;
  }
  const record = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    tanggal: $("tanggal").value,
    pic: $("pic").value.trim(),
    lokasi: $("lokasi").value,
    inlet, outlet, ph, tawas, flokullan,
    catatan: $("catatan").value.trim(),
    photo: currentPhoto,
    status: "Belum dibagikan"
  };
  if (!record.pic || !record.lokasi) { alert("PIC dan lokasi wajib diisi."); return; }
  try {
    await dbPut(record);
    $("saveStatus").textContent = "✓ Laporan tersimpan di perangkat ini.";
    $("reportForm").reset();
    $("tanggal").value = toLocalInputValue(new Date());
    $("preview").hidden = true;
    currentPhoto = null;
    await renderReports();
  } catch(err) {
    alert("Gagal menyimpan. Periksa ruang penyimpanan perangkat: " + err.message);
  }
});
function makeMessage(r) {
  return [
    "📝 *TSS FIELD REPORT*",
    "Tanggal: " + new Date(r.tanggal).toLocaleString("id-ID"),
    "PIC: " + r.pic,
    "Lokasi: " + r.lokasi,
    "TSS Inlet: " + r.inlet + " mg/L",
    "TSS Outlet: " + r.outlet + " mg/L",
    "pH Outlet: " + r.ph,
    "Penggunaan Chemical:",
    "• Tawas: " + r.tawas + " karung",
    "• Flokullan: " + r.flokullan + " kg",
    "Keterangan: " + (r.catatan || "-"),
    "Status: " + r.status
  ].join("\n");
}
async function shareReport(id) {
  if (!navigator.onLine) { alert("Perangkat masih offline. Simpan laporan dahulu, lalu bagikan saat online."); return; }
  const records = await dbAll();
  const r = records.find(x => x.id === id);
  if (!r) return;
  const file = new File([r.photo], `TSS_${r.lokasi.replace(/[^a-z0-9]/gi,"_")}_${r.id.slice(0,6)}.jpg`, {type:"image/jpeg"});
  const text = makeMessage(r);
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
      await navigator.share({title:"TSS Field Report", text, files:[file]});
      r.status = "Sudah dibagikan (konfirmasi petugas)";
      await dbPut(r);
      await renderReports();
    } else {
      await navigator.clipboard?.writeText(text);
      const wa = "https://wa.me/?text=" + encodeURIComponent(text);
      window.open(wa, "_blank");
      alert("Teks laporan dibuka di WhatsApp. Untuk foto, lampirkan foto dari galeri secara manual. Salinan foto tetap tersimpan di antrean aplikasi.");
    }
  } catch(err) {
    if (err.name !== "AbortError") alert("Tidak dapat membuka menu berbagi: " + err.message);
  }
}
async function renderReports() {
  const records = await dbAll();
  $("storage").textContent = `${records.length} laporan tersimpan di perangkat ini`;
  const root = $("reports");
  root.innerHTML = "";
  if (!records.length) { root.innerHTML = '<p class="small">Belum ada laporan tersimpan.</p>'; return; }
  for (const r of records) {
    const item = document.createElement("div");
    item.className = "report";
    const title = document.createElement("strong");
    title.textContent = `${r.lokasi} · ${r.tanggal.replace("T"," ")}`;
    const p = document.createElement("p");
    p.textContent = `PIC: ${r.pic} | Inlet: ${r.inlet} | Outlet: ${r.outlet} mg/L | pH: ${r.ph} | Tawas: ${r.tawas ?? 0} karung | Flokullan: ${r.flokullan ?? 0} kg`;
    const state = document.createElement("p");
    state.textContent = r.status;
    const img = document.createElement("img");
    img.className = "thumb"; img.alt = "Foto dokumentasi"; img.src = URL.createObjectURL(r.photo);
    const buttons = document.createElement("div"); buttons.className = "row"; buttons.style.marginTop = "9px";
    const send = document.createElement("button"); send.className = "share"; send.type="button"; send.textContent="Kirim ke WhatsApp";
    send.addEventListener("click",()=>shareReport(r.id));
    const del = document.createElement("button"); del.className = "danger"; del.type="button"; del.textContent="Hapus";
    del.addEventListener("click",async()=>{ if(confirm("Hapus laporan ini dari perangkat?")){await dbDelete(r.id);renderReports();}});
    buttons.append(send,del); item.append(title,p,state,img,buttons); root.append(item);
  }
}
$("refreshBtn").addEventListener("click", renderReports);
window.addEventListener("online",setNetwork);
window.addEventListener("offline",setNetwork);
if ("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
setNetwork();
renderReports().catch(err => $("reports").textContent = "Database lokal tidak dapat dibuka: " + err.message);