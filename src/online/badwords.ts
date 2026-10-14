// Usernames that insult or harass: swear words and slurs in Turkish and
// English, also when written with digits for letters ("0r0spu") or split by
// '_' and '-'. Short words that sit inside ordinary words ("stamina",
// "ocean") only count as the whole name. Pure.

/** Found anywhere in the name. */
const ANYWHERE = [
  // Turkish
  'orospu',
  'orosbu',
  'amcik',
  'aminako',
  'aminakoy',
  'aminikoy',
  'amnakoy',
  'sikerim',
  'sikeyim',
  'siktir',
  'sikik',
  'sikis',
  'yarrak',
  'dalyarak',
  'gavat',
  'kahpe',
  'pezevenk',
  'ibne',
  'gotveren',
  'kaltak',
  'surtuk',
  'kevase',
  // English
  'fuck',
  'shit',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'bitch',
  'whore',
  'slut',
  'rapist',
  'nazi',
  'hitler',
  'retard',
  'pussy',
  'asshole',
  'porn',
];

/** Only as the whole name. */
const WHOLE = ['amk', 'aq', 'oc', 'sik', 'pic', 'got', 'fag', 'rape', 'kike', 'dick', 'cock', 'sex'];

/** Lower case, separators dropped, digits read as the letters they stand for. */
export function normalizeName(name: string): string {
  const leet: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '8': 'b',
    '9': 'g',
  };
  return name
    .toLowerCase()
    .replace(/[_-]/g, '')
    .replace(/[0-9]/g, (d) => leet[d] ?? d);
}

export function offensiveName(name: string): boolean {
  const n = normalizeName(name);
  if (ANYWHERE.some((w) => n.includes(w))) return true;
  return WHOLE.includes(n);
}
