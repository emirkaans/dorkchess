# dorkchess

Tarayıcıda çalışan satranç varyantları: **Standart**, **Bürokrat**, **Jester**, **Diplomat**.
İki kişi aynı ekranda, bilgisayara karşı (5 seviye) ya da bot vs bot izleyerek oynanır; satranç saati ve
her varyant için görsel kural kartları var. Kural motoru, tahta ve yapay zekâ sıfırdan yazıldı; harici
satranç kütüphanesi ve backend yok.

## Çalıştırma

```bash
npm install
npm run dev        # geliştirme sunucusu (http://localhost:5173)
npm test           # tüm motor testleri (Vitest)
npm run typecheck  # uygulama + motorun DOM'suz tip kontrolü
npm run build      # üretim derlemesi (dist/)
npm run bench      # perft(4) süresi + seviye 5'in 3 sn'de ulaştığı derinlik ve düğüm/sn
npm run selfplay -- --variant jester --games 100 --white 3 --black 3 --seed 1 [--out sonuc.json]
```

`bench` ve `selfplay` Node 22.6+ ile TypeScript'i doğrudan çalıştırır (`--experimental-strip-types`).

## Yapı

```
src/engine/            saf TypeScript kural motoru (React/DOM import etmez)
  types.ts             Color, Piece, Move, Position, GameState, MovePattern,
                       PieceDefinition, VariantDefinition
  board.ts             0..63 kare indeksi (a1 = 0), yönler, kare yardımcıları
  movegen.ts           hareket kalıplarından ham hamle üretimi, rok, isSquareAttacked, applyMove
  legality.ts          şah güvenliği, yasal hamle filtresi, perft
  game.ts              makeMove / undoMove, oyun sonu, tekrar hash'i, yetersiz materyal
  notation.ts          FEN benzeri konum metni, kısa cebirsel notasyon (SAN)
  variants/            standard.ts, burokrat.ts, jester.ts, diplomat.ts, icons.ts,
                       index.ts (registry)
src/ai/                yapay zekâ (React/DOM import etmez; worker'da ve Node'da çalışır)
  evaluate.ts          konum değerlendirme (materyal, konum tabloları, varyant kancası, hareketlilik)
  search.ts            negamax + alfa-beta, iteratif derinleştirme, quiescence, transpozisyon tablosu
  levels.ts            seviye ayarları (tek yapılandırma nesnesi), bot süresi, beraberlik kararı
  rng.ts               tohumlanabilir rastgele sayı üreteci
  match.ts             worker'sız bot vs bot oyunu (selfplay ve testler)
  protocol.ts          UI <-> worker mesaj tipleri
  worker.ts, client.ts Web Worker girişi ve UI'nin kullandığı küçük API
src/clock/clock.ts     saf saat mantığı (zaman dışarıdan verilir)
src/rules/cards.ts     kural kartı veri tipleri (içerik varyant tanımlarında)
src/storage/           local.ts (localStorage, try/catch), games.ts (oyun kaydı, PGN benzeri metin)
src/ui/                React: App, Board, Diagram, ClockView, NewGameDialog, RuleCardModal,
                       HistoryModal, sound.ts (Web Audio), prefs.ts (tema/ses ayarları), ...
scripts/               bench.ts, selfplay.ts
tests/                 motor, YZ (tests/ai), saat (tests/clock), kural kartları, mimari, bileşen testleri
```

`GameState` değişmezdir (immutable): `makeMove` yeni bir durum döndürür, `previous` alanı geri almayı sağlar.
Motor fonksiyonları varyant tanımını parametre olarak alır, bu yüzden sunucuda da aynen çalışır.

## Motor tasarımı

- **Taş = `PieceDefinition`**: FEN harfi, SAN harfi, hareket kalıpları (`patterns(pos, color)`),
  `canCapture` / `capturable`, `royal` (şah), `castles`, yetersiz materyal rolü (`material`),
  ikon (Unicode glyph veya SVG string) ve isteğe bağlı rozet (`badge`).
