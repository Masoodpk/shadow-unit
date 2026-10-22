/**
 * White silhouette icons for the HUD (weapon in hand, grenades), drawn as SVG so they stay
 * crisp at any resolution. Side views, muzzle to the left, like a shooter's loadout HUD.
 */
const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">${body}</svg>`;

const RIFLE = svg(
  200,
  64,
  // suppressor + barrel, rail handguard, receiver with optic, mag, grip, collapsible stock
  `<rect x="2" y="21" width="34" height="9" rx="2"/><rect x="34" y="23" width="14" height="5"/>` +
    `<path d="M48 17h56v15H48z"/><path d="M52 14h50v4H52z"/>` +
    `<path d="M104 15h44l4 4v14h-48z"/><path d="M112 6h22l3 4v5h-28v-5z"/><rect x="118" y="2" width="10" height="5" rx="1"/>` +
    `<path d="M112 33h14l-3 22h-11z"/><path d="M134 33h11l5 16-4 3-8-2z"/>` +
    `<path d="M152 17h10v8h-10z"/><path d="M162 14h26l6 3v18l-6 3h-8l-4-10h-14z"/>`,
);
const AK = svg(
  200,
  64,
  `<rect x="2" y="21" width="40" height="5"/><path d="M40 19h48v10H40z"/><path d="M60 15h28v4H60z"/>` +
    `<path d="M88 16h56l3 3v13H88z"/><path d="M100 32c2 10 6 18 14 24l10-4c-6-6-9-12-10-20z"/>` +
    `<path d="M132 32h10l4 16-4 3-7-2z"/><path d="M147 18h8l40 4 3 12-40 2-11-4z"/>`,
);
const CARBINE = svg(
  200,
  64,
  `<rect x="18" y="22" width="24" height="7"/><path d="M42 17h50v15H42z"/><path d="M46 13h44v4H46z"/>` +
    `<path d="M92 15h42l4 4v14H92z"/><path d="M98 7h22l3 4v4H98z"/><path d="M98 33h12l-2 18h-10z"/><path d="M120 33h10l5 15-4 3-7-2z"/>` +
    `<path d="M138 18h8v7h-8z"/><path d="M146 15h28l5 3v14l-5 3h-10l-6-8h-12z"/>`,
);
const SNIPER = svg(
  220,
  64,
  `<rect x="2" y="22" width="78" height="11" rx="5"/><path d="M80 19h44v15H80z"/>` +
    `<path d="M96 6h40l4 4v6H92v-6z"/><rect x="86" y="9" width="10" height="8" rx="2"/><rect x="136" y="9" width="8" height="8" rx="2"/>` +
    `<path d="M124 18h34v16h-34z"/><path d="M130 34h12l-1 14h-10z"/><path d="M150 34h10l4 14-4 3-6-2z"/>` +
    `<path d="M158 18h50l8 4v14l-8 4h-22l-8-10h-20z"/>`,
);
const PISTOL = svg(
  120,
  64,
  `<path d="M8 14h76l6 4v12H8z"/><path d="M48 30h36l2 4-6 26H64l2-18-18-2z"/><path d="M40 30h8v8h-8z"/>`,
);
const SMG = svg(
  190,
  64,
  `<rect x="2" y="21" width="30" height="10" rx="3"/><path d="M32 16h40v18H32z"/><path d="M72 12h52l6 6v26l-10 4H72z"/>` +
    `<path d="M82 6h30v6H82z"/><path d="M84 44h12l-2 16h-10z"/><path d="M110 44h11l5 12-4 4-8-2z"/>` +
    `<path d="M130 18h8v6h-8z"/><path d="M138 14h40l6 4v14l-6 4h-10l-6-8h-24z"/>`,
);
const KNIFE = svg(
  170,
  64,
  `<path d="M4 34c30-14 62-20 96-20v18c-36 2-66 4-96 2z"/><path d="M100 10h8v26h-8z"/><path d="M108 16h52l6 4v6l-6 4h-52z"/>`,
);
const LAUNCHER = svg(
  220,
  64,
  `<rect x="2" y="18" width="200" height="18" rx="4"/><rect x="0" y="16" width="10" height="22" rx="2"/><rect x="196" y="15" width="18" height="24" rx="3"/>` +
    `<path d="M70 6h10v12H70z"/><path d="M150 6h10v12h-10z"/><path d="M118 36h12l-2 18h-10z"/><path d="M96 36h10v10H96z"/>`,
);
const ROCKET_TUBE = svg(
  220,
  64,
  `<rect x="2" y="16" width="196" height="22" rx="6"/><rect x="0" y="13" width="14" height="28" rx="4"/><rect x="190" y="12" width="26" height="30" rx="5"/>` +
    `<rect x="60" y="14" width="10" height="26" fill-opacity="0.35"/><path d="M98 38h12l-2 18h-10z"/><path d="M128 38h12l-2 14h-10z"/><path d="M104 2h26l4 4v10h-34V6z"/>`,
);

export const WEAPON_ICONS: Record<string, string> = {
  rifle: RIFLE,
  ak47: AK,
  m5: CARBINE,
  vssk: SNIPER,
  glock: PISTOL,
  vector: SMG,
  knife: KNIFE,
  m72: LAUNCHER,
  dzj08: ROCKET_TUBE,
  flashbang: svg(64, 64, `<rect x="22" y="12" width="20" height="44" rx="4"/><rect x="26" y="4" width="12" height="9" rx="2"/>`),
};

export const GRENADE_ICONS: Record<string, string> = {
  frag: svg(48, 56, `<ellipse cx="22" cy="34" rx="15" ry="18"/><rect x="16" y="10" width="14" height="8" rx="2"/><path d="M30 12h8l4 14-4 2z"/><circle cx="13" cy="10" r="5" fill="none" stroke="currentColor" stroke-width="2.5"/>`),
  flame: svg(48, 56, `<rect x="12" y="16" width="22" height="36" rx="5"/><rect x="16" y="9" width="14" height="8" rx="2"/><path d="M30 10h8l3 12-4 2z"/><path d="M23 26c5 6 6 10 2 15-3-3-6-7-2-15z" fill-opacity="0.35"/>`),
  plasma: svg(48, 56, `<circle cx="23" cy="32" r="16"/><circle cx="23" cy="32" r="7" fill-opacity="0.35"/><rect x="18" y="10" width="10" height="7" rx="2"/>`),
  flash: svg(48, 56, `<rect x="14" y="14" width="18" height="38" rx="4"/><rect x="17" y="7" width="12" height="8" rx="2"/><path d="M29 8h8l3 12-4 2z"/><rect x="14" y="24" width="18" height="3" fill-opacity="0.35"/><rect x="14" y="38" width="18" height="3" fill-opacity="0.35"/>`),
};
