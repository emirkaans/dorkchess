# punkchess

Tarayıcıda çalışan satranç varyantları: **Standart**, **Bürokrat**, **Jester**, **Diplomat**.
İki kişi aynı ekranda, bilgisayara karşı (5 seviye) ya da bot vs bot izleyerek oynanır. Satranç saati,
her varyant için görsel kural kartları, oyun sonu analizi, link ile paylaşım, çevrimdışı çalışma (PWA),
klavye/ekran okuyucu desteği ve Türkçe/İngilizce arayüz var. Kural motoru, tahta ve yapay zekâ sıfırdan
yazıldı; harici satranç kütüphanesi ve backend yok.

## Çalıştırma

```bash
npm install
npm run dev           # geliştirme sunucusu (http://localhost:5173)
npm run build         # üretim derlemesi (dist/, service worker dahil)
npm run preview       # derlemeyi yerelde sun (PWA/çevrimdışı denemek için)
```

Kontroller (CI'da da aynı sırayla çalışır, `.github/workflows/ci.yml`, Node 22):

```bash
npm run typecheck     # uygulama + motorun DOM'suz tip kontrolü
npm run lint          # ESLint (typescript-eslint, react-hooks)
npm run format:check  # Prettier; düzeltmek için: npm run format
npm test              # Vitest: motor, YZ, oturum reducer'ı, bileşen testleri (happy-dom)
npm run build
```

## Geliştirme araçları (`scripts/`)

Hepsi Node 22.6+ ile TypeScript'i doğrudan çalıştırır (`--experimental-strip-types`).

| Komut | Ne yapar |
| --- | --- |
| `npm run bench` | perft(4) süresi; seviye 5'in süre sınırında ulaştığı derinlik ve düğüm/sn |
| `npm run selfplay -- --variant jester --games 100 --white 3 --black 3 --seed 1` | bot vs bot istatistikleri (aşağıda) |
| `npm run match -- --a . --b ../dork-old --games 200 --time 200` | iki motor sürümü arasında paralel maç, Elo farkı ± hata payı |
| `npm run parity -- --depth 4 --positions 20` | hızlı tahta ile referans motorun derin perft karşılaştırması |
| `npm run gen-data -- --variant standard --games 3000` | ayar verisi: bot oyunlarından sakin konumlar |
| `npm run sf-label -- --in data/standard.txt --out data/standard-sf.txt` | konumları Stockfish değerlendirmesiyle etiketler |
| `npm run tune -- --data data/standard-sf.txt --write` | Texel ayarı; `src/ai/eval-params.ts`'i yeniden yazar |
| `npm run sf-match -- --sf <stockfish> --elo 2500 --games 40` | kalibrasyon: seviye 5'e karşı sınırlı Stockfish |
| `npm run icons` | `public/icons/` PWA ikonlarını üretir |

**Stockfish yalnızca geliştirme aracıdır** (kalibrasyon ve etiketleme): yerel bir dosyadır, `data/` klasöründe
durur (git'e girmez) ve uygulamanın parçası değildir. Oyundaki bot tamamen bu projenin kodudur.

## Yapı

```
src/engine/            saf TypeScript kural motoru (React/DOM import etmez) — referans uygulama
  types.ts             Color, Piece, Move, Position, GameState, MovePattern,
                       PieceDefinition, VariantDefinition, VariantTexts
  board.ts             0..63 kare indeksi (a1 = 0), yönler, kare yardımcıları
  movegen.ts           hareket kalıplarından ham hamle üretimi, rok, isSquareAttacked, applyMove
  legality.ts          şah güvenliği, yasal hamle filtresi, perft
  game.ts              makeMove / undoMove, oyun sonu, tekrar hash'i, yetersiz materyal
  notation.ts          FEN benzeri konum metni, kısa cebirsel notasyon (SAN)
  premove.ts           ön hamle hedefleri
  fast/                botun hızlı tahtası (make/unmake, Zobrist) ve varyant kancaları
  variants/            standard.ts, burokrat.ts, jester.ts, diplomat.ts, icons.ts, index.ts (registry)
src/ai/                yapay zekâ (React/DOM import etmez; worker'da ve Node'da çalışır)
  search.ts            PVS araması (aşağıda)
  evaluate.ts          değerlendirme; eval-params.ts ayarlanmış parametreler, eval-features.ts ayar için özellikler
  analysis.ts          oyun sonu analizi: Beyaz'ın bakışından skor, hata işaretleri
  levels.ts            seviye ayarları (tek yapılandırma nesnesi), bot süresi, beraberlik kararı
  rng.ts, match.ts     tohumlanabilir rastgelelik; worker'sız bot vs bot
  protocol.ts, worker.ts, client.ts   Web Worker mesajları, giriş noktası ve UI'nin kullandığı API
src/clock/clock.ts     saf saat mantığı (zaman dışarıdan verilir)
src/rules/cards.ts     kural kartı veri tipleri (içerik varyant tanımlarında)
src/storage/           local.ts (localStorage, try/catch), games.ts (oyun kaydı, PGN benzeri metin),
                       share.ts (paylaşım linkleri)
src/i18n/              sözlükler (messages.ts), translate, varyant metinleri, kayıt metinleri (React'siz)
src/pwa/               service worker kaynağı ve kaydı / güncelleme bildirimi
src/ui/                React
  game/                session.ts + reducer.ts: oyun oturumu, saf reducer (React'siz, Node'da test edilir);
                       hooks.ts: bot, saat, ses/kayıt, ipucu/beraberlik efektleri
  App.tsx, Board.tsx, GameViewer.tsx (analiz), Modal.tsx, useDialogFocus.ts, i18n.tsx, ...
scripts/               geliştirme araçları (yukarıda)
tests/                 motor, hızlı tahta eşliği, YZ, saat, reducer, paylaşım, PWA, i18n, mimari;
                       tests/ui/ bileşen testleri (happy-dom + Testing Library)
```

`GameState` değişmezdir (immutable): `makeMove` yeni bir durum döndürür, `previous` alanı geri almayı sağlar.
Motor fonksiyonları varyant tanımını parametre olarak alır, bu yüzden sunucuda da aynen çalışır.
`tests/architecture.test.ts` motorun, YZ'nin, depolamanın, i18n'in ve oyun reducer'ının React/DOM'a
bağlanmadığını ve UI kodunda varyanta özel dal olmadığını denetler.

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

Bot, motorun varyant tanımından derlenen **hızlı tahtada** (`src/engine/fast/board.ts`) arar: kopyalamak
yerine make/unmake, artımlı Zobrist hash'i, taş listeleri, önceden hesaplanmış adım tabloları. Taş verisiyle
anlatılamayan kurallar (Jester formu, Diplomat aurası) varyantın `fast` kancalarından gelir; aramada varyanta
özel kod yoktur. Değişmez motor referans olarak kalır: testler iki tahtayı her varyantta hamle hamle
karşılaştırır (`tests/fast-board.test.ts`, derin kontrol için `npm run parity`). Bot yalnızca motorun yasal
hamle listesindeki bir hamleyi oynar.

- **Arama** (`src/ai/search.ts`): PVS + iteratif derinleştirme ve aspirasyon pencereleri; 2^20 kayıtlık
  transpozisyon tablosu (aynı varyantta aramalar arasında korunur); null move, geç hamle indirimi (LMR),
  razoring, futility, "iyileşiyor" bayrağı, tekil uzatma ve şah uzatması; hamle sıralamasında TT hamlesi,
  SEE ile süzülen yemeler, killer, karşı hamle ve geçmiş tabloları; yalnızca yemelerden oluşan quiescence.
  Süre: sınırın %60'ı dolunca yeni derinliğe başlanmaz; derinlik 1 her zaman tamamlanır.
- **Değerlendirme** (`src/ai/evaluate.ts`, parametreler `eval-params.ts`): PeSTO tabanlı oyun ortası / oyun
  sonu konum tabloları, fil çifti, piyon yapısı (çift, izole, geçer piyon), açık/yarı açık hatta kale, şah
  kalkanı, hareketlilik ve şaha saldırı, piyonla tehdit; oyun evresine göre karıştırılır. Varyanta özel bilgi
  yalnızca `pieceValues` ve `fast.evaluate` kancasından gelir. Parametreler Stockfish ile etiketlenmiş
  konumlarda Texel yöntemiyle ayarlandı (`gen-data` → `sf-label` → `tune`). Mat = 100000 − ply; beraberlik 0.
- **Rastgelelik** tohumlu üreteçten gelir: aynı tohum + konum + seviye 1–3 = aynı hamle. Kök hamlelerin
  yalnızca seçilebilecek olanları kesin puanlanır.
- **Worker**: arama Web Worker'da çalışır, arayüz donmaz. "stop" worker'ı sonlandırarak yapılır; cevaplar
  istek `id`'si taşır, eskiler yok sayılır. Bot en az 400 ms bekler (çok hızlı cevap doğal görünmüyor).

### Seviyeler (`src/ai/levels.ts`)

| Seviye | Ad | Arama | Seçim | Süre |
| --- | --- | --- | --- | --- |
| 1 | Çaylak | 1 ply | %50 rastgele yasal hamle, aksi halde en iyi | 0.1 sn |
| 2 | Mahalle | 2 ply | en iyi 3 hamleden puana göre ağırlıklı | 0.3 sn |
| 3 | Kulüp | 3 ply + quiescence | en iyiye 50 puan yakınlar arasından (bulunan mat asla bırakılmaz) | 0.7 sn |
| 4 | Usta | tam arama + TT | en iyi (eşitler arasında rastgele) | 0.5 sn |
| 5 | Dork | tam arama + TT + hareketlilik/şah saldırısı | en iyi | 0.95 sn |

Saatli oyunda bot süresi = min(seviye sınırı, kalan süre / 30 + artış). İpucu seviye 4 ile 1 sn arar.
Beraberlik teklifini seviye 3+ kendi değerlendirmesi −150'den kötüyse kabul eder; 1–2 her zaman reddeder.

**Güç**: seviye 5, standart satrançta Stockfish `UCI_LimitStrength` / `UCI_Elo 2500`'e karşı 40 oyunda
≈ 2535 Elo performans gösterdi (±100 civarı hata payı; `npm run sf-match`). Bu geliştirme makinesinde
`npm run bench`: perft(4) ≈ 0.23 sn; seviye 5 oyun ortasında 0.95 sn sınırıyla derinlik 11'e ≈ 0.64 sn'de
ulaşıyor, ≈ 550 bin düğüm/sn.

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
- **Oyun durumu**: oturum (oyuncular, hamle zaman çizelgesi, saat, ön hamle, kurulum soruları) saf bir
  reducer'da tutulur (`src/ui/game/reducer.ts`); bot, saat, ses ve kayıt efektleri `src/ui/game/hooks.ts`'te.

## Oynanış eklentileri

- **Ön hamle (premove)**: bota karşı, sıra bottayken kendi taşını sürükleyerek ya da tıklayarak bir hamle
  sıraya konur; bot oynayınca yasalsa hemen oynanır, değilse iptal edilir (sağ tık da iptal eder). Terfi ön
  hamlesi vezire terfi eder.
- **Oklar**: sağ tuşla bir kareden diğerine sürükleyince ok, aynı karede bırakınca halka çizilir; sol tık temizler.

## Analiz

Biten oyunda "Oyunu analiz et" (ve Geçmiş / paylaşılan oyun görüntüleyicisinde "Analiz et") her konumu
worker'da 0.3 sn arar (`src/ai/analysis.ts`, `src/ui/GameViewer.tsx`):

- tahtanın yanında değerlendirme çubuğu, altında tıklanabilir değerlendirme grafiği (Beyaz'ın bakışından);
- gösterilen konum için motorun önerdiği hamle ok olarak;
- hamle listesinde `??` (hata: hamle yapanın değerlendirmesi 2+ piyon düştü) ve `?` (yanlışlık: 1+ piyon).

Analiz istenince durdurulup kaldığı yerden sürdürülebilir.

## Paylaşım

Linkler sunucu gerektirmez; her şey adresin `#` kısmındadır (`src/storage/share.ts`), base64url JSON:

- `#g=` — bir oyun: varyant, başlangıç FEN'i (varsayılandan farklıysa) ve SAN hamleleri. Açılınca oyun
  görüntüleyicide (analiz dahil) gösterilir.
- `#p=` — bir konum: varyant ve FEN. Açılınca o konumdan iki kişilik oyun başlar.

Linkteki her hamle motorla yeniden oynanarak doğrulanır; bozuk link anlaşılır bir mesajla bildirilir.
Linkler oyun kontrollerindeki "Oyun linki" / "Konum linki" ve Geçmiş'teki "Linki kopyala" ile alınır.

## Çevrimdışı (PWA)

`npm run build`, Vite eklentisiyle (`vite.config.ts`) derlemenin tüm dosyalarını listeleyen bir `sw.js`
üretir (`src/pwa/service-worker.ts`). İlk ziyaretten sonra uygulama, bot dahil, tamamen çevrimdışı çalışır ve
ana ekrana eklenebilir (`public/manifest.webmanifest`, ikonlar `npm run icons` ile üretilir). Önbellek sürüm
adlıdır; yeni sürüm yüklendiğinde üstte "Yeni sürüm hazır — Yenile" çıkar, geçişe kullanıcı karar verir.
Geliştirme sunucusunda (`npm run dev`) service worker kaydedilmez.

## Erişilebilirlik ve mobil

- **Klavye**: tahtada tek bir kare odaklanır (roving tabindex); ok tuşları gezinir (tahta çevrikse yönler de
  döner), Enter/Boşluk taşı seçer ve oynar, Esc seçimi bırakır.
- **Ekran okuyucu**: her karenin etiketi kare adı, taş ve renkle gösterilen durumları içerir ("e4, beyaz
  piyon, son hamle"); oynanan hamle ve oyun sonucu canlı bölgede duyurulur.
- **Pencereler**: açılınca içine odaklanır, Esc kapatır, kapanınca odak açan düğmeye döner (`useDialogFocus`).
- **Telefon**: 640 px altında tek sütun; tahta ekran genişliğine (16 px kenar boşluğuyla) ve yüksekliğine
  sığar; dokunarak sürükleme çalışır, yatay kaydırma olmaz.

## Dil (Türkçe / İngilizce)

Arayüz dili araç çubuğundaki "Dil" seçimiyle değişir ve hatırlanır; kayıtlı seçim yoksa tarayıcı dili Türkçe
ise Türkçe, değilse İngilizce açılır. `<html lang>` seçime uyar.

- Arayüz metinleri `src/i18n/messages.ts`'tedir: `tr` başvuru sözlüğüdür, diğer diller aynı anahtarları
  taşır (`{name}` biçiminde yer tutucularla). Bileşenler `useI18n()` ile `t('anahtar', { ... })` kullanır.
- Varyant metinleri tanımın içindedir: tanımdaki alanlar Türkçedir, `translations.en` İngilizcesini verir
  (ad, açıklama, kural kartı ve örnek açıklamaları, taş adları, vurgu etiketi, kurulum soruları, rozetler).
  UI bunları `variantTexts(v, locale)` ile okur; eksik alan Türkçeye düşer.
- Link ve içe aktarma hataları `LocalizedError` (anahtar + parametre) olarak atılır, seçili dilde gösterilir.
- Geçmiş kayıtları kod saklar (`bot`, `human`, `bot:4`, `checkmate`) ve gösterirken çevirir; önceki
  sürümlerin Türkçe kayıtları olduğu gibi gösterilir.

**Yeni dil eklemek** (ör. Almanca):

1. `src/i18n/messages.ts`'e `export const de: Record<MessageKey, string> = { ... }` ekleyin (tüm anahtarlar).
2. `src/i18n/index.ts`'te `LOCALES`'e `de: 'Deutsch'`, `DICTIONARIES`'e `de` ekleyin; gerekiyorsa
  `detectLocale`'i genişletin.
3. Her varyantın `translations`'ına `de: { ... }` ekleyin (standart taş adları için `STANDARD_PIECE_NAMES_EN`
  gibi ortak bir nesne tanımlayın).
4. `npm test`: `tests/i18n.test.ts` anahtarların ve yer tutucuların eşleştiğini denetler; varyant çevirisi
  eksiksizlik testini yeni dile de uygulayın.

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

4. İngilizce metinleri `translations.en` alanına ekleyin (`name`, `description`, `rules` + örnek
   `captions`, `pieceNames`; varsa `highlightLabel`, `setup`, `badges`). `tests/i18n.test.ts` eksik
   çeviriyi yakalar.

5. `tests/` altına davranış testlerini yazın. Hızlı tahta varyantı tanımdan kendisi derler; taş verisiyle
   anlatılamayan bir kural varsa `fast` kancalarını yazın ve `tests/fast-board.test.ts`'teki hedefli
   konumlara örnek ekleyin (referans motorla hamle hamle karşılaştırılır).

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
- **Determinizm**: seviye 1–3 sabit derinliğe kadar arar; süre sınırı yalnızca çok karmaşık konumlarda devreye
  girer. Aynı tohum + konum + seviye aynı hamleyi verir (testli).
- **Süre bitimi**: "rakibin mat gücü" yalnızca kazanacak tarafın kendi taşlarına (ve şahlara) varyantın
  yetersiz materyal kuralı uygulanarak bulunur.
- **Geri alma**: bota karşı "Geri al" son kendi hamleni ve botun cevabını birlikte geri alır; iki kişilik ve
  bot vs bot modunda Geri/İleri hamle geçmişinde gezinir (saatli oyunda geçmişten hamle oynanamaz).
- **Selfplay sınırı**: "200 hamle" tam hamle (her iki renk) olarak sayılır.

### v3 kararları

- **Seviye süreleri**: seviye 4 0.5 sn, seviye 5 0.95 sn (önceden 1.5 / 3 sn); güç hızlı tahta ve daha iyi
  aramayla arttı. Hareketlilik ve şaha saldırı terimleri yalnızca seviye 5'te ve skor alfa-beta sınırlarına
  yakınken hesaplanır.
- **Stockfish** yalnızca kalibrasyon ve değerlendirme ayarı için kullanıldı; uygulamaya girmez, çalışma
  zamanında hiçbir dış motor ya da sunucu yoktur.
- **Ön hamle terfisi** her zaman vezire yapılır (seçim penceresi bot hamlesini bekletmesin diye).
- **Analiz eşikleri**: hata 200, yanlışlık 100 santipiyon düşüş (hamle yapanın bakışından); her konum 0.3 sn.
- **Paylaşım linki** yalnızca hamleleri taşır (saat, oyuncular, sonuç yok); açan kişi oyunu baştan doğrular.
- **Dil**: kayıtlar ve linkler dilden bağımsızdır (kodlar ve SAN); dışa aktarılan PGN metni o anki dilde
  yazılır. Taş harfleri (SAN, FEN) dilden bağımsızdır.