- **Hareket kalıpları**: `slide` (kale/fil/vezir), `step` (at/şah), `pawn` (çift adım, en passant, terfi
  ayrı ayrı açılıp kapatılabilir). Kalıplar konuma bağlı olabilir — Jester formunu böyle değiştirir.
- **Saldırı hesabı** (`isSquareAttacked`) aynı kalıpları kullanır; `canCapture: false` taşlar hiçbir kareye
  saldırmaz, ama her taş kayan hatları keser.
- **Yasallık**: ham hamle uygulanır (varyantın `afterMove` ile güncellediği ekstra durum dahil), sonra hamle
  yapanın şahı rakip tarafından alınabiliyor mu bakılır. Jester'in "hamle yapılan taş türü rakip Jester'in
  yeni formu olur" kuralı bu sayede ek kod gerektirmeden doğru işler.
- **Varyant = `VariantDefinition`**: id, ad, açıklama, başlangıç FEN'i, taşlar, terfi seçenekleri,
  `isCapturable` / `canCapture`, ekstra durum (`initialExtra`, `afterMove`, `hashExtra`,
  `serializeExtra` / `parseExtra`), isteğe bağlı `generateMoves` ve `isGameOver` override'ları.
- **Konuma bağlı yeme kuralı** (`captureAllowed`, isteğe bağlı): statik `canCapture` / `isCapturable`
  kontrolünden sonra hem yeme hamlesi üretiminde hem `isSquareAttacked`'te sorulur; dolayısıyla şah çekme,
  mat ve pat da ona uyar. Diplomat'ın barış bölgesi tamamen bununla yazıldı.
- **Vurgulu kareler** (`highlight`, isteğe bağlı): UI'nin tahtada boyayacağı kareler, aç/kapa düğmesinin
  etiketi ve hafif çizgiyle işaretlenecek yataylar (`ranks`). Diplomat'ta "Barış bölgesi": aktif aura
  kareleri (şahın karesi hariç) ve 4-5. yataylar.
- **Pasif taş** (`PieceDefinition.inactive`, isteğe bağlı): taş o karede etkisizse UI onu soluk çizer.
- **Başlangıç kurulumu** (`setup`, isteğe bağlı): oyun öncesi sorulan sorular (`questions`) ve cevaplardan
  başlangıç FEN'i üreten `startPosition(answers)`. UI bu soruları genel bir pencerede sorar; Jester'de her
  oyuncu hangi taşının (vezir, sol/sağ kale, fil, at) Jester olacağını seçer. `setupStartPosition(v, answers)`
  eksik cevaplar için varsayılanı kullanır.
- **Konum hash'i** yerleşim, sıra, rok hakları, (yalnızca yasal en passant varsa) en passant karesi ve
  varyant ekstra durumunu içerir.
- **Oyun sonu**: mat, pat, 50 hamle (yarım hamle sayacı ≥ 100), üç kez tekrar, yetersiz materyal
  (K–K, K+F–K, K+A–K; `material: 'none'` taşlar yok sayılır). Mat, aynı hamledeki 50 hamle beraberliğine
  üstün gelir. Beraberlikler otomatik uygulanır (talep gerekmez).

### FEN benzeri konum metni

Standart FEN'in 6 alanı + varyant gerektirirse 7. alan. Jester için 7. alan iki karakterdir:
beyazın ve siyahın en son oynattığı taş türü (`-` = henüz yok). Örnek: `... w KQkq - 0 2 pn`.

## Bilgisayar rakibi

Bot yalnızca motorun genel API'sini kullanır: yasal hamle üretimi, hamle uygulama, oyun sonu kuralları ve
konum hash'i. Bu yüzden Jester'in yasallık kuralı, Diplomat'ın barış bölgesi gibi kurallar aramada ayrıca
kodlanmadan doğru uygulanır; yeni bir varyant eklendiğinde bot ek kod gerektirmeden oynar. Varyanta özel
bilgi yalnızca değerlendirmeye girer (`pieceValues`, `evaluateExtra`).

- **Değerlendirme** (sıradaki tarafın bakış açısından, santipiyon): materyal + standart taşlar için konum
  tabloları (oyun sonunda şah merkeze) + `evaluateExtra` + (seviye 5) hareketlilik (ham hamle sayısı farkı × 2).
  Mat = 100000 − ply (en kısa matı tercih eder); her türlü beraberlik 0.
