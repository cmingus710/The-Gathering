/**
 * Demonstration coloring pictures: original, simple vector artwork drawn for
 * The Gathering, offered to editors as unpublished drafts to review, change,
 * or discard. They go through exactly the same SVG checks as an upload.
 * There is no text inside the artwork; each fillable part has a name for
 * keyboard and screen reader users. Story summaries are short retellings to
 * be checked against the passages listed before anything is published.
 */
export type ColoringDemo = {
  slug: string;
  title: string;
  summary: string;
  bible_story: string;
  scripture_refs: string[];
  story: string;
  age_min: number;
  age_max: number;
  svg: string;
};

export const DEMO_TITLE_PREFIX = "Demo draft: ";
export const DEMO_CREDIT = "Original demonstration artwork drawn for The Gathering (draft for review).";

const stroke = 'fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round"';

function rainbowBand(i: number): string {
  const cx = 400;
  const cy = 430;
  const R = 330 - i * 20;
  const r = R - 20;
  return `M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy} L${cx + r} ${cy} A${r} ${r} 0 0 0 ${cx - r} ${cy} Z`;
}

const rainbow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <title>Noah's rainbow</title>
  <rect data-region="Sky" x="0" y="0" width="800" height="430" ${stroke}/>
  ${["outside", "second", "third", "fourth", "fifth", "inside"]
    .map((n, i) => `<path data-region="Rainbow, ${n} stripe" d="${rainbowBand(i)}" ${stroke}/>`)
    .join("\n  ")}
  <circle data-region="Sun" cx="110" cy="100" r="45" ${stroke}/>
  <path data-region="Cloud" d="M600 165 C560 165 560 120 600 122 C605 85 660 80 672 108 C690 80 745 90 740 128 C780 132 775 165 740 165 Z" ${stroke}/>
  <g data-region="Dove">
    <path d="M70 255 C85 230 120 228 140 245 C160 240 175 245 185 255 C165 262 150 265 140 265 C120 285 85 282 70 255 Z" ${stroke}/>
  </g>
  <path data-region="Dove's wing" d="M110 250 C112 222 132 205 152 205 C146 225 140 240 128 254 Z" ${stroke}/>
  <path data-region="Olive leaf" d="M185 255 C195 246 210 246 214 252 C206 260 194 262 185 255 Z" ${stroke}/>
  <path data-region="Water" d="M0 420 C50 400 100 400 150 420 C200 440 250 440 300 420 C350 400 400 400 450 420 C500 440 550 440 600 420 C650 400 700 400 750 420 C770 428 790 430 800 428 L800 600 L0 600 Z" ${stroke}/>
  <path data-region="Ark's hull" d="M230 470 L570 470 L520 545 L280 545 Z" ${stroke}/>
  <rect data-region="Ark's cabin" x="315" y="415" width="170" height="55" ${stroke}/>
  <polygon data-region="Ark's roof" points="300,416 400,375 500,416" ${stroke}/>
  <rect data-region="Ark's window" x="385" y="428" width="30" height="28" ${stroke}/>
  <path d="M260 490 L540 490 M270 510 L530 510" fill="none" stroke="#000" stroke-width="3"/>
  <path d="M40 470 C60 460 80 460 100 470 M640 500 C660 490 680 490 700 500 M80 560 C100 550 120 550 140 560 M600 565 C620 555 640 555 660 565" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>
  <circle cx="160" cy="246" r="4" fill="#000"/>
