# Proje: Dorkchess – Satranç Varyantları

Bu dosya iki bölümden oluşur:
- **Bölüm A – v1 (TAMAMLANDI):** kural motoru, 4 varyant, yerel iki kişilik oyun. Referans
  olarak duruyor; mevcut kod bu kurallara uyuyor olmalı. Bozma, sadece gerekirse genişlet.
- **Bölüm B – v2 (ŞİMDİ YAPILACAK):** bilgisayar rakibi (seviyeli), satranç saati, kural
  kartları, bot vs bot test modu; ikinci öncelikte oyun kaydı, ses, tema.

Önce bu dosyanın tamamını oku, sonra mevcut kodu incele, ardından Bölüm B'deki
"v2 çalışma sırası"nı uygula.

---------------------------------------------------------------------------------------

# BÖLÜM A – v1 (TAMAMLANDI)

## Amaç
Tarayıcıda çalışan, aynı bilgisayarda iki kişinin sırayla oynadığı (hotseat) bir satranç
prototipi. Dört varyant: Standart, Bürokrat, Jester, Diplomat. Ağ, hesap, reyting YOK.
Asıl hedef: yeni varyant ve yeni taş eklemeyi kolaylaştıran, iyi test edilmiş bir kural motoru.

## Teknoloji
- TypeScript (strict), Vite, React
- Test: Vitest
- Harici satranç kütüphanesi KULLANMA (chess.js, chessops, chessground, stockfish vb. yok).
  Kural motoru, tahta ve yapay zekâ sıfırdan yazılacak (lisans serbestliği ve özel taş desteği için).
- Taş görselleri: basit inline SVG veya Unicode; özel taşlar için ayırt edilebilir basit SVG
  ikonlar (Bürokrat: evrak/mühür, Jester: soytarı şapkası, Diplomat: zeytin dalı/beyaz bayrak).

## Proje yapısı (v1)
/src/engine       -> saf TS kural motoru (React'e/DOM'a bağımlı olmayacak)
  types.ts        -> Color, PieceType, Piece, Square, Move, Position, GameState
  board.ts        -> 8x8 temsil, kare yardımcıları
  movegen.ts      -> taş türüne göre ham hamle üretimi
  legality.ts     -> şah güvenliği, yasal hamle filtresi
  game.ts         -> hamle uygula/geri al, oyun sonu tespiti, tekrar sayımı
  notation.ts     -> FEN benzeri konum metni, hamle listesi notasyonu
  variants/
    index.ts      -> varyant kaydı (registry)
    standard.ts
    burokrat.ts
    jester.ts
    diplomat.ts
/src/ui           -> React tahta, hamle listesi, varyant seçici
/tests            -> motor testleri

## Motor tasarımı
- Engine UI'dan tamamen bağımsız; ileride sunucuda da aynen çalışacak.
- Her varyant bir `VariantDefinition` nesnesidir:
    id, ad, açıklama
    startPosition (FEN benzeri metin)
    pieceTypes: kullanılan taş türleri
    isCapturable(piece), canCapture(piece)
    generateMoves(state, square) için taş bazlı override
    extraState: varyanta özel durum (ör. Jester için son hamle bilgisi)
    isGameOver(state) override (gerekirse)
- Taş hareketleri "hareket kalıpları" ile tanımlanır (kayan: kale/fil/vezir; adımlı: at/şah;
  piyon özel). Yeni taşlar bu kalıplarla veya özel fonksiyonla eklenebilir.
- Yasal hamle = ham hamle uygulandıktan sonra kendi şahı rakip tarafından alınamıyorsa.
  Saldırı hesabı (isSquareAttacked) varyant kurallarını dikkate alır.
- GameState: konum, sıra, rok hakları, en passant karesi, 50 hamle sayacı, hamle no,
  pozisyon geçmişi (tekrar için), varyant ekstra durumu.
- Konum hash'i varyant ekstra durumunu da içerir (Jester'in formu farklıysa konum farklıdır).

## Standart satranç
Tam FIDE kuralları: rok, en passant, terfi (V/K/F/A seçimi), mat, pat, 50 hamle kuralı,
üç kez tekrar, yetersiz materyal (sadece standart taşlar için: K-K, K+F-K, K+A-K).

