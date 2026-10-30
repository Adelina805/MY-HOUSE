/** Source of truth for available prizes — one entry per WebP in public/media/prizes/. */

export interface PrizeDefinition {
  id: string
  name: string
  image: string
  adjectives: string[]
  locations: string[]
}

const BEACH = [
  'Pacific Beach',
  'Mission Beach',
  'Ocean Beach',
  'La Jolla Shores',
  'Coronado Beach',
  'Sunset Cliffs',
] as const

const NEIGHBORHOOD = [
  'North Park',
  'South Park',
  'Hillcrest',
  'Normal Heights',
  'University Heights',
  'Kensington',
] as const

const DOWNTOWN = [
  'Gaslamp Quarter',
  'East Village',
  'Little Italy',
  'Petco Park',
  'Seaport Village',
] as const

const FOOD_SPOTS = [
  "Ike's Place",
  'Old Town',
  'Barrio Logan',
  'PB Boardwalk',
  'Mission Bay',
  'Liberty Station',
] as const

function prize(
  id: string,
  name: string,
  adjectives: string[],
  locations: readonly string[],
): PrizeDefinition {
  return {
    id,
    name,
    image: `/media/prizes/${id}.webp`,
    adjectives,
    locations: [...locations],
  }
}

export const PRIZES: PrizeDefinition[] = [
  prize(
    'apple',
    'apple',
    ['crisp', 'forgotten', 'suspiciously shiny', 'lunchbox'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'assorted-pebbles',
    'assortment of pebbles',
    ['suspicious', 'carefully curated', 'pocket-warmed', 'mysterious'],
    BEACH
  ),
  prize(
    'avocado',
    'avocado',
    ['perfectly ripe', 'slightly smug', 'California', 'overpriced'],
    [...FOOD_SPOTS, 'Hillcrest']
  ),
  prize(
    'bagged-goldfish',
    'bagged goldfish',
    ['optimistic', 'carnival-won', 'bubbling', 'doomed'],
    [...BEACH, 'Balboa Park']
  ),
  prize(
    'beach-bucket-and-shovel',
    'beach bucket and shovel',
    ['sandy', 'forgotten', 'child-sized', 'sun-bleached'],
    BEACH
  ),
  prize(
    'bonita-dinosaur-named-rangui',
    'Bonita dinosaur named Rangui',
    ['legendary', 'slightly sticky', 'championship', 'beloved'],
    ['Bonita', 'Chula Vista', 'South Bay']
  ),
  prize(
    'bonita-dinosaur-named-rumbi',
    'Bonita dinosaur named Rumbi',
    ['rival', 'equally sticky', 'underrated', 'fierce'],
    ['Bonita', 'Chula Vista', 'South Bay']
  ),
  prize(
    'bottle-cap',
    'bottle cap',
    ['dented', 'lucky', 'sun-warmed', 'collectible'],
    [...BEACH, ...DOWNTOWN]
  ),
  prize(
    'broken-pencil',
    'broken pencil',
    ['half-used', 'overworked', 'graphite-stained', 'tragic'],
    [...NEIGHBORHOOD, 'SDSU']
  ),
  prize(
    'california-burrito',
    'California burrito',
    ['legendary', 'slightly crushed', 'fries-included', 'life-changing'],
    FOOD_SPOTS
  ),
  prize(
    'cocktail-umbrella',
    'cocktail umbrella',
    ['tiny', 'festive', 'slightly damp', 'party'],
    [...BEACH, 'Gaslamp Quarter', 'Mission Bay']
  ),
  prize(
    'cool-ranch-doritos',
    'Cool Ranch Doritos',
    ['dusty', 'half-eaten', 'intensely flavored', 'crumpled'],
    [...NEIGHBORHOOD, 'PB Boardwalk', 'Mission Beach']
  ),
  prize(
    'crab',
    'crab',
    ['sideways', 'grumpy', 'pinch-ready', 'tidepool'],
    BEACH
  ),
  prize(
    'crumpled-receipt',
    'crumpled receipt',
    ['illegible', 'suspicious', 'expense-report', 'faded'],
    [...DOWNTOWN, ...FOOD_SPOTS]
  ),
  prize(
    'dollar-bills',
    'dollar bills',
    ['slightly sandy', 'folded', 'optimistic', 'wrinkled'],
    [...BEACH, ...DOWNTOWN]
  ),
  prize(
    'flip-flop',
    'flip-flop',
    ['orphaned', 'sandy', 'mismatched', 'sun-baked'],
    BEACH
  ),
  prize(
    'french-fry',
    'french fry',
    ['lonely', 'crispy', 'salt-crusted', 'abandoned'],
    FOOD_SPOTS
  ),
  prize(
    'googly-eye',
    'googly eye',
    ['judgmental', 'wobbly', 'detached', 'staring'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'googly-eyed-rock',
    'googly-eyed rock',
    ['expressive', 'handmade', 'weirdly charming', 'staring'],
    [...BEACH, ...NEIGHBORHOOD]
  ),
  prize(
    'house-key',
    'house key',
    ['forgotten', 'jingly', 'slightly bent', 'important'],
    [...NEIGHBORHOOD, 'Mission Hills']
  ),
  prize(
    'ikes-sandwich',
    "Ike's sandwich",
    ['towering', 'slightly smashed', 'sauce-dripping', 'legendary'],
    ["Ike's Place", 'Hillcrest', 'UTC']
  ),
  prize(
    'japanese-nautical-glass-orb',
    'Japanese nautical glass orb',
    ['sea-glass', 'mysterious', 'barnacle-kissed', 'ancient'],
    [...BEACH, 'La Jolla Cove']
  ),
  prize(
    'killer-fish-from-san-diego',
    'killer fish from San Diego',
    ['menacing', 'cartoonish', 'unexpectedly local', 'fierce'],
    [...BEACH, 'SeaWorld parking lot']
  ),
  prize(
    'lemon',
    'lemon',
    ['puckering', 'sun-warmed', 'almost ripe', 'zesty'],
    [...NEIGHBORHOOD, 'Coronado']
  ),
  prize(
    'lifeguard-buoy',
    'lifeguard buoy',
    ['sun-faded', 'official', 'slightly sandy', 'heroic'],
    BEACH
  ),
  prize(
    'magic-eight-ball',
    'Magic 8-Ball',
    ['cryptic', 'shake-worn', 'indecisive', 'oracle'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'metal-slinky',
    'metal Slinky',
    ['tangled', 'staircase-ready', 'jingling', 'classic'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'orange',
    'orange',
    ['juicy', 'pocket-warmed', 'slightly squashed', 'citrus'],
    [...NEIGHBORHOOD, 'Carlsbad']
  ),
  prize(
    'padres-cap',
    'Padres cap',
    ['sweat-stained', 'lucky', 'sun-faded', 'game-day'],
    [...DOWNTOWN, 'Petco Park']
  ),
  prize(
    'paperclip',
    'paperclip',
    ['bent', 'office-escaped', 'tiny', 'useful'],
    [...DOWNTOWN, ...NEIGHBORHOOD]
  ),
  prize(
    'parking-ticket',
    'parking ticket',
    ['unfair', 'crumpled', 'expensive', 'ignored'],
    [...DOWNTOWN, 'Pacific Beach', 'La Jolla']
  ),
  prize(
    'peanut-butter-jelly-sandwich',
    'peanut butter and jelly sandwich',
    ['squished', 'classic', 'crustless', 'lunchbox'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'pink-eraser',
    'pink eraser',
    ['half-used', 'rubbery', 'mistake-covering', 'school-desk'],
    [...NEIGHBORHOOD, 'SDSU']
  ),
  prize(
    'pronto-card',
    'Pronto card',
    ['expired', 'scratched', 'transit', 'almost-empty'],
    [...DOWNTOWN, 'Old Town', 'UTC']
  ),
  prize(
    'rainbow-slinky',
    'rainbow Slinky',
    ['colorful', 'tangled', 'nostalgic', 'bouncy'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'rubber-duck',
    'rubber duck',
    ['squeaky', 'bath-escaped', 'cheerful', 'bobbing'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'rusty-nail',
    'rusty nail',
    ['tetanus-adjacent', 'construction', 'forgotten', 'dangerous'],
    [...BEACH, ...NEIGHBORHOOD]
  ),
  prize(
    'san-diego-parrot',
    'San Diego parrot',
    ['loud', 'escaped', 'tropical', 'gossiping'],
    [...NEIGHBORHOOD, 'Balboa Park', 'Ocean Beach']
  ),
  prize(
    'sand-dollar',
    'sand dollar',
    ['fragile', 'perfect', 'bleached', 'tide-gifted'],
    BEACH
  ),
  prize(
    'sea-monster-toy',
    'sea monster toy',
    ['menacing', 'bathtub', 'slightly chewed', 'mythic'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'seagull',
    'seagull',
    ['fry-obsessed', 'brazen', 'screeching', 'boardwalk'],
    BEACH
  ),
  prize(
    'seashell',
    'seashell',
    ['spiraled', 'ocean-polished', 'whispering', 'collected'],
    BEACH
  ),
  prize(
    'shark-egg',
    'shark egg',
    ['mysterious', 'leathery', 'tidepool', 'ominous'],
    [...BEACH, 'La Jolla Cove']
  ),
  prize(
    'smooth-rock',
    'smooth rock',
    ['worry', 'pocket-polished', 'satisfying', 'skipping'],
    BEACH
  ),
  prize(
    'sour-patch-kids',
    'Sour Patch Kids',
    ['mouth-puckering', 'half-stuck', 'sugar-coated', 'shared'],
    [...NEIGHBORHOOD, 'Movie theater lobby']
  ),
  prize(
    'sour-skittles',
    'Sour Skittles',
    ['rainbow', 'face-contorting', 'spilled', 'addictive'],
    [...NEIGHBORHOOD, 'PB Boardwalk']
  ),
  prize(
    'spare-change',
    'spare change',
    ['jingling', 'linty', 'parking-meter', 'lucky'],
    [...DOWNTOWN, ...BEACH]
  ),
  prize(
    'starfish',
    'starfish',
    ['five-armed', 'tidepool', 'sun-dried', 'delicate'],
    BEACH
  ),
  prize(
    'stop-sign',
    'stop sign',
    ['miniature', 'authoritative', 'slightly bent', 'ignored'],
    [...NEIGHBORHOOD, ...DOWNTOWN]
  ),
  prize(
    'striped-rock',
    'striped rock',
    ['geological', 'layered', 'pocket-sized', 'handsome'],
    BEACH
  ),
  prize(
    'strong-current-warning-sign',
    'strong current warning sign',
    ['urgent', 'sun-faded', 'ignored', 'official'],
    BEACH
  ),
  prize(
    'surfboard-fin',
    'surfboard fin',
    ['snapped', 'wax-covered', 'orphaned', 'shredded'],
    BEACH
  ),
  prize(
    'surfing-santa',
    'surfing Santa',
    ['festive', 'off-season', 'wave-riding', 'bearded'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'tacos',
    'tacos',
    ['dripping', 'street', 'life-affirming', 'slightly smashed'],
    FOOD_SPOTS
  ),
  prize(
    'tortilla-chip',
    'tortilla chip',
    ['lonely', 'salsa-ready', 'crumbled', 'triangular'],
    FOOD_SPOTS
  ),
  prize(
    'toy-dinosaur',
    'toy dinosaur',
    ['roaring', 'plastic', 'prehistoric', 'battle-worn'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'traffic-cone',
    'traffic cone',
    ['miniature', 'construction', 'orange', 'detour'],
    [...DOWNTOWN, 'I-5 on-ramp']
  ),
  prize(
    'trophy',
    'trophy',
    ['participation', 'slightly tarnished', 'champion', 'plastic'],
    [...NEIGHBORHOOD, 'Balboa Park', 'Petco Park']
  ),
  prize(
    'usb-flash-drive',
    'USB flash drive',
    ['mysterious', 'unlabeled', 'probably-empty', 'tech'],
    [...DOWNTOWN, ...NEIGHBORHOOD]
  ),
  prize(
    'volleyball',
    'volleyball',
    ['sandy', 'deflated', 'court-worn', 'spike-ready'],
    BEACH
  ),
]
