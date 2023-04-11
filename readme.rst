Michigan legislation scraper
============================

Run the ``index.js`` script in Node to pull a list of bills from the MI state legislature, scrape the details from those bills (including their last status) and upload to a Google Sheet.

The script will also produce an ``output.json`` file with additional data for debugging.

Implementation notes
--------------------

For the most part, Michigan's legislation listings are a fairly straightforward ASP app. In fact, several of its routes are accessible only using GET, which puts it ahead of the curve.

However, it does have an interesting wrinkle: page URLs must include a session ID, in the form of ``https://legislature.mi.gov/(S(SESSION_ID_HERE))/mileg.aspx?page=Bills``. The TTL on this session is unclear, but it's definitely 24 hours or less, and won't be stable from day to day. Luckily, the base URL will redirect to this session, and will also include the ASP viewstate values that we also need for scraping. As such, the order of operations is:

1. Request ``https://legislature.mi.gov/mileg.aspx?page=Bills``, get redirected
2. Check ``Response.url`` to get the actual endpoint for this session.
3. Pull ASP values from the redirected page as well, and store those for the listing queries.
4. POST to the endpoint to get the list of all House bills
5. Extract those links, GET all pages, and scrape for bill details
6. Repeat steps 4 and 5 for Senate bills
7. Sort bills by date, write out JSON for logging, and push the listing to the Sheet