## Varyant 1: Bürokrat
- Başlangıç: g1 ve g8'deki atların yerine Bürokrat konur (b1/b8 atları kalır).
- FEN harfi: U (beyaz) / u (siyah).
- Hareket: herhangi bir yöne (düz veya çapraz) 1 kare, sadece BOŞ kareye.
- Hiçbir taşı yiyemez. Hiçbir taş tarafından yenemez (piyon dahil, şah dahil).
- Hiçbir kareye saldırmaz: şah çekmez, rakip şahın hareketini kısıtlamaz.
- Bloklayıcıdır: kayan taşların (kale/fil/vezir) yolunu keser, çekilmiş şahı araya
  girerek kurtarabilir. Atların üzerinden atlamasını engellemez.
- Kendi şahını açığa çıkaracak şekilde hareket edemez (normal bağ/pin kuralı geçerli).
- Bürokrat hamleleri yasal hamle sayılır (pat hesabında dikkate alınır).
- 50 hamle kuralında taş yemeyen, piyon olmayan hamle olarak sayılır.
- Piyon Bürokrat'a terfi edemez.
- Yetersiz materyal kontrolünde Bürokrat yok sayılır (mat gücü yok).
- Bürokratın bulunduğu kare dolu sayılır: hiçbir taş oraya gidemez/oraya yiyerek giremez.

## Varyant 2: Jester
- Başlangıç: g1 ve g8'deki atların yerine Jester konur.
- FEN harfi: J (beyaz) / j (siyah).
- Kural: Jester, RAKİBİN EN SON HAREKET ETTİRDİĞİ TAŞIN TÜRÜ gibi hareket eder ve yer.
  Buna Jester'in "formu" denir. Sahibinin her hamlesinde form o anki duruma göre belirlenir.
- Form tablosu (rakibin son hareket ettirdiği taş -> Jester formu):
    Piyon  -> kendi rengine göre piyon gibi: ileri 1 kare (boşsa), çapraz ileri yeme.
              İki kare ilerleme YOK, en passant YOK, terfi YOK (son sırada sadece yeme
              yoluyla hareket edebilir, ileri gidemez).
    At     -> at
    Fil    -> fil
    Kale   -> kale
    Vezir  -> vezir
    Şah    -> 1 kare her yöne, yiyebilir (rok yapamaz, kraliyet taşı DEĞİL).
    Rok    -> rakip rok yaptıysa son hareket eden taş Şah sayılır.
    Jester -> rakip son hamlesini Jester ile yaptıysa: varsayılan form (At).
  Henüz rakip hiç hamle yapmadıysa (oyunun ilk hamlesinde beyaz için): varsayılan form At.
- Jester şah değildir; yenebilir, terfi yoluyla elde edilemez.
- Rakip Jester'i yediyse ve rakibin son hamlesi Jester değildi: kural aynen uygulanır.

### Jester ile şah ve yasallık (KRİTİK)
- Hamle yasallığı: oyuncu X taşını hareket ettirdiğinde, rakibin Jester'i bir sonraki
  rakip hamlede X türünün formuna geçer. Bu yüzden hamle yasallığı kontrol edilirken
  rakip Jester'in saldırıları, AZ ÖNCE HAREKET ETTİRİLEN TAŞIN TÜRÜ formunda hesaplanır.
  Yani: "Bu hamleden sonra rakip, (Jester'i bu yeni formdayken dahil) şahımı alabilir mi?"
  Alabiliyorsa hamle yasal değildir.
- Örnek: Beyaz vezirini oynarsa, siyah Jester vezir gibi davranır; bu yüzden beyaz,
  siyah Jester'i vezir yapınca şahının vezir hattında açıkta kaldığı bir vezir hamlesi yapamaz.
- "Şah çekili mi" göstergesi ve mat tespiti: sıradaki oyuncunun şahı, rakibin normal
  taşları VEYA rakip Jester'in GÖRÜNEN formu tarafından saldırı altındaysa şah çekilidir.
  Görünen form = rakip Jester için, sıradaki oyuncunun en son hareket ettirdiği taşın türü.
