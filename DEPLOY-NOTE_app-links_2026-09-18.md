# Why an ETL page opens inside Almost Human

2026-09-18. Dr. O, with a screenshot: *"when ETL webpage is open the AH logo is
what shows, not ETL."* Then, pointing at the row of icons along the bottom:
*"look at the bottom of the photo."* Then: *"yes, AH is installed on my phone"*,
and *"so is ETL, GC, and Everly."*

## What the screenshot proves

The page in it is **astra9.html**, not the front page. It is the only page here
that carries all four Astra hero renders, and its `--bg` is `#f4f3ee`, which is
the exact colour of the page background in her screenshot.

The strip along the top of that screenshot is `#17206b`. That colour appears on
this whole site in exactly one place: `almost-human.html`, as its `theme-color`,
and in `almost-human-manifest.json` as the app's theme colour. astra9.html sets
no theme colour at all, and neither does index.html.

So the Astra-9 page was being drawn inside the Almost Human app. The AH mark in
the row at the bottom is the app that is running. It was never the page's icon.

## What lets that happen

`.well-known/assetlinks.json` grants
`delegate_permission/common.handle_all_urls` to two Android packages:

- `com.emergingtechlab.almosthuman`
- `com.emergingtechlab.goodcompany`

`handle_all_urls` is the whole of emerging-tech-lab.com. Every address on it,
every ETL page included. Almost Human and Good Company are each entitled to open
any link on this domain. Everly Castle and ETL are not in that file at all, so
they are entitled to none, including their own.

Four apps on her phone, two of them claiming everything and two of them claiming
nothing, is the shape of the problem.

## What cannot be fixed from this repository

`handle_all_urls` is the only relation the format has. There is no way to write
"only the Almost Human pages" into assetlinks.json. Which addresses an app
actually claims is set inside the Android app, in its own manifest, and there is
no Android project in this repository. The three Capacitor projects here,
`almost-human-ios`, `good-company-ios` and `everly-castle-ios`, are iOS.

Taking the two entries out of assetlinks.json would stop Android handing ETL
links to either app. What it costs depends on how those two Android apps were
built, and that is not known from in here:

- If they wrap the site and load it themselves, it costs nothing but deep links.
- If they rely on this file to verify the domain, they lose that, and an address
  bar appears across the top of both apps.

**What would settle it** is how the Almost Human and Good Company Android
packages were built and signed. Until somebody knows that, this file stays as it
is.

## What fixes it on the phone today

Settings, Apps, Almost Human, Open by default, and turn off opening supported
links. Same for Good Company. ETL links then go to the browser or to the ETL
app. Nothing ships, nothing breaks, and it is one switch back.

## Also true, and already fixed

astra9.html was one of twenty eight ETL pages that named no icon at all, and
eleven more named an icon file that has never been in this repository. Both are
fixed and `tests/etl-icons.test.js` fails if either comes back. That was a real
fault and worth fixing. It is not what she was looking at.
