/* The Rising Sun Court page: what a search engine and Google Analytics need, checked so a later edit cannot quietly lose it. */
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let bad = 0; const check = (ok, l) => { if (!ok) bad++; console.log((ok ? '  ok    ' : '  FAIL  ') + l); };
const land = R('rising-sun/index.html'), panel = R('rising-sun/panel.html'), notify = R('rising-sun/notify.html'), owner = R('rising-sun/interest.html'), map = R('sitemap.xml');
const ID = 'G-TC3L7MNC66';
const title = (land.match(/<title>(.*?)<\/title>/) || [])[1] || '', desc = (land.match(/name="description" content="(.*?)"/) || [])[1] || '';
check(title.length > 20 && title.length <= 65, 'title is ' + title.length + ' characters');
check(desc.length >= 80 && desc.length <= 160, 'description is ' + desc.length + ' characters');
check(/<link rel="canonical" href="https:\/\/emerging-tech-lab\.com\/rising-sun\/">/.test(land), 'canonical points at the page');
check((land.match(/<h1[ >]/g) || []).length === 1, 'exactly one h1');
check(/og:title/.test(land) && /og:image"/.test(land) && /twitter:card/.test(land) && /og:url/.test(land), 'share tags are there');
const imgs = land.match(/<img [^>]*>/g) || [];
check(imgs.length >= 8 && imgs.every((i) => /alt="[^"]{3,}"/.test(i)), 'every image has a description (' + imgs.length + ')');
check(imgs.every((i) => /width="\d+" height="\d+"/.test(i)), 'every image has its size, so the page does not jump');
let ld = null; try { ld = JSON.parse((land.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]); } catch (e) {}
check(!!ld, 'structured data parses');
const g = (ld && ld['@graph']) || [];
check(['Organization', 'WebPage', 'BreadcrumbList', 'FAQPage'].every((t) => g.some((x) => x['@type'] === t)), 'structured data has the organization, page, breadcrumb and questions');
const faq = (g.find((x) => x['@type'] === 'FAQPage') || { mainEntity: [] }).mainEntity;
check(faq.length >= 3 && faq.every((q) => land.indexOf('<summary>' + q.name + '</summary>') > -1), 'every question in the data is on the page');
[['landing', land], ['panel', panel], ['notify page', notify]].forEach(([n, h]) => check(h.indexOf('googletagmanager.com/gtag/js?id=' + ID) > -1 && h.indexOf("gtag('config', '" + ID + "')") > -1, n + ' carries Google Analytics'));
check(!/gtag/.test(owner) && /noindex/.test(owner), 'the owner list page is private and not counted');
check(/noindex/.test(panel), 'the panel is not indexed, the page is');
check(['select_content', 'cta_click', 'generate_lead'].every((e) => land.indexOf("'" + e + "'") > -1), 'the page reports fairy picks, button clicks and signups');
check(['chat_message', 'select_content', 'generate_lead'].every((e) => panel.indexOf("'" + e + "'") > -1), 'the panel reports chats, fairy picks and signups');
check(!/gtag\([^)]*email/i.test(land + panel + notify), 'no email address is ever sent to Analytics');
check(map.indexOf('https://emerging-tech-lab.com/rising-sun/</loc>') > -1, 'the page is in the sitemap');
process.exit(bad ? 1 : 0);
