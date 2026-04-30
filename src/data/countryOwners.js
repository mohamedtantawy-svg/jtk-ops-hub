// ── Country → Owner email mapping ─────────────────────────────────────────
// Original source: Deel admin 'Countries by Person Role' export (2026-04-17).
// Live source of truth (2026-04-30): the team_member_countries table,
// hydrated into these maps via hydrateOwnerCountries() — server-side from
// roster-server.js, client-side from useTeamCountryOwnership(). The static
// values below remain as a cold-boot baseline so a server starting before
// the first DB query (or a client running without a network round-trip)
// still has a reasonable scoping map; once hydration runs it fully
// replaces this baseline.

let _countryOwners = {
  'AD': ['julia.mateos@deel.com'],
  'AE': ['ewa.kotowska@deel.com'],
  'AL': ['anna.esipova@deel.com'],
  'AM': ['yonit.menashe@deel.com'],
  'AR': ['rosa.meza@deel.com'],
  'AT': ['pilvi.pirhonen@deel.com', 'fernanda.scafini@deel.com'],
  'AU': ['ziyaad.mahomed@deel.com'],
  'AZ': ['oxana.serdyuk@deel.com'],
  'BA': ['anna.esipova@deel.com'],
  'BD': ['sonal.singh@deel.com'],
  'BE': ['kaat.meyns@deel.com'],
  'BG': ['oxana.serdyuk@deel.com'],
  'BH': ['ewa.kotowska@deel.com'],
  'BO': ['andre.maia@deel.com'],
  'BR': ['andre.maia@deel.com', 'amanda.passos@deel.com'],
  'BY': ['oxana.serdyuk@deel.com'],
  'BZ': ['luisinadecicco@deel.com'],
  'CA': ['joaquin.celhay@deel.com', 'stefania.marini@deel.com', 'luisinadecicco@deel.com', 'william.gaspar@deel.com'],
  'CH': ['francesca.desantis@deel.com'],
  'CI': ['georgina.cotton@deel.com'],
  'CL': ['astrid.martinez@deel.com'],
  'CM': ['raquel.sanchez@deel.com'],
  'CN': ['jia.zhao@deel.com', 'xiaofeng.yao@deel.com'],
  'CO': ['amanda.passos@deel.com', 'laura.pai@deel.com'],
  'CR': ['astrid.martinez@deel.com'],
  'CY': ['alexandra.apsychou@deel.com'],
  'CZ': ['kinga.bobko@deel.com'],
  'DE': ['trish.lee@deel.com', 'belen.silvestri@deel.com', 'jessica.czech@deel.com'],
  'DK': ['pilvi.pirhonen@deel.com'],
  'DO': ['andre.maia@deel.com'],
  'EC': ['astrid.martinez@deel.com'],
  'EE': ['lorraine.muketo@deel.com'],
  'EG': ['raquel.sanchez@deel.com'],
  'ES': ['elena.delgado@deel.com', 'anne.sanmartin@deel.com', 'pilar.dominguez@deel.com', 'julia.mateos@deel.com'],
  'ET': ['raquel.sanchez@deel.com'],
  'FI': ['pilvi.pirhonen@deel.com'],
  'FR': ['hala.elkhalfaoui@deel.com', 'aline.galletyer@deel.com', 'emilie.thiery@deel.com'],
  'GB': ['georgina.cotton@deel.com', 'mauro.coronel@deel.com', 'raquel.sanchez@deel.com'],
  'GE': ['yonit.menashe@deel.com'],
  'GH': ['raquel.sanchez@deel.com'],
  'GR': ['alexandra.apsychou@deel.com'],
  'GT': ['victor.cortes@deel.com'],
  'HK': ['xiaofeng.yao@deel.com'],
  'HN': ['victor.cortes@deel.com'],
  'HR': ['anna.esipova@deel.com'],
  'HU': ['anna.esipova@deel.com'],
  'ID': ['navin.segar@deel.com'],
  'IE': ['insiya.jasdanwalla@deel.com'],
  'IL': ['yonit.menashe@deel.com'],
  'IN': ['ayushi.jain@deel.com', 'sonal.singh@deel.com', 'sayli.patil@deel.com'],
  'IS': ['imran.lantra@deel.com'],
  'IT': ['martina.guccione@deel.com', 'federica.deluca@deel.com'],
  'JE': ['georgina.cotton@deel.com'],
  'JM': ['laura.pai@deel.com'],
  'JO': ['raquel.sanchez@deel.com'],
  'JP': ['asako.abe@deel.com', 'jia.zhao@deel.com'],
  'KE': ['abe.elkholi@deel.com'],
  'KG': ['oxana.serdyuk@deel.com'],
  'KH': ['celine.taruc@deel.com'],
  'KR': ['lehi.salonga@deel.com'],
  'KZ': ['oxana.serdyuk@deel.com'],
  'LK': ['sayli.patil@deel.com'],
  'LT': ['kinga.bobko@deel.com'],
  'LU': ['aline.galletyer@deel.com', 'lyall.genade@deel.com'],
  'LV': ['lorraine.muketo@deel.com'],
  'MA': ['abe.elkholi@deel.com'],
  'MC': ['aline.galletyer@deel.com'],
  'MD': ['oxana.serdyuk@deel.com'],
  'ME': ['anna.esipova@deel.com'],
  'MG': ['raquel.sanchez@deel.com'],
  'MK': ['anna.esipova@deel.com'],
  'MN': ['lehi.salonga@deel.com'],
  'MO': ['xiaofeng.yao@deel.com'],
  'MT': ['susana.santos@deel.com'],
  'MU': ['georgina.cotton@deel.com'],
  'MX': ['laura.pai@deel.com', 'victor.cortes@deel.com'],
  'MY': ['navin.segar@deel.com'],
  'MZ': ['raquel.sanchez@deel.com'],
  'NA': ['raquel.sanchez@deel.com'],
  'NG': ['abe.elkholi@deel.com'],
  'NI': ['amanda.passos@deel.com'],
  'NL': ['kaat.meyns@deel.com', 'klaske.rinia@deel.com', 'lyall.genade@deel.com'],
  'NO': ['fernanda.scafini@deel.com'],
  'NP': ['ayushi.jain@deel.com'],
  'NZ': ['ziyaad.mahomed@deel.com'],
  'OM': ['ewa.kotowska@deel.com'],
  'PA': ['laura.pai@deel.com'],
  'PE': ['andre.maia@deel.com'],
  'PH': ['erwin.javier@deel.com', 'lehi.salonga@deel.com', 'celine.taruc@deel.com'],
  'PK': ['chaitanya.uppalapati@deel.com'],
  'PL': ['laura.llopislopez@deel.com', 'kinga.bobko@deel.com'],
  'PR': ['jacqueline.ciboso@deel.com', 'jessica.fowler@deel.com', 'alaetra.wilkerson@deel.com', 'helen.abraha@deel.com', 'natalia.mesa@deel.com', 'stormie.skutnik@deel.com'],
  'PT': ['alexandra.apsychou@deel.com', 'carolina.ferreira@deel.com'],
  'PY': ['andre.maia@deel.com'],
  'QA': ['ewa.kotowska@deel.com'],
  'RE': ['emilie.thiery@deel.com', 'aline.galletyer@deel.com'],
  'RO': ['lorraine.muketo@deel.com'],
  'RS': ['anna.esipova@deel.com'],
  'RU': ['oxana.serdyuk@deel.com'],
  'RW': ['raquel.sanchez@deel.com'],
  'SA': ['ewa.kotowska@deel.com'],
  'SE': ['fernanda.scafini@deel.com'],
  'SG': ['navin.segar@deel.com'],
  'SI': ['anna.esipova@deel.com'],
  'SK': ['anna.esipova@deel.com'],
  'SN': ['georgina.cotton@deel.com'],
  'SR': ['laura.pai@deel.com'],
  'SV': ['victor.cortes@deel.com'],
  'TH': ['erwin.javier@deel.com'],
  'TN': ['abe.elkholi@deel.com'],
  'TR': ['yonit.menashe@deel.com'],
  'TT': ['amanda.passos@deel.com'],
  'TW': ['jia.zhao@deel.com'],
  'UA': ['anna.esipova@deel.com'],
  'UG': ['georgina.cotton@deel.com'],
  'US': ['helen.abraha@deel.com', 'stormie.skutnik@deel.com', 'jacqueline.ciboso@deel.com', 'natalia.mesa@deel.com', 'alaetra.wilkerson@deel.com', 'jessica.fowler@deel.com'],
  'UY': ['victor.cortes@deel.com'],
  'UZ': ['oxana.serdyuk@deel.com'],
  'VN': ['celine.taruc@deel.com'],
  'XK': ['anna.esipova@deel.com'],
  'ZA': ['abe.elkholi@deel.com'],
  'ZM': ['raquel.sanchez@deel.com'],
};