- **Arama**: negamax + alfa-beta, iteratif derinleştirme ve süre sınırı (sınır dolunca son tamamlanan
  derinliğin sonucu kullanılır; derinlik 1 her zaman tamamlanır, yani yasal bir hamle mutlaka döner).
  Hamle sıralaması: önceki iterasyonun / tablonun en iyi hamlesi, MVV-LVA ile yeme hamleleri, terfiler.
  Quiescence yalnızca yeme ve terfi hamlelerine bakar (şah altındayken tüm kaçışlara). Transpozisyon tablosu
  konum hash'ini kullanır (Jester formu dahil), en fazla 2^18 kayıt. Tekrar eden konum (oyun geçmişinde veya
  arama yolunda) beraberlik sayılır.
- **Rastgelelik** tohumlu üreteçten gelir: aynı tohum + konum + seviye 1–3 = aynı hamle. Kök hamlelerin
  yalnızca seçilebilecek olanları (en iyi 3, en iyiye 50 puan yakın olanlar ya da eşitler) kesin puanlanır;
  diğerleri alfa-beta ile budanır.
- **Worker**: arama Web Worker'da çalışır, arayüz donmaz. Çalışan bir arama mesaj okuyamadığı için "stop"
  worker'ı sonlandırarak yapılır; cevaplar istek `id`'si taşır, eskiler yok sayılır. Bot en az 400 ms bekler.

### Seviyeler (`src/ai/levels.ts`)

| Seviye | Ad | Arama | Seçim | Süre |
| --- | --- | --- | --- | --- |
| 1 | Çaylak | 1 ply | %50 rastgele yasal hamle, aksi halde en iyi | 0.1 sn |
| 2 | Mahalle | 2 ply | en iyi 3 hamleden puana göre ağırlıklı | 0.3 sn |
| 3 | Kulüp | 3 ply + quiescence | en iyiye 50 puan yakınlar arasından (bulunan mat asla bırakılmaz) | 0.7 sn |
| 4 | Usta | iteratif + quiescence + TT | en iyi (eşitler arasında rastgele) | 1.5 sn |
| 5 | Dork | 4 + hareketlilik | en iyi | 3 sn |

Saatli oyunda bot süresi = min(seviye sınırı, kalan süre / 30 + artış). İpucu seviye 4 ile 1 sn arar.
Beraberlik teklifini seviye 3+ kendi değerlendirmesi −150'den kötüyse kabul eder; 1–2 her zaman reddeder.

