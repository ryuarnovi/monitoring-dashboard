# Cloudflare VPS Monitoring Dashboard

Dashboard monitoring VPS **zero-agent**, ringan, dan aman, yang berjalan sepenuhnya di infrastruktur Cloudflare. Tidak ada agen, daemon, exporter, atau software apa pun yang dipasang pada VPS yang dipantau — semua pengukuran dilakukan dari luar (external-only) oleh Cloudflare Workers.

## Prinsip

- **Zero-agent** — nol jejak pada VPS target.
- **External monitoring only** — HTTP/HTTPS probe dari Cloudflare edge.
- **Tidak ada angka palsu** — CPU / RAM / Disk ditampilkan sebagai *Not available — requires internal metrics*.
- **HTTP latency, bukan ICMP ping** — metrik disebut secara eksplisit sebagai HTTP response time.
- **Secure by default** — dilindungi Cloudflare Access + verifikasi JWT di Worker.

## Arsitektur

| Komponen | Fungsi |
| --- | --- |
| Cloudflare Workers | API + static SPA + logika probe |
| Cron Trigger | Probe tiap 2 menit (`*/2 * * * *`) |
| D1 (`vps_monitor_db`) | Target, health checks, insiden, metrik uptime |
| Cloudflare Access | Proteksi `monitor.DOMAIN.COM` (Zero Trust) |
| React + Tailwind + Recharts + Lucide | Dashboard responsif |

Alur: Cron/API → `executeExternalProbe()` → `recordCheckResult()` → D1 → endpoint API → dashboard.

## Fitur

- Uptime 24 jam / 7 hari / 30 hari (dihitung dari data nyata; `null` bila belum ada data).
- Status **online / degraded / offline** + HTTP status code + error message.
- HTTP latency: min / avg / max + grafik (1H, 6H, 24H, 7D, 30D) + penanda threshold *high*.
- Riwayat insiden otomatis (dibuka saat gagal/degraded, ditutup saat sehat lagi).
- Indikator PoP Cloudflare tempat probe dijalankan.
- CPU / RAM / Disk: **Not available — Requires internal metrics** (disengaja).
- Network: **external HTTP reachability** (bukan ICMP).

## Development

```bash
npm install
npm run d1:init          # inisialisasi schema D1 lokal
npm run dev              # frontend di http://localhost:3000 (proxy /api → :8787)
npm run worker:dev       # Worker + API di http://localhost:8787
```

Pada localhost, otorisasi otomatis diizinkan untuk development.

## Deployment ke production

1. **Buat database D1**

   ```bash
   npx wrangler d1 create vps_monitor_db
   ```

   Salin `database_id` yang dihasilkan ke `wrangler.jsonc`, mengganti nilai
   `vps-monitor-d1-placeholder`.

2. **Terapkan schema**

   ```bash
   npm run d1:init:prod
   ```

3. **Set secret / env var Cloudflare Access** (wajib untuk produksi)

   ```bash
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # mis. myteam.cloudflareaccess.com
   npx wrangler secret put CF_ACCESS_AUD           # Application Audience (AUD) tag
   ```

   Opsional: `LATENCY_DEGRADED_THRESHOLD_MS` (default `1000`) dan `RETENTION_DAYS` (default `31`).
   `ALLOW_UNAUTHENTICATED=true` **hanya** untuk testing sementara — jangan dipakai di produksi.

4. **Build & deploy**

   ```bash
   npm run build
   npx wrangler deploy
   ```

5. **Custom domain** — di Cloudflare Dashboard → Workers & Pages → `cloudflare-vps-monitoring` → Settings → Domains & Routes → Add Custom Domain → `monitor.DOMAIN.COM`.

6. **Aktifkan Cloudflare Access** — Zero Trust → Access → Applications → tambahkan `monitor.DOMAIN.COM` dengan policy allow-list (email / OTP / SSO).

> Catatan: Worker juga dapat dijangka lewat `*.workers.dev`. Verifikasi JWT di `src/worker/auth.ts` mencegah akses tanpa Access melalui URL tersebut.

## Endpoint API

Semua endpoint diawali otorisasi dan mengembalikan `{ success, data | error }`.

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/overview` | Ringkasan global |
| GET | `/api/targets` | Semua target + statistik |
| POST | `/api/targets` | Tambah target (langsung diprobe) |
| DELETE | `/api/targets/:id` | Hapus target + riwayatnya |
| GET | `/api/targets/:id/history?hours=24` | Histori latency |
| POST | `/api/targets/:id/probe` | Probe satu target sekarang |
| POST | `/api/probes/run-all` | Probe semua target |
| GET | `/api/incidents?limit=50` | Riwayat insiden |

## catatan keamanan

- VPS target **tidak memerlukan akses SSH** apa pun untuk sistem ini. Jangan memasang agen atau membuka port tambahan.
- Rotasi kredensial apa pun yang pernah dibagikan melalui chat/log.
- Batasi maksimal target melalui `MAX_TARGETS` di `src/worker/api.ts` (default 10).
