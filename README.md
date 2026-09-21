<div align="center">

# TheAtlas — Queue

**Yayıncılar için Özel 5v5 Lobi & Sıra Yönetim Sistemi**

[![Next.js](https://img.shields.io/badge/Next.js-Latest-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Riot Games API](https://img.shields.io/badge/Riot_Games-API-eb0029?style=for-the-badge&logo=riotgames&logoColor=white)](https://developer.riotgames.com/)
[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPL--3.0--only-blue?style=for-the-badge)](LICENSE)

_Özel "Şamata" oyunları için tasarlanmış sade ve odaklı bir dashboard — chat'teki ilk `!sıra` komutundan takımların oluşturulmasına kadar lobi yönetimini tamamen üstlenir._

[Hata Bildir](https://github.com/atlasatakahraman/atlasata-queue/issues) · [Özellik İste](https://github.com/atlasatakahraman/atlasata-queue/issues)

</div>

---

## Genel Bakış

AtlasAta Queue, özel 5v5 oturumları düzenleyen League of Legends yayıncıları için geliştirilmiş bir lobi yönetim aracıdır. Kick sohbetine doğrudan bağlanarak oyuncu sırasını otomatik olarak oluşturur, Riot Games API'sinden anlık rank ve profil verisi çeker; takım oluşturma, karıştırma ve yönetim işlemlerinin tamamını tek bir dashboard üzerinden sunar.

Arayüz bilinçli olarak sade tutulmuştur. Üst çubukta bağlantı durumu ve oyuncu sayısı anlık olarak görünür; ana panel ise sırayı (bekleyen, oyunda, uzakta) ve aktif takımları sekmeli yapıda sunar. Gerekli her şey tek tıkla erişilebilir, gereksiz hiçbir şey ekranda yer almaz.

---

## Özellikler

**Canlı Kick Chat Entegrasyonu**
`!sıra OyuncuAdı#TAG` komutlarını gerçek zamanlı olarak ayrıştırır. Oyuncular sıraya otomatik eklenir; kopyala-yapıştır ya da manuel giriş gerekmez.

**Anlık Riot Games Senkronizasyonu**
PUUID tabanlı Riot API çağrıları aracılığıyla her oyuncunun SoloQ/Flex rütbesini, hesap seviyesini, kazanma oranını ve profil ikonunu çeker. Tüm istekler Next.js API rotaları üzerinden güvenli biçimde proxylenir.

**Akıllı Takım Karıştırma**
10 oyuncuyu iki 5 kişilik takıma adil şekilde böler. Alliance Breaker algoritması son sıralamalardan oluşan grupları takip eder ve aynı alt grupların üst üste oluşmasını engeller.

**Duruma Duyarlı Kontroller**
Butonlar lobi durumuna göre uyum sağlar. Henüz geçerli olmayan eylemler (örneğin 10 oyuncu hazır değilken karıştırma) sessizce devre dışı kalmak yerine açıklayıcı tooltip'lerle gösterilir.

**Sağ Tık Oyuncu Menüsü**
Dashboard genelinde birleşik bağlam menüleri: Kick veya Riot ID'sini kopyala, oyuncuyu Uzakta (AFK) olarak işaretle, sıra durumları arasında taşı ya da tamamen kaldır.

**Moderasyon Sistemi**
Oyuncular için uyarı, ceza ve ban yönetimi sunar. İki uyarıya ulaşan oyunculara otomatik olarak 1 maçlık ceza uygulanır ve sıradan çıkarılır. Yönetici, sağ tık menüsünden doğrudan uyarı verebilir ya da detaylı moderasyon diyaloğu üzerinden özel ceza/ban süresi tanımlayabilir.

---

## Hızlı Başlangıç

### Gereksinimler

- [Node.js](https://nodejs.org/en/) ≥ 18 veya [Bun](https://bun.sh/)
- [Riot Games Geliştirici API Anahtarı](https://developer.riotgames.com/)
- Kick OAuth 2.1 Client ID ve Secret

### Kurulum

```bash
git clone https://github.com/atlasatakahraman/TheAtlas-Queue.git
cd atlasata-queue
bun install
```

### Ortam Değişkenleri

Proje kök dizininde bir `.env.local` dosyası oluşturun:

```env
# Auth.js / NextAuth
AUTH_SECRET="32-byte-rastgele-gizli-anahtar"
AUTH_URL="http://localhost:3000/api/auth"

# Kick OAuth
KICK_CLIENT_ID="kick_client_id"
KICK_CLIENT_SECRET="kick_client_secret"

# Riot Games
RIOT_API_KEY="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

> `AUTH_SECRET` üretmek için: `openssl rand -base64 32`

### Çalıştırma

```bash
bun run dev
```

`http://localhost:3000` adresini açın, Kick hesabınızla giriş yapın; dashboard sıra komutlarını almaya hazır.

---

## Mimari

**Güvenli Riot API Proxy**
Tüm Riot Games istekleri Next.js App Router'daki `/api/riot` handler'ları üzerinden iletilir. API anahtarınız hiçbir zaman istemci tarafına ulaşmaz.

**WebSocket Tabanlı Chat Alımı**
Kick'in Pusher uyumlu WebSocket altyapısını kullanarak sohbet mesajlarını düşük gecikmeyle eş zamansız olarak işler.

**Ayrıştırılmış Bileşen Modeli**
`PlayerContextMenu` ve etkileşimli liste öğeleri tamamen bağımsızdır; sürükle-bırak durumu ile sağ tık bağlam durumu çakışma olmadan bir arada çalışır.

---

## Teknoloji Yığını

| Katman           | Teknoloji                    |
| ---------------- | ---------------------------- |
| Framework        | Next.js (Latest, App Router) |
| UI Bileşenleri   | shadcn/ui                    |
| Stil             | Tailwind CSS                 |
| Kimlik Doğrulama | Auth.js (NextAuth v5)        |
| Chat             | Kick WebSocket (Pusher)      |
| Oyuncu Verisi    | Riot Games REST API          |
| Çalışma Ortamı   | Bun                          |

---

## Katkıda Bulunma

Her türlü katkı memnuniyetle karşılanır.

1. Repoyu forklayın
2. Özellik dalı oluşturun: `git checkout -b ozellik/yeni-ozellik`
3. Değişikliklerinizi kaydedin: `git commit -m 'Yeni özellik ekle'`
4. Dalı gönderin: `git push origin ozellik/yeni-ozellik`
5. Pull Request açın

---

## Lisans

GNU Genel Kamu Lisansı v3.0 (yalnızca, `GPL-3.0-only`) kapsamında dağıtılmaktadır. Ayrıntılar için [`LICENSE`](LICENSE) dosyasına bakın.

---

<div align="center">
  <sub>League of Legends topluluğu için <a href="https://github.com/atlasatakahraman">atlasatakahraman</a> tarafından yapılmıştır</sub>
</div>
