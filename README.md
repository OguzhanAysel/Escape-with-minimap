# Escape from Tarkov — Yardımcı Mini Harita & Görev Overlay (PvE / PvP)

Escape from Tarkov için geliştirilmiş, oyunun üstünde saydam (`alwaysOnTop`) olarak duran, **tamamen güvenli** (oyun sürecine/belleğine müdahale etmeyen, yalnızca statik `tarkov.dev` verisi, ekran görüntüsü dosya adları ve resmi oyun logları ile çalışan) Windows masaüstü yardımcı harita uygulaması.

## Özellikler

- **İki Pencere Mimarisi:**
  1. **Mini Harita Overlay Penceresi:** Çerçevesiz, saydam, her zaman üstte (`screen-saver` seviyesi). Varsayılan olarak tıklamalar oyuna geçer; farenizi üzerine götürdüğünüzde haritayı doğrudan kaydırıp yakınlaştırabilirsiniz.
  2. **Kontrol Paneli Penceresi:** Canlı PvE / PvP Flea Market fiyat analizi, eşya arama, konum/rota yönetimi, görev OCR ve kısayol ayarları.
- **Canlı PvE & PvP Eşya Fiyatları ve Spawn Haritası:**
  - `tarkov.dev` verileri ile her eşyanın **Anlık En Düşük Flea Fiyatı**, **24 Saatlik Ortalaması**, **En İyi Trader Fiyatı** ve **Slot Başı Değeri (`₽/slot`)** hesaplanır.
  - Seçilen eşyaların olası açıkta (`loose loot`) ve konteyner spawn noktaları renk kodlu olarak haritaya pinlenir.
- **Konum İsimleri (Callouts), Çıkışlar (Extracts) ve Görev Hedefleri:**
  - Haritalar üzerinde önemli bina ve bölge isimleri (*3 Katlı Yurt, Crackhouse, Kale, Sawmill, USEC Kampı, LexOs, Concordia, Sanatoryum, D-2 vb.*) ile çıkış noktaları gösterilir.
  - Herhangi bir eşya pinine, çıkışa, bölge ismine veya görev hedefine tıkladığınızda oyuncudan hedefe **kuş uçuşu rota çizgisi, mesafe (metre), bakış açısına göre yön (`35° sağda`, `arkanızda`) ve kat farkı (`▲ yukarıda` / `▼ aşağıda`)** hesaplanır.
- **Oyun Logundan %100 Kesin Otomatik Harita Algılama:**
  - Raid başlarken Tarkov'un kendi `Logs/log_.../application_000.log` dosyasındaki `scene preset path:maps/...` kaydını okuyarak girdiğiniz haritayı otomatik açar.
- **Oyuncu Konumu, Yön Oku ve Akıllı Oto-Home (`Alt+H`):**
  - Tarkov'un ekran görüntüsü dosya adına yazdığı 3B koordinat ve Quaternion değerlerinden konumunuzu ve baktığınız yönü (Yaw) haritada gösterir, son 10 konumu iz olarak çizer.
  - **Akıllı Hareket Modu:** Yalnızca yürürken (`W/A/S/D`) veya çıkışlara bakarken (`O`) ekran görüntüsü alarak gereksiz bildirimleri önler.
- **Yerel Görev Ekran Görüntüsü OCR (`tesseract.js` + `fuse.js`):**
  - Görev ekran görüntünüzü sürükleyip bırakın veya `Ctrl+V` ile yapıştırın; görüntü cihazınızda taranıp görevleriniz otomatik eşleştirilir ve haritaya pinlenir.

---

## Kurulum ve Çalıştırma

### 1. Tek Tıkla Çalışan Portable `.exe` (Bağımlılık Gerektirmez)
Node.js veya herhangi bir paket kurmadan doğrudan çalıştırmak için:
- `dist/TarkovMapOverlay-1.0.0-portable.exe` (veya Masaüstündeki `TarkovMapOverlay.exe`) dosyasına çift tıklayın.

### 2. Kaynak Koddan Çalıştırma ve Derleme
```bash
npm install
npm start
```
Tek dosya Portable `.exe` üretmek için:
```bash
npm run build
```

---

## Varsayılan Global Kısayollar

| Kısayol | İşlev |
| :--- | :--- |
| **`Alt+M`** | Overlay Mini Haritayı Göster / Gizle |
| **`Alt+E`** | Düzenleme Modu Aç / Kapat (Overlay'i taşıma ve boyutlandırma) |
| **`Alt+H`** | Otomatik `Home` Tuşu Döngüsü Aç / Kapat (Varsayılan: 3 sn) |
| **`Alt+8` / `Alt+9`** | Haritayı Yakınlaştır / Uzaklaştır |
| **`Alt+F`** | Takip Modu (Oyuncu Merkezde) / Sabit Mod Değiştir |
| **`Alt+N`** | Sonraki Rota Hedefine Geç |
| **`Alt+G`** | Sonraki Haritaya Geç |
| **`Alt+Up` / `Alt+Down`** | Overlay Saydamlığını Artır / Azalt |

---

## Önemli Notlar ve Bilinen Durumlar
1. **Pencereli / Çerçevesiz Tam Ekran Zorunluluğu:** Escape from Tarkov görüntü ayarlarında ekran modu **Borderless (Çerçevesiz)** veya **Windowed (Pencereli)** olmalıdır. Tam ekran (Exclusive Fullscreen) modda Windows hiçbir şeffaf overlay penceresini oyunun üstünde gösteremez.
2. **Spawn Verileri:** Haritada gösterilen eşya pinleri *"çıkabilir" (olası spawn havuzu)* noktalarıdır; her raid başında sunucu bu noktalardan rastgele seçim yapar.
