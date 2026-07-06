# SwannHub

Automasi login akun Roblox berbasis web, dibangun dengan Express dan Puppeteer.

## Deskripsi

SwannHub adalah server otomatisasi untuk proses login akun Roblox, digunakan untuk mendukung kebutuhan manajemen akun secara lebih efisien. Project ini menjalankan server backend (`server.js`) yang memanfaatkan Puppeteer untuk mengontrol browser secara otomatis, ditambah worker terpisah (`login-worker.js`) untuk menangani proses login itu sendiri.

## Fitur

- Server backend berbasis Express
- Otomasi login Roblox menggunakan Puppeteer
- Worker terpisah untuk proses login, memisahkan logika dari server utama
- Folder `public` untuk aset/frontend statis

## Tech Stack

- **Node.js**
- **Express** `^4.21.0` — web server & routing
- **Puppeteer** `^21.11.0` — browser automation

## Instalasi

Clone repo ini:

```bash
git clone https://github.com/ditsune/SwannHub.git
cd SwannHub
```

Install dependencies:

```bash
npm install
```

## Menjalankan Project

```bash
npm start
```

Perintah ini akan menjalankan `server.js` sebagai entry point utama.

## Struktur Project

```
SwannHub/
├── public/            # Aset statis / frontend
├── login-worker.js    # Worker untuk proses login Roblox
├── server.js          # Entry point server (Express)
├── package.json
└── .gitignore
```

## Catatan

- Pastikan Node.js sudah terinstall di sistem sebelum menjalankan project ini.
- Karena menggunakan Puppeteer, project ini akan menjalankan instance Chromium headless saat proses login berjalan.

## Lisensi

Project ini menggunakan lisensi [MIT](LICENSE)

Copyright © 2026 ditsune