- Oyun sonu: sıradaki oyuncunun yasal hamlesi yoksa -> şah çekiliyse MAT, değilse PAT.
- Arayüzde her Jester'in üzerinde/yanında güncel formunu gösteren küçük bir etiket var
  (ör. "♞" veya "V"); fareyle üzerine gelince "Rakibin son taşı: Vezir" yazar.

## Varyant 3: Diplomat

### Temel
- Başlangıç: g1 ve g8'deki atların yerine Diplomat konur.
- FEN harfi: D (beyaz) / d (siyah).
- Hareket: herhangi bir yöne 1 kare, sadece BOŞ kareye. Diplomat hiçbir taşı yiyemez.
- Diplomat hiçbir kareye saldırmaz, şah çekmez.
- Diplomat yenebilir (normal bir taş gibi), ancak aşağıdaki yeme yasağı nedeniyle
  sadece AURA DIŞINDAN gelen bir taş tarafından yenebilir. Diplomat yenince
  aurası anında kalkar.
- Piyon Diplomat'a terfi edemez. Yetersiz materyal kontrolünde Diplomat yok sayılır.

### Barış bölgesi (aura)
- Aura YALNIZCA Diplomat 4. veya 5. yatayda (rank 4 veya 5) dururken aktiftir.
  Diplomat 1-3. veya 6-8. yataydaysa aurası yoktur, sıradan bir taştır.
- Aktifken aura = Diplomatın bitişiğindeki kareler ∩ 4. ve 5. yataylar.
  Aura hiçbir zaman 3. veya 6. yataya taşmaz.
  Örnek: Diplomat d4'te -> aura c4, e4, c5, d5, e5 (c3, d3, e3 DAHİL DEĞİL).
  Örnek: Diplomat d5'te -> aura c5, e5, c4, d4, e4 (c6, d6, e6 DAHİL DEĞİL).
  Kenarda (a/h sütunu) aura buna göre daha küçük olur.
  Diplomatın kendi karesi auraya DAHİL DEĞİL.
- Aura her iki rengin taşlarını etkiler. Birden fazla aktif aura birleşebilir.
- Aura kuralı 1 – yenilmezlik: aura karesinde duran bir taş yenemez. ŞAH HARİÇ:
  şah aurada da saldırıya açıktır, şah çekilebilir ve mat olabilir.
- Aura kuralı 2 – yeme yasağı: aura karesinde duran bir taş (şah dahil) yeme yapamaz.
  Yani yeme hamlesinin başlangıç karesi aurada olamaz.
- En passant: yiyen piyon veya yenen piyon aura karesindeyse en passant yapılamaz.
- Taşlar auraya yemeden girip çıkabilir. Auralar her hamleden sonra yeniden hesaplanır.

### Şah ve mat
- Genel tanım değişmez: bir hamleden sonra rakip, kurallara uygun bir yeme hamlesiyle
  şahı alabiliyorsa o hamle yasal değildir. isSquareAttacked ve yeme üretimi aura
  kurallarını dikkate alır (aurada duran rakip taşlar şaha saldıramaz).
- Yasal hamle yok + şah çekili -> mat; yasal hamle yok + şah çekili değil -> pat.

### Arayüz
- Aktif aura kareleri hafif mavi renkle boyanır.
- Şahın bulunduğu kare, aura içinde olsa bile mavi BOYANMAZ (şah korunmadığı için).
- Diplomat 4-5. yatay dışındayken hiçbir kare boyanmaz; ikon soluk/pasif görünebilir.
- 4. ve 5. yataylar tahtada çok hafif bir çizgi veya kenar işaretiyle belirtilir.
- Aura gösterimini açma/kapama düğmesi vardır.

## Arayüz (v1)
- Varyant seçici (Standart / Bürokrat / Jester / Diplomat) + "Yeni oyun".
- Seçilen varyantın kısa kural açıklaması tahtanın yanında.
- Tahta: tıkla-tıkla ve sürükle-bırak ile hamle; seçili taşın yasal hamleleri noktalarla
  gösterilir; son hamle vurgulanır; şah çekilmişse şah karesi kırmızı.
