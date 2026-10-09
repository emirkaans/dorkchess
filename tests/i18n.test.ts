import { describe, expect, it } from 'vitest';
import { createGame, listVariants, setupStartPosition } from '../src/engine/index.ts';
import { LocalizedError, detectLocale, dictionaries, errorText, translate, translator } from '../src/i18n/index.ts';
import { recordTexts } from '../src/i18n/records.ts';
import { variantTexts } from '../src/i18n/variant.ts';
import { decodeLink } from '../src/storage/share.ts';
import type { SavedGame } from '../src/storage/games.ts';

describe('çeviri sözlükleri', () => {
  it('her dilde aynı anahtarlar ve aynı yer tutucular var', () => {
    const tr = dictionaries.tr;
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [locale, dict] of Object.entries(dictionaries)) {
      expect(Object.keys(dict).sort(), locale).toEqual(Object.keys(tr).sort());
      for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
        expect(names(dict[key]), `${locale} ${key}`).toEqual(names(tr[key]));
        expect(dict[key].trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('yer tutucular doldurulur', () => {
    expect(translate('en', 'status.turn', { color: 'White' })).toBe('White to move');
    expect(translate('tr', 'status.turn', { color: 'Beyaz' })).toBe('Sıra: Beyaz');
  });

  it('tarayıcı dili: Türkçe ise tr, değilse en', () => {
    expect(detectLocale(['tr-TR', 'en'])).toBe('tr');
    expect(detectLocale(['de-DE', 'tr'])).toBe('tr');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});

describe('varyant metinleri', () => {
  it('her varyantın İngilizce adı, açıklaması, kural kartı ve taş adları var', () => {
    for (const v of listVariants()) {
      const en = v.translations?.en;
      expect(en?.name, v.id).toBeTruthy();
      expect(en?.description?.length, v.id).toBe(v.description.length);
      expect(en?.rules?.bullets.length, v.id).toBe(v.rules.bullets.length);
      expect(en?.rules?.captions.length, v.id).toBe(v.rules.examples.length);
      for (const type of v.pieceTypes) expect(en?.pieceNames?.[type], `${v.id} ${type}`).toBeTruthy();
      if (v.highlight) expect(en?.highlightLabel, v.id).toBeTruthy();
      for (const q of v.setup?.questions ?? []) {
        expect(en?.setup?.[q.id]?.title, `${v.id} ${q.id}`).toBeTruthy();
        for (const o of q.options) expect(en?.setup?.[q.id]?.options[o.id], `${v.id} ${q.id} ${o.id}`).toBeTruthy();
      }
      // Pieces with a badge have one in English too.
      for (const type of v.pieceTypes) {
        if (v.pieces[type].badge) expect(en?.badges?.[type], `${v.id} ${type}`).toBeTruthy();
      }
    }
  });

  it('Türkçede tanımdaki metinler, İngilizcede çeviriler kullanılır', () => {
    const jester = listVariants().find((v) => v.setup)!;
    const question = jester.setup!.questions[0];
    const tr = variantTexts(jester, 'tr');
    const en = variantTexts(jester, 'en');
    expect(tr.name).toBe(jester.name);
    expect(tr.question(question).title).toBe(question.title);
    expect(en.question(question).title).toBe('White: which piece becomes the Jester?');
    expect(en.question(question).options.find((o) => o.id === 'g')?.label).toBe('Right knight (g1)');
    expect(en.pieceName('n')).toBe('Knight');
    // Examples keep their positions; only captions change.
    expect(en.rules.examples.map((e) => e.fen)).toEqual(jester.rules.examples.map((e) => e.fen));

    const state = createGame(jester, setupStartPosition(jester, { w: 'g', b: 'g' }));
    expect(en.badge('j', state.position, 'w')?.title).toBe('The opponent has not moved yet: default form (Knight)');
    expect(tr.badge('j', state.position, 'w')?.title).toBe('Rakip henüz hamle yapmadı: varsayılan form (At)');
  });
});

describe('hata ve kayıt metinleri', () => {
  it('link hataları seçilen dilde gösterilir', () => {
    let error: unknown;
    try {
      decodeLink('#g=@@@');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(LocalizedError);
    expect((error as Error).message).toBe('Link bozuk (okunamadı).');
    expect(errorText(error, translator('en'))).toBe('The link is broken (unreadable).');
    expect(errorText(new Error('x'), translator('en'))).toBe('x');
  });

  it('kayıtlar kodla saklanır ve çevrilir; eski Türkçe kayıtlar olduğu gibi gösterilir', () => {
    const base: SavedGame = {
      id: '1',
      date: '2026-01-01T00:00:00.000Z',
      variantId: 'standard',
      mode: 'bot',
      white: 'human',
      black: 'bot:4',
      result: '1-0',
      termination: 'checkmate',
      startFen: '',
      moves: [],
    };
    expect(recordTexts(base, translator('en'))).toEqual({
      mode: 'Against the computer',
      white: 'Human',
      black: 'Master (4)',
      termination: 'Checkmate',
    });
    expect(recordTexts(base, translator('tr')).black).toBe('Usta (4)');
    const old = { ...base, mode: 'Bilgisayara karşı', white: 'İnsan', black: 'Usta (4)', termination: 'Mat' };
    expect(recordTexts(old, translator('en'))).toEqual({
      mode: 'Bilgisayara karşı',
      white: 'İnsan',
      black: 'Usta (4)',
      termination: 'Mat',
    });
  });
});
