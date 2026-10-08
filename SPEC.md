# Proje: Satranç Varyantları – v1 (yerel prototip)

## Amaç

Tarayıcıda çalışan, aynı bilgisayarda iki kişinin sırayla oynadığı (hotseat) bir satranç
prototipi yap. Üç varyant olacak: Standart, Bürokrat, Jester. Ağ, hesap, reyting YOK.
Asıl hedef: yeni varyant ve yeni taş eklemeyi kolaylaştıran, iyi test edilmiş bir kural motoru.

## Teknoloji

- TypeScript (strict), Vite, React
- Test: Vitest
- Harici satranç kütüphanesi KULLANMA (chess.js, chessops, chessground vb. yok).
  Kural motoru ve tahta sıfırdan yazılacak (lisans serbestliği ve özel taş desteği için).
- Taş görselleri: basit inline SVG veya Unicode; Bürokrat ve Jester için ayırt edilebilir
  basit SVG ikonlar çiz (ör. Bürokrat: evrak/mühür, Jester: soytarı şapkası).

## Proje yapısı

/src/engine -> saf TS kural motoru (React'e bağımlı olmayacak)
types.ts -> Color, PieceType, Piece, Square, Move, Position, GameState
board.ts -> 8x8 temsil, kare yardımcıları
movegen.ts -> taş türüne göre ham hamle üretimi
legality.ts -> şah güvenliği, yasal hamle filtresi
game.ts -> hamle uygula/geri al, oyun sonu tespiti, tekrar sayımı
notation.ts -> FEN benzeri konum metni, hamle listesi notasyonu
variants/
index.ts -> varyant kaydı (registry)
standard.ts
burokrat.ts
jester.ts
/src/ui -> React tahta, hamle listesi, varyant seçici
/tests -> motor testleri

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
- Taş hareketleri "hareket kalıpları" ile tanımlansın (kayan: kale/fil/vezir; adımlı: at/şah;
  piyon özel). Yeni taşlar bu kalıplarla veya özel fonksiyonla eklenebilsin.
- Yasal hamle = ham hamle uygulandıktan sonra kendi şahı rakip tarafından alınamıyorsa.
  Saldırı hesabı (isSquareAttacked) varyant kurallarını dikkate almalı (aşağıya bak).
- GameState: konum, sıra, rok hakları, en passant karesi, 50 hamle sayacı, hamle no,
  pozisyon geçmişi (tekrar için), varyant ekstra durumu.
- Konum hash'i varyant ekstra durumunu da içermeli (Jester'in formu farklıysa konum farklıdır).

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
  girerek kurtarabilir. Atların üzerinden atlamasını engellemez (at zaten atlar).
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
  Piyon -> kendi rengine göre piyon gibi: ileri 1 kare (boşsa), çapraz ileri yeme.
  İki kare ilerleme YOK, en passant YOK, terfi YOK (son sırada sadece yeme
  yoluyla hareket edebilir, ileri gidemez).
  At -> at
  Fil -> fil
  Kale -> kale
  Vezir -> vezir
  Şah -> 1 kare her yöne, yiyebilir (rok yapamaz, kraliyet taşı DEĞİL).
  Rok -> rakip rok yaptıysa son hareket eden taş Şah sayılır.
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
- Arayüzde her Jester'in üzerinde/yanında güncel formunu gösteren küçük bir etiket olsun
  (ör. "♞" veya "V"); fareyle üzerine gelince "Rakibin son taşı: Vezir" yazsın.

## Arayüz (v1)

- Ana ekranda varyant seçici (Standart / Bürokrat / Jester) + "Yeni oyun".
- Seçilen varyantın kısa kural açıklaması tahtanın yanında görünsün.
- Tahta: tıkla-tıkla ve sürükle-bırak ile hamle; seçili taşın yasal hamleleri noktalarla
  gösterilsin; son hamle vurgulansın; şah çekilmişse şah karesi kırmızı.
