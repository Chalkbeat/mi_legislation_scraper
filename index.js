var cheerio = require("cheerio");
var google = require("@googleapis/sheets");
var { getClient } = require("./auth");
var fs = require("fs");

const BILLS = "http://legislature.mi.gov/(S(cdfw1dajvg3m5rvu3ahj5mtc))/mileg.aspx?page=Bills";
const DETAILS = "http://legislature.mi.gov/(S(cdfw1dajvg3m5rvu3ahj5mtc))/mileg.aspx?page=getobject&objectname=2023-HB-4001&query=on";
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
function extractDetails($) {
  var bill = $("#frg_billstatus_BillHeading").text();
  var categories = $("#frg_billstatus_CategoryList").text();
  var activity = $("#frg_billstatus_HistoriesGridView");
  var hasHouseAnalysis = $("#frg_billstatus_HlaTable tr").length > 0;
  var hasSenateAnalysis = $("#frg_billstatus_SfaTable tr").length > 0;
  var last = activity.find("tr:last-child td");
  var [ date, journal, action ] = [...last].map(e => $(e).text());
  return { bill, categories, date, action, hasHouseAnalysis, hasSenateAnalysis };
}

// this is a little simpler than having an async main() that we immediately call
fetch(BILLS).then(r => r.text()).then(async function(homeHTML) {
  var home = cheerio.load(homeHTML);
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
    var response = await fetch(BILLS, { body, method: "POST" }).then(r => r.text());
    var $ = cheerio.load(response);
    var links = $("#frg_executesearch_SearchResults_Results tr td:first-child a").toArray();
    var urls = links.map(l => l.attribs.href);
    for (var url of urls) {
      var params = new URL(url, BILLS).searchParams;
      var object = params.get("objectname");
      var detailURL = new URL(DETAILS);
      detailURL.searchParams.set("objectname", object);
      detailURL = detailURL.toString();
      console.log(` > Scraping ${object}...`);
      var detailHTML = await fetch(detailURL).then(r => r.text());
      var $detail = cheerio.load(detailHTML);
      var extracted = extractDetails($detail);
      extracted.url = detailURL;
      extracted.chamber = chamber;
      extracted.link = `=HYPERLINK("${detailURL}", "${extracted.bill}")`;
      if (extracted.date) {
        var [m, d, y] = extracted.date.split("/").map(Number);
        extracted.dateValue = new Date(y, m - 1, d);
      } else {
        extracted.dateValue = 0;
      }
      bills.push(extracted);
    }
  }
  bills.sort((a, b) => b.dateValue - a.dateValue);
  console.log(`Total extracted: ${bills.length}`);
  fs.writeFileSync("output.json", JSON.stringify({ timestamp: Date.now(), bills }, null, 2));
  console.log(`Pushing to https://docs.google.com/spreadsheets/d/${SHEET}/edit...`);
  await sheets.spreadsheets.values.clear({
    auth, spreadsheetId: SHEET, range: "bills!A:ZZZ"
  });
  var headers = [
    "chamber",
    "link",
    "date",
    "action",
    "categories",
    "hasSenateAnalysis",
    "hasHouseAnalysis"
  ];
  var values = [headers];
  for (var bill of bills) {
    var row = headers.map(h => bill[h]);
    values.push(row);
  }
  await sheets.spreadsheets.values.update({
    auth, spreadsheetId: SHEET, range: "bills!A1", valueInputOption: "USER_ENTERED",
    resource: { values }
  });
  console.log(`Uploaded ${values.length} rows`);
});