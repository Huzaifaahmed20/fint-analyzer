// Turns a raw bank description into a readable merchant name.
//
// Card descriptions arrive as:
//   CARD NO.443913XXXXXX9193 NESTO HYPERMARKET LLC DUBAI:AE 874495 16-08-2026 30.02,AED
// which is merchant + city:country + auth ref + date + original amount. Only the
// merchant is useful for display, per-merchant totals and learned rules.

// Trailing "<ref> <date> <amount>,<CUR>". The statement uses a Unicode minus
// (U+2212) and sometimes splits the date with a space: "16- 08-2026".
const TRAILING_AUTH = /\s+\d{3,}\s+\d{1,2}\s*[-−]\s*\d{1,2}\s*[-−]\s*\d{4}\s+[\d,]+\.\d{2}\s*,\s*[A-Z]{3}\s*$/i;

// A second trailing form: masked auth ref plus masked date, e.g.
// "033854XX XX-XX-2026", and the city/country written without a colon.
const TRAILING_MASKED = /\s+\d+X+\s+XX\s*[-−]\s*XX\s*[-−]\s*\d{4}(?:\s+\d+)?\s*$/i;
const TRAILING_COUNTRY = /\s+(AE|PK|US|IE|GB|IN|SA|EG|PH)\s*$/i;

const CITIES = [
  'dubai', 'abu', 'dhabi', 'sharjah', 'ajman', 'fujairah', 'ras al khaimah', 'umm al quwain',
  'karachi', 'rawalpindi', 'lahore', 'islamabad', 'dxb', 'auh',
];

function stripNoise(text) {
  return text
    .replace(/CARD\s+NO\.?\s*[0-9X]+/gi, ' ')
    .replace(/RefNo\s*:?-?\s*\S+/gi, ' ')
    .replace(/DDR-\d+\s*;?\s*/gi, ' ')
    .replace(/OIC-\d+\s*/gi, ' ')
    .replace(/Pymt-\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Drop an account/reference token: long alphanumeric blobs, IBAN-like strings,
// and short numeric fragments left at the end.
function isNoiseToken(token) {
  if (/^[A-Z]{2}\d{8,}$/i.test(token)) return true;            // IBAN-ish
  if (/^[A-Z0-9]{8,}$/i.test(token) && /\d/.test(token)) return true; // auth code
  if (/^\d{1,6}$/.test(token)) return true;                    // stray number
  return false;
}

function cleanMerchant(description) {
  const raw = String(description || '');
  let text = stripNoise(raw);

  text = text.replace(TRAILING_AUTH, ' ').replace(TRAILING_MASKED, ' ').trim();

  // Leading timestamp fragments on ATM/POS lines.
  text = text.replace(/^[\s\d:\-−]+/, '').trim();
  // A full date onwards is never part of a merchant name.
  text = text.replace(/\s+\d{2}\/\d{2}\/\d{4}.*$/, '').trim();

  // Cut everything from the "CITY:CC" marker onward.
  const country = text.match(/\s*\S*:[A-Za-z]{2}\b/);
  if (country) text = text.slice(0, country.index);

  text = text.replace(TRAILING_COUNTRY, '').trim();

  let tokens = text.split(/\s+/).filter(Boolean);

  // Leading reference blobs, e.g. "E4011870 150789 Mall of the Emirates".
  while (tokens.length > 1 && isNoiseToken(tokens[0])) tokens.shift();

  // Trim trailing city names (handles "Abu Dhabi", where ":AE" already removed "Dhabi").
  for (let i = 0; i < 2 && tokens.length > 1; i += 1) {
    const last = tokens[tokens.length - 1].toLowerCase();
    // "SDubai" is a city glued to the end of a truncated merchant name.
    if (CITIES.includes(last) || CITIES.some((c) => c.length > 3 && last.endsWith(c))) tokens.pop();
    else break;
  }

  while (tokens.length > 1 && isNoiseToken(tokens[tokens.length - 1])) tokens.pop();

  const merchant = tokens.join(' ').replace(/[\s,;:.-]+$/, '').trim();
  if (merchant.length >= 3) return merchant;

  return stripNoise(raw).slice(0, 60).trim() || 'Unknown';
}

module.exports = { cleanMerchant };