// ── Public bindings ────────────────────────────────────────────────────────
// Live bindings (let exports are tracked across modules per the ES spec, so
// hydrateOwnerCountries() updates here are visible to every importing file
// without a re-import). Consumers read these as if they were const maps.
export let COUNTRY_OWNERS = _countryOwners;
export let OWNER_COUNTRIES = _buildReverseMap(_countryOwners);

function _buildReverseMap(owners) {
  const map = new Map();
  for (const [cc, emails] of Object.entries(owners || {})) {
    for (const email of emails) {
      const e = (email || '').toLowerCase();
      if (!e) continue;
      if (!map.has(e)) map.set(e, new Set());
      map.get(e).add(cc.toUpperCase());
    }
  }
  return map;
}

/**
 * Replace the live country-ownership maps with rows from the DB.
 *
 * @param {Array<{email:string, country_code:string}>} rows — junction-table
 *        rows from team_member_countries. Whitespace-tolerant; rows with
 *        missing email or country are skipped.
 *
 * Both COUNTRY_OWNERS (cc → emails[]) and OWNER_COUNTRIES (email → Set<cc>)
 * are rebuilt from scratch so a row that disappears from the DB also
 * disappears from the in-memory map. No-op if `rows` is missing.
 */
export function hydrateOwnerCountries(rows) {
  if (!Array.isArray(rows)) return;
  const owners = {};
  for (const r of rows) {
    const email = (r?.email || '').toLowerCase();
    const cc = (r?.country_code || r?.countryCode || '').toUpperCase();
    if (!email || !cc) continue;
    if (!owners[cc]) owners[cc] = [];
    if (!owners[cc].includes(email)) owners[cc].push(email);
  }
  COUNTRY_OWNERS = owners;
  OWNER_COUNTRIES = _buildReverseMap(owners);
}

// ── Helper: get country codes owned by a given email ──
export function getOwnedCountries(email) {
  if (!email) return new Set();
  return OWNER_COUNTRIES.get(email.toLowerCase()) || new Set();
}

// ── Helper: check if a user owns a specific country ──
export function ownsCountry(email, countryCode) {
  if (!email || !countryCode) return false;
  const owned = OWNER_COUNTRIES.get(email.toLowerCase());
  return owned ? owned.has(countryCode.toUpperCase()) : false;
}
