# dorkchess

Tarayıcıda, aynı bilgisayarda iki kişinin sırayla oynadığı (hotseat) satranç varyantları prototipi.
Varyantlar: **Standart**, **Bürokrat**, **Jester**. Kural motoru ve tahta sıfırdan yazıldı; harici satranç
kütüphanesi kullanılmıyor.

## Çalıştırma

```bash
npm install
npm run dev        # geliştirme sunucusu (http://localhost:5173)
npm test           # tüm motor testleri (Vitest)
npm run typecheck  # uygulama + motorun DOM'suz tip kontrolü
npm run build      # üretim derlemesi (dist/)
```

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
src/ui/                React: App, Board, PieceView, MoveList, PromotionDialog
tests/                 perft, standart kurallar, Bürokrat, Jester, Diplomat, mimari, Board bileşeni
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