- Terfi seçimi için küçük bir pencere.
- Hamle listesi (kısa cebirsel notasyon; Bürokrat = U, Jester = J, Diplomat = D).
- Geri al / ileri al, tahtayı çevir, mevcut konumu FEN benzeri metin olarak kopyala.
- Oyun sonu mesajı: mat, pat, 50 hamle, üç kez tekrar, yetersiz materyal.
- Mobilde de kullanılabilir (dokunarak hamle).

## v1 testleri (mevcut, geçmeye devam etmeli)
1. Standart perft (başlangıç konumu): derinlik 1 = 20, 2 = 400, 3 = 8.902, 4 = 197.281.
   Ayrıca "Kiwipete" konumu için bilinen perft değerleri (derinlik 1-3).
2. Rok, en passant, terfi, pat, mat, üç kez tekrar, 50 hamle için birim testleri.
3. Bürokrat:
   - Boş komşu karelere gidebiliyor, dolu karelere gidemiyor, hiçbir şey yiyemiyor.
   - Hiçbir taş (vezir, piyon, şah, at) Bürokrat'ın karesine hamle üretemiyor.
   - Bürokrat şah çekmiyor; rakip şah Bürokrat'ın yanındaki kareye gidebiliyor.
   - Bürokrat, kale tarafından çekilen şahı araya girerek kurtarabiliyor.
   - Bağlı (pinned) Bürokrat hattan çıkamıyor.
4. Jester:
   - Oyunun ilk hamlesinde beyaz Jester at gibi hareket ediyor.
   - Rakip fil oynayınca fil gibi, kale oynayınca kale gibi hareket edip yiyor.
   - Rakip piyon oynayınca: tek ileri, çapraz yeme; çift adım ve terfi yok.
   - Rakip rok yapınca şah formu.
   - Rakip Jester oynayınca at formu.
   - Yasallık: hareket ettirilen taş türü rakip Jester'e şah çekme imkânı veriyorsa o hamle
     yasal hamleler listesinde YOK (en az 3 farklı konumla test).
   - Jester formunun dahil olduğu bir mat ve bir pat konumu.
   - Aynı taş dizilişi, farklı Jester formu = farklı konum hash'i.
5. Diplomat:
   - Diplomat boş komşu karelere gider, dolu karelere gidemez, yeme yapamaz.
   - Diplomat 4. veya 5. yataydayken aura aktif; 3. veya 6. yataydayken aura yok.
   - Diplomat d4'teyken aura tam olarak {c4, e4, c5, d5, e5}; d5'teyken tam olarak
     {c5, e5, c4, d4, e4}. 3. ve 6. yataydaki komşu karelerde duran taşlar korunmaz
     ve yeme yapabilir.
   - Diplomat a4'teyken aura tam olarak {b4, a5, b5} (kenar durumu).
   - Aurada duran rakip at/kale/fil yenemez.
   - Aurada duran bir taş (şah dahil) yeme yapamaz.
   - Aurada duran şaha aura dışındaki bir kale ile şah çekilebilir; aura içindeki
     şahla bir mat konumu.
   - Diplomat aura dışından yenebilir; aurasındaki bir taş tarafından yenemez.
   - Diplomat yenildiği anda aura kalkar.
   - Diplomat 4. yataydan 3. yataya inince aura kalkar.
   - En passant aura kuralına uyar.
   - Arayüz: aura içindeki şahın karesi boyanmaz.

---------------------------------------------------------------------------------------

# BÖLÜM B – v2 (ŞİMDİ YAPILACAK)

## v2 amacı
1. Kullanıcı bilgisayara karşı 5 farklı seviyede, dört varyantın hepsinde oynayabilsin.
2. Satranç saati ile oynanabilsin.
3. Her varyantın kuralları oyun öncesi kısa, görsel bir "kural kartı" ile anlatılsın.
4. Geliştirici olarak varyantları dengelemek için bot vs bot test modu ve komut satırı
   simülasyon aracı olsun.
5. (İkinci öncelik) Oyun kaydı/tekrar izleme, ses, tahta temaları.
Hâlâ backend YOK; her şey tarayıcıda çalışır.

