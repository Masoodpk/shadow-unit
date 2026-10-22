import ak47Url from "../assets/audio/ak47.mp3?url";

/**
 * Recorded AK-47 (single shots with their room tail, a full-auto string cut into
 * per-round slices that carry the continuous echo bed, the release tail, and the
 * reload foley), packed with silence gaps into one mp3. [name, start s, length s]
 */
export const AK47_ATLAS = {
  url: ak47Url,
  table: [
    ["akShot", 0.12, 0.854],
    ["akShot", 1.094, 0.854],
    ["akShot", 2.068, 0.854],
    ["akAuto", 3.042, 0.1133],
    ["akAuto", 3.2753, 0.1436],
    ["akAuto", 3.5389, 0.1301],
    ["akAuto", 3.789, 0.1301],
    ["akAuto", 4.0391, 0.1245],
    ["akAuto", 4.2836, 0.1303],
    ["akAuto", 4.5339, 0.1246],
    ["akAuto", 4.7784, 0.13],
    ["akAuto", 5.0284, 0.1302],
    ["akAuto", 5.2786, 0.1245],
    ["akAuto", 5.5231, 0.1291],
    ["akAuto", 5.7722, 0.1307],
    ["akAuto", 6.0229, 0.1249],
    ["akAuto", 6.2678, 0.1298],
    ["akAuto", 6.5176, 0.1252],
    ["akAuto", 6.7628, 0.1293],
    ["akAuto", 7.0122, 0.1304],
    ["akAuto", 7.2625, 0.1236],
    ["akAuto", 7.5061, 0.1308],
    ["akAuto", 7.7569, 0.1292],
    ["akAuto", 8.0062, 0.1252],
    ["akAuto", 8.2514, 0.1301],
    ["akAuto", 8.5015, 0.1252],
    ["akAuto", 8.7467, 0.1298],
    ["akAuto", 8.9965, 0.1298],
    ["akAuto", 9.2463, 0.1251],
    ["akAuto", 9.4914, 0.1296],
    ["akAuto", 9.7409, 0.13],
    ["akAuto", 9.9909, 0.1251],
    ["akTail", 10.236, 0.68],
    ["akMagOut", 11.036, 0.38],
    ["akMagIn", 11.536, 0.5],
    ["akBolt", 12.156, 0.48],
  ] as const,
};
