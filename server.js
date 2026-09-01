const path = require('node:path');
const express = require('express');

// Node's built-in .env loader (>=20.12) - avoids a dotenv dependency.
// PDF_PASSWORD lives here; the file is gitignored.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env present - fine unless a protected PDF is imported.
}

const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Spend Tracker running at http://localhost:${PORT}`);
});
