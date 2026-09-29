import { DEFAULTS as D } from "@/lib/defaults";
import type { Help } from "./index";

const c = D.commands;
const s = D.settings;
const L = D.limits;
const r = D.respect;
const k = D.retention;
const pct = (n: number) => `%${n * 100}`;
const x = (n: number) => `×${String(n).replace(".", ",")}`;

export const tr: Help = {
  ui: {
    title: "Wiki",
    topics: "Konular",
    search: "Wiki'de ara",
    none: "Eşleşen başlık yok.",
    onThisPage: "Bu sayfada",
  },
  "getting-started": {
    title: "Başlarken",
    description: "Kick izleyici sırasını yönet: izleyiciler sohbetten katılır, adil takımlar çekersin, kazananı kaydedersin, herkes canlı izler.",
    lead: "TheAtlas Queue, Kick yayının için izleyici sırasını yönetir. İzleyiciler sohbetten katılır, sen takımları çekersin, kazananı kaydedersin; izleyicilerin de hepsini herkese açık bir sayfadan takip edebilir.",
    sections: [
      {
        id: "sign-in",
        title: "Giriş ve kurulum",
        body: [
          "[Ana sayfada](/) Kick ile giriş yap. İlk seferde Hoş geldin sayfası kanalını üç adımda kurar: Queue'yu sohbetine bağlar, izleyicilerin nasıl katılacağını seçtirir (katılma komutu ve Riot ID gerekip gerekmediği) ve bir deneme yaptırır.",
          "Panelin kanalının adresindedir, örneğin `/c/kanalin`. Onu yalnızca sen ve moderatörlerin açabilir.",
        ],
      },
      {
        id: "first-stream",
        title: "İlk yayının",
        body: [
          {
            list: [
              `Yayına başla. İzleyiciler sohbete katılma komutunu yazar (değiştirmediysen \`${c.join}\`) ve sıraya düşer.`,
              "**Takımları çek**'e (ya da `D`) bas; iki takım bekleyenlerden rastgele dolar.",
              "Oynayın. Maç bitince kazanan takımın kartında **Kazandı**'ya bas.",
              "İstediğin gibi yeniden çek, karıştır ya da tek tek oyuncu çek. Her değişikliğin bir Geri al'ı vardır.",
            ],
          },
          "İzleyiciler sırayı ve takımları takip edebilsin diye [izleme sayfanı](/wiki/watch) paylaş.",
        ],
      },
      {
        id: "moderators",
        title: "Moderatörler",
        body: [
          "Kick moderatörlerin erişimi kendiliğinden alır: moderatör rozetini taşıyan ilk sohbet mesajıyla, kendi Kick girişleriyle panele girerler. Birini önceden eklemek ya da birini engellemek için [Ayarlar → Moderatörler](/wiki/settings#moderators).",
        ],
      },
    ],
  },
  "chat-commands": {
    title: "Sohbet komutları",
    description: "İzleyicilerin sıraya katılmak, ayrılmak ve sırasını sormak için kullandığı Kick sohbet komutları ve bunları değiştirmek.",
    lead: "İzleyiciler sırayı Kick sohbetinden kullanır. Komut, mesajın ilk kelimesidir; katılma komutundan sonra yazılan Riot ID olarak okunur.",
    sections: [
      {
        id: "join",
        title: "Katıl",
        body: [
          `\`${c.join}\` seni sıranın sonuna ekler. \`${c.join} Ad#TAG\` Riot ID'ni de verir, böylece yayıncı dereceni görür.`,
          "Bir katılma geri çevrilebilir: yasaklı ya da cezalısındır, zaten sıradasındır, katılım kapalıdır, yayın kapalıdır, sıra doludur, yayıncının istediği rozet sende yoktur, maç sonrası bekliyorsundur ya da Riot ID zorunludur ve vermemişsindir. Yayıncı nedenini akışında görür.",
          "Sohbet yanıtları açıksa Queue katılmayı sohbette yerinle yanıtlar, yasaklıysan ya da zaten sıradaysan bunu söyler. Yayın kapalıyken sıranın yayın açılınca açılacağını, katılım kapalıyken de sıranın kapalı olduğunu bir kez söyler. Yanıtlar birkaç saniye bekler ve birlikte gider, böylece aynı anda gelen katılımlar tek satır olur: *Sıraya katıldı: @a #3, @b #4*. Diğer retler yayıncının akışında kalır, böylece çok sayıda katılma geri çevrildiğinde sohbet dolmaz. Yayıncı her yanıtı [Ayarlar → Etiketler ve dil](/wiki/settings#labels) bölümünden kendi sözleriyle yazabilir.",
        ],
      },
      { id: "leave", title: "Ayrıl", body: [`\`${c.leave}\` seni sıradan çıkarır.`] },
      {
        id: "position",
        title: "Sıram",
        body: [`\`${c.position}\` bekleyenler arasındaki yerini sorar. Yayıncı sohbet yanıtlarını açtıysa Queue sohbette yanıtlar.`],
      },
      {
        id: "away",
        title: "Uzakta",
        body: [`\`${c.away}\` seni uzakta olarak işaretler, bir daha yazınca geri döndün sayılır. Uzaktaki oyuncu yerini korur ama çekilmez. Oyundayken ya da cezalıyken bir şey yapmaz.`],
      },
      {
        id: "perk",
        title: "Kalan korumalı hak",
        body: [`\`${c.perk}\` yayıncı ayrıcalığı açtıysa kaç [korumalı hakkın](/wiki/perks) kaldığını sorar. Hak kazandıran bir rozetin yoksa Queue hangi rozetlerin kazandırdığını söyler.`],
      },
      {
        id: "watch",
        title: "İzleme sayfası",
        body: [`\`${c.watch}\`, yayıncı sohbet yanıtlarını açtıysa ve izleme sayfası herkese açıksa, sohbette kanalın [izleme sayfasının](/wiki/watch#watch-page) bağlantısıyla yanıt verir. En fazla 30 saniyede bir yanıt verir.`],
      },
      {
        id: "rules",
        title: "Kurallar",
        body: [`\`${c.rules}\`, sohbet yanıtları açıksa yayıncının [Ayarlar → Komutlar](/wiki/settings#commands) bölümüne yazdığı kuralları sohbette gönderir. Kural yazılmamışsa yanıt vermez. Kurallar kanalın izleme sayfasında da görünür. En fazla 30 saniyede bir yanıt verir.`],
      },
      {
        id: "list",
        title: "Tüm komutlar",
        body: ["`!komutlar` ya da `!commands`, yayıncı sohbet yanıtlarını ve **!komutlar yanıtlansın**'ı açtıysa kanalın komutlarını bu sayfanın bağlantısıyla sohbette sıralar. Bu ikisi her kanalda aynıdır ve en fazla 30 saniyede bir yanıt verir. Kanalın mod botu bağlantıları siliyorsa yayıncı TheAtlas'a izin verir."],
      },
      {
        id: "custom",
        title: "Komutları değiştirmek",
        body: [
          `Yayıncı kendi komutlarını [Ayarlar → Komutlar](/wiki/settings#commands) bölümünde belirler. Komut \`!\` ve boşluksuz 1 ile ${D.commandMax} karakterdir, yedisi de birbirinden farklı olmalıdır. Bir kanalın kendi komutları izleme sayfasında yazar.`,
        ],
      },
    ],
  },
  queue: {
    title: "Sıra",
    description: "Oyuncuları süz, ara, ekle ve taşı; sohbetten kimin katılabileceğini belirle: açık ya da kapalı, sınır, yalnızca aboneler, bekleme.",
    lead: "Sıra sekmesi sıradaki herkesi katılma sırasıyla listeler; sağda sohbetin yaptıklarının akışı durur.",
    sections: [
      {
        id: "filters",
        title: "Süzgeçler ve arama",
        body: ["**Tümü**, **Bekleyen**, **Oyunda**, **Uzakta** ya da **Cezalı** ile süz. Arama kutusu (`/`) bir oyuncuyu Kick adı ya da Riot ID ile bulur; Enter ilk eşleşmeye atlar."],
      },
      {
        id: "add",
        title: "Oyuncu eklemek",
        body: ["**Oyuncu ekle** herkesi Kick adıyla, varsa Riot ID'siyle ekler. Elle eklemek aşağıdaki katılım kurallarına takılmaz, yani birini her zaman içeri alabilirsin."],
      },
      {
        id: "rows",
        title: "Oyuncuları taşımak",
        body: ["Her satırın düğmeleri oyuncuyu bir takıma taşır, uzakta olarak işaretler ya da çıkarır; gerisi `⋯` menüsündedir (ya da odaktaki satırda Enter). Sırayı değiştirmek için satırı sürükle ya da bir takımın üstüne bırak."],
      },
      {
        id: "joining",
        title: "Sohbetten kim katılabilir",
        body: [
          "Bu kurallar yalnızca sohbetteki katılma komutu için geçerlidir ve [Ayarlar → Katılım](/wiki/settings#joining) bölümünde ayarlanır.",
          {
            list: [
              "**Katılım açık**: kapatırsan sohbetten her katılma geri çevrilir. Araç çubuğundaki Katılım düğmesi aynısını tek dokunuşla, senin ve moderatörlerin için yapar.",
              `**Sıra sınırı**: oyunda olmayan en fazla bu kadar oyuncu, 1 ile ${L.queue_max[1]} arası. ${L.queue_max[0]} sınır yok demektir.`,
              `**Maç sonrası bekleme**: yeni oynamış bir oyuncu sohbetten yeniden katılmadan önce bu kadar kayıtlı maç bekler, en fazla ${L.join_cooldown[1]}. ${L.join_cooldown[0]} kapalıdır.`,
              "**Yalnızca yayındayken**: varsayılan olarak açık. Yayın kapalıyken sohbetten katılmalar yayın açılana kadar geri çevrilir. Sen ve moderatörlerin yine katılabilir, elle eklemek her zaman çalışır. Kick yayının başladığını ya da bittiğini kendi zamanlamasıyla, bazen birkaç dakika geç bildirir; bu yüzden katılım yayından biraz sonra açılıp kapanabilir. Engel olursa anahtarı kapat.",
              "**Yalnızca aboneler**: yalnızca seçtiğin rozete sahip izleyiciler katılabilir. Sen ve moderatörlerin her zaman geçersiniz.",
            ],
          },
        ],
      },
      {
        id: "undo",
        title: "Geri al",
        body: ["Her değişiklik birkaç saniye bir Geri al gösterir. Sırayı, takımları, yaptırımları ya da geçmişi temizlemek önce sorar."],
      },
    ],
  },
  teams: {
    title: "Takımlar ve çekilişler",
    description: "Sıradan iki adil takım çek, yeniden çek, tek tek oyuncu seç ve çekilişin yayında nasıl gösterileceğini belirle.",
    lead: `En fazla ${L.team_size[1]} kişilik iki takım (takım büyüklüğünü değiştirmediysen ${s.team_size}). Takımlar sekmesi ikisini yan yana, bu yayının skoruyla gösterir.`,
    sections: [
      {
        id: "draw",
        title: "Takım çekmek",
        body: [
          "**Takımları çek** (`D`) iki takımı bekleyenlerden rastgele doldurur. **Yeniden çek** aynı oyunculardan yeniden çeker, korumalı olanları yerinde bırakır. **Mevcut takımları karıştır** zaten takımda olanları karıştırır.",
          "Çekilişler aynı takım arkadaşlarını yeniden bir araya getirmekten kaçınır; bir maçtan sonra aynı dört oyuncu çekilirse farklı bölünür. Bkz. [Takımlar nasıl bölünür](/wiki/teams#split).",
        ],
      },
      {
        id: "split",
        title: "Takımlar nasıl bölünür",
        body: [
          "Takım çekmek, yeniden çekmek ve karıştırmak aynı kişileri yeniden aynı takıma koymamaya çalışır. Queue **kayıtlı maçlarında**, yani **Kazandı** ile bitirdiklerinde, kimlerin aynı takımda olduğunu hatırlar ve oyuncuları eski takım arkadaşları olabildiğince az bir araya gelecek şekilde böler. Birkaç bölünüş eşit derecede iyiyse aralarından biri rastgele seçilir.",
          "Yeni maçlar daha çok sayılır: beş maç önceki bir maç en yenisinin yarısı kadar sayılır ve yalnızca son 50 maçın okunur. Geri aldığın ya da kaldırdığın bir maç artık sayılmaz; [Maçlar ne kadar tutulur](/wiki/games#retention) süresi dolup silinen maçlar da öyle.",
          "**Kayıtlı maç yoksa bölünüş düpedüz rastgeledir.** Kazandı'ya hiç basmazsan Queue'nun hatırlayacağı bir şey olmaz ve aynı takım arkadaşları yeniden karşılaşabilir. Her maçtan sonra Kazandı'ya bas; çeşitlilik bir sonraki çekilişten başlar.",
          "Bu yalnızca kimin hangi takıma gideceğini belirler, sıradan kimin çekileceğini asla: o [Adil oyun](/wiki/teams#fair-play)'dur. Bir beceri dengesi değildir; dereceler ve kazanma oranları rol oynamaz ve bu hesap hiçbir yerde gösterilmez.",
        ],
      },
      {
        id: "pick",
        title: "Oyuncu çekmek",
        body: ["**Çek** ×1, ×2, ×3, ×4 ya da ×5 kaynağından o kadar oyuncuyu rastgele alır: **Bekleyenler**, **Takımlar** ya da **Tüm sıra**. Yasaklı ve cezalı oyuncular dışarıda kalır; kaynağın dolduramayacağı sayı gizlenir."],
      },
      {
        id: "fair-play",
        title: "Adil oyun",
        body: ["**Oynamamış oyunculara öncelik ver** henüz maçı olmayanları önce çeker. Onlar *ilk oyun* etiketini taşır.", "Bir oyuncunun takıma her girişini sayar, maçı Kazandı ile kaydetsen de kaydetmesen de; bu yüzden hiç maç geçmişi olmadan da çalışır."],
      },
      {
        id: "reveal",
        title: "Çekiliş gösterimi",
        body: ["Takım çekilişinde isimler takımlara yazılarak gelir. Tek çekim, [Ayarlar → Takımlar ve çekilişler](/wiki/settings#teams) bölümünde seçilen gösterimi oynatır: isimler yazılarak, kartlar, listeleme, çarkıfelek ya da sonucu hemen göster. İzleme sayfası ve overlay'ler yeni bir çekilişi geldiği an gösterir."],
      },
    ],
  },
  games: {
    title: "Maçlar",
    description: "Kazananı Kazandı ile kaydet, bu yayının skorunu izle, her oyuncunun galibiyet, mağlubiyet ve serilerini gör.",
    lead: "Kazanan takımda Kazandı'ya bastığında bir maç kaydedilir. Maçlar skoru, istatistikleri ve en çok kazananlar tablolarını besler.",
    sections: [
      {
        id: "victory",
        title: "Kazandı",
        body: ["Kazanan takımın kartında **Kazandı**'ya bas. [Ayarlar → Maçlar](/wiki/settings#games) bölümündeki **Kazandı'dan sonra** ardından ne olacağını seçer: yalnızca kaydet, karıştır, yeni çekiliş, herkes sıraya ya da kaybedenler sıraya. Geri al ikisini de geri alır."],
      },
      {
        id: "stats",
        title: "Skor ve istatistik",
        body: ["Maçlar sekmesi her maçı listeler (takımları için birini aç); **İstatistik** her oyuncunun maçlarını, galibiyet, mağlubiyet, kazanma oranı ve serisini **Bu yayın** ya da **Tüm zamanlar** için sayar."],
      },
      {
        id: "retention",
        title: "Maçlar ne kadar tutulur",
        body: [`Maçlar, ${L.games_retention_days[0]} ile ${L.games_retention_days[1]} arasında başka bir değer seçmediysen ${s.games_retention_days} gün tutulur. Daha eski maçlar ve bıraktıkları kayıtlar silinir. **Bu maçı kaldır**'ın Geri al'ı vardır; **Maçları temizle** önce sorar.`],
      },
    ],
  },
  moderation: {
    title: "Yönetim ve saygı",
    description: "İzleyicileri uyar, cezalandır ve yasakla; saygının nasıl hesaplandığı ve Geçmiş'in kimin ne yaptığını nasıl tuttuğu.",
    lead: "Yönetim sekmesi uyarıları, cezaları ve yasakları tutar. Nedenler panelde kalır; izleme sayfası onları asla göstermez.",
    sections: [
      {
        id: "sanctions",
        title: "Uyar, cezalandır, yasakla",
        body: [
          {
            list: [
              "**Uyar**: oyuncuya bir nedenle not düşülür.",
              "**Cezalandır**: belli sayıda maç ya da belli bir süre için. Cezalı oyuncu takımından ya da bekleyenlerden **Cezalı**'ya geçer, ceza bitince bekleyenlere döner.",
              "**Yasakla**: oyuncu sıradan çıkar, yasak bitene ya da kaldırılana kadar katılamaz.",
            ],
          },
          "Bir yaptırım erken kaldırılabilir, süresi değiştirilebilir ya da uyarı cezaya dönüştürülebilir.",
        ],
      },
      {
        id: "respect",
        title: "Saygı",
        body: [
          `Her izleyici ${r.start} ile başlar. Uyarı ${r.warn}, ceza ${r.punish}, yasak ${r.ban} düşürür. Üçüncü yaptırımdan itibaren her biri ${x(r.repeat[2])}, dördüncüsü ${x(r.repeat[3])}, beşinci ve sonrası ${x(r.repeat[4])} sayılır.`,
          `Eski yaptırımlar daha az sayılır: ${r.decay[2][0]} günden sonra ${pct(r.decay[2][1])}, ${r.decay[1][0]} günden sonra ${pct(r.decay[1][1])}, ${r.decay[0][0]} günden sonra ${pct(r.decay[0][1])}. Kaldırılan uyarı sayılmaz; kaldırılan ceza ya da yasak sayılmaya devam eder. Silinen yaptırım tamamen gider.`,
        ],
      },
      {
        id: "history",
        title: "Geçmiş",
        body: [`Geçmiş sekmesi her değişikliği listeler: kimin, ne zaman, kime yaptığı; Sıra, Takımlar, Yönetim ya da Sohbet ve yayın diye süzülür. ${k.historyDays} gün tutulur. **Geçmişi temizle** yalnızca yayıncınındır ve önce sorar.`],
      },
      {
        id: "moderators",
        title: "Moderatörler",
        body: [`Sohbette görülen Kick moderatör rozeti panele erişim verir; rozetsiz bir mesaj erişimi kaldırır, rozeti ${k.badgeDays} gün görülmeyen de erişimini kaybeder. Moderatörler Ayarlar dışında her şeyi yapabilir. Yaptıkları her şey Geçmiş'te adlarıyla yazar.`],
      },
    ],
  },
  perks: {
    title: "Ayrıcalıklar ve rozetler",
    description: "Abone ayrıcalığı çekilen aboneleri belli sayıda yeniden çekilişten korur; hangi Kick rozetlerinin hak kazandırdığı.",
    lead: "Abone ayrıcalığı destekçilerini gizli şans olmadan ödüllendirir: kimin korumalı olduğunu herkes görür.",
    sections: [
      {
        id: "perk",
        title: "Korumalı haklar",
        body: [
          `Hak kazandıran rozeti olan bir izleyici çekildiğinde korumalı olur: yeniden çekiliş onu takımında bırakır. Değiştirmediysen her biri ${s.perk_window_days} günde ${s.perk_uses} korumalı hak alır (${L.perk_uses[0]} ile ${L.perk_uses[1]} hak, ${L.perk_window_days[0]} ile ${L.perk_window_days[1]} günde bir).`,
          `İzleyiciler kalanı \`${c.perk}\` ile sorar; uygun rozeti olmayan izleyiciye bir sayı değil, hangi rozetlerin uygun olduğu söylenir. Panelde korumalı oyuncu *korumalı* etiketini taşır; satır menüsü korumayı kaldırabilir.`,
        ],
      },
      {
        id: "badges",
        title: "Rozetler",
        body: ["Hangi Kick rozetlerinin hak kazandırdığını seç: abone, VIP, OG, kurucu ya da hediye eden. Katılım yalnızca abonelere açıkken kimin katılabileceğini de aynı seçici belirler."],
      },
    ],
  },
  watch: {
    title: "İzleme sayfası ve overlay'ler",
    description: "Telefondan açılan herkese açık bir izleme sayfası paylaş; sırayı ve takımları OBS overlay'leriyle yayına koy.",
    lead: "Sırayı göstermenin iki yolu var: izleyicilerin kendilerinin açtığı herkese açık bir sayfa ve OBS'e eklediğin overlay'ler.",
    sections: [
      {
        id: "watch-page",
        title: "İzleme sayfası",
        body: [
          "[Ayarlar → İzleme sayfası](/wiki/settings#watch) bölümünde **Herkese açık izleme sayfası**'nı aç ve `/watch/kanalin` adresini paylaş. Önce sohbet komutlarını, sonra seçtiğin bölümleri gösterir: **Takımlar**, **Sıra**, **Maçlar** ve **Yönetim** (yalnızca isim ve tür, asla neden değil); Riot ID'ler yalnızca paylaşırsan görünür.",
          "Canlı güncellenir ve çekiliş gösterimini oynatır. Varsayılan olarak kapalıdır.",
        ],
      },
      {
        id: "overlays",
        title: "Overlay'ler",
        body: [
          "Overlay, OBS için 1920×1080 bir tarayıcı kaynağıdır. [Ayarlar → Overlay'ler](/wiki/settings#overlays) bölümünde istediğin kadar yap; her birinin kendi parçaları (sıra, takımlar, skor, son sonuç, en çok kazananlar, en saygın oyuncular, çekiliş gösterimi), konumu, boyutu, panelleri ve dili olur.",
          "Overlay bağlantısına sahip olan herkes onu görür, bu yüzden yayında gösterme. **Yeni bağlantı** eskisini hemen geçersiz kılar.",
        ],
      },
    ],
  },
  settings: {
    title: "Ayarlar",
    description: "Ayarlar'ın her bölümü ne yapar: komutlar, katılım, Riot, takımlar ve çekilişler, maçlar, ayrıcalıklar, izleme, overlay'ler, moderatörler, etiketler.",
    lead: "Ayarlar yalnızca yayıncınındır, üst çubuktaki dişliyle açılır. Anahtarlar hemen kaydolur; metin ve sayılar Kaydet'i bekler.",
    sections: [
      { id: "commands", title: "Komutlar", body: ["Yedi sohbet komutu ve kuralların. Bkz. [Sohbet komutları](/wiki/chat-commands)."] },
      { id: "joining", title: "Katılım", body: ["Açık ya da kapalı, sıra sınırı, maç sonrası bekleme, yalnızca aboneler. Bkz. [Sohbetten kim katılabilir](/wiki/queue#joining)."] },
      { id: "riot", title: "Riot", body: [`Tek/Çift derecelerini getir (değiştirmediysen bölge ${s.riot_region.toUpperCase()}) ve katılmak için Riot ID gerekip gerekmediği.`] },
      { id: "teams", title: "Takımlar ve çekilişler", body: [`Takım büyüklüğü (${L.team_size[0]} ile ${L.team_size[1]} arası), adil oyun, çekiliş gösterimi ve yayın bitince sıranın temizlenip temizlenmeyeceği. Bkz. [Takımlar ve çekilişler](/wiki/teams).`] },
      { id: "games", title: "Maçlar", body: ["Kazandı'dan sonra ne olacağı ve maçların ne kadar tutulacağı. Bkz. [Maçlar](/wiki/games)."] },
      { id: "perks", title: "Ayrıcalıklar", body: ["Abone ayrıcalığı ve rozetleri. Bkz. [Ayrıcalıklar ve rozetler](/wiki/perks)."] },
      { id: "watch", title: "İzleme sayfası", body: ["Herkese açık sayfa ve bölümleri. Bkz. [İzleme sayfası](/wiki/watch#watch-page)."] },
      { id: "overlays", title: "Overlay'ler", body: ["OBS overlay'lerin. Bkz. [Overlay'ler](/wiki/watch#overlays)."] },
      { id: "moderators", title: "Moderatörler", body: ["Erişimi olan herkes ve erişimin nereden geldiği; ekle, engelle ya da çıkar. Bkz. [Moderatörler](/wiki/moderation#moderators)."] },
      { id: "labels", title: "Etiketler ve dil", body: ["Takım adları, başlıklar ve her sohbet yanıtı için her dilde kendi ifadelerin, ve overlay ile sohbet yanıtlarının kullandığı yayın dili."] },
    ],
  },
  keyboard: {
    title: "Klavye",
    description: "Panelin klavye kısayolları: komut paleti, takım çekmek, sekmeler arasında geçmek ve sırada gezinmek.",
    lead: "Hiçbir tarayıcı kısayolunun kullanmadığı kısa bir tuş listesi. Bir metin kutusu odakta değilken çalışırlar.",
    sections: [
      {
        id: "global",
        title: "Panelin her yerinde",
        body: [
          {
            keys: [
              ["Ctrl K", "Komut paletini aç (Mac'te ⌘ K)"],
              ["/", "Sırada ara"],
              ["D", "Takımları çek"],
              ["1 – 5", "Sıra, Takımlar, Yönetim, Geçmiş, Maçlar"],
              ["Esc", "Arama kutusunu ya da odaktaki satırı bırak"],
            ],
          },
        ],
      },
      {
        id: "rows",
        title: "Bir sıra satırında",
        body: [
          "Listeye Tab ile gel, sonra:",
          { keys: [["↑ ↓", "Önceki ya da sonraki satır"], ["Enter", "Satırın menüsünü aç"], ["Delete", "Sıradan çıkar (Geri al ile)"]] },
        ],
      },
      {
        id: "more",
        title: "Ayrıca",
        body: ["Enter tek alanlı her formu kaydeder: Oyuncu ekle, bir yaptırım, bir Ayarlar alanı. Bir maçın sayfasında ← ve → maçlar arasında gezer. Komut paleti ve satır menüsü her işlemin tuşunu gösterir."],
      },
    ],
  },
  privacy: {
    title: "Gizlilik",
    description: "TheAtlas Queue'nun yayıncılar ve izleyiciler hakkında ne sakladığı, herkese açık sayfaların ne gösterdiği ve ne kadar tutulduğu.",
    lead: "TheAtlas Queue sıranı yönetmek için gerekeni tutar, fazlasını değil. Reklam ve analiz yoktur.",
    sections: [
      {
        id: "stored",
        title: "Ne saklanır",
        body: [
          {
            list: [
              "**Yayıncılar ve moderatörler**: Kick ile girişten Kick adın, kimliğin ve resmin, ve kanalının ayarları.",
              "**Sıradaki izleyiciler**: sohbetten Kick adı ve kimliği, verdikleri Riot ID, rozetleri ve Riot'tan getirilen derecesi.",
              "**Yönetim**: yaptırımlar ve nedenleri, kanalla birlikte tutulur. Nedenler yalnızca panelde görünür.",
              "**Maçlar**: kimin oynadığı, kimin kazandığı ve bıraktıkları kayıtlar.",
              "**Sohbet yanıtları**: yayıncı açtığında, Kick'in sohbetine yazma izni, şifreli saklanır. Yanıtları kapatmak izni iptal eder ve siler.",
            ],
          },
        ],
      },
      {
        id: "public",
        title: "Ne herkese açık",
        body: ["Yalnızca yayıncının açtığı. İzleme sayfası ve overlay'ler isimleri, takımları, skorları ve yayıncı isterse Riot ID'leri ile dereceleri gösterir. Kick kimlikleri, nedenler ya da kimin ne yaptığı asla gösterilmez."],
      },
      {
        id: "kept",
        title: "Ne kadar",
        body: [
          {
            list: [
              `Geçmiş: ${k.historyDays} gün. Geri al'ın ihtiyaç duyduğu: ${k.undoMinutes} dakika.`,
              `Maçlar ve kayıtlar: ${s.games_retention_days} gün ya da yayıncının seçtiği.`,
              `Getirilen bir derece: ${k.rankDays} gün.`,
              `Sohbet rozetinden gelen moderatör erişimi: rozet son görüldükten ${k.badgeDays} gün sonra.`,
            ],
          },
        ],
      },
      {
        id: "delete",
        title: "Verilerini silmek",
        body: [
          "Yayıncı kanalını ve içindeki her şeyi **Ayarlar → Verilerin** bölümündeki **Verilerimi sil** ile silebilir: sıra, takımlar, maçlar ve kayıtlar, moderasyon, overlay'ler, geçmiş, ayarlar ve sohbet yanıtları izni silinir, Kick kanalın sohbetini buraya göndermeyi bırakır. Kanalın adını yeniden yazmanı ister ve geri alınamaz. Yeniden giriş yapınca yeni, boş bir kanal başlar.",
        ],
      },
      {
        id: "browser",
        title: "Tarayıcında",
        body: ["Bir giriş çerezi; dilin, teman, son bulunduğun yer ve görünüm seçimlerin için küçük çerezler ve yerel ayarlar. Riot ID'ler yalnızca derece getirmek için Riot'a gider. Hiçbir şey satılmaz, hiçbir şey reklamcılara gitmez."],
      },
    ],
  },
};
