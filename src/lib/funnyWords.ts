const FUNNY_WORDS = new Set([
  'BUM',
  'BUMS',
  'BUTT',
  'BUTTS',
  'DONG',
  'DONGS',
  'DORK',
  'DORKS',
  'FANNY',
  'FART',
  'FARTS',
  'GOOF',
  'GOOFS',
  'NERD',
  'NERDS',
  'PEE',
  'PEED',
  'PEES',
  'POO',
  'POOH',
  'POOP',
  'POOPS',
  'TOOT',
  'TOOTS',
  'TWERP',
  'TWERPS',
  'WEEN',
  'WEENS',
  'ZIT',
  'ZITS',
]);

const FUNNY_PARTS = ['BOOB', 'BONER', 'BUTT', 'DONG', 'FART', 'POO', 'TOOT', 'TURD', 'WEEN', 'ZIT'];

export function isFunnyWord(word: string): boolean {
  const normalized = word.toUpperCase();
  if (FUNNY_WORDS.has(normalized)) {
    return true;
  }

  return FUNNY_PARTS.some((part) => normalized.includes(part));
}