## Yeni klasörler
/src/ai
  evaluate.ts     -> konum değerlendirme (varyanttan bağımsız + varyant kancaları)
  search.ts       -> negamax + alfa-beta arama
  levels.ts       -> seviye ayarları
  rng.ts          -> tohumlanabilir rastgele sayı üreteci (testler için deterministik)
  worker.ts       -> Web Worker giriş noktası
  client.ts       -> UI'nin worker ile konuştuğu küçük API
/src/clock
  clock.ts        -> saf TS saat mantığı (zaman kaynağı dışarıdan verilir, test edilebilir)
/src/rules
  cards.ts        -> kural kartı veri tipleri (içerik varyant tanımlarında)
/src/storage      -> (ikinci öncelik) oyun kaydı, ayarlar
/scripts
  selfplay.ts     -> komut satırından bot vs bot simülasyon
/tests/ai, /tests/clock

Kural: /src/ai ve /src/clock da React'e/DOM'a bağımlı OLMAYACAK (worker ve Node'da çalışacak).

## B1. Bilgisayar rakibi (yapay zekâ)

### Genel ilke
- Yapay zekâ SADECE motorun genel API'sini kullanır: yasal hamle üretimi, hamle uygula/geri al,
  oyun sonu tespiti, konum hash'i. Varyanta özel kural bilgisi aramaya gömülmez.
  Böylece Jester'in yasallık kuralı, Diplomat aurası vb. otomatik olarak doğru uygulanır
  ve yeni bir varyant eklendiğinde bot ek kod olmadan çalışır.
- Varyanta özel bilgi sadece değerlendirmeye, `VariantDefinition` içindeki opsiyonel
  alanlarla girer (aşağıda).

### VariantDefinition'a eklenecek alanlar
- `pieceValues`: taş türü -> santipiyon değeri. Başlangıç değerleri:
    Piyon 100, At 300, Fil 320, Kale 500, Vezir 900, Şah 0 (mat ayrı ele alınır),
    Bürokrat 100, Jester 300, Diplomat 200.
  Bu değerler varyant dosyasında tek yerde dursun; dengelemede değiştireceğiz.
- `evaluateExtra?(state, color): number` (opsiyonel, santipiyon):
    Diplomat: Diplomat 4. veya 5. yataydaysa +30, aurasında kendi taşı başına +10.
    Jester: şimdilik yok (0).
    Bürokrat: kendi şahına bitişikse +15 (kalkan değeri).
- `rules`: kural kartı içeriği (B3).

### Değerlendirme (evaluate.ts)
- Materyal (pieceValues).
- Basit konum tabloları (piece-square tables) standart taşlar için: merkez kontrolü,
  at/fil gelişimi, piyon ilerlemesi, oyun sonunda şahın merkeze gelmesi.
  Özel taşlar için tablo yok (0) veya varyant dosyasında opsiyonel.
- Hareketlilik: yasal hamle sayısı farkına küçük bir ağırlık (ör. hamle başına 2).
  Pahalıysa sadece seviye 4–5'te açık olsun.
- Mat skoru: çok büyük sabit (ör. 100000) eksi ply sayısı (en kısa matı tercih etsin).
- Beraberlik (pat, tekrar, 50 hamle, yetersiz materyal): 0.

### Arama (search.ts)
- Negamax + alfa-beta budama.
- İteratif derinleştirme + süre sınırı (sınır dolunca son tamamlanan derinliğin en iyi hamlesi).
- Hamle sıralama: önceki iterasyonun en iyi hamlesi önce, sonra yeme hamleleri
  MVV-LVA (değerli taşı ucuz taşla yemek önce), sonra diğerleri.
- Quiescence (sakinlik) araması: derinlik bitince sadece yeme hamleleriyle devam
  (seviye 3+ için açık).
- Transpozisyon tablosu: mevcut konum hash'ini kullan (varyant ekstra durumu dahil
  olduğu için Jester formu güvenle ayrışır). Boyut sınırı olsun (ör. 2^18 kayıt).
