function categorize(description, amount, rules) {
  const desc = String(description || '').toLowerCase();

  for (const [category, keywords] of Object.entries(rules)) {
    if (keywords.some((keyword) => desc.includes(String(keyword).toLowerCase()))) {
      return category;
    }
  }

  return amount > 0 ? 'Income' : 'Uncategorized';
}

module.exports = { categorize };
