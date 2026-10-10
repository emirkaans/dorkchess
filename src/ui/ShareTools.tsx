import { useRef, useState } from 'react';
import { createGame, getVariant, listVariants, toFen } from '../engine/index.ts';
import type { GameState, VariantDefinition } from '../engine/index.ts';
import { errorText } from '../i18n/index.ts';
import { exportPgn, importPgn } from '../storage/games.ts';
import type { ResultCode } from '../storage/games.ts';
import { decodeLink, encodeGame, encodePosition } from '../storage/share.ts';
import { Modal } from './Modal.tsx';
import { useI18n } from './i18n.tsx';

/** Player names and result written into an exported PGN. */
export interface PgnMeta {
  readonly white?: string;
  readonly black?: string;
  readonly result?: ResultCode;
  readonly termination?: string;
}

const resultOf = (state: GameState): ResultCode =>
  !state.result ? '*' : state.result.winner === 'w' ? '1-0' : state.result.winner === 'b' ? '0-1' : '1/2-1/2';

export function pgnOf(v: VariantDefinition, states: readonly GameState[], meta: PgnMeta = {}): string {
  const last = states[states.length - 1];
  return exportPgn({
    id: '',
    date: new Date().toISOString(),
    variantId: v.id,
    mode: 'imported',
    white: meta.white ?? '?',
    black: meta.black ?? '?',
    result: meta.result ?? resultOf(last),
    termination: meta.termination ?? '',
    startFen: toFen(v, states[0].position),
    moves: last.moves.map((m) => m.san),
  });
}

const here = () => location.origin + location.pathname;

export const gameLinkOf = (v: VariantDefinition, states: readonly GameState[]) =>
  here() +
  encodeGame({
    variantId: v.id,
    startFen: toFen(v, states[0].position),
    moves: states[states.length - 1].moves.map((m) => m.san),
  });

export const positionLinkOf = (v: VariantDefinition, state: GameState) =>
  here() + encodePosition(v.id, toFen(v, state.position));

/** Copies text to the clipboard; remembers for a moment which item was copied. */
function useCopy() {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt(t('copyPrompt'), text);
    }
  };
  return { copied, copy };
}

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

interface ShareProps {
  variant: VariantDefinition;
  /** Every position of the game, first to last. */
  states: readonly GameState[];
  /** Index of the position on the board (for FEN and the position link). */
  cursor: number;
  meta?: PgnMeta;
  /** Opens the game on the analysis board at the shown position. */
  onOpenAnalysis?: () => void;
  /** Start opened (otherwise a click on the heading opens it). */
  open?: boolean;
}

const Icon = ({ d }: { d: string }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
const LINK = 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1';
const DOC = 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5';
const BOARD = 'M4 4h16v16H4zM4 12h16M12 4v16';
const PIN = 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z';
const SAVE = 'M12 4v11M7 10l5 5 5-5M5 20h14';
const CHECK = 'M5 12l5 5 9-10';
const ANALYSE = 'M4 19V5M4 19h16M8 15l4-5 3 3 5-7';

/** Share and export: game link, PGN (copy / download), FEN and position link; optionally "open on the analysis board". */
export function SharePanel({ variant, states, cursor, meta, onOpenAnalysis, open = false }: ShareProps) {
  const { t } = useI18n();
  const { copied, copy } = useCopy();
  const shown = states[Math.min(cursor, states.length - 1)];
  const hasMoves = states.length > 1;
  const item = (key: string, icon: string, label: string, run: () => void, disabled = false) => (
    <button key={key} className="share-item" onClick={run} disabled={disabled}>
      <Icon d={copied === key ? CHECK : icon} />
      <span>{copied === key ? t('controls.copied') : label}</span>
    </button>
  );
  return (
    <details className="box share-box" open={open}>
      <summary>
        <Icon d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5" />
        {t('share.title')}
      </summary>
      <div className="share-grid">
        {item('game', LINK, t('share.gameLink'), () => copy(gameLinkOf(variant, states), 'game'), !hasMoves)}
        {item('pgn', DOC, t('share.copyPgn'), () => copy(pgnOf(variant, states, meta), 'pgn'))}
        {item('fen', BOARD, t('share.copyFen'), () => copy(toFen(variant, shown.position), 'fen'))}
        {item('position', PIN, t('share.positionLink'), () => copy(positionLinkOf(variant, shown), 'position'))}
        {item('download', SAVE, t('share.download'), () =>
          download(
            pgnOf(variant, states, meta),
            `punkchess-${variant.id}-${new Date().toISOString().slice(0, 10)}.pgn`,
          ),
        )}
        {onOpenAnalysis && item('analyse', ANALYSE, t('share.openAnalysis'), onOpenAnalysis)}
      </div>
    </details>
  );
}

export interface ImportedLine {
  readonly variantId: string;
  readonly states: readonly GameState[];
}

/**
 * Reads what the user pasted: a punkchess game or position link, a FEN
 * (for `variantId`), or PGN-like text. Throws a LocalizedError on bad input.
 */
export function parseImport(raw: string, variantId: string): ImportedLine {
  const text = raw.trim();
  const hash = /#[gp]=\S+/.exec(text);
  if (hash) {
    const link = decodeLink(hash[0])!;
    if (link.kind === 'game') return { variantId: link.game.variantId, states: link.states };
    return { variantId: link.variantId, states: [createGame(getVariant(link.variantId), link.fen)] };
  }
  const looksLikeFen = !text.includes('[') && /^\S+\/\S+\/\S+\/\S+\/\S+\/\S+\/\S+\/\S+(\s|$)/.test(text);
  if (looksLikeFen) return { variantId, states: [createGame(getVariant(variantId), text)] };
  const { game, states } = importPgn(text);
  return { variantId: game.variantId, states };
}

/** Paste a PGN, a FEN or a punkchess link. */
export function ImportDialog({
  variantId: initialVariant,
  onImport,
  onClose,
}: {
  variantId: string;
  onImport: (line: ImportedLine) => void;
  onClose: () => void;
}) {
  const { t, vt } = useI18n();
  const [text, setText] = useState('');
  const [variantId, setVariantId] = useState(initialVariant);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    try {
      onImport(parseImport(text, variantId));
    } catch (e) {
      // A FEN that does not parse comes back as a plain Error from the engine.
      setError(errorText(e, t) || t('error.importStart'));
    }
  };
  return (
    <Modal label={t('import.title')} className="import-modal" onClose={onClose}>
      <h2>{t('import.title')}</h2>
      <p className="muted import-help">{t('import.help')}</p>
      <textarea
        value={text}
        rows={8}
        spellCheck={false}
        placeholder={'[Variant "standard"]\n\n1. e4 e5 2. Nf3 …'}
        aria-label={t('import.text')}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      <label className="analysis-field">
        <span>{t('import.fenVariant')}</span>
        <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          {listVariants().map((v) => (
            <option key={v.id} value={v.id}>
              {vt(v).name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>{t('newGame.cancel')}</button>
        <button className="primary" onClick={load} disabled={!text.trim()}>
          {t('import.load')}
        </button>
      </div>
    </Modal>
  );
}