Ölçümler (bu geliştirme makinesinde): perft(4) ≈ 0.3 sn; seviye 5 oyun ortasında 3 sn'de 4 ply
(4. ply ≈ 1.1 sn'de biter), ≈ 90 bin düğüm/sn. Seviye 5, seviye 3'e karşı 20 oyunda %100 puan aldı.

### Selfplay

```bash
npm run selfplay -- --variant all --games 20 --white 2 --black 2 --seed 1 --out sonuc.json
```

`--variant` bir varyant id'si ya da `all`; `--max-moves` (varsayılan 200). Her oyunun ilk 2 hamlesi (her renk 1)
rastgele yasal hamledir; 200 hamlede bitmeyen oyun "sınır" beraberliği sayılır. Çıktı: beyaz/siyah/beraberlik
yüzdeleri, ortalama oyun uzunluğu, bitiş nedenleri, özel taşın yenme oranı ve ortalama yenildiği hamle.

## Saat ve kural kartları

- **Saat** (`src/clock/clock.ts`): Süresiz, 1+0, 3+2, 5+0, 10+0, 15+10. İlk hamleyle başlar (ilk hamle süreden
  düşmez), hamle yapanın saati durur ve artış eklenir. Süresi biten kaybeder; ancak rakibin kendi taşlarıyla
  mat gücü yoksa (varyantın yetersiz materyal kuralı) beraberlik. Son 10 saniyede kırmızı ve ondalıklı.
  Saatli oyunda bota karşı geri alma ve ipucu kapalı.
- **Kural kartları**: her varyantın `rules` alanı (başlık, özet, en fazla 6 madde, örnek diyagramlar: FEN +
  vurgulu kareler + oklar + açıklama). "Oyuna başla" denince açılır; örnekler ileri/geri ve 2 sn'de bir
  otomatik oynar; "bir daha gösterme" tarayıcıda saklanır; "Kurallar" düğmesi kartı tekrar açar. Diyagram,
  ana tahta bileşeninin salt okunur halidir.

## Geçmiş, ses ve temalar

- **Geçmiş**: biten oyunlar tarayıcıda saklanır (en fazla 200; eskiler silinir). "Geçmiş" ekranında tarih,
  varyant, mod, oyuncular/seviye ve sonuç listelenir; "İzle" hamle listesi ve kaydırıcıyla tekrar oynatır.
  Dışa aktarma (kopyala / .pgn indir) ve içe aktarma PGN benzeri metinle yapılır; başlıkta
  `[Variant "jester"]`, `[FEN "..."]` gibi alanlar bulunur ve içe aktarılan her hamle motorla doğrulanır.
- **Ses**: hamle, yeme, şah, oyun sonu ve saat 10 saniyenin altına inince uyarı; sesler Web Audio API ile kodda
  üretilir (ses dosyası yok). Araç çubuğundaki düğmeyle sessize alınır.
- **Temalar**: tahta için Klasik, Koyu ve Dork; arayüz için Sistem / Açık / Koyu. Seçimler hatırlanır.

## Yeni varyant / taş ekleme (örnek: Bürokrat)

UI'a dokunmak gerekmez; ikon, rozet ve açıklama varyant tanımından gelir.

1. `src/engine/variants/burokrat.ts` dosyasını oluşturun ve taşı tanımlayın:

   ```ts
   import { ALL_DIRS } from '../board.ts';
   import { STANDARD_PIECES, defineVariant } from './standard.ts';

   export const BUROKRAT: PieceDefinition = {
     type: 'u', name: 'Bürokrat', fenChar: 'u', sanLetter: 'U',
     patterns: () => [{ kind: 'step', dirs: ALL_DIRS }], // her yöne 1 kare
     canCapture: false,   // hiçbir şey yiyemez ve hiçbir kareye saldırmaz
     capturable: false,   // hiçbir taş onu yiyemez (kare "dolu" sayılır)
     material: 'none',    // yetersiz materyal hesabında yok sayılır
     icon: { kind: 'svg', svg: (color) => `<svg ...>...</svg>` },
   };
   ```

2. Varyantı tanımlayın (standart taşları yayıp yenisini ekleyerek):

   ```ts
   export const burokrat = defineVariant({
     id: 'burokrat',
     name: 'Bürokrat',
     description: ['g1/g8 atlarının yerine Bürokrat başlar.', /* ... */],
     startPosition: 'rnbqkbur/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBUR w KQkq - 0 1',
     pieces: { ...STANDARD_PIECES, u: BUROKRAT },
     promotionTypes: ['q', 'r', 'b', 'n'], // 'u' yok: piyon Bürokrat'a terfi edemez
     // Bot için taş değerleri (santipiyon); dengelemede yalnızca burası değişir.
     pieceValues: { ...STANDARD_VALUES, u: 100 },
     // İsteğe bağlı değerlendirme terimi: kendi şahına bitişik her Bürokrat +15.
     evaluateExtra: (pos, color) => /* ... */ 0,
     // Kural kartı: en fazla 6 madde, özel varyantlar için en az 3 örnek diyagram.
     rules: {
       title: 'Bürokrat',
       summary: 'Kimseyi yemez, kimse onu yiyemez, ama yol keser.',
       bullets: ['Her yöne 1 kare, yalnızca boş kareye gider.', /* ... */],
       examples: [
         { fen: 'k3r3/8/8/8/8/8/3U4/4K3 w - - 0 1', highlights: ['e1'], arrows: [['d2', 'e2']],
           caption: 'Bürokrat e2'ye girip şahı kurtarır.' },
       ],
     },
   });
   ```

3. `src/engine/variants/index.ts` içinde kaydedin: `registerVariant(burokrat);`

4. `tests/` altına davranış testlerini yazın.

Mevcut kalıplarla anlatılamayan bir taş için `patterns` yerine konuma bağlı kalıp döndürün (bkz. `jester.ts`)
ya da varyantın `generateMoves(pos, from, base)` override'ını kullanın. Varyanta özel bir durum gerekiyorsa
`initialExtra` + `afterMove` + `hashExtra` + `serializeExtra`/`parseExtra` ekleyin.

## Yorum gerektiren kural kararları

- **Jester piyon formu, son sıra**: Jester piyon formunda son sıraya ilerleyebilir/yiyerek girebilir ama
  terfi etmez; son sıradayken piyon formunda hamlesi yoktur (ileri ve çapraz kareler tahta dışında).
- **Jester ve rok**: rok sırasında şahın başlangıç ve geçiş karesi, Jester'in *o anki* görünen formuna göre
  kontrol edilir; varış karesi ise normal yasallık filtresiyle (Jester şah formundayken) kontrol edilir.
- **Jester başlangıç seçimi**: önce Beyaz, sonra Siyah seçer; "sol/sağ" oyuncunun kendi oturduğu yere göredir
  (Siyah için sol = h kanadı), etikette kare adı da yazar. Seçilen taşın yerine Jester konur; kale seçilen
  kanatta rok hakkı yoktur. Varsayılan (vurgulu) seçenek g atıdır.
- **Jester'i Jester ile taklit etme** (SPEC.md'den bilinçli sapma): rakip son hamlesini Jester ile yaptıysa
  Jester varsayılan At formuna değil, oynanan Jester'in *hamle anındaki formuna* geçer (ör. vezir formundaki
  Jester oynarsa karşı Jester de vezir olur). Ekstra durumda Jester hamlesi bu form olarak kaydedilir.
  Hiç hamle yapılmamışsa form yine At'tır.
