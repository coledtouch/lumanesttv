/* Tuner provider data. ES5 syntax for Samsung TV browsers. Credentials come only from user settings. */
(function (root) {
    'use strict';
    var countryRows = ["AD|AND|Andorra","AE|ARE|United Arab Emirates","AF|AFG|Afghanistan","AG|ATG|Antigua & Barbuda","AI|AIA|Anguilla","AL|ALB|Albania","AM|ARM|Armenia","AO|AGO|Angola","AQ|ATA|Antarctica","AR|ARG|Argentina","AS|ASM|American Samoa","AT|AUT|Austria","AU|AUS|Australia","AW|ABW|Aruba","AX|ALA|Åland Islands","AZ|AZE|Azerbaijan","BA|BIH|Bosnia & Herzegovina","BB|BRB|Barbados","BD|BGD|Bangladesh","BE|BEL|Belgium","BF|BFA|Burkina Faso","BG|BGR|Bulgaria","BH|BHR|Bahrain","BI|BDI|Burundi","BJ|BEN|Benin","BL|BLM|St. Barthélemy","BM|BMU|Bermuda","BN|BRN|Brunei","BO|BOL|Bolivia","BQ|BES|Caribbean Netherlands","BR|BRA|Brazil","BS|BHS|Bahamas","BT|BTN|Bhutan","BV|BVT|Bouvet Island","BW|BWA|Botswana","BY|BLR|Belarus","BZ|BLZ|Belize","CA|CAN|Canada","CC|CCK|Cocos (Keeling) Islands","CD|COD|Congo - Kinshasa","CF|CAF|Central African Republic","CG|COG|Congo - Brazzaville","CH|CHE|Switzerland","CI|CIV|Côte d’Ivoire","CK|COK|Cook Islands","CL|CHL|Chile","CM|CMR|Cameroon","CN|CHN|China","CO|COL|Colombia","CR|CRI|Costa Rica","CU|CUB|Cuba","CV|CPV|Cape Verde","CW|CUW|Curaçao","CX|CXR|Christmas Island","CY|CYP|Cyprus","CZ|CZE|Czechia","DE|DEU|Germany","DJ|DJI|Djibouti","DK|DNK|Denmark","DM|DMA|Dominica","DO|DOM|Dominican Republic","DZ|DZA|Algeria","EC|ECU|Ecuador","EE|EST|Estonia","EG|EGY|Egypt","EH|ESH|Western Sahara","ER|ERI|Eritrea","ES|ESP|Spain","ET|ETH|Ethiopia","FI|FIN|Finland","FJ|FJI|Fiji","FK|FLK|Falkland Islands","FM|FSM|Micronesia","FO|FRO|Faroe Islands","FR|FRA|France","GA|GAB|Gabon","GB|GBR|United Kingdom","GD|GRD|Grenada","GE|GEO|Georgia","GF|GUF|French Guiana","GG|GGY|Guernsey","GH|GHA|Ghana","GI|GIB|Gibraltar","GL|GRL|Greenland","GM|GMB|Gambia","GN|GIN|Guinea","GP|GLP|Guadeloupe","GQ|GNQ|Equatorial Guinea","GR|GRC|Greece","GS|SGS|South Georgia & South Sandwich Islands","GT|GTM|Guatemala","GU|GUM|Guam","GW|GNB|Guinea-Bissau","GY|GUY|Guyana","HK|HKG|Hong Kong SAR China","HM|HMD|Heard & McDonald Islands","HN|HND|Honduras","HR|HRV|Croatia","HT|HTI|Haiti","HU|HUN|Hungary","ID|IDN|Indonesia","IE|IRL|Ireland","IL|ISR|Israel","IM|IMN|Isle of Man","IN|IND|India","IO|IOT|British Indian Ocean Territory","IQ|IRQ|Iraq","IR|IRN|Iran","IS|ISL|Iceland","IT|ITA|Italy","JE|JEY|Jersey","JM|JAM|Jamaica","JO|JOR|Jordan","JP|JPN|Japan","KE|KEN|Kenya","KG|KGZ|Kyrgyzstan","KH|KHM|Cambodia","KI|KIR|Kiribati","KM|COM|Comoros","KN|KNA|St. Kitts & Nevis","KP|PRK|North Korea","KR|KOR|South Korea","KW|KWT|Kuwait","KY|CYM|Cayman Islands","KZ|KAZ|Kazakhstan","LA|LAO|Laos","LB|LBN|Lebanon","LC|LCA|St. Lucia","LI|LIE|Liechtenstein","LK|LKA|Sri Lanka","LR|LBR|Liberia","LS|LSO|Lesotho","LT|LTU|Lithuania","LU|LUX|Luxembourg","LV|LVA|Latvia","LY|LBY|Libya","MA|MAR|Morocco","MC|MCO|Monaco","MD|MDA|Moldova","ME|MNE|Montenegro","MF|MAF|St. Martin","MG|MDG|Madagascar","MH|MHL|Marshall Islands","MK|MKD|North Macedonia","ML|MLI|Mali","MM|MMR|Myanmar (Burma)","MN|MNG|Mongolia","MO|MAC|Macao SAR China","MP|MNP|Northern Mariana Islands","MQ|MTQ|Martinique","MR|MRT|Mauritania","MS|MSR|Montserrat","MT|MLT|Malta","MU|MUS|Mauritius","MV|MDV|Maldives","MW|MWI|Malawi","MX|MEX|Mexico","MY|MYS|Malaysia","MZ|MOZ|Mozambique","NA|NAM|Namibia","NC|NCL|New Caledonia","NE|NER|Niger","NF|NFK|Norfolk Island","NG|NGA|Nigeria","NI|NIC|Nicaragua","NL|NLD|Netherlands","NO|NOR|Norway","NP|NPL|Nepal","NR|NRU|Nauru","NU|NIU|Niue","NZ|NZL|New Zealand","OM|OMN|Oman","PA|PAN|Panama","PE|PER|Peru","PF|PYF|French Polynesia","PG|PNG|Papua New Guinea","PH|PHL|Philippines","PK|PAK|Pakistan","PL|POL|Poland","PM|SPM|St. Pierre & Miquelon","PN|PCN|Pitcairn Islands","PR|PRI|Puerto Rico","PS|PSE|Palestinian Territories","PT|PRT|Portugal","PW|PLW|Palau","PY|PRY|Paraguay","QA|QAT|Qatar","RE|REU|Réunion","RO|ROU|Romania","RS|SRB|Serbia","RU|RUS|Russia","RW|RWA|Rwanda","SA|SAU|Saudi Arabia","SB|SLB|Solomon Islands","SC|SYC|Seychelles","SD|SDN|Sudan","SE|SWE|Sweden","SG|SGP|Singapore","SH|SHN|St. Helena","SI|SVN|Slovenia","SJ|SJM|Svalbard & Jan Mayen","SK|SVK|Slovakia","SL|SLE|Sierra Leone","SM|SMR|San Marino","SN|SEN|Senegal","SO|SOM|Somalia","SR|SUR|Suriname","SS|SSD|South Sudan","ST|STP|São Tomé & Príncipe","SV|SLV|El Salvador","SX|SXM|Sint Maarten","SY|SYR|Syria","SZ|SWZ|Eswatini","TC|TCA|Turks & Caicos Islands","TD|TCD|Chad","TF|ATF|French Southern Territories","TG|TGO|Togo","TH|THA|Thailand","TJ|TJK|Tajikistan","TK|TKL|Tokelau","TL|TLS|Timor-Leste","TM|TKM|Turkmenistan","TN|TUN|Tunisia","TO|TON|Tonga","TR|TUR|Turkey","TT|TTO|Trinidad & Tobago","TV|TUV|Tuvalu","TW|TWN|Taiwan","TZ|TZA|Tanzania","UA|UKR|Ukraine","UG|UGA|Uganda","UM|UMI|U.S. Outlying Islands","US|USA|United States","UY|URY|Uruguay","UZ|UZB|Uzbekistan","VA|VAT|Vatican City","VC|VCT|St. Vincent & Grenadines","VE|VEN|Venezuela","VG|VGB|British Virgin Islands","VI|VIR|U.S. Virgin Islands","VN|VNM|Vietnam","VU|VUT|Vanuatu","WF|WLF|Wallis & Futuna","WS|WSM|Samoa","YE|YEM|Yemen","YT|MYT|Mayotte","ZA|ZAF|South Africa","ZM|ZMB|Zambia","ZW|ZWE|Zimbabwe"];
    var countries = Object.create(null), aliases = Object.create(null);
    // Provider fields lose, at both ends, tab, line feed, vertical tab, form feed, carriage return, space and the Unicode
    // spaces of docs/browse.md (U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and
    // U+FEFF), and nothing else. Not \s or trim(): the oldest TV browsers' also take U+180E, and modern ones lack U+0085.
    // The set is built from character codes (pairs of first and last), so no editor can turn it into the characters.
    // A loop, not a pattern (docs/browse.md, Trimming): ^[...]+|[...]+$ tries its second half again at every space of
    // a run inside the text, so its time grows with the square of the run (0.4 s for 16,000 spaces on a Samsung TV).
    var edgeSpaces = (function (ranges) {
        var set = Object.create(null), i, code;
        for (i = 0; i < ranges.length; i += 2) for (code = ranges[i]; code <= ranges[i + 1]; code++) set[code] = true;
        return set;
    }([0x09, 0x0d, 0x20, 0x20, 0x85, 0x85, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff]));
    // value without the characters of set (character codes) at its ends.
    function trimCodes(value, set) {
        var start = 0, end = value.length;
        while (start < end && set[value.charCodeAt(start)] === true) start++;
        while (end > start && set[value.charCodeAt(end - 1)] === true) end--;
        return start === 0 && end === value.length ? value : value.substring(start, end);
    }
    function text(value) { return value === null || value === undefined ? '' : trimCodes(String(value), edgeSpaces); }
    function unique(values) { var seen = Object.create(null); return values.filter(function (v) { if (seen[v]) return false; seen[v] = true; return true; }); }
    function copy(item) { var result = {}, key; for (key in item) if (Object.prototype.hasOwnProperty.call(item, key)) result[key] = item[key]; return result; }
    function safeUrl(value) { value = text(value); return /^https?:\/\//i.test(value) ? value : ''; }
    function first(value) { return Array.isArray(value) ? text(value[0]) : text(value); }
    function hash(value) { var h = 0, i; for (i = 0; i < value.length; i++) h = ((h * 31) + value.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
    function fingerprint(value) { return hash(value) + '-' + hash(value.split('').reverse().join('')); }
    function sourceKey(source) {
        if (!source) return 'none';
        var user = text(source.username), userMatch = /[?&]username=([^&]*)/i.exec(text(source.server));
        if (!user && userMatch) { try { user = decodeURIComponent(userMatch[1].replace(/\+/g, ' ')); } catch (_) {} }
        var identity = source.id ? 'id:' + source.id : [text(source.type).toLowerCase(), normalizeServer(source.server || ''), user, text(source.m3uUrl)].join('\n');
        return 'source-' + fingerprint(identity);
    }
    function normalizeServer(value) { value = text(value); if (value && !/^https?:\/\//i.test(value)) value = 'http://' + value; return value.split(/\/(?:player_api|get|xmltv)\.php/i)[0].replace(/\/+$/, ''); }
    function normalizeSource(source) {
        var result = copy(source || {}), link = text(result.server), query, match;
        result.type = text(result.type || (result.m3uUrl ? 'm3u' : 'xtream')).toLowerCase();
        if (/\/get\.php\?/i.test(link)) {
            query = link.substring(link.indexOf('?') + 1).split('&');
            query.forEach(function (part) { var pair = part.split('='), key = pair.shift(); if ((key === 'username' || key === 'password') && !result[key]) { try { result[key] = decodeURIComponent(pair.join('=').replace(/\+/g, ' ')); } catch (_) {} } });
        }
        result.server = normalizeServer(link); result.username = text(result.username); result.password = text(result.password);
        result.m3uUrl = safeUrl(result.m3uUrl); result.epgUrl = safeUrl(result.epgUrl); result.hotUrl = safeUrl(result.hotUrl);
        if (result.type === 'xtream' && (!safeUrl(result.server) || !result.username || !result.password)) throw new Error('Enter a server, username and password.');
        if (result.type === 'm3u' && !result.m3uUrl) throw new Error('Enter an HTTP or HTTPS playlist URL.');
        if (result.type !== 'xtream' && result.type !== 'm3u') throw new Error('Choose Xtream or M3U.');
        return result;
    }
    function api(source, action, extra) {
        var url = source.server + '/player_api.php?username=' + encodeURIComponent(source.username) + '&password=' + encodeURIComponent(source.password);
        if (action) url += '&action=' + encodeURIComponent(action);
        Object.keys(extra || {}).forEach(function (key) { url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(extra[key]); });
        return url;
    }
    function streamUrl(source, kind, id, extension) {
        extension = /^[a-z0-9]{1,8}$/i.test(extension || '') ? extension : 'mp4';
        return source.server + '/' + kind + '/' + encodeURIComponent(source.username) + '/' + encodeURIComponent(source.password) + '/' + encodeURIComponent(id) + '.' + extension;
    }
    function metadata(row, keys) { var values = []; keys.forEach(function (key) { var value = row[key]; (Array.isArray(value) ? value : [value]).forEach(function (v) { if (text(v)) values.push(text(v)); }); }); return unique(values).join(';'); }
    // The TMDB id a provider gives a movie or series (docs/browse.md, Matching step 1): the first of tmdb, tmdb_id,
    // info.tmdb_id and info.tmdb (the last two only when info is an object) whose value gives one. A string gives one
    // when, trimmed as a provider field, it is 1 to 12 ASCII digits (TMDB_ID, a trailing ".0" allowed) not all zeros;
    // a number when it is whole, from 1 to 999999999999. Any other value gives none: never String() it, which makes
    // ["123"] "123".
    var TMDB_ID = /^([0-9]{1,12})(\.0)?$/;
    function tmdbValue(value) {
        var match;
        if (typeof value === 'string') { match = TMDB_ID.exec(text(value)); return match ? match[1].replace(/^0+/, '') : ''; }
        return typeof value === 'number' && Math.floor(value) === value && value >= 1 && value <= 999999999999 ? String(value) : '';
    }
    function providerTmdbId(row) {
        var info = row.info !== null && typeof row.info === 'object' && !Array.isArray(row.info) ? row.info : null,
            values = info ? [row.tmdb, row.tmdb_id, info.tmdb_id, info.tmdb] : [row.tmdb, row.tmdb_id], i, id;
        for (i = 0; i < values.length; i++) { id = tmdbValue(values[i]); if (id) return id; }
        return '';
    }
    // docs/browse.md, Spaces and letter case: before a Movies & Series rule reads a text (a category name, an origin
    // entry, a title's name or a provider's year field), these Unicode spaces become U+0020. Never \s or trim(): which
    // characters they take differs between engines (JavaScript's \s lacks U+0085; older TV browsers' takes U+180E).
    var unicodeSpaces = /[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;
    function spaceText(value) { return value === null || value === undefined ? '' : String(value).replace(unicodeSpaces, ' '); }
    // The release year a provider gives (docs/browse.md): the first of year, releaseDate, release_date and releasedate
    // that starts, after optional spaces, with a year from 1800 to 2099 not followed by another digit (YEAR_FIELD,
    // read with the Unicode spaces replaced; its \s written out as tab, LF, VT, FF, CR and space); '' when none does.
    var yearField = /^[ \t\n\x0B\f\r]*((18|19|20)[0-9]{2})([^0-9]|$)/;
    function providerYear(row) {
        var values = [row.year, row.releaseDate, row.release_date, row.releasedate], i, match;
        for (i = 0; i < values.length; i++) { match = yearField.exec(spaceText(values[i])); if (match) return match[1]; }
        return '';
    }
    function memberships(row) { return unique([row.category_id].concat(Array.isArray(row.category_ids) ? row.category_ids : []).map(text).filter(Boolean)); }
    // Adult content: a category name with a standalone XXX, adult(s), 18+ or porn token (but not "Adult Swim"),
    // or the Xtream is_adult flag on a category or stream. Hidden unless the passcode-protected lock is open.
    var adultPattern = /(^|[^a-z0-9])(xxx|adults?|18\+|porn)(?![a-z0-9])/i;
    function adultFlag(value) { return value === 1 || value === '1' || value === true; }
    function adultName(name) { return adultPattern.test(text(name).replace(/adult[\s_-]*swim/ig, ' ')); }
    function isAdultCategory(cat) { return !!cat && (cat.adult === true || adultName(cat.name)); }
    function adultFilter(items, categories) {
        var blocked = Object.create(null), cats = (categories || []).filter(function (cat) { if (!isAdultCategory(cat)) return true; blocked[cat.id] = true; return false; });
        return { items: (items || []).filter(function (item) { return !item.adult && !(item.categoryIds || []).some(function (id) { return blocked[id] === true; }) && blocked[item.categoryId] !== true; }), categories: cats };
    }
    function parseCategories(rows) { if (!Array.isArray(rows)) throw new Error('The provider did not return categories. Check your login details.'); var seen = Object.create(null); return rows.filter(function (row) { var id = text(row.category_id); if (!id || seen[id]) return false; seen[id] = true; return true; }).map(function (row) { var cat = { id: text(row.category_id), name: text(row.category_name) || 'Other' }; if (adultFlag(row.is_adult)) cat.adult = true; return cat; }); }
    function parseXtream(rows, kind, source, format) {
        if (!Array.isArray(rows)) throw new Error('The provider did not return a catalog. Check your login details.');
        var byId = Object.create(null), result = [], key = sourceKey(source);
        rows.forEach(function (row) {
            var rawId = text(kind === 'series' ? row.series_id : row.stream_id), cats = memberships(row), previous = byId[rawId], item, direct;
            if (!rawId) return;
            if (previous) { if (adultFlag(row.is_adult)) previous.adult = true; previous.categoryIds = unique(previous.categoryIds.concat(cats)); previous.country = unique([previous.country, metadata(row, ['country', 'country_code', 'country_name', 'stream_country', 'tvg-country'])].filter(Boolean)).join(';'); return; }
            direct = safeUrl(row.direct_source);
            if (kind === 'live' && direct) direct = direct.replace(/\.(ts|m3u8)(\?|$)/i, '.' + (format || 'm3u8') + '$2');
            item = { id: (kind === 'live' ? 'x:' : kind === 'movies' ? 'm:' : 's:') + rawId, streamId: rawId, sourceKey: key,
                name: text(row.name) || (kind === 'series' ? 'Series' : kind === 'movies' ? 'Movie' : 'Channel ' + rawId),
                url: kind === 'series' ? '' : direct || streamUrl(source, kind === 'live' ? 'live' : 'movie', rawId, kind === 'live' ? format || 'm3u8' : text(row.container_extension) || 'mp4'),
                backups: [], image: safeUrl(kind === 'series' ? row.cover : row.stream_icon), epgId: text(row.epg_channel_id),
                categoryId: cats[0] || '', categoryIds: cats, number: Number(row.num) || 0,
                year: providerYear(row), plot: text(row.plot), rating: text(row.rating) === '0' ? '' : text(row.rating),
                added: Number(kind === 'series' ? row.last_modified : row.added) || 0,
                country: metadata(row, ['country', 'country_code', 'country_name', 'stream_country', 'tvg-country']),
                language: metadata(row, ['language', 'lang', 'original_language', 'audio_language', 'stream_language', 'tvg-language']) };
            if (adultFlag(row.is_adult)) item.adult = true;
            if (kind !== 'live') { item.tmdb = providerTmdbId(row); item.genre = text(row.genre); }
            byId[rawId] = item; result.push(item);
        });
        return kind === 'live' ? renumber(result) : result;
    }
    function renumber(items) {
        var positive = 0, seen = Object.create(null), distinct = 0;
        items.forEach(function (item) { if (item.number > 0) positive++; if (!seen[item.number]) { seen[item.number] = true; distinct++; } });
        if (positive > items.length * 0.9 && distinct > items.length * 0.9) return items.sort(function (a, b) { return a.number - b.number; });
        return items.map(function (item, index) { item.number = index + 1; return item; });
    }
    function mergeIds(items) { var byId = Object.create(null), result = []; items.forEach(function (item) { var existing = byId[item.id]; if (!existing) { byId[item.id] = item; result.push(item); return; } existing.categoryIds = unique(existing.categoryIds.concat(item.categoryIds)); existing.country = unique([existing.country, item.country].filter(Boolean)).join(';'); existing.backups = unique((existing.backups || []).concat(item.url !== existing.url ? [item.url] : [], item.backups || [])); if (!existing.epgId) existing.epgId = item.epgId; if (!existing.image) existing.image = item.image; }); return result; }
    function parseM3u(input, source) {
        var result = { live: [], movies: [], series: [], liveCategories: [], movieCategories: [], seriesCategories: [], epgUrl: '' }, attrs = {}, title = '', groupOverride = '', key = sourceKey(source), seriesByName = Object.create(null);
        function category(kind, group) { var list = result[kind === 'live' ? 'liveCategories' : kind === 'movies' ? 'movieCategories' : 'seriesCategories'], found = list.filter(function (cat) { return cat.name === group; })[0]; if (!found) { found = { id: kind + ':g' + list.length, name: group }; list.push(found); } return found; }
        function attributes(line) { var values = {}, match, re = /([a-z0-9_-]+)\s*=\s*["']([^"']*)["']/ig; while ((match = re.exec(line))) values[match[1].toLowerCase()] = match[2]; return values; }
        text(input).split(/\r?\n/).forEach(function (raw) {
            var line = text(raw), inQuote, i, cat, item, url, name, group, isVod, episodeMatch, season, episode, show;
            if (!line) return;
            if (/^#EXTM3U/i.test(line)) { var header = attributes(line); result.epgUrl = safeUrl(first(header['url-tvg'] || header['x-tvg-url']).split(',')[0]); return; }
            if (/^#EXTINF/i.test(line)) { attrs = attributes(line); title = ''; groupOverride = ''; inQuote = ''; for (i = 0; i < line.length; i++) { if (line[i] === '"' || line[i] === "'") { if (!inQuote) inQuote = line[i]; else if (inQuote === line[i]) inQuote = ''; } else if (line[i] === ',' && !inQuote) { title = text(line.substring(i + 1)); break; } } return; }
            if (/^#EXTGRP:/i.test(line)) { groupOverride = text(line.substring(8)); return; }
            if (line[0] === '#') return;
            url = safeUrl(line); if (!url) { attrs = {}; title = ''; groupOverride = ''; return; }
            name = title || attrs['tvg-name'] || 'Channel ' + (result.live.length + 1); group = attrs['group-title'] || groupOverride || 'Uncategorized';
            isVod = /\/(movie|series)\//i.test(url) || /\.(mp4|mkv|avi)(?:\?|$)/i.test(url);
            episodeMatch = /^(.*?)\s+[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})\b(.*)$/.exec(name);
            season = Number(attrs.season) || (episodeMatch ? Number(episodeMatch[2]) : 0); episode = Number(attrs.episode) || (episodeMatch ? Number(episodeMatch[3]) : 0);
            item = { id: (isVod ? 'mu:' : 'u:') + fingerprint(url), sourceKey: key, name: name, url: url, backups: [], image: safeUrl(attrs['tvg-logo']), epgId: attrs['tvg-id'] || attrs['tvg-name'] || '', categoryId: '', categoryIds: [], number: Number(attrs['tvg-chno']) || 0, year: '', plot: '', rating: '', country: attrs['tvg-country'] || attrs.country || '', language: attrs['tvg-language'] || attrs.language || '' };
            if (isVod && season && episode && (episodeMatch || attrs['series-name'])) {
                var showName = text(attrs['series-name'] || episodeMatch[1]); cat = category('series', group); show = seriesByName[showName];
                if (!show) { show = copy(item); show.id = 'ms:' + fingerprint(showName); show.name = showName; show.url = ''; show._episodes = []; show.categoryId = cat.id; show.categoryIds = [cat.id]; result.series.push(show); seriesByName[showName] = show; }
                show.categoryIds = unique(show.categoryIds.concat([cat.id])); show._episodes.push({ id: 'me:' + fingerprint(url), name: name, url: url, image: item.image, season: season, episode: episode, duration: 0, sourceKey: key });
            } else { cat = category(isVod ? 'movies' : 'live', group); item.categoryId = cat.id; item.categoryIds = [cat.id]; result[isVod ? 'movies' : 'live'].push(item); }
            attrs = {}; title = ''; groupOverride = '';
        });
        result.live = renumber(mergeIds(result.live)); result.movies = mergeIds(result.movies); return result;
    }

    countryRows.forEach(function (row) { var parts = row.split('|'); countries[parts[0].toLowerCase()] = parts[0]; countries[parts[1].toLowerCase()] = parts[0]; countries[parts[2].toLowerCase()] = parts[0]; });
    ['usa', 'u.s.', 'u.s', 'u.s.a.', 'u.s.a', 'united states of america'].forEach(function (name) { countries[name] = 'US'; });
    ['uk', 'britain', 'great britain', 'united kingdom'].forEach(function (name) { countries[name] = 'GB'; });
    countries['czech republic'] = 'CZ'; countries['south korea'] = 'KR'; countries['north korea'] = 'KP'; delete countries.tv;
    var countryPattern = new RegExp('(^|[^a-z0-9])(' + Object.keys(countries).sort(function (a, b) { return b.length - a.length; }).map(function (word) { return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?=$|[^a-z0-9])', 'ig');
    var ambiguous = /^(IN|TO|AS|AT|BE|IS|IT|NO|DO|ME|SO|BY|FI)$/;
    var languages = /^(english|anglophone|eng|en(?:[-_][a-z0-9]+)*|spanish|espa[nñ]ol|latino|latina|latam|latin|es|spa|french|fran[cç]ais|fr|fra|german|deutsch|de|deu|italian|italiano|it|ita|portuguese|portugu[eê]s|pt|por|arabic|ar|ara|hindi|hin|urdu|punjabi|bengali|tamil|telugu|malayalam|kannada|marathi|russian|rus|ru|polish|polski|pl|turkish|t[uü]rk[cç]e|tr|dutch|nederlands|nl|chinese|mandarin|cantonese|zh|japanese|ja|korean|ko|vietnamese|thai|indonesian|malay|filipino|tagalog|greek|hebrew|persian|farsi|ukrainian|romanian|hungarian|czech|slovak|serbian|croatian|bulgarian|swedish|norwegian|danish|finnish|multilingual|asian|taiwanese)$/i;
    var league = /(^|[^a-z])(?:nfl|nba|wnba|nhl|mlb|milb|mls|ncaa|espn|ppv|peacock|paramount|flo ?sports|flo ?college|flo ?racing)(?=$|[^a-z])/i;
    var service = /^(pluto|samsung|stv|roku|tubi|plex|xumo|rakuten|prime)(?:\s+|[/+|,;]+)\s*/;
    function categoryLabels(value) {
        var flags = { us: league.test(value), foreign: false }, match, at, code; countryPattern.lastIndex = 0;
        while ((match = countryPattern.exec(value))) { code = countries[match[2].toLowerCase()]; at = match.index + match[1].length; if (match[2].length <= 3 && ambiguous.test(code) && text(value) !== match[2] && at > 0 && !/[[(|:/]/.test(value[at - 1])) continue; if (code === 'US') flags.us = true; else flags.foreign = true; }
        return flags;
    }
    function nameLabels(name) {
        var flags = { us: false, foreign: false }, marker = /\[([^\]]+)\]|\(([^)]+)\)|\|([^|]+)\|/g, match, prefix;
        function include(value) {
            var clean = text(value).toLowerCase().replace(service, ''), parts = clean.split(/[/+|,;]+/), local = { us: false, foreign: false }, valid = true;
            function take(code) { if (code === 'US') local.us = true; else if (code) local.foreign = true; }
            if (countries[clean]) { take(countries[clean]); } else {
                parts.forEach(function (part) { var words, index = 0, length, phrase, found; part = text(part); if (!part || !valid) return; if (countries[part]) { take(countries[part]); return; } if (languages.test(part)) return; words = part.split(/\s+/); while (index < words.length) { found = false; for (length = Math.min(4, words.length - index); length > 0; length--) { phrase = words.slice(index, index + length).join(' '); if (countries[phrase] || (length === 1 && languages.test(phrase))) { take(countries[phrase]); index += length; found = true; break; } } if (!found) { valid = false; break; } } });
            }
            if (valid) { flags.us = flags.us || local.us; flags.foreign = flags.foreign || local.foreign; }
        }
        while ((match = marker.exec(name))) include(match[1] || match[2] || match[3]);
        prefix = /^\s*([^:|]+?)\s*[:|]\s*|^\s*([a-z]{2,3})\s*-\s*/i.exec(name); if (prefix) include(prefix[1] || prefix[2]); return flags;
    }
    function usPolicy(items, categories) {
        var byCat = Object.create(null); categories.forEach(function (cat) { byCat[cat.id] = categoryLabels(cat.name); });
        var accepted = items.filter(function (item) {
            var named = nameLabels(item.name), countryParts = text(item.country).toLowerCase().split(/[,;|/]+/).map(text).filter(Boolean), epg = /\.([a-z]{2})$/i.exec(item.epgId || ''), epgCountry = epg ? countries[epg[1].toLowerCase()] : '', members;
            if (countryParts.some(function (part) { return countries[part] !== 'US'; }) || named.foreign || (epgCountry && epgCountry !== 'US')) return false;
            members = unique(item.categoryIds.filter(function (id) { return byCat[id] && !byCat[id].foreign; }));
            if (!countryParts.length && !named.us && epgCountry !== 'US' && !members.some(function (id) { return byCat[id].us; })) return false;
            item.categoryIds = members.length ? members : ['__tuner_us']; item.categoryId = item.categoryIds[0]; return true;
        });
        return { items: accepted, categories: usedCategories(accepted, categories, '__tuner_us', 'USA') };
    }
    // Default lineup: everything the line includes, as chosen in the LumaNest customer hub. usPolicy is the optional "USA channels only" view.
    function allPolicy(items, categories) {
        var accepted = items.map(function (item) { var ids = unique(item.categoryIds || []); item.categoryIds = ids.length ? ids : ['__tuner_live']; item.categoryId = item.categoryIds[0]; return item; });
        return { items: accepted, categories: usedCategories(accepted, categories, '__tuner_live', 'Live TV') };
    }
    function usedCategories(items, categories, fallbackId, fallbackName) { var used = Object.create(null), seen = Object.create(null); items.forEach(function (item) { item.categoryIds.forEach(function (id) { used[id] = true; }); }); var result = categories.filter(function (cat) { if (!used[cat.id] || seen[cat.id]) return false; seen[cat.id] = true; return true; }); if (used[fallbackId] && !seen[fallbackId]) result.push({ id: fallbackId, name: fallbackName }); return result; }
    var nearbyStations = ('WCVB WBZ WBTS WHDH WFXT WGBH WGBX WMUR WUNI WUTF WNEU WENH WLED WEKW WCCA WLVI WSBK WWJE WMFP').split(' '), newsStations = ('WCVB WBZ WBTS WHDH WFXT WMUR WUNI WNEU').split(' '), notStations = ('KEY KILL KIDS WEST WITH WILD WISH WILL WARS WAVE WORK WEEK WALK WELL WHAT WHEN WALL WOKE WORD WINE WOLF WWE').split(' ');
    function upper(value) { return text(value).toUpperCase().replace(/\s+/g, ' '); }
    function stationNames(value) { var re = /(^|[^A-Z0-9])([WK][A-Z]{2,3})(?:(?:-|\s+)(?:TV|DT|CD|LD))?\d?(?=$|[^A-Z0-9])/g, match, result = []; while ((match = re.exec(value))) if (notStations.indexOf(match[2]) < 0) result.push(match[2]); return unique(result); }
    var sportsName = /\b(?:ESPN|NESN|SPORTSNET|SPORTS|FANDUEL|BALLY|NBALP|NFL TEAMS|TENNIS CHANNEL|GOLF CHANNEL)\b/;
    var nationalName = /^(?:CNN|HLN|FOX NEWS|FOX BUSINESS|CNBC(?: WORLD)?|MSNBC|MS NOW|NEWSMAX(?:2)?|NEWSNATION|WGN AMERICA|(?:ALL REALITY )?WE ?TV|ANTENNA TV|FUSE(?: MUSIC| FM)?|WORLD FISHING NETWORK|WORLD POKER TOUR|WORLD AT WAR|WPT|BLOOMBERG(?: TV)?|(?:THE )?WEATHER CHANNEL|C ?SPAN(?: [123])?|BBC (?:WORLD NEWS|NEWS)|AL JAZEERA|ONE AMERICA NEWS|OAN|CHEDDAR(?: NEWS)?|ABC NEWS(?: LIVE)?|NBC NEWS NOW|CBS NEWS(?: 24\/?7)?|CBSN|LIVE ?NOW FROM FOX|PBS (?:KIDS(?: EAST| WEST)?|ANTIQUES ROADSHOW|NATURE|TRAVEL|GENEALOGY|FOOD|RETRO)|WORLD|CREATE|USA(?: NETWORK)?|(?:ABC|CBS|NBC|FOX|CW|PBS|UNIVISION|UNIMAS|TELEMUNDO)(?: (?:EAST|WEST|NETWORK))?)$/;
    var broadcastOnly = /^(?:ABC|CBS|NBC|FOX|CW|PBS|UNIVISION|UNIMAS|TELEMUNDO)(?: (?:EAST|WEST|NETWORK))?$/;
    var nearbyBrand = /\b(?:NECN|NEW ENGLAND CABLE NEWS|(?:CBSN|CBS NEWS|NBC(?: ?10)?(?: NEWS)?|ABC ?5|FOX ?25|7 ?NEWS|BOSTON ?25(?: NEWS)?) ?BOSTON|BOSTON ?25(?: NEWS)?|7 ?NEWS BOSTON|NBC ?10 BOSTON NEWS|SPECTRUM NEWS(?: ?1)? (?:WORCESTER|MASSACHUSETTS|NEW ENGLAND)|GBH|(?:NEW HAMPSHIRE|NH) PBS|PBS(?: ?11)? NEW HAMPSHIRE|WORCESTER (?:TV|COMMUNITY))\b/;
    var newsBrand = /\b(?:NECN|NEW ENGLAND CABLE NEWS|BOSTON ?25|7 ?NEWS BOSTON|CBSN BOSTON|CBS NEWS BOSTON|NBC(?: ?10)? BOSTON NEWS|NBC NEWS BOSTON|SPECTRUM NEWS(?: ?1)? (?:WORCESTER|MASSACHUSETTS|NEW ENGLAND))\b/;
    function marketForZip(zip) { return /^(014|015|016|017|018|019|020|021|022|024|030|031|032|033|034|035|036|037|038)\d{2}$/.test(text(zip)); }
    function localPolicy(catalog, zip) {
        if (!marketForZip(zip)) return catalog;
        var cats = Object.create(null); catalog.categories.forEach(function (cat) { cats[cat.id] = upper(cat.name); });
        var items = catalog.items.filter(function (item) {
            var name = upper(item.name), core = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/^(PEACOCK LIVE[ |:]+|USA?[ :|\/-]+)/, '').replace(/\b(HD|FHD|UHD|4K|SD|HEVC)\b/g, ' ').replace(/\s+/g, ' ').trim(), groups = item.categoryIds.map(function (id) { return cats[id] || ''; }), national = nationalName.test(core), epg = upper(item.epgId), stations, context, near, branded;
            if (sportsName.test(name) || /^(?:USA?[: ]+)?(?:NBA|NFL|MLB|NHL|DAZN|UFC|FOOTBALL EVENT|PPV|ESPN\+)[ :0-9]/.test(name) || /^24\/7 /.test(name)) return true;
            if (national && !broadcastOnly.test(core)) return true;
            context = groups.some(function (g) { return /\b(LOCALS?|REGIONAL|AFFILIATES?|LOCAL STATIONS)\b/.test(g) || /^(USA?|UNITED STATES)[ |:\/-]+(ABC|CBS|FOX|NBC|PBS|CW)$/.test(g); }) || /\b(ABC|CBS|NBC|FOX|PBS|CW|UNIVISION|UNIMAS|TELEMUNDO)\b/.test(name) || /[([]\s*[WK][A-Z]{2,3}(?:[- ]?(?:TV|DT|CD|LD))?\s*[)\]]/.test(name) || /^[WK][A-Z]{2,3}(?:(?:-|\s+)(?:TV|DT|CD|LD)\b|\s*\d+\b|$)/.test(core) || /^[WK][A-Z]{2,3}\s+(NEW YORK|LOS ANGELES|CHICAGO|SEATTLE|PHILADELPHIA|MIAMI|DALLAS|HOUSTON|ATLANTA|DENVER|DETROIT|SAN FRANCISCO|LAS VEGAS|CLEVELAND|ORLANDO|BALTIMORE|PITTSBURGH|BOSTON|WORCESTER|MANCHESTER)\b/.test(core);
            stations = stationNames(name).filter(function (call) { return context || nearbyStations.indexOf(call) >= 0; }).concat(stationNames(epg));
            var prefixed = /^(?:ABC|CBS|NBC|FOX|PBS|CW|MY)\d*([WK][A-Z]{2,3})(?:[ ._-]|$)/.exec(epg); if (prefixed) stations.push(prefixed[1]); stations = unique(stations);
            if (!stations.length && national) return true;
            near = nearbyBrand.test(name) || stations.some(function (call) { return nearbyStations.indexOf(call) >= 0; });
            branded = /\b(?:CBSN|CBS NEWS|(?:NBC|ABC)\b.*\bNEWS|ABC[ 0-9]+|FOX[ 0-9]+|FOX LOCAL|NEWS ?12|SPECTRUM NEWS|LOCAL NEWS|NEWSON|PBS|CW[ 0-9]+|UNIVISION[ 0-9]+|TELEMUNDO[ 0-9]+|\d{1,2} NEWS)\b/.test(name);
            if (groups.some(function (g) { return /\b(SPORTS?|NBA|NFL|MLB|NHL|HOCKEY|PPV|ESPN|LIVE EVENTS|LEAGUE PASS)\b/.test(g); }) && !stations.length && !near && !branded) return true;
            if (!near && !stations.length && !branded && !groups.some(function (g) { return /\b(LOCALS?|REGIONAL|AFFILIATES?|LOCAL STATIONS)\b/.test(g) || /^(USA?|UNITED STATES)[ |:\/-]+(ABC|CBS|FOX|NBC|PBS|CW)$/.test(g); })) return true;
            if (/\b(RHODE ISLAND|NEW ENGLAND PUBLIC MEDIA|WESTERN RESERVE)\b/.test(name) || stations.some(function (call) { return nearbyStations.indexOf(call) < 0; }) || !near) return false;
            if (newsBrand.test(name) || stations.some(function (call) { return newsStations.indexOf(call) >= 0; })) item.categoryIds = unique(item.categoryIds.concat(['__tuner_local_news']));
            return true;
        });
        return { items: items, categories: usedCategories(items, catalog.categories, '__tuner_local_news', 'Local news') };
    }
    function displayName(raw) {
        var name = text(raw).replace(/\u00a0/g, ' '), previous, i;
        for (i = 0; i < 6; i++) { previous = name; name = name.replace(/^\s*\(\s*(PLUTO|STV|SAMSUNG|ROKU|TUBI|PLEX|XUMO)\s+USA?\s*\)\s*/i, '').replace(/^\s*(?:[([]\s*USA?\s*[)\]|]|\|USA?\||USA?\s*[:|]|USA?\s*[-–]\s*|US\s+(?!Open\b|Weekly\b|Marshals\b|Navy\b|Army\b)|USA\s+(?!Network\b|Today\b|Hockey\b|Rugby\b|Swimming\b|Gymnastics\b|Wrestling\b|Track\b|Softball\b|Baseball\b))\s*/, ''); if (name !== previous) name = name.replace(/^\s*\(\s*(?:[A-Z0-9+]{1,5}|Prime|Tubi|Meo)\s*\)\s*/, ''); if (name === previous) break; }
        name = name.replace(/\s*\([^()]*@\s*[\d.]+\s*Mbps[^()]*\)|\s*\((?:F?HD|UHD|SD)\s*@[^)]*\)/ig, ' ').replace(/\b(FHD|HD|UHD|4K|HEVC|H\.?265|1080[PI]?|720P|60\s*FPS|50\s*FPS)\b/ig, ' ').replace(/\s*[(\[]?\bback\s*up\b[)\]]?/ig, ' ').replace(/\s*\((?:[A-Z]|HX|FEED|Feed)\)(?=\s*(?:\(|$))/g, ' ').replace(/\s+USA?\s*$/, '').replace(/\(\)|\[\]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:|\-–]+|[\s:|\-–]+$/g, ''); return text(name) || text(raw);
    }
    function idleEvent(name) { return !text(name) || /\b(?:no\s+(?:scheduled\s+)?(?:events?|games?|matches|streams?)(?:\s+(?:scheduled|today|available))?|no\s+live\s+(?:courts?|events?|games?|matches)|offline|off\s*air|not\s+live|coming\s+soon)\b/i.test(name) || /^:|[:|]\s*$|\(\s*209\d\s+\d{2}\s+\d{2}/.test(name) || /(?:^|\s)[|:]\s*(?:event\s*)?\d{1,3}\s*$/i.test(name) || /^(?:PPV|UFC|EVENT|LIVE\s*EVENT|ESPN\s*\+|ESPN\s*PLUS|ESPNPLUS|PEACOCK|PARAMOUNT\s*\+?|MAX\s*US|MILB|NCAA[FB]?|NFL|NBA|WNBA|NHL|MLB|MLS|FLO\s*\w+|TENNIS\s*TV|WTA|ATP)\s*(?:EVENT\s*)?\d{1,3}$/i.test(text(name)); }
    function easternTime(month, day, clock, minute, ap, now) {
        if (month < 1 || month > 12 || day < 1 || day > 31 || clock < 0 || clock > 23 || minute < 0 || minute > 59) return null;
        var hour = clock > 12 ? clock : clock % 12 + (upper(ap) === 'P' ? 12 : 0), year = new Date(now - 18000000).getUTCFullYear(), nearest = null;
        for (var y = year - 1; y <= year + 1; y++) {
            var wall = Date.UTC(y, month - 1, day, hour, minute), marchSunday = 1 + (7 - new Date(Date.UTC(y, 2, 1)).getUTCDay()) % 7, novemberSunday = 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7;
            // U.S. Eastern rules since 2007. Calendar's lenient spring hour and
            // standard-time choice for the repeated fall hour both use UTC-5.
            var daylight = wall >= Date.UTC(y, 2, marchSunday + 7, 3) && wall < Date.UTC(y, 10, novemberSunday, 1), candidate = wall + (daylight ? 14400000 : 18000000);
            if (nearest === null || Math.abs(candidate - now) < Math.abs(nearest - now)) nearest = candidate;
        }
        return nearest;
    }
    function offAir(name, now) {
        var stop = /stop:\s*(\d{4})\s(\d{2})\s(\d{2})\s(\d{2}):(\d{2}):(\d{2})/i.exec(name), match, start = null, months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        if (stop && +stop[2] >= 1 && +stop[2] <= 12 && +stop[3] >= 1 && +stop[3] <= 31 && +stop[4] <= 23 && +stop[5] <= 59) return Date.UTC(+stop[1], +stop[2] - 1, +stop[3], +stop[4], +stop[5], +stop[6]) < now;
        // Dated live-event titles carry a full clock; replay and continuous
        // channels keep their catalogs even when the original event is old.
        if (/\b(?:replays?|encore|classics?|highlights|on\s*demand|VOD)\b|24\s*\/\s*7/i.test(name)) return false;
        match = /\((\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M\s*E[SD]?T\)/i.exec(name);
        if (match) start = easternTime(+match[1], +match[2], +match[3], +match[4], match[5], now);
        if (start === null) { match = /@\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M/i.exec(name); if (match) start = easternTime(months.indexOf(match[1].toLowerCase()) + 1, +match[2], +match[3], +match[4], match[5], now); }
        if (start === null) { match = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\s+(\d{1,2}):(\d{2})\s*([AP]?)M?\b/i.exec(name); if (match) start = easternTime(months.indexOf(match[2].toLowerCase().substring(0, 3)) + 1, +match[1], +match[3], +match[4], match[5], now); }
        return start !== null && (start < now - 21600000 || start > now + 72000000);
    }
    function nameKey(name) { var normalized = displayName(name).toLowerCase(); if (normalized.normalize) normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); normalized = normalized.replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/\b(east|eastern)\b/g, ' ').replace(/^\s*the\s+/, '').replace(/[^a-z0-9]/g, ''); return { natgeo: 'nationalgeographic', natgeowild: 'nationalgeographicwild', fs1: 'foxsports1', fs2: 'foxsports2', foxnewschannel: 'foxnews', foxbusinessnetwork: 'foxbusiness', cnninternational: 'cnni' }[normalized] || normalized; }
    function stationKey(name) { var network = /\b(ABC|CBS|NBC|FOX|PBS|CW|MyNetwork|MyTV|MY|ION|Telemundo|Univision|UniMas)\b/i.exec(name), calls = stationNames(name); return network && calls.length ? 'station:' + calls[0] + ':' + network[1].toLowerCase().replace(/^my.*$/, 'my') : ''; }
    function foldLive(catalog, now) {
        var groups = Object.create(null), order = [], merged = Object.create(null), result = [], favored = Object.create(null);
        catalog.categories.forEach(function (cat) { if (/most\s+watched|trending|popular/i.test(cat.name)) favored[cat.id] = true; });
        catalog.items.forEach(function (item, index) { if (idleEvent(item.name) || offAir(item.name, now === undefined ? Date.now() : now)) return; var name = displayName(item.name), key = stationKey(item.name) || nameKey(name) || item.id, score = (item.epgId ? 8 : 0) + (item.categoryIds.some(function (id) { return favored[id]; }) ? 4 : 0) + (/[a-z]/.test(name) ? 3 : 0) - (/back\s*up/i.test(item.name) ? 10 : 0) - (/\b(4K|UHD)\b/i.test(item.name) ? 2 : 0) - (/\bSD\b/i.test(item.name) ? 1 : 0), resolution = /\b(\d{3,4})p(\d{2})?\b/i.exec(item.name); if (resolution) score += +resolution[1] >= 1080 ? 2 : +resolution[1] >= 720 ? 1 : -3; if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push({ item: item, name: name, score: score, index: index }); });
        order.forEach(function (key) { var ranked = groups[key].sort(function (a, b) { return b.score - a.score || a.index - b.index; }), kept = copy(ranked[0].item), categoryIds = [], urls = [], chosenName = ranked[0].name; ranked.forEach(function (entry) { if (entry.item.adult) kept.adult = true; categoryIds = categoryIds.concat(entry.item.categoryIds); urls = urls.concat([entry.item.url], entry.item.backups || []); merged[entry.item.id] = kept.id; if (!kept.image && entry.item.image) kept.image = entry.item.image; if (!kept.epgId && entry.item.epgId) kept.epgId = entry.item.epgId; }); ranked.some(function (entry) { if (/[a-z]/.test(entry.name)) { chosenName = entry.name; return true; } return false; }); kept.name = chosenName; kept.categoryIds = unique(categoryIds); kept.backups = unique(urls.filter(function (url) { return url && url !== kept.url; })); result.push(kept); });
        return { items: result, categories: usedCategories(result, catalog.categories, '__tuner_us', 'USA'), merged: merged };
    }
    // Re-uploads of one movie (docs/browse.md, Copies of one title): uploads whose names are equal once lower-cased and
    // stripped to a-z and 0-9 are one movie, except that uploads listed only in foreign categories fold among
    // themselves, so a dubbed copy never backs up the US one. Each group keeps its newest upload (on a tie the first);
    // the others become its backups, newest first, and their ids its aliases; categories merge; a missing TMDB id,
    // year or genre comes from the newest copy that has one.
    function foldMovies(items, categories) {
        var groups = Object.create(null), order = [], browse = root.TunerData && root.TunerData.browse, passes = browse ? browse.categoryCheck(categories) : function () { return true; };
        items.forEach(function (item, index) {
            var name = text(item.name).toLowerCase().replace(/[^a-z0-9]/g, ''), key = name ? (passes(item) ? 'p:' : 'f:') + name : 'i:' + item.id, added = Number(item.added) || 0;
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push({ item: item, index: index, added: added > 1e11 ? Math.floor(added / 1000) : added });
        });
        return order.map(function (key) {
            var copies = groups[key].sort(function (a, b) { return b.added - a.added || a.index - b.index; }), kept = copy(copies[0].item), ids = [], urls = [], aliases = [];
            copies.forEach(function (entry, n) {
                var item = entry.item;
                if (item.adult) kept.adult = true;
                if (!kept.tmdb && item.tmdb) kept.tmdb = item.tmdb;
                if (!kept.year && item.year) kept.year = item.year;
                if (!kept.genre && item.genre) kept.genre = item.genre;
                ids = ids.concat(item.categoryIds); urls = urls.concat([item.url], item.backups || []);
                if (n) aliases = aliases.concat([item.id], item.aliases || []);
            });
            kept.categoryIds = unique(ids); kept.categoryId = kept.categoryIds[0] || ''; kept.backups = unique(urls.filter(function (url) { return url && url !== kept.url; }));
            if (aliases.length) kept.aliases = unique(aliases.filter(function (id) { return id !== kept.id; }));
            return kept;
        });
    }
    // order: 'featured' (main cable groups first, the default), 'provider' (as the line delivers them) or 'az'.
    function categoryItems(categories, hasMostWatched, order) { var ranked = ['SPORTS', 'PREMIUM', 'NEWS', 'MOVIES', 'ENTERTAINMENT', 'DOCUMENTARIES', 'LOCAL NEWS'], seen = Object.create(null), result = [{ id: '__all', name: 'All Channels' }, { id: '__fav', name: 'Favorites' }]; if (hasMostWatched !== false) result.push({ id: '__hot', name: 'Most Watched' }); var remaining = categories.filter(function (cat) { if (/^__(all|fav|hot)$/.test(cat.id) || seen[cat.id]) return false; seen[cat.id] = true; return true; }).map(function (cat, index) { var value = upper(cat.name).replace(/[^A-Z0-9]+/g, ' ').trim().replace(/^USA? /, ''), rank = ranked.indexOf(value); return { cat: cat, index: index, rank: order === 'provider' || order === 'az' ? 0 : rank < 0 ? 7 : rank, key: text(cat.name).replace(/^[^A-Za-z0-9]+/, '').toLowerCase() }; }).sort(function (a, b) { return a.rank - b.rank || (order === 'az' && a.key !== b.key ? (a.key < b.key ? -1 : 1) : 0) || a.index - b.index; }); return result.concat(remaining.map(function (value) { return value.cat; })); }

    // Finished catalogues stay private to this widget. IndexedDB avoids the small settings quota.
    var catalogDatabase = null, catalogMemory = Object.create(null), catalogMemoryIdentity = '';
    // Version 2 records carry the adult flags; older saved catalogues reload once.
    var CATALOG_RECORD_SCHEMA = 2;
    function catalogStorageApi() { try { return root.indexedDB && typeof root.indexedDB.open === 'function' ? root.indexedDB : null; } catch (_) { return null; } }
    // SHA-256 (FIPS 180-4), synchronous so source changes cannot race catalogue selection.
    function catalogDigest(value) {
        var constants = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];
        var digest = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var bytes = [], words = [], i, j, code, next, bitLength, high, low, a, b, c, d, e, f, g, h, s0, s1, t1, t2;
        function rotate(word, count) { return (word >>> count) | (word << (32 - count)); }
        for (i = 0; i < value.length; i++) {
            code = value.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff) {
                next = value.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00; i++; }
                else code = 0xfffd;
            } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 63));
            else if (code < 0x10000) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
            else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 63), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
        }
        bitLength = bytes.length * 8; high = Math.floor(bitLength / 4294967296); low = bitLength >>> 0;
        bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
        for (i = 3; i >= 0; i--) bytes.push((high >>> (i * 8)) & 255);
        for (i = 3; i >= 0; i--) bytes.push((low >>> (i * 8)) & 255);
        for (i = 0; i < bytes.length; i += 64) {
            for (j = 0; j < 16; j++) words[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
            for (j = 16; j < 64; j++) {
                s0 = rotate(words[j - 15], 7) ^ rotate(words[j - 15], 18) ^ (words[j - 15] >>> 3);
                s1 = rotate(words[j - 2], 17) ^ rotate(words[j - 2], 19) ^ (words[j - 2] >>> 10);
                words[j] = (words[j - 16] + s0 + words[j - 7] + s1) | 0;
            }
            a = digest[0]; b = digest[1]; c = digest[2]; d = digest[3]; e = digest[4]; f = digest[5]; g = digest[6]; h = digest[7];
            for (j = 0; j < 64; j++) {
                s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
                t1 = (h + s1 + ((e & f) ^ (~e & g)) + constants[j] + words[j]) | 0;
                s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
                t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            digest[0] = (digest[0] + a) | 0; digest[1] = (digest[1] + b) | 0;
            digest[2] = (digest[2] + c) | 0; digest[3] = (digest[3] + d) | 0;
            digest[4] = (digest[4] + e) | 0; digest[5] = (digest[5] + f) | 0;
            digest[6] = (digest[6] + g) | 0; digest[7] = (digest[7] + h) | 0;
        }
        return digest.map(function (word) { return ('00000000' + (word >>> 0).toString(16)).slice(-8); }).join('');
    }
    function catalogIdentity(input, options) {
        options = options || {};
        var source = normalizeSource(input), ordered = {};
        Object.keys(source).sort().forEach(function (key) { if (!/^(?:__proto__|constructor|prototype)$/.test(key)) ordered[key] = source[key]; });
        return catalogDigest(JSON.stringify({ schema: 1, source: ordered, zip: options.zip === undefined ? '01608' : text(options.zip), liveFormat: options.liveFormat || source.liveFormat || 'm3u8', lineup: options.usOnly ? 'us' : 'all' }));
    }
    function openCatalogDatabase() {
        var databaseApi = catalogStorageApi();
        if (!databaseApi) return root.Promise.resolve(null);
        if (catalogDatabase) return catalogDatabase;
        var opening = new root.Promise(function (resolve) {
            var done = false, timer, request;
            function finish(database) { if (done) { if (database) database.close(); return; } done = true; if (timer && root.clearTimeout) root.clearTimeout(timer); resolve(database); }
            try {
                if (root.setTimeout) timer = root.setTimeout(function () { finish(null); }, 1500);
                request = databaseApi.open('tuner.tv.catalog.v1', 1);
                request.onupgradeneeded = function () { var store = request.result.createObjectStore('catalogs', { keyPath: 'id' }); store.createIndex('updated', 'updated'); };
                request.onsuccess = function () { var database = request.result; database.onversionchange = function () { database.close(); if (catalogDatabase === opening) catalogDatabase = null; }; finish(database); };
                request.onerror = function () { finish(null); };
                request.onblocked = function () { finish(null); };
            } catch (_) { finish(null); }
        });
        catalogDatabase = opening;
        opening.then(function (database) { if (!database && catalogDatabase === opening) catalogDatabase = null; });
        return opening;
    }
    function createCatalogCache(input, options) {
        options = options || {};
        var identity = catalogIdentity(input, options), prefix = 'catalog-' + fingerprint(identity) + ':', libraryKey = sourceKey(input), storage;
        if (catalogMemoryIdentity !== identity) { catalogMemory = Object.create(null); catalogMemoryIdentity = identity; }
        try { storage = root.localStorage; } catch (_) {}
        function valid(record, kind) {
            if (!record || record.schema !== CATALOG_RECORD_SCHEMA || record.identity !== identity || record.kind !== kind ||
                typeof record.updated !== 'number' || record.updated <= 0 || record.updated > Date.now() + 300000 ||
                !record.payload || !Array.isArray(record.payload.items) || !Array.isArray(record.payload.categories) ||
                (kind === 'live' && (!record.payload.merged || typeof record.payload.merged !== 'object' || Array.isArray(record.payload.merged)))) return false;
            var seen = Object.create(null), items = record.payload.items, categories = record.payload.categories, i, item;
            for (i = 0; i < items.length; i++) { item = items[i]; if (!item || typeof item.id !== 'string' || !item.id || seen[item.id] || typeof item.name !== 'string' ||
                item.sourceKey !== libraryKey || !Array.isArray(item.categoryIds) || (kind !== 'series' && !safeUrl(item.url)) || !Array.isArray(item.backups) ||
                (item._episodes !== undefined && !Array.isArray(item._episodes))) return false; seen[item.id] = true; }
            for (i = 0; i < categories.length; i++) if (!categories[i] || typeof categories[i].id !== 'string' || typeof categories[i].name !== 'string') return false;
            return true;
        }
        function fallback(kind) {
            var record = catalogMemoryIdentity === identity && catalogMemory[prefix + kind];
            if (valid(record, kind)) return record;
            if (kind !== 'live' || !storage) return null;
            try { record = JSON.parse(storage.getItem('tuner.tv.catalog.live.v1')); return valid(record, kind) ? record : null; } catch (_) { return null; }
        }
        function saveFallback(record) {
            if (record.kind !== 'live' || !storage) return false;
            try { var serialized = JSON.stringify(record); if (serialized.length > 1500000) return false; storage.setItem('tuner.tv.catalog.live.v1', serialized); return true; } catch (_) { return false; }
        }
        function read(onRecord) {
            if (!catalogStorageApi()) return null; // The synchronous fallback keeps unsupported TVs responsive.
            var memory = {}, allMemory = true;
            ['live', 'movies', 'series'].forEach(function (kind) { var record = catalogMemoryIdentity === identity && catalogMemory[prefix + kind]; if (valid(record, kind)) memory[kind] = record; else allMemory = false; });
            if (allMemory) { ['live', 'movies', 'series'].forEach(function (kind) { if (onRecord) onRecord(kind, memory[kind]); }); return root.Promise.resolve(memory); }
            return openCatalogDatabase().then(function (database) {
                if (!database) { var saved = { live: fallback('live'), movies: fallback('movies'), series: fallback('series') }; Object.keys(saved).forEach(function (kind) { if (saved[kind] && onRecord) onRecord(kind, saved[kind]); }); return saved; }
                return new root.Promise(function (resolve) {
                    var result = {}, done = false, timer, transaction;
                    function finish() { if (done) return; done = true; if (timer && root.clearTimeout) root.clearTimeout(timer); ['live', 'movies', 'series'].forEach(function (kind) { if (!result[kind]) { result[kind] = fallback(kind); if (result[kind] && onRecord) onRecord(kind, result[kind]); } }); resolve(result); }
                    try {
                        if (root.setTimeout) timer = root.setTimeout(finish, 1500);
                        transaction = database.transaction('catalogs', 'readonly');
                        ['live', 'movies', 'series'].forEach(function (kind) {
                            var request = transaction.objectStore('catalogs').get(prefix + kind);
                            request.onsuccess = function () { if (done) return; var saved = valid(request.result, kind) ? request.result : null; result[kind] = memory[kind] && (!saved || memory[kind].updated >= saved.updated) ? memory[kind] : saved; if (result[kind] && onRecord) onRecord(kind, result[kind]); };
                        });
                        transaction.oncomplete = finish; transaction.onerror = finish; transaction.onabort = finish;
                    } catch (_) { finish(); }
                });
            });
        }
        function write(kind, payload) {
            var record = { id: prefix + kind, schema: CATALOG_RECORD_SCHEMA, identity: identity, kind: kind, updated: Date.now(), payload: payload };
            if (catalogMemoryIdentity === identity) catalogMemory[record.id] = record;
            if (!catalogStorageApi()) return root.Promise.resolve(saveFallback(record));
            return openCatalogDatabase().then(function (database) {
                if (!database) return saveFallback(record);
                return new root.Promise(function (resolve) {
                    var done = false, timer, transaction;
                    function finish(saved) { if (done) return; done = true; if (timer && root.clearTimeout) root.clearTimeout(timer); resolve(saved || saveFallback(record)); }
                    try {
                        if (root.setTimeout) timer = root.setTimeout(function () { finish(false); }, 1500);
                        transaction = database.transaction('catalogs', 'readwrite');
                        var store = transaction.objectStore('catalogs'); store.put(record);
                        var count = store.count();
                        count.onsuccess = function () {
                            var excess = count.result - 9;
                            if (excess <= 0) return;
                            var oldest = store.index('updated').openKeyCursor();
                            oldest.onsuccess = function () { var cursor = oldest.result; if (!cursor || excess <= 0) return; if (cursor.primaryKey !== record.id) { store.delete(cursor.primaryKey); excess--; } cursor.continue(); };
                        };
                        transaction.oncomplete = function () { finish(true); };
                        transaction.onerror = function () { finish(false); }; transaction.onabort = function () { finish(false); };
                    } catch (_) { finish(false); }
                });
            });
        }
        return { identity: identity, peek: fallback, read: read, write: write,
            fresh: function (record) { var age = Date.now() - record.updated; return age >= 0 && age < (record.kind === 'live' ? 7200000 : 43200000); } };
    }

    // Adult lock passcode. Only a random salt and an iterated, salted SHA-256 digest are saved; never the digits.
    // Five wrong entries in a row impose a 60 second wait, which also survives an app restart.
    var PASSCODE_KEY = 'tuner.tv.adultlock.v1', PASSCODE_ROUNDS = 64, PASSCODE_TRIES = 5, PASSCODE_WAIT = 60000;
    function validPasscode(pin) { return typeof pin === 'string' && /^[0-9]{4}$/.test(pin); }
    function passcodeSalt() {
        var bytes = [], values, i;
        try { values = new root.Uint8Array(16); root.crypto.getRandomValues(values); for (i = 0; i < 16; i++) bytes.push(values[i]); } catch (_) { bytes = []; }
        if (bytes.length !== 16) { bytes = []; for (i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256)); }
        return bytes.map(function (value) { return ('0' + value.toString(16)).slice(-2); }).join('');
    }
    function hashPasscode(pin, salt) {
        var digest = catalogDigest('tuner-adult-lock:' + salt + ':' + pin), i;
        for (i = 1; i < PASSCODE_ROUNDS; i++) digest = catalogDigest(salt + ':' + digest);
        return digest;
    }
    function createPasscodeLock(storage, clock) {
        if (!storage) { try { storage = root.localStorage; } catch (_) {} }
        clock = clock || function () { return Date.now(); };
        function load() {
            var value = null;
            try { value = JSON.parse(storage.getItem(PASSCODE_KEY)); } catch (_) {}
            if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
            if (typeof value.salt !== 'string' || !/^[0-9a-f]{32}$/.test(value.salt) || typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) { delete value.salt; delete value.hash; }
            value.failures = Math.max(0, Math.floor(Number(value.failures) || 0));
            value.until = Math.max(0, Number(value.until) || 0);
            return value;
        }
        function save(value) { try { storage.setItem(PASSCODE_KEY, JSON.stringify(value)); return true; } catch (_) { return false; } }
        var lock = {
            hasPasscode: function () { return !!load().hash; },
            waitRemaining: function () { var wait = load().until - clock(); return wait > 0 ? wait : 0; },
            setPasscode: function (pin) {
                if (!validPasscode(pin)) return false;
                var salt = passcodeSalt();
                return save({ salt: salt, hash: hashPasscode(pin, salt), failures: 0, until: 0 });
            },
            verify: function (pin) {
                var value = load(), now = clock();
                if (!value.hash) return { ok: false, wait: 0, left: PASSCODE_TRIES, missing: true };
                if (value.until > now) return { ok: false, wait: value.until - now, left: 0 };
                if (validPasscode(pin) && hashPasscode(pin, value.salt) === value.hash) {
                    value.failures = 0; value.until = 0; save(value);
                    return { ok: true, wait: 0, left: PASSCODE_TRIES };
                }
                value.failures++;
                if (value.failures >= PASSCODE_TRIES) { value.failures = 0; value.until = now + PASSCODE_WAIT; save(value); return { ok: false, wait: PASSCODE_WAIT, left: 0 }; }
                value.until = 0; save(value);
                return { ok: false, wait: 0, left: PASSCODE_TRIES - value.failures };
            }
        };
        return lock;
    }
    function createStore(storage) {
        if (!storage) { try { storage = root.localStorage; } catch (_) {} }
        function read(key, fallback) { try { var parsed = JSON.parse(storage.getItem(key)); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback; } catch (_) { return fallback; } }
        var settings = read('tuner.tv.settings.v1', { source: null, zip: '01608' }), library = read('tuner.tv.library.v1', Object.create(null)), store;
        if (settings.zip === undefined) settings.zip = '01608'; if (settings.source === undefined) settings.source = null;
        function write(key, value) { try { storage.setItem(key, JSON.stringify(value)); store.lastError = ''; return true; } catch (_) { store.lastError = 'Unable to save on this TV. Check available storage.'; return false; } }
        function row(key) { key = key || sourceKey(settings.source); if (!Object.prototype.hasOwnProperty.call(library, key)) library[key] = { favourites: [], recents: [], watches: {} }; var entry = library[key]; if (!Array.isArray(entry.favourites)) entry.favourites = []; if (!Array.isArray(entry.recents)) entry.recents = []; if (!entry.watches || typeof entry.watches !== 'object') entry.watches = {}; if (!Array.isArray(entry.upNext)) entry.upNext = []; if (!Array.isArray(entry.seen)) entry.seen = []; return entry; }
        function resolve(id, key) { var map = aliases[key || sourceKey(settings.source)]; return map && map[id] ? map[id] : id; }
        function persist() { return write('tuner.tv.library.v1', library); }
        store = { settings: settings, lastError: '', saveSettings: function (patch) { Object.keys(patch || {}).forEach(function (key) { if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') settings[key] = patch[key]; }); return write('tuner.tv.settings.v1', settings); },
            favourites: function (key) { return unique(row(key).favourites.map(function (id) { return resolve(id, key); })); },
            isFavourite: function (id) { return store.favourites().indexOf(resolve(id)) >= 0; },
            toggleFavourite: function (id) { var entry = row(), ids = store.favourites(), canonical = resolve(id), added = ids.indexOf(canonical) < 0; entry.favourites = added ? ids.concat([canonical]) : ids.filter(function (value) { return value !== canonical; }); persist(); return added; },
            recents: function () { return row().recents.map(copy); },
            // An episode carries seriesId: finishing it (95%) leaves a "next episode" marker for its series.
            saveRecent: function (item, position, duration) { var entry = row(), record = copy(item), finished; position = Math.max(0, Number(position) || 0); duration = Math.max(0, Number(duration) || 0); finished = duration > 0 && position > duration * 0.95; entry.recents = entry.recents.filter(function (value) { return value.id !== item.id; }); if (position > 15000 && !finished) { record.position = record.positionMs = position; record.duration = record.durationMs = duration; record.updated = Date.now(); entry.recents.unshift(record); entry.recents = entry.recents.slice(0, 40); }
                if (item.seriesId && (finished || position > 15000)) { entry.upNext = entry.upNext.filter(function (value) { return value.seriesId !== item.seriesId; }); if (finished) { entry.upNext.unshift({ seriesId: item.seriesId, season: Number(item.season) || 0, episode: Number(item.episode) || 0, updated: Date.now() }); entry.upNext = entry.upNext.slice(0, 30); } }
                return persist(); },
            upNext: function () { return row().upNext.map(copy); },
            // A series with no episode after the finished one leaves Continue watching.
            clearUpNext: function (seriesId) { var entry = row(), kept = entry.upNext.filter(function (value) { return value.seriesId !== seriesId; }); if (kept.length === entry.upNext.length) return true; entry.upNext = kept; return persist(); },
            // Movies and series played, newest first (Library: Recently watched).
            seen: function () { return row().seen.map(copy); },
            recordSeen: function (id) { var entry = row(); id = text(id); if (!id) return false; entry.seen = [{ id: id, updated: Date.now() }].concat(entry.seen.filter(function (value) { return value && value.id !== id; })).slice(0, 40); return persist(); },
            clearRecent: function (id) { var entry = row(); entry.recents = entry.recents.filter(function (item) { return item.id !== id; }); return persist(); },
            recordWatched: function (id) { var entry = row(), canonical = resolve(id), old = entry.watches[canonical] || { count: 0, updated: 0 }; entry.watches[canonical] = { count: old.count + 1, updated: Date.now() }; entry.lastWatched = canonical; return persist(); },
            mostWatched: function () { var entry = row(), totals = Object.create(null); Object.keys(entry.watches).forEach(function (id) { var canonical = resolve(id), old = totals[canonical] || { count: 0, updated: 0 }, value = entry.watches[id]; totals[canonical] = { count: old.count + (Number(value.count) || 0), updated: Math.max(old.updated, Number(value.updated) || 0) }; }); return Object.keys(totals).sort(function (a, b) { return totals[b].count - totals[a].count || totals[b].updated - totals[a].updated || a.localeCompare(b); }).slice(0, 50); },
            lastWatched: function () { return resolve(row().lastWatched || ''); } };
        store.adultLock = createPasscodeLock(storage);
        return store;
    }
    function decodeBase64(value) { value = text(value); if (!value) return ''; if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return value; try { var raw = root.atob(value), escaped = ''; for (var i = 0; i < raw.length; i++) escaped += '%' + ('0' + raw.charCodeAt(i).toString(16)).slice(-2); return decodeURIComponent(escaped).trim(); } catch (_) { return value; } }
    function parseGuide(payload) { return (payload && Array.isArray(payload.epg_listings) ? payload.epg_listings : []).map(function (row, index) { var start = Number(row.start_timestamp) * 1000, end = Number(row.stop_timestamp || row.end_timestamp) * 1000; return { id: text(row.id) || 'p:' + start + ':' + index, title: decodeBase64(row.title), description: decodeBase64(row.description), start: start, end: end }; }).filter(function (program) { return isFinite(program.start) && isFinite(program.end) && program.end > program.start; }).sort(function (a, b) { return a.start - b.start; }); }
    function groupEpisodes(episodes) { var grouped = Object.create(null), seen = Object.create(null); episodes.forEach(function (episode) { if (!episode.id || seen[episode.id] || !safeUrl(episode.url)) return; seen[episode.id] = true; (grouped[episode.season] || (grouped[episode.season] = [])).push(episode); }); return Object.keys(grouped).map(Number).sort(function (a, b) { return a - b; }).map(function (number) { return { number: number, episodes: grouped[number].sort(function (a, b) { return a.episode - b.episode; }) }; }); }
    function parseSeriesInfo(payload, source) { var episodes = [], raw = payload.episodes || {}, metadata = payload.info || {};
        function add(row, hint) { if (!row || typeof row !== 'object' || !text(row.id)) return; var info = row.info || {}, number = Number(row.episode_num) || 0; episodes.push({ id: 'e:' + text(row.id), name: text(row.title) || 'Episode ' + number, url: safeUrl(row.direct_source) || streamUrl(source, 'series', text(row.id), text(row.container_extension) || 'mp4'), image: safeUrl(info.movie_image), season: Number(row.season) || Number(hint) || 1, episode: number, duration: Number(info.duration_secs) || 0, plot: text(info.plot), sourceKey: sourceKey(source) }); }
        if (Array.isArray(raw)) raw.forEach(function (value) { if (Array.isArray(value)) value.forEach(function (row) { add(row, 0); }); else add(value, 0); }); else Object.keys(raw).forEach(function (season) { if (Array.isArray(raw[season])) raw[season].forEach(function (row) { add(row, season); }); });
        return { seasons: groupEpisodes(episodes), name: text(metadata.name), plot: text(metadata.plot), image: safeUrl(metadata.cover), year: text(metadata.releaseDate || metadata.release_date).substring(0, 4), genre: text(metadata.genre), cast: text(metadata.cast) };
    }
    function xmlText(value) {
        return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/ig, function (entity, code) {
            var entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }, n;
            if (code[0] !== '#') return entities[code.toLowerCase()] || entity;
            n = code[1].toLowerCase() === 'x' ? parseInt(code.substring(2), 16) : parseInt(code.substring(1), 10);
            if (!isFinite(n) || n < 1 || n > 1114111 || (n >= 55296 && n <= 57343)) return '\ufffd';
            return n <= 65535 ? String.fromCharCode(n) : String.fromCharCode(55296 + ((n - 65536) >> 10), 56320 + ((n - 65536) & 1023));
        });
    }
    function xmlTime(value) {
        var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*(Z|[+-]\d{4}))?\s*$/.exec(value || '');
        if (!m) return 0;
        var year = +m[1], month = +m[2], day = +m[3], hour = +m[4], minute = +m[5], second = +(m[6] || 0), offset = m[7] || 'Z', ms = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(ms);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return 0;
        if (offset !== 'Z') { var oh = +offset.substring(1, 3), om = +offset.substring(3, 5); if (oh > 23 || om > 59) return 0; ms -= (offset[0] === '-' ? -1 : 1) * (oh * 60 + om) * 60000; }
        return ms;
    }
    function xmlReader(input, channels, from, to) {
        var at = 0, currentChannel = '', currentProgram = null, field = '', fieldDepth = 0, fieldValue = '', channelNames = [], icons = Object.create(null), names = Object.create(null), programs = Object.create(null), wanted = Object.create(null), wantedKeys = Object.create(null), done = false, sawTv = false, closedTv = false;
        (channels || []).forEach(function (channel) { if (channel.epgId) wanted[text(channel.epgId).toLowerCase()] = true; var key = nameKey(channel.name); if (key) wantedKeys[key] = true; });
        function attributes(raw) { var values = Object.create(null), match, re = /([a-z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/ig; while ((match = re.exec(raw))) values[match[1]] = xmlText(match[2] === undefined ? match[3] : match[2]); return values; }
        function addName(value, id) { var key = nameKey(value); if (!key || !id) return; if (!names[key]) names[key] = id; if (wantedKeys[key]) wanted[id] = true; }
        function endField() { if (field === 'display-name') channelNames.push(text(fieldValue)); else if (currentProgram && !currentProgram[field === 'desc' ? 'description' : field === 'sub-title' ? 'subtitle' : 'title']) currentProgram[field === 'desc' ? 'description' : field === 'sub-title' ? 'subtitle' : 'title'] = text(fieldValue); field = ''; fieldDepth = 0; fieldValue = ''; }
        function endProgram() { if (currentProgram) { var id = currentProgram.channel; if (wanted[id] && currentProgram.end > from && currentProgram.start < to && currentProgram.end > currentProgram.start && currentProgram.start > 0) { delete currentProgram.channel; if (!programs[id]) programs[id] = []; programs[id].push(currentProgram); } } currentProgram = null; }
        function clean() { Object.keys(programs).forEach(function (id) { var sorted = programs[id].sort(function (a, b) { return a.start - b.start || a.end - b.end; }), kept = []; sorted.forEach(function (p) { var previous = kept[kept.length - 1]; if (previous && p.start < previous.end) { if (p.end <= previous.end) return; p.start = previous.end; } kept.push(p); }); programs[id] = kept; }); }
        return { result: { programs: programs, names: names, icons: icons }, step: function (budget) {
            if (done) return true;
            for (var count = 0; at < input.length && count < budget; count++) {
                if (input[at] !== '<') { var next = input.indexOf('<', at); if (next < 0) next = input.length; if (field) fieldValue += xmlText(input.substring(at, next)); at = next; continue; }
                if (input.substring(at, at + 4) === '<!--') { var commentEnd = input.indexOf('-->', at + 4); if (commentEnd < 0) throw new Error('The guide contains incomplete XML.'); at = commentEnd + 3; continue; }
                if (input.substring(at, at + 9) === '<![CDATA[') { var cdataEnd = input.indexOf(']]>', at + 9); if (cdataEnd < 0) throw new Error('The guide contains incomplete XML.'); if (field) fieldValue += input.substring(at + 9, cdataEnd); at = cdataEnd + 3; continue; }
                var end = at + 1, quote = '', ch;
                for (; end < input.length; end++) { ch = input[end]; if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; }
                if (end >= input.length) throw new Error('The guide contains incomplete XML.');
                var raw = input.substring(at + 1, end), match = /^\s*(\/)?([a-z0-9:_-]+)/i.exec(raw), selfClosing = /\/\s*$/.test(raw); at = end + 1;
                if (!match) { if (/^!DOCTYPE/i.test(raw) && raw.indexOf('[') >= 0) throw new Error('This guide uses XML entities that the TV cannot safely read. Use a standard XMLTV guide.'); continue; }
                var tag = match[2].toLowerCase(), closing = !!match[1], attrs;
                if (field) { if (closing) { fieldDepth--; if (fieldDepth === 0) endField(); } else if (!selfClosing) fieldDepth++; continue; }
                if (closing) { if (tag === 'channel') { channelNames.forEach(function (name) { addName(name, currentChannel); }); currentChannel = ''; channelNames = []; } else if (tag === 'programme') endProgram(); else if (tag === 'tv') closedTv = true; continue; }
                attrs = attributes(raw);
                if (tag === 'tv') { sawTv = true; if (selfClosing) closedTv = true; }
                else if (tag === 'channel') { currentChannel = text(attrs.id).toLowerCase(); channelNames = []; addName(currentChannel.replace(/\.[a-z]{2,3}$/i, ''), currentChannel); if (selfClosing) currentChannel = ''; }
                else if (tag === 'icon' && currentChannel && !icons[currentChannel]) icons[currentChannel] = safeUrl(attrs.src);
                else if (tag === 'programme') { currentProgram = { id: text(attrs.id) || 'xml:' + attrs.channel + ':' + attrs.start, channel: text(attrs.channel).toLowerCase(), start: xmlTime(attrs.start), end: xmlTime(attrs.stop), title: '', description: '' }; if (selfClosing) endProgram(); }
                else if ((tag === 'display-name' && currentChannel) || (currentProgram && /^(title|sub-title|desc)$/.test(tag))) { if (!selfClosing) { field = tag; fieldDepth = 1; fieldValue = ''; } }
            }
            if (at < input.length) return false;
            if (!sawTv || !closedTv || currentChannel || currentProgram || field) throw new Error('The provider did not return a complete XMLTV guide.');
            clean(); done = true; return true;
        } };
    }
    function parseXmltv(input, channels, from, to) { var reader = xmlReader(text(input), channels || [], from === undefined ? Date.now() - 7200000 : from, to === undefined ? Date.now() + 129600000 : to); while (!reader.step(2000)) {} return reader.result; }
    function parseXmltvAsync(input, channels, from, to, active) { return new root.Promise(function (resolve, reject) {
        var reader = xmlReader(input, channels, from, to);
        function batch() { try { if (active && !active()) { var error = new Error('Request cancelled.'); error.name = 'AbortError'; throw error; } if (reader.step(800)) resolve(reader.result); else if (root.setTimeout) root.setTimeout(batch, 0); else root.Promise.resolve().then(batch); } catch (error) { reject(error); } }
        batch();
    }); }
    function utf8Bytes(bytes) {
        if (root.TextDecoder) return new root.TextDecoder('utf-8').decode(bytes);
        var out = [], block = '', i = 0, n, extra, minimum, c;
        while (i < bytes.length) { n = bytes[i++]; extra = n < 128 ? 0 : n >= 194 && n <= 223 ? 1 : n <= 239 && n >= 224 ? 2 : n >= 240 && n <= 244 ? 3 : -1; minimum = extra === 1 ? 128 : extra === 2 ? 2048 : extra === 3 ? 65536 : 0; if (extra < 0) { block += '\ufffd'; continue; } n &= extra ? (1 << (6 - extra)) - 1 : 127; while (extra > 0) { c = bytes[i]; if (c === undefined || (c & 192) !== 128) { n = 65533; break; } i++; n = (n << 6) | (c & 63); extra--; } if (extra || n < minimum || n > 1114111 || (n >= 55296 && n <= 57343)) n = 65533; block += n <= 65535 ? String.fromCharCode(n) : String.fromCharCode(55296 + ((n - 65536) >> 10), 56320 + ((n - 65536) & 1023)); if (block.length >= 16384) { out.push(block); block = ''; } }
        out.push(block); return out.join('');
    }
    function xmlBytes(bytes) {
        var encoding = 'utf-8', header = '', i, bom = 0;
        if (bytes[0] === 255 && bytes[1] === 254) { encoding = 'utf-16le'; bom = 2; } else if (bytes[0] === 254 && bytes[1] === 255) { encoding = 'utf-16be'; bom = 2; }
        else if (bytes[0] === 60 && bytes[1] === 0 && bytes[3] === 0) encoding = 'utf-16le'; else if (bytes[0] === 0 && bytes[1] === 60 && bytes[2] === 0) encoding = 'utf-16be';
        else { for (i = 0; i < Math.min(512, bytes.length); i++) header += String.fromCharCode(bytes[i]); var match = /^\s*(?:\xEF\xBB\xBF)?<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(header); if (match) encoding = match[1].toLowerCase(); }
        if (/^(utf-?8|us-ascii)$/.test(encoding)) return utf8Bytes(bytes);
        if (root.TextDecoder) { try { return new root.TextDecoder(encoding).decode(bytes); } catch (_) {} }
        if (/^utf-16(le|be)$/.test(encoding)) { var out = [], block = '', little = encoding === 'utf-16le'; for (i = bom; i + 1 < bytes.length; i += 2) { block += String.fromCharCode(little ? bytes[i] + bytes[i + 1] * 256 : bytes[i] * 256 + bytes[i + 1]); if (block.length >= 16384) { out.push(block); block = ''; } } out.push(block); return out.join(''); }
        throw new Error('This TV cannot read the guide text encoding. Use a UTF-8 XMLTV guide.');
    }
    function xmlResponse(value) { if (typeof value === 'string') return root.Promise.resolve(value); var bytes = new Uint8Array(value); if (bytes[0] !== 31 || bytes[1] !== 139) { try { return root.Promise.resolve(xmlBytes(bytes)); } catch (error) { return root.Promise.reject(error); } } if (!root.DecompressionStream || !root.Blob || !root.Response || !root.Blob.prototype.stream) return root.Promise.reject(new Error('This TV cannot unpack the compressed guide. Use an uncompressed XMLTV URL.')); try { return new root.Response(new root.Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('gzip'))).arrayBuffer().then(function (buffer) { return xmlBytes(new Uint8Array(buffer)); }).catch(function () { throw new Error('The compressed guide could not be read. Try an uncompressed XMLTV URL.'); }); } catch (_) { return root.Promise.reject(new Error('The compressed guide could not be read. Try an uncompressed XMLTV URL.')); } }
    function createClient(input, options) {
        options = options || {}; var source = normalizeSource(input), key = sourceKey(input), generation = 0, requests = [], guideCache = Object.create(null), guidePending = Object.create(null), details = Object.create(null), cancelled = false, accountCache = null, accountUpdated = 0, accountPending = null, liveChannels = [], xmlUrl = source.epgUrl, xmlCache = null, xmlPending = null, xmlUpdated = 0;
        var catalogCache = options.cache === false ? null : createCatalogCache(input, options), catalogWrites = [];
        function aborted() { var error = new Error('Request cancelled.'); error.name = 'AbortError'; return error; }
        function request(url, timeout, binary) { return new root.Promise(function (resolve, reject) {
            if (cancelled) { reject(aborted()); return; }
            var xhr, entry, finished = false;
            try { xhr = new root.XMLHttpRequest(); } catch (_) { reject(new Error('The TV could not start a provider request. Try again.')); return; }
            entry = { xhr: xhr, cancelled: false };
            requests.push(entry);
            function finish(error, value) { if (finished) return; finished = true; var index = requests.indexOf(entry); if (index >= 0) requests.splice(index, 1); if (error) reject(error); else resolve(value); }
            try { xhr.open('GET', url, true); xhr.timeout = timeout || options.timeout || 45000; if (binary) xhr.responseType = 'arraybuffer'; } catch (_) { finish(new Error('The provider request could not be started. Check the server address.')); return; }
            xhr.onreadystatechange = function () { if (xhr.readyState !== 4) return; if (entry.cancelled) finish(aborted()); else if (xhr.status >= 200 && xhr.status < 300) finish(null, binary ? xhr.response : xhr.responseText); else finish(new Error(xhr.status === 401 || xhr.status === 403 ? 'The provider rejected this login. Check your details.' : 'Unable to load from the provider. Check the server and network.')); };
            xhr.onerror = function () { finish(new Error('Unable to reach the provider. Check the TV network and server address.')); };
            xhr.ontimeout = function () { finish(new Error('The provider took too long to respond. Try again.')); };
            xhr.onabort = function () { finish(aborted()); };
            try { xhr.send(); } catch (_) { finish(new Error('The provider request could not be started. Check the server address.')); }
        }); }
        function json(url, timeout) { return request(url, timeout).then(function (value) { try { return JSON.parse(value); } catch (_) { throw new Error('The provider returned unreadable data. Try again.'); } }); }
        function status(kind, state, message, token) { if (token === generation && !cancelled && options.onStatus) options.onStatus(kind, { state: state, message: message || '' }); }
        function deliver(kind, payload, token) {
            if (token !== generation || cancelled) return;
            if (kind === 'live') {
                var merged = Object.create(null);
                Object.keys(payload.merged || {}).forEach(function (id) { if (typeof payload.merged[id] === 'string') merged[id] = payload.merged[id]; });
                aliases[key] = merged; liveChannels = payload.items; xmlUrl = source.epgUrl || payload.xmlUrl || '';
            }
            if (options.onCatalog) options.onCatalog(kind, payload.items, payload.categories);
            status(kind, 'ready', '', token);
        }
        function publish(kind, items, cats, token) {
            if (token !== generation || cancelled) return;
            var merged = {};
            if (kind === 'live') { var folded = foldLive(localPolicy(options.usOnly ? usPolicy(items, cats) : allPolicy(items, cats), options.zip === undefined ? '01608' : options.zip)); merged = folded.merged; items = folded.items; cats = folded.categories; }
            else if (kind === 'movies') { items = foldMovies(items, cats); cats = usedCategories(items, cats, '__tuner_movies', 'Movies'); }
            else cats = usedCategories(items, cats, '__tuner_series', 'Series');
            items.forEach(function (item) { item.sourceKey = key; });
            var payload = { items: items, categories: cats, merged: merged, xmlUrl: xmlUrl };
            deliver(kind, payload, token);
            if (catalogCache && token === generation && !cancelled) catalogWrites.push(catalogCache.write(kind, payload));
        }
        function stop() { generation++; cancelled = true; requests.slice().forEach(function (entry) { entry.cancelled = true; try { entry.xhr.abort(); } catch (_) {} }); guidePending = Object.create(null); accountPending = null; xmlPending = null; }
        function load(force) {
            stop(); cancelled = false; guideCache = Object.create(null); xmlCache = null;
            var writes = catalogWrites = [];
            var token = generation, kinds = ['live', 'movies', 'series'];
            var restored = Object.create(null);
            kinds.forEach(function (kind) { status(kind, 'loading', 'Loading ' + (kind === 'live' ? 'channels' : kind) + '…', token); });
            function restore(kind, record) {
                if (!record || cancelled || token !== generation || restored[kind]) return;
                restored[kind] = true;
                deliver(kind, record.payload, token);
            }
            function begin(records) {
                if (cancelled || token !== generation) return root.Promise.resolve();
                var needed = [];
                kinds.forEach(function (kind) {
                    var record = records[kind];
                    if (record) restore(kind, record);
                    if (!record || force === true || !catalogCache.fresh(record)) {
                        needed.push(kind);
                        if (record) status(kind, 'loading', 'Updating ' + (kind === 'live' ? 'channels' : kind) + '…', token);
                    }
                });
                if (cancelled || token !== generation) return root.Promise.resolve();
                if (options.onAccount && source.type === 'xtream') accountInfo(true).catch(function () {});
                function failed(kind, error) { if (error.name !== 'AbortError') status(kind, records[kind] ? 'ready' : 'error', records[kind] ? 'Your saved library is available. Refresh when the provider responds.' : error.message, token); }
                if (!needed.length) return root.Promise.resolve();
                if (source.type === 'm3u') return request(source.m3uUrl).then(function (value) {
                    if (cancelled || token !== generation) throw aborted();
                    var parsed = parseM3u(value, source); xmlUrl = source.epgUrl || parsed.epgUrl;
                    publish('live', parsed.live, parsed.liveCategories, token); publish('movies', parsed.movies, parsed.movieCategories, token); publish('series', parsed.series, parsed.seriesCategories, token);
                }).catch(function (error) { needed.forEach(function (kind) { failed(kind, error); }); });
                var endpoints = { live: ['get_live_categories', 'get_live_streams'], movies: ['get_vod_categories', 'get_vod_streams'], series: ['get_series_categories', 'get_series'] };
                return root.Promise.all(needed.map(function (kind) {
                    return root.Promise.all([json(api(source, endpoints[kind][0])), json(api(source, endpoints[kind][1]))]).then(function (values) {
                        if (cancelled || token !== generation) throw aborted();
                        publish(kind, parseXtream(values[1], kind, source, options.liveFormat || source.liveFormat || 'm3u8'), parseCategories(values[0]), token);
                    }).catch(function (error) { failed(kind, error); });
                }));
            }
            var reading = catalogCache && catalogCache.read(restore), result;
            if (reading) result = reading.then(begin);
            else { var saved = {}; kinds.forEach(function (kind) { saved[kind] = catalogCache && catalogCache.peek(kind); }); result = begin(saved); }
            return result.then(function () { return root.Promise.all(writes); });
        }
        function accountInfo(refresh) { if (cancelled) return root.Promise.reject(aborted()); if (source.type !== 'xtream') return root.Promise.resolve({ maxConnections: null, activeConnections: null }); if (accountPending) return accountPending; if (!refresh && accountCache && Date.now() - accountUpdated < 60000) return root.Promise.resolve(accountCache); var token = generation, pending = json(api(source), 15000).then(function (payload) { if (cancelled || token !== generation) throw aborted(); var user = payload.user_info || {}, max = Number(user.max_connections), active = Number(user.active_cons); if (String(user.auth) === '0') throw new Error('The provider rejected this login. Check your details.'); var result = { maxConnections: isFinite(max) && max > 0 ? max : null, activeConnections: user.active_cons !== undefined && isFinite(active) && active >= 0 ? active : null }; accountCache = result; accountUpdated = Date.now(); if (options.onAccount) options.onAccount(result); return result; }); accountPending = pending; pending.then(function () { if (accountPending === pending) accountPending = null; }, function () { if (accountPending === pending) accountPending = null; }); return pending; }
        function xmlGuide(channel) {
            if (cancelled) return root.Promise.reject(aborted());
            if (!xmlUrl) return root.Promise.resolve([]);
            var now = Date.now(), token = generation;
            if (!xmlCache || now - xmlUpdated >= 900000) { if (!xmlPending) { var pending = request(xmlUrl, 60000, true).then(xmlResponse).then(function (value) { if (cancelled || token !== generation) throw aborted(); return parseXmltvAsync(value, liveChannels.length ? liveChannels : [channel], now - 7200000, now + 129600000, function () { return !cancelled && token === generation; }); }).then(function (parsed) { if (cancelled || token !== generation) throw aborted(); xmlCache = parsed; xmlUpdated = Date.now(); return parsed; }); xmlPending = pending; pending.then(function () { if (xmlPending === pending) xmlPending = null; }, function () { if (xmlPending === pending) xmlPending = null; }); } return xmlPending.then(function () { return xmlGuide(channel); }); }
            var id = text(channel.epgId).toLowerCase(); if (!xmlCache.programs[id]) id = xmlCache.names[nameKey(channel.name)] || xmlCache.names[nameKey(id.replace(/\.[a-z]{2,3}$/i, ''))] || id;
            return root.Promise.resolve(xmlCache.programs[id] || []);
        }
        return { sourceKey: key, catalogIdentity: catalogCache ? catalogCache.identity : catalogIdentity(input, options), load: load, cancel: stop,
            accountInfo: accountInfo,
            guide: function (channel) { if (cancelled) return root.Promise.reject(aborted()); if (source.type === 'm3u') return xmlGuide(channel); if (!channel.streamId) return root.Promise.resolve([]); var id = channel.id, cached = guideCache[id], now = Date.now(), token = generation; if (cached && now - cached.updated < 300000 && (!cached.items.length || cached.items[cached.items.length - 1].end > now)) return root.Promise.resolve(cached.items); if (guidePending[id]) return guidePending[id]; var pending = json(api(source, 'get_short_epg', { stream_id: channel.streamId, limit: 48 }), 15000).then(function (payload) { if (cancelled || token !== generation) throw aborted(); var items = parseGuide(payload); guideCache[id] = { updated: Date.now(), items: items }; if (guidePending[id] === pending) delete guidePending[id]; return items; }, function (error) { if (guidePending[id] === pending) delete guidePending[id]; throw error; }); guidePending[id] = pending; return pending; },
            seriesInfo: function (series) { if (cancelled) return root.Promise.reject(aborted()); if (series._episodes) return root.Promise.resolve({ seasons: groupEpisodes(series._episodes) }); if (source.type !== 'xtream') return root.Promise.resolve({ seasons: [] }); var cacheKey = 's:' + series.id, token = generation; if (details[cacheKey]) return root.Promise.resolve(details[cacheKey]); return json(api(source, 'get_series_info', { series_id: series.streamId || series.id.replace(/^s:/, '') }), 25000).then(function (payload) { if (cancelled || token !== generation) throw aborted(); var result = parseSeriesInfo(payload, source); details[cacheKey] = result; return result; }); },
            movieInfo: function (movie) { if (cancelled) return root.Promise.reject(aborted()); if (source.type !== 'xtream') return root.Promise.resolve(copy(movie)); var cacheKey = 'm:' + movie.id, token = generation; if (details[cacheKey]) return root.Promise.resolve(details[cacheKey]); return json(api(source, 'get_vod_info', { vod_id: movie.streamId || movie.id.replace(/^m:/, '') }), 25000).then(function (payload) { if (cancelled || token !== generation) throw aborted(); var info = payload.info || {}, result = { plot: text(info.plot || info.description), cast: text(info.cast || info.actors), director: text(info.director), genre: text(info.genre), year: text(info.releasedate || info.release_date || info.year).substring(0, 4), duration: text(info.duration), rating: text(info.rating), image: safeUrl(info.movie_image || info.cover_big), backdrop: safeUrl(first(info.backdrop_path)) }; details[cacheKey] = result; return result; }); } };
    }
    root.TunerData = { createStore: createStore, createClient: createClient, sourceKey: sourceKey, catalogIdentity: catalogIdentity, normalizeSource: normalizeSource, categoryItems: categoryItems,
        parseXtream: parseXtream, parseCategories: parseCategories, parseM3u: parseM3u, usPolicy: usPolicy, allPolicy: allPolicy, localPolicy: localPolicy, foldLive: foldLive, foldMovies: foldMovies, providerYear: providerYear, spaceText: spaceText, text: text,
        adultName: adultName, isAdultCategory: isAdultCategory, adultFilter: adultFilter, hashPasscode: hashPasscode, createPasscodeLock: createPasscodeLock,
        parseGuide: parseGuide, parseSeriesInfo: parseSeriesInfo, parseXmltv: parseXmltv, parseXmltvAsync: parseXmltvAsync, xmlTime: xmlTime, marketForZip: marketForZip, displayName: displayName, idleEvent: idleEvent, offAir: offAir };
}(typeof window !== 'undefined' ? window : this));

/* Movies & Series browsing (docs/browse.md), shared by the Samsung and LG apps: matching catalogue
   titles to the lumanest.tv catalog rows, the "Movies & Series: USA only" filter, the Home rows and
   Discover lists, and the rows client with its 12-hour cache. Everything here is pure data work; the
   screens and their focus live in app.js.

   An index is built once per catalogue: createIndexBuilder walks the titles in small steps (slow TVs
   with 30,000 titles stay responsive), then matchIndex links them to the rows (cheap, rerun when new
   rows arrive). Lists are arrays of title positions, sorted on first use and kept until the next match. */
(function (root) {
    'use strict';
    var D = root.TunerData, text = D.text;
    function map() { return Object.create(null); }

    // Streaming services in Home's order, with the words that put a provider category in one.
    var SERVICES = [{ key: 'netflix', name: 'Netflix' }, { key: 'disney', name: 'Disney+' }, { key: 'max', name: 'Max' },
        { key: 'prime', name: 'Prime Video' }, { key: 'apple', name: 'Apple TV+' }, { key: 'hulu', name: 'Hulu' },
        { key: 'paramount', name: 'Paramount+' }, { key: 'peacock', name: 'Peacock' }];
    var SERVICE_WORDS = { netflix: /NETFLIX/, disney: /DISNEY/, max: /HBO|(^|[^A-Z0-9])MAX([^A-Z0-9]|$)/, prime: /AMAZON|(^|[^A-Z0-9])PRIME([^A-Z0-9]|VIDEO|$)/,
        apple: /APPLE/, hulu: /HULU/, paramount: /PARAMOUNT/, peacock: /PEACOCK/ };

    // ---------------------------------------------------------------- spaces and letter case
    // docs/browse.md, Spaces and letter case. spaces(): the Unicode spaces become U+0020 before any rule below reads a
    // text. rx() builds the doc's patterns as written, except that it spells their \s out as tab, line feed, vertical
    // tab, form feed, carriage return and space: what \s means in every engine once the Unicode spaces are gone, which
    // older TV browsers' own \s (it also takes U+180E) does not give. Rules that ignore case use the i flag without u,
    // which ignores the case of ASCII letters only: ES5's Canonicalize never maps a character beyond ASCII to an ASCII
    // one, so ſ is not s, the Kelvin sign is not k and neither falls inside [A-Za-z].
    var spaces = D.spaceText;
    function rx(source, flags) { return new RegExp(source.replace(/\\s/g, '[ \\t\\n\\x0B\\f\\r]'), flags || ''); }
    // Normalize step 1 and the year from a name: the Unicode spaces become spaces, then tab, line feed, vertical tab,
    // form feed, carriage return and space go from both ends, and nothing else (U+001C to U+001F, U+180E and U+200B
    // stay). A name made only of tags then reads alike whether or not the provider trimmed it: " - 1999" is "- 1999".
    // A loop over the character codes, not ^[ \t\n\x0B\f\r]+|[ \t\n\x0B\f\r]+$, whose time grows with the square of a
    // run of spaces inside the name (docs/browse.md, Trimming).
    var EDGE = { 9: true, 10: true, 11: true, 12: true, 13: true, 32: true };
    function trimmed(name) {
        var s = spaces(name), start = 0, end = s.length;
        while (start < end && EDGE[s.charCodeAt(start)] === true) start++;
        while (end > start && EDGE[s.charCodeAt(end - 1)] === true) end--;
        return start === 0 && end === s.length ? s : s.substring(start, end);
    }

    // ---------------------------------------------------------------- titles
    // Normalize (docs/browse.md, Matching step 4, and its patterns). Steps 2 and 3 are case-sensitive: only short
    // upper-case tags go, so "EN | The Matrix | 1999" keeps its title. A year is never a leading tag ("2012 | 1999 |
    // EN" keeps 2012). whole: skip steps 3.1, 3.2 and 3.4 (the second lookup, "CSI: Miami").
    // TAG: a short upper-case code, or a quality word where no short upper-case code followed by \s or the end fits, so
    // "4K" or "HD" matches one way only and YEAR_END gives up on "Movie - 1999 - 4K - ... - 4K - Extended" at once.
    var TAG = '[A-Z0-9+]{2,4}|(?![A-Z0-9+]{2,4}(\\s|$))([48][Kk]|[UuFf]?[Hh][Dd]|[Ss][Dd]|[Hh][Dd][Rr](10)?|(1080|720|2160)[Pp])';
    var BRACKETS = rx('\\[[^\\]]*\\]|\\{[^}]*\\}|\\(\\s*(18|19|20)[0-9]{2}\\s*\\)|\\([A-Z0-9 +.]{1,6}\\)', 'g');
    var LEADING = rx('^\\s*(\\|\\s*[A-Z0-9+]{1,6}\\s*\\|\\s*|(?!(18|19|20)[0-9]{2}([^A-Z0-9+]|$))[A-Z0-9+]{2,4}(\\s*[-_]\\s*[A-Z0-9+]{2,4})*\\s*(\\|\\s*|([:-]|–)\\s+))');
    var TRAILING = rx('\\s(\\||-|–)\\s*(' + TAG + ')\\s*$');
    var PIPES = rx('\\|\\s*[A-Z0-9+]{1,6}\\s*\\|', 'g');
    var YEAR_BRACKETS = rx('[(\\[]\\s*((18|19|20)[0-9]{2})\\s*[)\\]]');
    var YEAR_END = rx('\\s(\\||-|–)\\s*((18|19|20)[0-9]{2})(\\s+(\\||-|–)\\s*(?!(18|19|20)[0-9]{2}(\\s|$))(' + TAG + '))*\\s*$');
    var QUALITY = { '4k': true, '8k': true, uhd: true, fhd: true, hd: true, sd: true, hdr: true, hdr10: true, '1080p': true, '720p': true, '2160p': true };
    var FOLD = { 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ß': 'ss', 'đ': 'd', 'ł': 'l', 'ð': 'd', 'þ': 'th' };
    // Browsers without String.prototype.normalize fold with a table: what steps 4 and 7 (NFKD, then U+0300 to U+036F
    // removed) give for the letters of Latin-1, Latin Extended-A and -B, the ligatures U+FB00 to U+FB06, the Kelvin
    // and Angstrom signs, the fullwidth digits and letters, the Roman numerals and the circled numbers and letters, in
    // upper and lower case. Characters whose result has no a-z or 0-9 are left alone (step 8 makes a space of either).
    // Any other character beyond ASCII stays and becomes a space in step 8. tests/browse.test.cjs checks the table
    // against NFKD for every character of these ranges.
    var LATIN = map(), ROMAN = 'i ii iii iv v vi vii viii ix x xi xii l c d m'.split(' ');
    var UNFOLDED = /[\u00a0-\u024f\u2160-\u217f\u2460-\u2473\u24b6-\u24e9\ufb00-\ufb06\uff10-\uff5a\u212a\u212b]/g;
    (function (bases) { Object.keys(bases).forEach(function (base) { bases[base].split('').forEach(function (ch) { LATIN[ch] = base; }); }); }({
        a: 'ªÀÁÂÃÄÅàáâãäåĀāĂăĄąǍǎǞǟǠǡǺǻȀȁȂȃȦȧ\u212b', ae: 'ÆæǢǣǼǽ', c: 'ÇçĆćĈĉĊċČč', d: 'ÐðĎďĐđ', dz: 'ǄǅǆǱǲǳ', e: 'ÈÉÊËèéêëĒēĔĕĖėĘęĚěȄȅȆȇȨȩ',
        ff: 'ﬀ', ffi: 'ﬃ', ffl: 'ﬄ', fi: 'ﬁ', fl: 'ﬂ', g: 'ĜĝĞğĠġĢģǦǧǴǵ', h: 'ĤĥȞȟ', i: 'ÌÍÎÏìíîïĨĩĪīĬĭĮįİǏǐȈȉȊȋ', ij: 'Ĳĳ', j: 'Ĵĵǰ',
        k: 'ĶķǨǩ\u212a', l: 'ĹĺĻļĽľŁł', 'l ': 'Ŀŀ', lj: 'Ǉǈǉ', n: 'ÑñŃńŅņŇňǸǹ', nj: 'Ǌǋǌ',
        o: 'ºÒÓÔÕÖØòóôõöøŌōŎŏŐőƠơǑǒǪǫǬǭǾǿȌȍȎȏȪȫȬȭȮȯȰȱ', oe: 'Œœ', r: 'ŔŕŖŗŘřȐȑȒȓ', s: 'ŚśŜŝŞşŠšſȘș', ss: 'ß', st: 'ﬅﬆ', t: 'ŢţŤťȚț',
        th: 'Þþ', u: 'ÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲųƯưǓǔǕǖǗǘǙǚǛǜȔȕȖȗ', w: 'Ŵŵ', y: 'ÝýÿŶŷŸȲȳ', z: 'ŹźŻżŽž',
        ' n': 'ŉ', '1': '¹', '2': '²', '3': '³', '1 2': '½', '1 4': '¼', '3 4': '¾' }));
    function unfold(ch) {
        var c = ch.charCodeAt(0);
        if (c >= 0xff10 && c <= 0xff19) return String.fromCharCode(c - 0xfee0);         // fullwidth digits
        if (c >= 0xff21 && c <= 0xff3a) return String.fromCharCode(c - 0xfec0);         // fullwidth A-Z, as a-z
        if (c >= 0xff41 && c <= 0xff5a) return String.fromCharCode(c - 0xfee0);         // fullwidth a-z
        if (c >= 0x2160 && c <= 0x217f) return ROMAN[c & 15];                            // Roman numerals, upper and lower case
        if (c >= 0x2460 && c <= 0x2473) return String(c - 0x245f);                       // circled 1-20
        if (c >= 0x24b6 && c <= 0x24e9) return String.fromCharCode(97 + (c - 0x24b6) % 26); // circled A-Z, a-z
        return LATIN[ch] || ch;
    }
    // Steps 3.1 and 3.2: up to three leading tags, then trailing tags, the last one first, while one ends the name.
    function ends(s) {
        var i, stripped;
        for (i = 0; i < 3; i++) { stripped = s.replace(LEADING, ''); if (stripped === s) break; s = stripped; }
        for (;;) { stripped = s.replace(TRAILING, ''); if (stripped === s) break; s = stripped; }
        return s;
    }
    function normalizeTitle(name, whole) {
        var s = trimmed(name), i, words, out = [];
        if (/[\[{(]/.test(s)) s = s.replace(BRACKETS, ' ');
        if (!whole && /[|:-]|–/.test(s)) s = ends(s);
        if (s.indexOf('|') >= 0) s = s.replace(PIPES, ' ');
        if (!whole && /[|:-]|–/.test(s)) s = ends(s);
        s = s.toLowerCase();
        if (s.indexOf('&') >= 0) s = s.replace(/&/g, ' and ');
        if (/['`´’]/.test(s)) s = s.replace(/['`´’]/g, '');
        if (/[^\x00-\x7f]/.test(s)) {
            s = s.normalize ? s.normalize('NFKD') : s.replace(UNFOLDED, unfold);
            s = s.replace(/[\u0300-\u036f]/g, '').replace(/[æœøßđłðþ]/g, function (ch) { return FOLD[ch]; });
        }
        words = s.split(/[^a-z0-9]+/);
        for (i = 0; i < words.length; i++) if (words[i] && !QUALITY[words[i]]) out.push(words[i]);
        if (out.length > 1 && out[0] === 'the') out.shift();
        return out.join(' ');
    }
    // The release year of a catalogue title: the provider's year fields, else the first year in brackets, "(2021)",
    // "[2021]" or the mixed "(2021]" (YEAR_BRACKETS), else the year among the trailing tags of step 3.2 nearest the
    // end (YEAR_END: "Heat - 1995 - 4K", "2012 | 1999 | EN" gives 1999). "Blade Runner 2049" has none. 0 when none.
    function titleYear(item) {
        var name = trimmed(item && item.name), match = D.providerYear(item || {});
        if (match) return Number(match);
        match = /[(\[]/.test(name) ? YEAR_BRACKETS.exec(name) : null;
        if (match) return Number(match[1]);
        match = /[|-]|–/.test(name) ? YEAR_END.exec(name) : null;
        return match ? Number(match[2]) : 0;
    }

    // ---------------------------------------------------------------- the USA filter
    // The category filter (docs/browse.md): a name is foreign when any of the four patterns matches, on the name with
    // the Unicode spaces replaced. 1: a country or language code in upper case as a whole word; 2: IN or IT in upper
    // case, only as a tag ("MOVIES IN 4K" is English); 3: a code in any ASCII letter case written as a tag ("Fr |
    // Films", "[ru] Kino"); 4: a country or language written out, in any ASCII letter case. No lookbehind: older
    // Samsung and LG browsers reject it.
    var CODES = 'FR|DE|ES|LAT|MX|BR|PT|TR|AR|PK|NL|PL|RO|RU|UK|CA|AF';
    var WORDS = 'french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espa(n|ñ|Ñ)ol|spain|castellano|latino|latina|latam|' +
        'mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arab|arabic|india|indian|hindi|bollywood|tamil|telugu|' +
        'malayalam|kannada|bengali|punjabi|pakistan|pakistani|urdu|dutch|netherlands|polish|poland|polska|romanian|romania|russian|russia|' +
        'british|canada|canadian|quebec|korean|japanese|chinese|filipino|vietnamese|thai|persian|farsi|greek|albanian|kurdish';
    var FOREIGN = [
        rx('(^|[^A-Za-z0-9])(' + CODES + ')([^A-Za-z0-9]|$)'),
        rx('(^|[^A-Za-z0-9])(IN|IT)\\s*([|:\\[\\]()/-]|–|$)'),
        rx('^[^A-Za-z0-9]*(' + CODES + ')\\s*([|:\\])/-]|–)|\\|\\s*(' + CODES + ')\\s*\\||\\[\\s*(' + CODES + ')\\s*\\]|\\(\\s*(' + CODES + ')\\s*\\)', 'i'),
        rx('(^|[^A-Za-z])(' + WORDS + ')([^A-Za-z]|$)', 'i')
    ];
    function isForeignCategory(name) { name = spaces(name); return !!name && (FOREIGN[0].test(name) || FOREIGN[1].test(name) || FOREIGN[2].test(name) || FOREIGN[3].test(name)); }
    function categoryServices(name) { var upper = text(name).toUpperCase(); return SERVICES.filter(function (service) { return SERVICE_WORDS[service.key].test(upper); }).map(function (service) { return service.key; }); }
    // Origin countries (docs/browse.md): an entry is a country when, with the Unicode spaces replaced, it is two ASCII
    // letters with nothing but \s around them (COUNTRY); the country is those letters in ASCII upper case. Every other
    // entry is ignored ("USA", "U.S.", "uſ", a fullwidth "ＵＳ", a value that is not a string), so ["USA"] is unknown,
    // as [] is. COUNTRY is checked before upper-casing: "uſ".toUpperCase() is "US".
    var COUNTRY = rx('^\\s*([A-Za-z]{2})\\s*$');
    function originCountries(origin) {
        var out = [], i, match;
        if (!Array.isArray(origin)) return out;
        for (i = 0; i < origin.length; i++) {
            match = typeof origin[i] === 'string' ? COUNTRY.exec(spaces(origin[i])) : null;
            if (match) out.push(match[1].toUpperCase());
        }
        return out;
    }
    // USA only: a title shows when its category passes and, if it is matched to TMDB and its origin holds a country,
    // the countries include US. An origin without one is unknown: the category alone decides.
    function usaAllowed(categoryPasses, origin) {
        var countries;
        if (!categoryPasses) return false;
        countries = originCountries(origin);
        return !countries.length || countries.indexOf('US') >= 0;
    }
    // The category check alone, for one catalogue's categories: item => whether it passes. Ids missing from the
    // categories are left out; it passes when none is left or at least one of them is not foreign.
    function categoryCheck(categories) {
        var passes = map();
        (categories || []).forEach(function (cat) { if (cat) passes[cat.id] = !isForeignCategory(cat.name); });
        return function (item) {
            var ids = (item && item.categoryIds) || [], known = false, i;
            for (i = 0; i < ids.length; i++) { if (passes[ids[i]] === true) return true; if (passes[ids[i]] === false) known = true; }
            return !known;
        };
    }

    // ---------------------------------------------------------------- genres
    var GENRE_ALIASES = { 'sci-fi': 'science fiction', scifi: 'science fiction', 'sci fi': 'science fiction', 'science-fiction': 'science fiction', documentaries: 'documentary', docs: 'documentary', docu: 'documentary',
        comedies: 'comedy', dramas: 'drama', thrillers: 'thriller', westerns: 'western', animated: 'animation', anime: 'animation', cartoon: 'animation', cartoons: 'animation', children: 'kids', childrens: 'kids', kid: 'kids',
        romantic: 'romance', musical: 'music', musicals: 'music', suspense: 'thriller', horrors: 'horror', historical: 'history', crimes: 'crime', sport: 'sports', biographical: 'biography', biopic: 'biography' };
    var GENRE_NOISE = { movies: true, movie: true, films: true, film: true, series: true, shows: true, show: true, tv: true, vod: true, '4k': true, uhd: true, hd: true, fhd: true, en: true, us: true, usa: true, english: true, 'new': true, top: true, best: true, all: true, and: true };
    var COMMON_GENRES = { action: 'Action', adventure: 'Adventure', animation: 'Animation', biography: 'Biography', comedy: 'Comedy', crime: 'Crime', documentary: 'Documentary', drama: 'Drama', family: 'Family', fantasy: 'Fantasy', history: 'History',
        horror: 'Horror', music: 'Music', mystery: 'Mystery', news: 'News', politics: 'Politics', romance: 'Romance', 'science fiction': 'Science Fiction', soap: 'Soap', talk: 'Talk', thriller: 'Thriller', war: 'War', western: 'Western', kids: 'Kids', reality: 'Reality', sports: 'Sports' };
    function genreToken(value) { var t = text(value).toLowerCase().replace(/\s+/g, ' '); return GENRE_ALIASES[t] || t; }
    // Provider genre text ("Action, Drama") as tokens with their display names.
    function providerGenres(value) {
        var out = [];
        text(value).split(/[,\/|&;]+/).forEach(function (part) { var token = genreToken(part); if (token && !out.some(function (g) { return g.token === token; })) out.push({ token: token, name: text(part) }); });
        return out;
    }
    // A category named after genres ("EN | Action Movies", "Kids & Family"): each part must be a genre once
    // words such as Movies, EN or 4K are dropped, so "Comedy Central" or "Netflix" never count.
    function categoryGenreTokens(name) {
        var out = [];
        text(name).split(/[,\/|&;:()\[\]]+|\s+-\s+|–/).forEach(function (part) {
            var words = part.toLowerCase().split(/[^a-z0-9]+/).filter(function (word) { return word && !GENRE_NOISE[word]; }), token = genreToken(words.join(' '));
            if (token && out.indexOf(token) < 0) out.push(token);
        });
        return out;
    }
    // TMDB genres of one type: the Discover list and a lookup from a genre word ("Action", "Adventure" of
    // "Action & Adventure") to the TMDB id. With no TMDB genres the table is open: provider genres that are known
    // genre words are used ("N/A" or "Unknown" never become a Genre choice).
    function genreTable(rawGenres) {
        var list = [], lookup = map();
        (rawGenres || []).forEach(function (genre) {
            list.push({ key: genre.id, name: genre.name });
            lookup[genreToken(genre.name)] = genre.id;
            genre.name.split('&').forEach(function (part) { var token = genreToken(part); if (token && !lookup[token]) lookup[token] = genre.id; });
        });
        return { list: list, lookup: lookup, open: !list.length, names: map() };
    }
    function genreKeys(tokens, table, categoryOnly) {
        var keys = '|';
        tokens.forEach(function (genre) {
            var token = typeof genre === 'string' ? genre : genre.token, key = table.lookup[token];
            if (!key && table.open && COMMON_GENRES[token]) {
                key = token;
                if (!table.names[key]) table.names[key] = COMMON_GENRES[token];
            }
            if (key && keys.indexOf('|' + key + '|') < 0) keys += key + '|';
        });
        return keys === '|' ? '' : keys;
    }

    // ---------------------------------------------------------------- the catalog rows endpoint
    var ROWS_URL = 'https://lumanest.tv/api/catalog/rows?v=1', ROWS_KEY = 'tuner.tv.catalogrows.v1', ROWS_MAX_AGE = 43200000, ROWS_RETRY = 300000;
    function rowsItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var id = text(raw.id);
        if (!/^[0-9]+$/.test(id)) return null;
        return { id: id, title: text(raw.title), original_title: text(raw.original_title), year: Number(text(raw.year).substring(0, 4)) || 0,
            origin: originCountries(raw.origin),
            genres: Array.isArray(raw.genres) ? raw.genres.map(text).filter(function (g) { return /^[0-9]+$/.test(g); }) : [] };
    }
    function rowsList(value) { return Array.isArray(value) ? value.slice(0, 200).map(rowsItem).filter(Boolean) : []; }
    function rowsSection(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        var services = raw.services && typeof raw.services === 'object' ? raw.services : {}, out = { popular: rowsList(raw.popular), featured: rowsList(raw.featured), top_rated: rowsList(raw.top_rated), services: {} };
        SERVICES.forEach(function (service) { out.services[service.key] = rowsList(services[service.key]); });
        return out;
    }
    function rowsGenres(raw) { return Array.isArray(raw) ? raw.filter(function (g) { return g && typeof g === 'object' && /^[0-9]+$/.test(text(g.id)) && text(g.name); }).map(function (g) { return { id: text(g.id), name: text(g.name) }; }) : []; }
    // The body of GET /api/catalog/rows?v=1 (text or parsed), or null when it is not version 1. Missing lists are empty.
    function parseRows(input) {
        var data = input, genres;
        if (typeof input === 'string') { try { data = JSON.parse(input); } catch (_) { return null; } }
        if (!data || typeof data !== 'object' || Number(data.v) !== 1) return null;
        genres = data.genres && typeof data.genres === 'object' ? data.genres : {};
        return { v: 1, source: text(data.source) || 'none', generated: text(data.generated), movie: rowsSection(data.movie), tv: rowsSection(data.tv), genres: { movie: rowsGenres(genres.movie), tv: rowsGenres(genres.tv) } };
    }
    // Whether rows carry TMDB lists (source "none" and empty answers do not).
    function hasTmdb(rows) {
        if (!rows || rows.source === 'none') return false;
        return ['movie', 'tv'].some(function (kind) { var s = rows[kind]; return s.popular.length || s.featured.length || s.top_rated.length || SERVICES.some(function (service) { return s.services[service.key].length; }); });
    }
    // A saved copy is fresh for 12 hours; an older one is stale but still used until a request succeeds.
    function rowsFreshness(record, now) {
        if (!record || typeof record.saved !== 'number' || !record.rows) return 'none';
        var age = now - record.saved;
        return age >= 0 && age < ROWS_MAX_AGE ? 'fresh' : 'stale';
    }
    // options: storage (localStorage), XMLHttpRequest, now(), url, timeout. Only an HTTP 200 version 1 answer
    // (source "none" included) replaces the saved copy; errors, 503 and unreadable answers keep it.
    function createRowsClient(options) {
        options = options || {};
        var storage = options.storage || null, Xhr = options.XMLHttpRequest || null, now = options.now || function () { return Date.now(); },
            record = null, loaded = false, pending = false, lastTry = 0;
        function read() {
            if (loaded) return record;
            loaded = true;
            try { var raw = storage && JSON.parse(storage.getItem(ROWS_KEY)), rows = raw && parseRows(raw.rows); record = rows && typeof raw.saved === 'number' ? { saved: raw.saved, rows: rows } : null; } catch (_) { record = null; }
            return record;
        }
        function save(rows) { record = { saved: now(), rows: rows }; try { if (storage) storage.setItem(ROWS_KEY, JSON.stringify(record)); } catch (_) {} }
        return {
            peek: function () { var saved = read(); return saved ? saved.rows : null; },
            freshness: function () { return rowsFreshness(read(), now()); },
            // Requests new rows unless the saved copy is fresh, a request is running, or one failed in the last
            // five minutes (the server's Retry-After). onRows receives new rows only. Returns whether it asked.
            refresh: function (onRows) {
                var xhr;
                if (pending || !Xhr || rowsFreshness(read(), now()) === 'fresh' || (lastTry && now() - lastTry >= 0 && now() - lastTry < ROWS_RETRY)) return false;
                lastTry = now(); pending = true;
                function done(rows) { if (!pending) return; pending = false; if (rows) { lastTry = 0; save(rows); if (onRows) onRows(rows); } }
                try { xhr = new Xhr(); xhr.open('GET', options.url || ROWS_URL, true); xhr.timeout = options.timeout || 15000; } catch (_) { pending = false; return false; }
                xhr.onreadystatechange = function () { if (xhr.readyState === 4) done(xhr.status === 200 ? parseRows(xhr.responseText) : null); };
                xhr.onerror = xhr.ontimeout = xhr.onabort = function () { done(null); };
                try { xhr.send(); } catch (_) { done(null); }
                return true;
            }
        };
    }

    // ---------------------------------------------------------------- the index
    // kind: 'movies' or 'series'; items and categories as the app shows them (adult content already removed).
    // step(budget) prepares up to budget titles and returns true once all are done; index is then ready for matchIndex.
    function createIndexBuilder(kind, items, categories) {
        items = items || [];
        var cats = map(), index = { kind: kind, section: kind === 'series' ? 'tv' : 'movie', titles: [], byId: map(), cats: cats, catServices: map(), lists: map(), fixed: map(), rows: null, matched: 0, genres: [] }, at = 0, aliased = false;
        SERVICES.forEach(function (service) { index.catServices[service.key] = []; });
        (categories || []).forEach(function (cat) { cats[cat.id] = { ok: !isForeignCategory(cat.name), services: categoryServices(cat.name), genres: categoryGenreTokens(cat.name) }; });
        return { index: index, step: function (budget) {
            var end = Math.min(items.length, at + (budget > 0 ? budget : items.length)), item, entry, ids, info, i, j, ok, known, services, rating, added;
            for (; at < end; at++) {
                // The category filter: ids missing from the categories are left out; it passes when none is left or one passes.
                item = items[at]; ids = item.categoryIds || []; ok = false; known = false; services = [];
                for (i = 0; i < ids.length; i++) {
                    info = cats[ids[i]];
                    if (!info) continue;
                    known = true;
                    if (info.ok) ok = true;
                    for (j = 0; j < info.services.length; j++) if (services.indexOf(info.services[j]) < 0) services.push(info.services[j]);
                }
                if (!known) ok = true;
                rating = Number(item.rating) || 0;
                // Seconds, as Xtream gives them; a feed in milliseconds is brought to seconds.
                added = Number(item.added) || 0;
                if (added > 1e11) added = Math.floor(added / 1000);
                entry = { item: item, norm: normalizeTitle(item.name), year: titleYear(item), ok: ok, hint: text(item.tmdb), pg: item.genre ? providerGenres(item.genre) : null,
                    added: added, rating: rating > 10 ? rating / 10 : rating, tmdb: '', us: ok, g: '' };
                if (index.byId[item.id] === undefined) index.byId[item.id] = index.titles.length;
                for (j = 0; j < services.length; j++) index.catServices[services[j]].push(index.titles.length);
                index.titles.push(entry);
            }
            if (at < items.length) return false;
            // Uploads folded into a movie (foldMovies) still answer to their ids, unless another title has one.
            if (!aliased) {
                aliased = true;
                for (i = 0; i < index.titles.length; i++) {
                    ids = index.titles[i].item.aliases || [];
                    for (j = 0; j < ids.length; j++) if (index.byId[ids[j]] === undefined) index.byId[ids[j]] = i;
                }
            }
            return true;
        } };
    }
    function tmdbLookup(section) {
        var byId = map(), byTitle = map(), lists = [section.popular, section.featured, section.top_rated];
        SERVICES.forEach(function (service) { lists.push(section.services[service.key]); });
        lists.forEach(function (list) {
            list.forEach(function (raw) {
                if (byId[raw.id]) return;
                var entry = { id: raw.id, year: raw.year, origin: raw.origin, g: raw.genres.length ? '|' + raw.genres.join('|') + '|' : '' };
                byId[raw.id] = entry;
                [normalizeTitle(raw.title), normalizeTitle(raw.original_title)].forEach(function (key) { if (!key) return; var bucket = byTitle[key] || (byTitle[key] = []); if (bucket.indexOf(entry) < 0) bucket.push(entry); });
            });
        });
        return { byId: byId, byTitle: byTitle };
    }
    // 1. A provider TMDB id matches on the id alone. 2. Otherwise the normalized title must match and the years
    // may differ by 1 (an exact year wins). A title without a year matches only when one TMDB title has that name.
    // name: the provider's name, looked up again without its leading and trailing tags removed when the normalized
    // title finds nothing ("CSI: Miami" is tried as "miami", then as "csi miami").
    function matchTmdb(lookup, hint, norm, year, name) {
        var found, whole;
        if (hint) return lookup.byId[hint] || null;
        found = matchTitle(lookup, norm, year);
        if (!found && name && /[|:-]|–/.test(name)) { whole = normalizeTitle(name, true); if (whole !== norm) found = matchTitle(lookup, whole, year); }
        return found;
    }
    function matchTitle(lookup, key, year) {
        var candidates = key ? lookup.byTitle[key] : null, best = null, i, c;
        if (!candidates) return null;
        if (!year) return candidates.length === 1 ? candidates[0] : null;
        for (i = 0; i < candidates.length; i++) {
            c = candidates[i];
            if (c.year === year) return c;
            if (!best && c.year && Math.abs(c.year - year) <= 1) best = c;
        }
        return best;
    }
    // Links the titles to the rows (null: no TMDB data) and works out each title's USA flag and genres.
    // step(budget) matches up to budget titles into its own arrays and returns true when all are done; apply()
    // then writes them into the index in one quick pass, so a screen never sees a half-matched index.
    function createMatcher(index, rows) {
        var section = rows ? rows[index.section] : rowsSection(null), lookup = tmdbLookup(section), table = genreTable(rows ? rows.genres[index.section] : []),
            titles = index.titles, byTmdb = map(), catKeys = map(), used = map(), usUsed = map(), result = { tmdb: [], us: [], g: [] }, matched = 0, at = 0;
        Object.keys(index.cats).forEach(function (id) { catKeys[id] = genreKeys(index.cats[id].genres, table, true); });
        return {
            step: function (budget) {
                var end = Math.min(titles.length, at + (budget > 0 ? budget : titles.length)), entry, m, ids, g, i;
                for (; at < end; at++) {
                    entry = titles[at]; m = matchTmdb(lookup, entry.hint, entry.norm, entry.year, entry.item.name); ids = entry.item.categoryIds || []; g = '';
                    if (m) { matched++; g = m.g; (byTmdb[m.id] || (byTmdb[m.id] = [])).push(at); }
                    if (!g && entry.pg) g = genreKeys(entry.pg, table, false);
                    if (!g) for (i = 0; i < ids.length; i++) if (catKeys[ids[i]]) g += g ? catKeys[ids[i]].substring(1) : catKeys[ids[i]];
                    result.tmdb[at] = m ? m.id : '';
                    result.us[at] = m ? usaAllowed(entry.ok, m.origin) : entry.ok;
                    result.g[at] = g;
                    if (g) { used[g] = true; if (result.us[at]) usUsed[g] = true; }
                }
                return at >= titles.length;
            },
            apply: function () {
                var keys = map(), usKeys = map(), all, i;
                function mark(found, target) { Object.keys(found).forEach(function (g) { g.split('|').forEach(function (key) { if (key) target[key] = true; }); }); }
                for (i = 0; i < titles.length; i++) { titles[i].tmdb = result.tmdb[i] || ''; titles[i].us = result.us[i] !== undefined ? result.us[i] : titles[i].ok; titles[i].g = result.g[i] || ''; }
                mark(used, keys); mark(usUsed, usKeys);
                // Copies of one TMDB title, best first: those that pass USA only, then the newest, then catalogue order.
                Object.keys(byTmdb).forEach(function (id) { var group = byTmdb[id]; if (group.length > 1) group.sort(function (a, b) { return (titles[b].us ? 1 : 0) - (titles[a].us ? 1 : 0) || titles[b].added - titles[a].added || a - b; }); });
                index.rows = section; index.byTmdb = byTmdb; index.matched = matched; index.lists = map();
                // The Genre choices: genres some title has (usGenres: some title USA only shows).
                all = table.open ? Object.keys(table.names).map(function (key) { return { key: key, name: table.names[key] }; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }) : table.list;
                index.genres = all.filter(function (genre) { return keys[genre.key]; });
                index.usGenres = all.filter(function (genre) { return usKeys[genre.key]; });
                return index;
            }
        };
    }
    function matchIndex(index, rows) { var matcher = createMatcher(index, rows || null); matcher.step(0); return matcher.apply(); }
    function buildIndex(kind, items, categories, rows) { var builder = createIndexBuilder(kind, items, categories); builder.step(0); return matchIndex(builder.index, rows || null); }

    // ---------------------------------------------------------------- lists
    function tmdbOrder(list, byTmdb) { var out = []; list.forEach(function (raw) { var group = byTmdb[raw.id]; if (group) out = out.concat(group); }); return out; }
    function merged(first, second) { var seen = map(), out = []; first.concat(second).forEach(function (p) { if (!seen[p]) { seen[p] = true; out.push(p); } }); return out; }
    // Numbers sort natively (no comparator calls; about twice as fast on 30,000 titles) as one typed array of
    // value * 2^20 + reversed position, so equal values keep catalogue order. Values are capped at 2^33 - 1 so a
    // key never passes 2^53, where positions would be lost; past 2^20 titles a comparator sort is used.
    var POSITION = 1048576, MAX_VALUE = 8589934591;
    function sortedBy(index, positions, field) {
        var titles = index.titles, scale = field === 'rating' ? 100 : 1, keys = [], out = [], i, value, sorted;
        if (titles.length > POSITION) return positions.filter(function (p) { return titles[p][field] > 0; }).sort(function (a, b) { return titles[b][field] - titles[a][field] || a - b; });
        for (i = 0; i < positions.length; i++) { value = titles[positions[i]][field]; if (value > 0) keys.push(Math.min(Math.round(value * scale), MAX_VALUE) * POSITION + (POSITION - 1 - positions[i])); }
        sorted = typeof root.Float64Array === 'function' && root.Float64Array.prototype.sort ? new root.Float64Array(keys).sort() : keys.sort(function (a, b) { return a - b; });
        for (i = sorted.length - 1; i >= 0; i--) out.push(POSITION - 1 - sorted[i] % POSITION);
        return out;
    }
    function alphabetical(index) {
        var titles = index.titles, keys = [], i;
        for (i = 0; i < titles.length; i++) keys.push(titles[i].norm || titles[i].item.name.toLowerCase());
        return allPositions(index).sort(function (a, b) { return keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b; });
    }
    function allPositions(index) { var out = [], i; for (i = 0; i < index.titles.length; i++) out.push(i); return out; }
    // Title positions for one list key, best first: popular, featured, rated, recent, az or a service key.
    // Top rated and the services list TMDB's titles first, then the provider's (by rating, or newest first).
    function listOf(index, key) {
        var titles = index.titles, fixed = index.fixed, out = index.lists[key];
        if (out) return out;
        if (key === 'recent') out = fixed.recent || (fixed.recent = sortedBy(index, allPositions(index), 'added'));
        else if (key === 'az') out = fixed.az || (fixed.az = alphabetical(index));
        else if (key === 'popular' || key === 'featured') out = tmdbOrder(index.rows[key], index.byTmdb);
        else if (key === 'rated') out = merged(tmdbOrder(index.rows.top_rated, index.byTmdb), fixed.rated || (fixed.rated = sortedBy(index, allPositions(index), 'rating')));
        else if (index.catServices[key]) out = merged(tmdbOrder(index.rows.services[key], index.byTmdb), fixed[key] || (fixed[key] = sortedBy(index, index.catServices[key], 'added').concat(index.catServices[key].filter(function (p) { return !titles[p].added; }))));
        else out = [];
        index.lists[key] = out;
        return out;
    }
    // opts: usOnly, genre ('' for all).
    function visible(entry, opts) { return (!opts.usOnly || entry.us) && (!opts.genre || entry.g.indexOf('|' + opts.genre + '|') >= 0); }
    // Up to limit visible titles of a list from cursor, one per TMDB title (opts.seen is shared by one row or grid).
    // A TMDB title stands where its first visible copy stands and shows its best visible copy (index.byTmdb order).
    // Returns { picked: [position], cursor, done }.
    function pick(index, key, opts, cursor, limit) {
        var list = listOf(index, key), picked = [], i = cursor || 0, seen = opts.seen || (opts.seen = map()), entry, id, group, best, j;
        while (i < list.length && picked.length < limit) {
            entry = index.titles[list[i]];
            if (visible(entry, opts)) {
                id = entry.tmdb ? 't' + entry.tmdb : 'i' + entry.item.id;
                if (!seen[id]) {
                    seen[id] = true; best = list[i]; group = entry.tmdb && index.byTmdb ? index.byTmdb[entry.tmdb] : null;
                    for (j = 0; group && j < group.length; j++) if (visible(index.titles[group[j]], opts)) { best = group[j]; break; }
                    picked.push(best);
                }
            }
            i++;
        }
        return { picked: picked, cursor: i, done: i >= list.length };
    }
    function homeRowSpecs(withTmdb) {
        var specs = [];
        function pair(list, title) { specs.push({ kind: 'movies', list: list, title: title + ' – Movies' }); specs.push({ kind: 'series', list: list, title: title + ' – Series' }); }
        if (withTmdb) { pair('popular', 'Popular'); pair('featured', 'Featured'); }
        SERVICES.forEach(function (service) { pair(service.key, service.name); });
        pair('recent', 'Recently added');
        pair('rated', 'Top rated');
        return specs;
    }
    function discoverLists(withTmdb) {
        var lists = withTmdb ? [{ key: 'popular', name: 'Popular' }, { key: 'featured', name: 'Featured' }] : [];
        lists.push({ key: 'rated', name: 'Top rated' }, { key: 'recent', name: 'Recently added' }, { key: 'az', name: 'A–Z' });
        SERVICES.forEach(function (service) { lists.push({ key: service.key, name: service.name }); });
        return lists;
    }
    // Home rows after Continue watching: each with at least 5 visible titles, 20 at most.
    // indexes: { movies, series }. Returns [{ id, title, kind, list, positions }].
    function homeRows(indexes, opts) {
        var rows = [];
        homeRowSpecs(!!opts.withTmdb).forEach(function (spec) {
            var index = indexes[spec.kind], result;
            if (!index) return;
            result = pick(index, spec.list, { usOnly: !!opts.usOnly, genre: '', seen: map() }, 0, 20);
            if (result.picked.length >= 5) rows.push({ id: spec.kind + ':' + spec.list, title: spec.title, kind: spec.kind, list: spec.list, positions: result.picked });
        });
        return rows;
    }
    // Continue watching, newest first: movies in progress and, per series, the episode in progress or the next
    // one after a finished episode. find(kind, id) returns the catalogue item or null (titles gone are dropped).
    function continueWatching(recents, upNext, find) {
        var events = [], out = [], series = map(), movies = map();
        (recents || []).forEach(function (r, i) { if (r && r.id) events.push({ r: r, at: Number(r.updated) || 0, i: i, next: false }); });
        (upNext || []).forEach(function (r, i) { if (r && r.seriesId) events.push({ r: r, at: Number(r.updated) || 0, i: 1000 + i, next: true }); });
        events.sort(function (a, b) { return b.at - a.at || a.i - b.i; });
        events.forEach(function (event) {
            var r = event.r, item, fraction = r.duration > 0 ? Math.max(0, Math.min(1, r.position / r.duration)) : 0;
            if (event.next || r.seriesId) {
                if (series[r.seriesId]) return;
                series[r.seriesId] = true;
                item = find('series', r.seriesId);
                if (item) out.push(event.next ? { kind: 'series', item: item, next: { season: Number(r.season) || 0, episode: Number(r.episode) || 0 } } : { kind: 'series', item: item, progress: fraction, resume: r.id });
            } else if (!/^(e|me):/.test(r.id) && !movies[r.id]) {
                movies[r.id] = true;
                item = find('movies', r.id);
                if (item) out.push({ kind: 'movies', item: item, progress: fraction });
            }
        });
        return out;
    }
    // The episode a series opens on: the one being watched (resume: episode id) or the one after the finished
    // one (next: {season, episode}). seasons: [{number, episodes: [{id, episode}]}]. Returns {season, episode} indexes or null.
    function episodeToOpen(seasons, resume, next) {
        var s, e, list;
        for (s = 0; resume && s < seasons.length; s++) for (e = 0; e < seasons[s].episodes.length; e++) if (seasons[s].episodes[e].id === resume) return { season: s, episode: e };
        if (!next) return null;
        for (s = 0; s < seasons.length; s++) {
            list = seasons[s].episodes;
            if (seasons[s].number === next.season) {
                for (e = 0; e < list.length; e++) if (list[e].episode > next.episode) return { season: s, episode: e };
            } else if (seasons[s].number > next.season && list.length) return { season: s, episode: 0 };
        }
        return null;
    }

    D.browse = { SERVICES: SERVICES, ROWS_URL: ROWS_URL, ROWS_KEY: ROWS_KEY, normalizeTitle: normalizeTitle, titleYear: titleYear, isForeignCategory: isForeignCategory, originCountries: originCountries, categoryCheck: categoryCheck,
        categoryServices: categoryServices, usaAllowed: usaAllowed, parseRows: parseRows, hasTmdb: hasTmdb, rowsFreshness: rowsFreshness, createRowsClient: createRowsClient,
        createIndexBuilder: createIndexBuilder, createMatcher: createMatcher, matchIndex: matchIndex, buildIndex: buildIndex, matchTmdb: matchTmdb, listOf: listOf, visible: visible, pick: pick,
        homeRowSpecs: homeRowSpecs, discoverLists: discoverLists, homeRows: homeRows, continueWatching: continueWatching, episodeToOpen: episodeToOpen };
}(typeof window !== 'undefined' ? window : this));