</svg>`;

const shepherd = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <title>A shepherd and his sheep</title>
  <rect data-region="Sky" x="0" y="0" width="800" height="380" ${stroke}/>
  <circle data-region="Sun" cx="690" cy="90" r="42" ${stroke}/>
  <path data-region="Cloud" d="M120 120 C95 120 95 90 122 90 C128 62 175 60 182 85 C200 70 235 80 230 105 C255 108 252 130 228 130 L125 130 Z" ${stroke}/>
  <path data-region="Hill" d="M0 360 C150 270 300 300 420 340 C560 290 690 280 800 330 L800 600 L0 600 Z" ${stroke}/>
  <path data-region="Grass" d="M0 480 C200 440 600 440 800 480 L800 600 L0 600 Z" ${stroke}/>
  <path data-region="Shepherd's head covering" d="M178 305 C172 240 192 228 215 228 C238 228 258 240 252 305 Z" ${stroke}/>
  <circle data-region="Shepherd's face" cx="215" cy="272" r="23" ${stroke}/>
  <path data-region="Shepherd's robe" d="M182 300 L248 300 L285 525 L145 525 Z" ${stroke}/>
  <path data-region="Shepherd's belt" d="M168 392 L262 392 L265 410 L165 410 Z" ${stroke}/>
  <path d="M305 530 L305 260 C305 225 330 212 350 222 C368 232 366 258 350 262" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/>
  <g data-region="Big sheep's legs">
    <rect x="452" y="470" width="16" height="55" ${stroke}/>
    <rect x="482" y="475" width="16" height="52" ${stroke}/>
    <rect x="520" y="475" width="16" height="52" ${stroke}/>
    <rect x="550" y="470" width="16" height="55" ${stroke}/>
  </g>
  <path data-region="Big sheep's wool" d="M440 455 C415 455 410 420 435 412 C432 385 470 375 485 392 C495 370 535 370 545 392 C565 378 595 395 585 420 C605 432 598 465 575 465 C565 488 530 488 520 478 C505 492 470 490 462 476 C450 480 440 470 440 455 Z" ${stroke}/>
  <ellipse data-region="Big sheep's face" cx="598" cy="418" rx="24" ry="30" ${stroke}/>
  <circle cx="606" cy="410" r="4" fill="#000"/>
  <g data-region="Little lamb's legs">
    <rect x="345" y="510" width="11" height="36" ${stroke}/>
    <rect x="388" y="510" width="11" height="36" ${stroke}/>
  </g>
  <path data-region="Little lamb's wool" d="M335 505 C318 505 318 482 335 480 C335 462 362 458 372 472 C380 458 405 462 405 480 C420 484 418 506 402 508 C395 520 345 520 335 505 Z" ${stroke}/>
  <ellipse data-region="Little lamb's face" cx="418" cy="478" rx="15" ry="18" ${stroke}/>
  <circle cx="423" cy="474" r="3" fill="#000"/>
  <path d="M60 540 L66 520 L72 540 M690 545 L696 525 L702 545 M520 565 L526 548 L532 565" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

const loaves = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <title>Five loaves and two fish</title>
  <rect data-region="Background" x="0" y="0" width="800" height="600" ${stroke}/>
  <path data-region="Picnic cloth" d="M30 400 L770 400 L790 580 L10 580 Z" ${stroke}/>
  <ellipse data-region="Loaf 1 of 5" cx="300" cy="300" rx="62" ry="34" ${stroke}/>
  <ellipse data-region="Loaf 2 of 5" cx="500" cy="300" rx="62" ry="34" ${stroke}/>
  <ellipse data-region="Loaf 3 of 5" cx="400" cy="282" rx="68" ry="38" ${stroke}/>
  <path data-region="Basket" d="M225 335 L575 335 L535 520 L265 520 Z" ${stroke}/>
  <rect data-region="Basket's rim" x="205" y="312" width="390" height="36" rx="18" ${stroke}/>
  <path d="M245 380 L555 380 M255 425 L545 425 M262 470 L538 470 M320 348 L310 520 M400 348 L400 520 M480 348 L490 520" fill="none" stroke="#000" stroke-width="3"/>
  <path d="M360 270 C375 262 390 262 405 270 M415 275 C428 268 440 268 452 276 M275 296 C288 289 300 289 312 296 M480 296 C492 289 505 289 518 296" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>
  <ellipse data-region="Loaf 4 of 5" cx="120" cy="455" rx="58" ry="30" ${stroke}/>
  <ellipse data-region="Loaf 5 of 5" cx="135" cy="510" rx="62" ry="32" ${stroke}/>
  <path data-region="Fish 1 of 2, tail" d="M700 450 L750 420 L745 480 Z" ${stroke}/>
  <path data-region="Fish 1 of 2" d="M590 450 C625 410 680 410 710 450 C680 490 625 490 590 450 Z" ${stroke}/>
  <path data-region="Fish 2 of 2, tail" d="M690 525 L740 495 L735 555 Z" ${stroke}/>
  <path data-region="Fish 2 of 2" d="M580 525 C615 485 670 485 700 525 C670 565 615 565 580 525 Z" ${stroke}/>
  <circle cx="615" cy="445" r="5" fill="#000"/>
  <circle cx="605" cy="520" r="5" fill="#000"/>
  <path d="M640 425 C650 440 650 460 640 475 M630 500 C640 515 640 535 630 550" fill="none" stroke="#000" stroke-width="3"/>
</svg>`;

export const COLORING_DEMOS: ColoringDemo[] = [
  {
    slug: "noahs-rainbow",
    title: "Noah's rainbow",
    summary: "Color the rainbow God set in the clouds as a sign of his promise.",
    bible_story: "Noah and the rainbow",
    scripture_refs: ["Genesis 8:6-12", "Genesis 9:8-17"],
    story:
      "As the flood waters went down, Noah sent out a dove. It came back with a fresh olive leaf, so Noah knew the water was drying up. When Noah, his family, and the animals came out of the ark, God made a promise: never again would a flood destroy the earth. God put a rainbow in the clouds as the sign of that promise to every living creature.",
    age_min: 3,
    age_max: 8,
    svg: rainbow,
  },
  {
    slug: "shepherd-and-sheep",
    title: "A shepherd and his sheep",
    summary: "Color the shepherd who goes looking for every one of his sheep.",
    bible_story: "The lost sheep",
    scripture_refs: ["Luke 15:3-7", "Psalm 23:1", "John 10:11"],
    story:
      "Jesus told a story about a shepherd who had 100 sheep. When one of them was lost, the shepherd left the other 99 and searched until he found it. He carried it home on his shoulders, full of joy, and called his friends to celebrate. Jesus said there is joy like that in heaven over one person who turns back to God. Jesus also said, \"I am the good shepherd.\"",
    age_min: 3,
    age_max: 8,
    svg: shepherd,
  },
  {
    slug: "loaves-and-fish",
    title: "Five loaves and two fish",
    summary: "Color the boy's lunch that Jesus used to feed a huge crowd.",
    bible_story: "Jesus feeds the five thousand",
    scripture_refs: ["John 6:1-14", "Matthew 14:13-21", "Mark 6:30-44", "Luke 9:10-17"],
    story:
      "A huge crowd followed Jesus to a hillside, and they were hungry. A boy had five small barley loaves and two small fish. Jesus took the loaves, gave thanks to God, and shared them out, and the fish too. Everyone ate as much as they wanted: about five thousand men, besides women and children. Afterward the disciples gathered twelve baskets of leftover pieces.",
    age_min: 3,
    age_max: 8,
    svg: loaves,
  },
];