- **Jester tekrar hash'i**: yalnızca tahtada bulunan Jester'lerin formları hash'e girer.
- **Yetersiz materyal (Jester)**: Jester vezir formuna geçebildiği için mat gücü olan taş sayılır.
- **Diplomat rok**: rok geçiş karesi, şahın o karede duracağı varsayılarak kontrol edilir; şah aurada
  korunmadığı için bu, normal rok kuralıyla aynı sonucu verir.
- **Diplomat başka Diplomatın aurasında**: kendisi de "aurada duran taş" sayılır ve o sırada yenemez.
- **Diplomat pasifken**: 4-5. yatay dışındaki Diplomat arayüzde soluk çizilir (`inactive`), aurası yoktur.

### v2 kararları

- **Bot ve Jester başlangıç seçimi**: botun rengine ait kurulum sorularını bot rastgele cevaplar; insan kendi
  sorusunu cevaplar.
- **Hareketlilik** (seviye 5) yasal değil ham hamle sayısıyla hesaplanır ve sakinlik aramasının başındaki
  konumda bir kez ölçülür; skor alfa-beta sınırlarından 150 puandan fazla uzaksa hiç hesaplanmaz. Bu, seviye
  5'in 3 sn'de 4 ply'a ulaşmasını sağlar.
- **Determinizm**: seviye 1–3 sabit derinliğe kadar arar; süre sınırı yalnızca çok karmaşık konumlarda devreye
  girer. Aynı tohum + konum + seviye aynı hamleyi verir (testli).
- **Süre bitimi**: "rakibin mat gücü" yalnızca kazanacak tarafın kendi taşlarına (ve şahlara) varyantın
  yetersiz materyal kuralı uygulanarak bulunur.
- **Geri alma**: bota karşı "Geri al" son kendi hamleni ve botun cevabını birlikte geri alır; iki kişilik ve
  bot vs bot modunda Geri/İleri hamle geçmişinde gezinir (saatli oyunda geçmişten hamle oynanamaz).
- **Selfplay sınırı**: "200 hamle" tam hamle (her iki renk) olarak sayılır.
