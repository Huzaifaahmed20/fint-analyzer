// Keyword matching is anchored at a word boundary so a keyword cannot match in
// the middle of a longer word: "mart" matches "BLUE MART" but not "SMART", and
// "fee" matches "SERVICE FEE" but not "COFFEE". The end is deliberately left
// unanchored so plurals and suffixes still match ("mart" -> "MARTS").
function matchesKeyword(description, keyword) {
  const raw = String(keyword);

  // A keyword may be a regular expression when prefixed with "re:", for rules
  // that key off the shape of a line rather than a merchant name (ATM
  // withdrawals carry a timestamp and terminal id, not a merchant).
  if (raw.startsWith('re:')) return new RegExp(raw.slice(3), 'i').test(description);

  const escaped = raw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`).test(description);
}

function categorize(description, amount, rules) {
  const desc = String(description || '').toLowerCase();

  for (const [category, keywords] of Object.entries(rules)) {
    if (keywords.some((keyword) => matchesKeyword(desc, keyword))) {
      return category;
    }
  }

  return amount > 0 ? 'Income' : 'Uncategorized';
}

module.exports = { categorize, matchesKeyword };