- Arama her zaman motorun YASAL hamle listesinden seçer; asla yasal olmayan hamle dönmez.
- Terfi hamlelerinde terfi taşı seçimi hamlenin parçasıdır.
- Arama iptal edilebilir olmalı (kullanıcı yeni oyun başlatırsa worker durur).

### Seviyeler (levels.ts)
| Seviye | Ad (UI) | Arama | Rastgelelik / hata | Süre sınırı |
| --- | --- | --- | --- | --- |
| 1 | Çaylak | 1 ply, quiescence yok | %50 tamamen rastgele yasal hamle, aksi halde en iyi 1-ply hamle | 0.1 sn |
| 2 | Mahalle | en fazla 2 ply, quiescence yok | En iyi 3 hamleden puana göre ağırlıklı rastgele | 0.3 sn |
| 3 | Kulüp | en fazla 3 ply, quiescence açık | En iyiye 50 santipiyon yakın hamleler arasından rastgele | 0.7 sn |
| 4 | Usta | iteratif, quiescence + TT | Rastgelelik yok (eşit puanlılar arasında rastgele) | 1.5 sn |
| 5 | Dork | iteratif, quiescence + TT + hareketlilik | Yok | 3 sn |
- Bot, hesap ne kadar kısa sürse de en az 400 ms "düşünüyor" gibi beklesin (doğal his).
- Saatli oyunda bot süresi = min(seviye süre sınırı, kalan süre / 30 + artış).
- Seviye isimleri ve sayıları tek bir yapılandırma nesnesinde dursun.

### Performans
- Arama, motorun hamle uygula/geri al hızına bağlıdır. Hedef: seviye 5, tipik bir oyun ortası
  konumunda 3 saniyede en az 4 ply derinliğe ulaşsın (standart varyantta, sıradan bir dizüstü
  bilgisayarda).
- Ulaşılamıyorsa motoru optimize et (gereksiz kopyalama yerine make/unmake, önceden
  hesaplanmış saldırı tabloları vb.) ama v1 testleri geçmeye devam etsin.
- `npm run bench` komutu: başlangıç konumunda perft(4) süresi ve seviye 5'in 3 sn'de
  ulaştığı derinlik + saniyedeki düğüm sayısını yazdırsın.

### Web Worker
- Arama mutlaka Web Worker'da çalışır; arayüz bot düşünürken donmaz.
- Mesaj sözleşmesi (örnek):
    UI -> worker: { t: "think", id, variantId, state (serileştirilmiş), level, timeLimitMs, seed? }
    UI -> worker: { t: "stop", id }
    worker -> UI: { t: "bestmove", id, move, score, depth, nodes }
    worker -> UI: { t: "info", id, depth, score, pv } (opsiyonel, ilerleme için)
- `id` eşleşmeyen eski cevaplar yok sayılır.

## B2. Satranç saati

- Saat mantığı /src/clock/clock.ts içinde saf TS; zaman kaynağı parametre olarak verilir
  (testlerde sahte saat kullanılır).
- Süre seçenekleri: Süresiz, 1+0, 3+2, 5+0, 10+0, 15+10 (dakika + hamle başı artış saniye).
- Saat ilk hamle yapılınca başlar (beyazın ilk hamlesi beyazın süresinden düşmez).
- Hamle yapan oyuncunun saati durur, artış eklenir, rakibinki başlar.
- Süre biterse: süresi biten kaybeder; ANCAK rakibin mat gücü yoksa (varyantın yetersiz
  materyal kuralı) beraberlik.
- Son 10 saniyede saat kırmızı ve ondalıklı gösterilir.
- Hotseat ve bota karşı modda çalışır. Bot vs bot modunda opsiyonel.
- Oyun bitince (mat, pat vb.) saatler durur.

## B3. Kural kartları

- Her `VariantDefinition` bir `rules` alanı taşır:
    title, summary (1-2 cümle),
    bullets (en fazla 6 kısa madde),
    examples: dizi; her örnek = { fen, highlights: kare listesi, arrows: [from,to] listesi,
               caption: kısa açıklama }
