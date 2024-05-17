import google from "@googleapis/sheets";
import { getClient } from "./auth.js";

import { LegiscanClient } from "@civicnews/legiscan-client";
import { stringify } from "csv";
import * as fs from "node:fs/promises";
import Database from "better-sqlite3";
import progress from "cli-progress";

const SHEET = "1PUWVVtRwmx5_XlD2brZJ_lpeVvBI6FLGRyn0AMtHKIE";

var sheets = google.sheets("v4");
var auth = getClient();

var cache = new Database("cache.db");
cache.exec(`CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT);`);
var getCached = cache.prepare(`SELECT value FROM cache WHERE key = ?;`).pluck();
var setCached = cache.prepare(`INSERT INTO cache VALUES (?, ?);`);

const BATCH_SIZE = 20;

var client = new LegiscanClient();

var header = ["bill ID", "last action", "bill number","description", "link", "subjects", "sponsors", "supplements"];
var handle = await fs.open("log.txt", "a");
var stream = handle.createWriteStream();
function log(out) {
  console.log(out);
  var now = new Date();
  stream.write(`${now} - ${out}\n`);
}

var values = [header];

log("Getting master list from Legiscan...");
var all = await client.getMasterList({ state: "MI"});

var cachedCount = 0;
var bar = new progress.SingleBar({
  format: "{bar} | Retrieved: {value}/{total} ({percentage}%) | Cached: {cachedCount}/{total}"
}, progress.Presets.rect);
log("Retrieving details for each bill...");
bar.start(all.length, 0, { cachedCount });

for (var i = 0; i < all.length; i += BATCH_SIZE) {
  let slice = all.slice(i, i + BATCH_SIZE);
  let request = slice.map(async bill => {
    var hash = bill.change_hash;

    var details;
    var cached = getCached.get(hash);
    if (cached) {
      // use the cached info
      cachedCount++;
      details = JSON.parse(cached);
    } else {
      // get a fresh copy and cache it
      details = await client.getBill(bill.bill_id);
      setCached.run(hash, JSON.stringify(details));
    }
    Object.assign(bill, details);
    bar.increment(1, { cachedCount });

  });

  await Promise.all(request);
  for (var bill of slice) {
    var row = [
      bill.bill_id,
      bill.last_action_date,
      bill.bill_number,
      bill.description,
      bill.state_link,
      bill.subjects.map(s => s.subject_name).join(", "),
      bill.sponsors.map(s => s.name).join(", "),
      bill.supplements.some(b => b.type_id == 3 || 2)
    ];
    // add metadata for sorting
    var [y, m, d] = bill.last_action_date.split(/[-/]/).map(Number);
    row.metaDate = new Date(y, m - 1, d);
    values.push(row);
  }
};

bar.stop();

log("Uploading to sheets...");
values = values.sort((a, b) => b.metaDate - a.metaDate);

// upload to Sheets
await sheets.spreadsheets.values.clear({
  auth, spreadsheetId: SHEET, range: "bills!A:ZZZ"
});
await sheets.spreadsheets.values.update({
  auth, spreadsheetId: SHEET, range: "bills!A1", valueInputOption: "USER_ENTERED",
  resource: { values }
});
log(`Uploaded ${values.length} rows`);