- Terfi seçimi için küçük bir pencere.
- Hamle listesi (kısa cebirsel notasyon; Bürokrat = U, Jester = J).
- Geri al / ileri al, tahtayı çevir, mevcut konumu FEN benzeri metin olarak kopyala.
- Oyun sonu mesajı: mat, pat, 50 hamle, üç kez tekrar, yetersiz materyal.
- Mobilde de kullanılabilir (dokunarak hamle).

## Testler (zorunlu, motordan önce/eşzamanlı yazılsın)

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
     yasal hamleler listesinde YOK (en az 3 farklı konumla test et).
   - Jester formunun dahil olduğu bir mat ve bir pat konumu.
   - Aynı taş dizilişi, farklı Jester formu = farklı konum hash'i.

## Kabul kriterleri

- `npm run dev` ile açılıyor, üç varyant da baştan sona oynanabiliyor.
- `npm test` tüm testleri geçiyor.
- Engine klasörü React'e veya DOM'a hiç import yapmıyor.
- Yeni bir taş eklemek için sadece yeni bir varyant dosyası ve gerekirse bir hareket
  fonksiyonu yazmak yeterli; UI kodunda varyanta özel if/else yok (taş ikonu ve form
  etiketi gibi görsel bilgiler de varyant tanımından gelsin).
- Kodda README: nasıl çalıştırılır, yeni varyant nasıl eklenir (örnek olarak Bürokrat).

## Çalışma sırası

1. Engine tipleri + standart hamle üretimi + perft testleri geçene kadar.
2. Oyun sonu kuralları ve testleri.
3. Varyant registry, Bürokrat ve testleri.
4. Jester ve testleri.
5. React arayüzü.
6. README.
   Her adımdan sonra testleri çalıştır, geçmeyen test varsa bir sonraki adıma geçme.

## Kapsam dışı (v1'de YAPMA)

Çevrimiçi oyun, hesap, reyting, saat, bot/yapay zekâ, ses, animasyon cilası.

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
  kurallarını dikkate almalı (aurada duran rakip taşlar şaha saldıramaz).
- Yasal hamle yok + şah çekili -> mat; yasal hamle yok + şah çekili değil -> pat.

### Arayüz

- Diplomat için basit bir SVG ikon (ör. zeytin dalı veya beyaz bayrak).
- Aktif aura kareleri hafif mavi renkle boyanır.
- Şahın bulunduğu kare, aura içinde olsa bile mavi BOYANMAZ (şah korunmadığı için).
- Diplomat 4-5. yatay dışındayken hiçbir kare boyanmaz; ikon soluk/pasif görünebilir.
- 4. ve 5. yataylar tahtada çok hafif bir çizgi veya kenar işaretiyle belirtilsin
     (aura bölgesi açıkça anlaşılsın).
- Aura gösterimini açma/kapama düğmesi olsun.

### Testler

- Diplomat boş komşu karelere gider, dolu karelere gidemez, yeme yapamaz.
- Diplomat 4. veya 5. yataydayken aura aktif; 3. veya 6. yataydayken aura yok
  (aynı konum iki farklı yatayda test edilir).
- Diplomat d4'teyken aura tam olarak {c4, e4, c5, d5, e5}; d5'teyken tam olarak
  {c5, e5, c4, d4, e4}. 3. ve 6. yataydaki komşu karelerde duran taşlar korunmaz
  ve yeme yapabilir.
- Diplomat a4'teyken aura tam olarak {b4, a5, b5} (kenar durumu).
- Aurada duran rakip at/kale/fil yenemez.
- Aurada duran bir taş (şah dahil) yeme yapamaz.
- Aurada duran şaha aura dışındaki bir kale ile şah çekilebilir; aura içindeki
  şahla bir mat konumu test edilir.
- Diplomat aura dışından (uzaktan kale/fil, dışarıdan atlayan at) yenebilir;
  aurasındaki bir taş tarafından yenemez.
- Diplomat yenildiği anda aura kalkar; bir sonraki hamlede auradaki taşlar yenebilir.
- Diplomat 4. yataydan 3. yataya inince aura kalkar.
- En passant aura kuralına uyar.
- Arayüz: aura içindeki şahın karesi boyanmaz (bileşen testi veya görsel kontrol).