- Her özel varyant için en az 3 örnek diyagram:
    Bürokrat: hareketi; yenemediği/yiyemediği durum; şahı bloklaması.
    Jester: rakip fil oynadıktan sonra fil gibi hareketi; rakip piyon oynayınca piyon formu;
            "bu hamle yasal değil çünkü rakip Jester'e vezir gücü verir" örneği.
    Diplomat: 4-5. yataydaki aura; 3. yatayda aurasız hali; auradaki şahın korunmadığı durum.
    Standart: kısa genel açıklama, örnek gerekmez.
- Arayüz:
    - Varyant seçilip "Oyuna başla" denince kural kartı modal olarak açılır.
    - Örnekler küçük tahta diyagramlarıyla gösterilir, ileri/geri düğmesi ve otomatik oynatma
      (2 sn aralıkla) vardır.
    - "Bu varyant için bir daha gösterme" seçeneği (tarayıcıda saklanır, try/catch ile).
    - Oyun sırasında "Kurallar" düğmesi kartı tekrar açar.
- Diyagram bileşeni ana tahta bileşeninin küçük, salt okunur hali olsun (kod tekrarı yok).

## B4. Oyun kurulum ekranı

"Yeni oyun" ekranında:
- Mod: İki kişi (aynı ekran) / Bilgisayara karşı / Bot vs Bot (izle)
- Varyant: Standart / Bürokrat / Jester / Diplomat
- Bilgisayara karşı ise: seviye (1–5), renk (Beyaz / Siyah / Rastgele)
- Bot vs Bot ise: beyaz seviyesi, siyah seviyesi, hamleler arası bekleme (0.2 / 1 / 2 sn)
- Süre kontrolü (B2'deki seçenekler)
- Son kullanılan ayarlar hatırlansın (tarayıcıda, try/catch ile).

## B5. Oyun içi özellikler (bota karşı)
- Geri al: bota karşı oyunda son kullanıcı hamlesini VE botun cevabını birlikte geri alır.
  Saatli oyunda geri alma kapalıdır.
- İpucu düğmesi: seviye 4 ayarıyla 1 sn arama yapar, önerilen hamleyi tahtada okla gösterir.
  Saatli oyunda kapalıdır.
- "Bot düşünüyor..." göstergesi.
- Teslim ol ve beraberlik teklifi (bot, seviye 3+ iken değerlendirme -150'den kötüyse kabul eder,
  seviye 1-2 her zaman reddeder).

## B6. Bot vs Bot ve simülasyon (varyant dengelemek için)
- Arayüzde Bot vs Bot modu: iki bot oynar, kullanıcı izler; duraklat/devam/adım düğmeleri.
- Komut satırı aracı: `npm run selfplay -- --variant jester --games 100 --white 3 --black 3 --seed 1`
  - Node'da worker olmadan, aynı /src/ai koduyla çalışır.
  - Açılış çeşitliliği için ilk 2 hamle (her renk 1) rastgele yasal hamle olsun.
  - Çıktı: beyaz galibiyet / siyah galibiyet / beraberlik yüzdeleri, ortalama oyun uzunluğu,
    bitiş nedenleri dağılımı (mat, pat, tekrar, 50 hamle, materyal),
    özel taşın yenme oranı ve ortalama yenildiği hamle numarası.
  - `--out sonuc.json` ile sonuçları dosyaya yazabilsin.
  - 200 hamlede bitmeyen oyunlar "beraberlik (sınır)" sayılsın.

## B7. İkinci öncelik (B1–B6 bittikten sonra)
1. Oyun kaydı:
   - Biten oyunlar tarayıcıda saklanır (en fazla 200 oyun; eskiler silinir).
   - "Geçmiş" ekranı: tarih, varyant, mod, rakip/seviye, sonuç.
   - Tekrar izleme: hamle listesi + kaydırıcı ile ileri/geri.
   - Dışa/içe aktarma: PGN benzeri metin, başlıkta [Variant "jester"] gibi alanlar.
2. Ses: hamle, yeme, şah, oyun sonu, saat azalırken uyarı. Sesler Web Audio API ile kodda
   üretilsin (harici ses dosyası yok). Sessize alma düğmesi.
3. Tahta temaları: en az 3 tema (klasik, koyu, "dork" – canlı/oyunbaz renkler) + açık/koyu
   arayüz. Tema seçimi hatırlansın.

## v2 testleri (zorunlu)
Yapay zekâ:
- Her varyant için en az bir "1 hamlede mat" konumu: seviye 3+ her zaman matı bulur.
- Seviye 3+ asılı vezirini bedavaya bırakan hamleyi seçmez (her varyant için 1 konum).
- Seviye 3+ bedava vezir yemeyi kaçırmaz.
- Jester: botun seçtiği hamle hiçbir zaman yasal hamle listesinin dışında değildir;
  "rakip Jester'e şah imkânı veren" hamleyi asla seçmez (yasallık zaten engeller, test et).
- Diplomat: bot auradaki taşı yemeye çalışmaz (yasal liste dışında), Diplomat'ı aura dışından
  yiyebileceği bir konumda yer (seviye 3+).
- Sağlamlık: her varyantta seviye 1 ve 2 ile 20'şer tam bot vs bot oyunu (tohumlu)
  hatasız bitiyor; her hamle yasal.
- Determinizm: aynı tohum + aynı konum + seviye 1-3 = aynı hamle.
- Süre sınırı: seviye 4 araması 1.5 sn sınırını %20'den fazla aşmıyor.
Saat:
- Artış doğru ekleniyor; süre bitince doğru taraf kaybediyor; rakipte mat gücü yoksa beraberlik;
  ilk hamleden önce saat işlemiyor.
Kural kartları:
- Her kural kartı örneğindeki FEN motor tarafından geçerli olarak okunuyor; highlights ve
  arrows geçerli kareler.

## v2 kabul kriterleri
- Dört varyantın hepsinde bilgisayara karşı 5 seviyede baştan sona oynanabiliyor.
- Bot düşünürken arayüz donmuyor (sürükleme, saat, düğmeler çalışıyor).
- Seviye 1 bir yeni başlayanın yenebileceği kadar zayıf; seviye 5 belirgin şekilde güçlü
  (selfplay'de seviye 5, seviye 3'e karşı standart varyantta en az %80 puan alıyor).
- Saatli oyun düzgün çalışıyor, süre bitimi doğru sonuçlanıyor.
- Kural kartları her özel varyant için görünüyor ve örnekler doğru.
- `npm run selfplay` çalışıyor ve özet tablo yazdırıyor.
- `npm test` tüm testler (v1 + v2) geçiyor; `npm run bench` çalışıyor.
- /src/engine, /src/ai, /src/clock React'e veya DOM'a import yapmıyor.
- README güncel: botun nasıl çalıştığı, seviyeler, selfplay kullanımı, yeni varyanta
  pieceValues/evaluateExtra/rules nasıl eklenir.

## v2 çalışma sırası
1. Mevcut kodu incele; v1 testlerinin geçtiğini doğrula.
2. VariantDefinition'a pieceValues, evaluateExtra, rules alanlarını ekle (rules içeriği sonra).
3. evaluate.ts + search.ts + levels.ts + rng.ts; YZ testleri (önce Node'da, worker'sız).
4. `npm run bench`; performans hedefine ulaşılmıyorsa motoru optimize et, v1 testleri geçsin.
5. `scripts/selfplay.ts`; her varyantta seviye 2 vs 2 ile 20 oyun koşup sonucu bana özetle.
6. Web Worker + client.ts; UI'de "Bilgisayara karşı" modu, oyun kurulum ekranı (B4), B5.
7. Saat (B2) + testleri + UI.
8. Kural kartları (B3): içerik + modal + diyagram bileşeni.
9. Bot vs Bot izleme modu (B6 arayüz kısmı).
10. README.
11. (İkinci öncelik) B7: oyun kaydı, ses, temalar.
Her adımdan sonra testleri çalıştır, geçmeyen test varsa bir sonraki adıma geçme.
Her büyük adımın sonunda bana 3-5 satırlık durum özeti ver.

## Kapsam dışı (v2'de YAPMA)
Çevrimiçi oyun, hesap/giriş, reyting, sunucu/backend, mobil uygulama, açılış kitabı,
oyun sonu tabloları, sinir ağı tabanlı değerlendirme, kullanıcı tanımlı varyant editörü.
