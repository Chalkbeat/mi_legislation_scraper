var cheerio = require("cheerio");
var google = require("@googleapis/sheets");
var { getClient } = require("./auth");
var fs = require("fs");

const BILLS = "https://legislature.mi.gov/mileg.aspx?page=Bills";
const SHEET = "1PUWVVtRwmx5_XlD2brZJ_lpeVvBI6FLGRyn0AMtHKIE";

var sheets = google.sheets("v4");
var auth = getClient();

// standard ASP extraction code
// pass in a Cheerio document
function extractASPValues($) {
  var asp = {};
  var inputs = $(`input[type=hidden]`);
  for (var input of inputs) {
    var { name, value } = input.attribs;
    asp[name] = value;
  }
  return asp;
}

// actual scraping code for a bill detail page
async function scrapeDetails(url) {
  var html = await fetch(url).then(r => r.text());
  var $ = cheerio.load(html);
  // basic metadata
  var bill = $("#frg_billstatus_BillHeading").text();
  var categories = $("#frg_billstatus_CategoryList").text();
  // check for fiscal analysis documents
  var hasHouseAnalysis = $("#frg_billstatus_HlaTable tr").length > 0;
  var hasSenateAnalysis = $("#frg_billstatus_SfaTable tr").length > 0;
  // check for bill text documents at various stages
  var docs = {
    introduced: $("#frg_billstatus_ImageIntroHtm a"),
    senatePassed: $("#frg_billstatus_ImageApb1Htm a"),
    housePassed: $("#frg_billstatus_ImageApb2Htm a"),
    enrolled: $("#frg_billstatus_ImageEnrolledHtm a"),
    concurred: $("#frg_billstatus_ImageconcurredHtm a"),
    act: $("#frg_billstatus_ImageEnrolledHtm a")
  };
  // update the bill text to contain just URLs linking to each one
  for (var k in docs) {
    if (docs[k].length) {
      docs[k] = new URL(docs[k].get(0).attribs.href, url).toString();
    } else {
      delete docs[k];
    }
  }
  // get the last listed activity on this bill
  var activity = $("#frg_billstatus_HistoriesGridView");
  var last = activity.find("tr:last-child td");
  var [ date, journal, action ] = [...last].map(e => $(e).text());
  var dateValue = 0;
  if (date) { 
    var [m, d, y] = date.split("/").map(Number);
    dateValue = new Date(y, m - 1, d);
  }
  var link = `=HYPERLINK("${url}", "${bill}")`;
  return { url, link, bill, categories, date, dateValue, action, hasHouseAnalysis, hasSenateAnalysis, ...docs };
}

// this is a little simpler than having an async main() that we immediately call
fetch(BILLS).then(async function(redirect) {
  // the application actually has a hash in the URL, and if it's not there for your session, it will ignore you
  // so we get the root page, extract ASP values, but also store its new location for further queries
  const ROOT = redirect.url;
  console.log(`Got redirect URL for scraping: ${ROOT}`);
  var html = await redirect.text();
  var home = cheerio.load(html);
  var asp = extractASPValues(home);
  var bills = [];
  // get the listings of house and senate bills
  for (var chamber of ["House", "Senate"]) {
    console.log(`Getting list of ${chamber} bills...`);
    var form = {
      ...asp,
      frg_bills$LegislativeSession$LegislativeSession: "2023-2024",
      [`frg_bills$BrowseBills$Lst${chamber}Year`]: "2023-2024",
      [`frg_bills$BrowseBills$Button${chamber == "House" ? 1 : 2}`]: "Browse"
    };
    var body = new URLSearchParams(form);
    var request = await fetch(ROOT, { body, method: "POST" });
    var response = await request.text();
    var $ = cheerio.load(response);
    var links = $("#frg_executesearch_SearchResults_Results tr td:first-child a").toArray();
    var urls = links.map(l => l.attribs.href);
    for (var [i, url] of urls.entries()) {
      var dest = new URL(url, ROOT);
      var page = dest.toString();
      console.log(` > Scraping ${dest.searchParams.get("objectname")} (${i + 1} of ${urls.length})...`);
      var extracted = await scrapeDetails(page);
      bills.push(extracted);
    }
  }
  bills.sort((a, b) => b.dateValue - a.dateValue);
  console.log(`Total extracted: ${bills.length}`);
  fs.writeFileSync("output.json", JSON.stringify({ timestamp: Date.now(), bills }, null, 2));
  console.log(`Pushing to https://docs.google.com/spreadsheets/d/${SHEET}/edit...`);
  var columns = [
    "date",
    "link",
    "action",
    "categories",
    "hasSenateAnalysis",
    "hasHouseAnalysis"
  ];
  var values = [columns];
  for (var bill of bills) {
    var row = columns.map(h => bill[h]);
    values.push(row);
  }
  await sheets.spreadsheets.values.clear({
    auth, spreadsheetId: SHEET, range: "bills!A:ZZZ"
  });
  await sheets.spreadsheets.values.update({
    auth, spreadsheetId: SHEET, range: "bills!A1", valueInputOption: "USER_ENTERED",
    resource: { values }
  });
  console.log(`Uploaded ${values.length} rows`);
});