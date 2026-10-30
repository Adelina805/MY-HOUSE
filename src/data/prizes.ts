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
    'broken-sandy-sunglasses',
    'broken sandy sunglasses',
    ['crusty', 'one-armed', 'sun-bleached', 'questionable'],
    BEACH
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
    'comic-con-buttons',
    'Comic-Con buttons',
    ['mysterious', 'collector', 'slightly bent', 'exclusive'],
    [...DOWNTOWN, 'Gaslamp Quarter']
  ),
  prize(
    'concha-pastrie',
    'concha pastry',
    ['sugar-dusted', 'slightly stale', 'bakery', 'comforting'],
    [...FOOD_SPOTS, 'Barrio Logan']
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
    'de-la-rosa-mazapan',
    'De la Rosa mazapán',
    ['crumbly', 'powdery', 'nostalgic', 'sweet'],
    [...FOOD_SPOTS, 'Barrio Logan', 'Old Town']
  ),
  prize(
    'dollar-bills',
    'dollar bills',
    ['slightly sandy', 'folded', 'optimistic', 'wrinkled'],
    [...BEACH, ...DOWNTOWN]
  ),
  prize(
    'driftwood-milk-cartons',
    'driftwood milk cartons',
    ['weathered', 'tide-gifted', 'mysterious', 'sun-bleached'],
    BEACH
  ),
  prize(
    'extra-spearmint-gum',
    'Extra spearmint gum',
    ['minty', 'half-used', 'pocket-warmed', 'refreshing'],
    [...NEIGHBORHOOD, 'PB Boardwalk']
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
    'hodads-sticker',
    "Hodad's sticker",
    ['greasy-adjacent', 'proud', 'burger-stained', 'legendary'],
    [...FOOD_SPOTS, 'Ocean Beach']
  ),
  prize(
    'house-key',
    'house key',
    ['forgotten', 'jingly', 'slightly bent', 'important'],
    [...NEIGHBORHOOD, 'Mission Hills']
  ),
  prize(
    'ikea-mini-bag-keychain',
    'IKEA mini bag keychain',
    ['tiny', 'blue', 'strangely useful', 'assembled'],
    ['Mission Valley', 'UTC']
  ),
  prize(
    'ikea-pencil',
    'IKEA pencil',
    ['suspicious', 'flat-pack', 'freebie', 'slightly chewed'],
    ['Mission Valley', 'UTC']
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
    'julian-apple-pie',
    'Julian apple pie',
    ['warm', 'crumb-topped', 'road-trip', 'comforting'],
    ['Julian', ...FOOD_SPOTS]
  ),
  prize(
    'killer-fish-from-san-diego',
    'killer fish from San Diego',
    ['menacing', 'cartoonish', 'unexpectedly local', 'fierce'],
    [...BEACH, 'SeaWorld parking lot']
  ),
  prize(
    'kinder-chocolate',
    'Kinder chocolate',
    ['melty', 'foil-wrapped', 'imported', 'pocket-squished'],
    [...NEIGHBORHOOD, 'PB Boardwalk']
  ),
  prize(
    'kinder-surprise-egg',
    'Kinder Surprise egg',
    ['mysterious', 'foil-crinkled', 'toy-hiding', 'forbidden'],
    [...NEIGHBORHOOD, 'Balboa Park']
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
    'mexican-pink-sprinkle-cake',
    'Mexican pink sprinkle cake',
    ['festive', 'slightly smashed', 'bakery', 'celebratory'],
    [...FOOD_SPOTS, 'Barrio Logan']
  ),
  prize(
    'morey-bodyboard',
    'Morey bodyboard',
    ['wax-slick', 'dinged', 'wave-ready', 'sandy'],
    BEACH
  ),
  prize(
    'movie-ticket',
    'movie ticket',
    ['torn', 'stubbornly kept', 'faded', 'matinee'],
    [...DOWNTOWN, 'Movie theater lobby']
  ),
  prize(
    'mts-san-diego-bus',
    'MTS San Diego bus',
    ['rumbling', 'slightly late', 'transit', 'familiar'],
    [...DOWNTOWN, 'Old Town', 'UTC']
  ),
  prize(
    'orange',
    'orange',
    ['juicy', 'pocket-warmed', 'slightly squashed', 'citrus'],
    [...NEIGHBORHOOD, 'Carlsbad']
  ),
  prize(
    'pacific-surfliner-train',
    'Pacific Surfliner',
    ['coastal', 'ticket-stubbed', 'scenic', 'punctual-ish'],
    ['Santa Fe Depot', 'Downtown', 'Solana Beach', 'Oceanside']
  ),
  prize(
    'padres-baseball',
    'Padres baseball',
    ['powerful', 'scuffed', 'game-day', 'foul-ball'],
    [...DOWNTOWN, 'Petco Park', 'East Village']
  ),
  prize(
    'padres-cap',
    'Padres cap',
    ['sweat-stained', 'lucky', 'sun-faded', 'game-day'],
    [...DOWNTOWN, 'Petco Park']
  ),
  prize(
    'padres-soapy-joes-air-freshener',
    "Padres Soapy Joe's air freshener",
    ['pine-scented', 'dashboard', 'faded', 'loyal'],
    [...DOWNTOWN, 'Petco Park']
  ),
  prize(
    'panda-express-fortune-cookie',
    'Panda Express fortune cookie',
    ['questionable', 'cryptic', 'cracked', 'destiny'],
    [...FOOD_SPOTS, 'Convoy']
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
    'pinecone',
    'pinecone',
    ['prickly', 'forest-adjacent', 'pocket-sized', 'seasonal'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'pink-eraser',
    'pink eraser',
    ['half-used', 'rubbery', 'mistake-covering', 'school-desk'],
    [...NEIGHBORHOOD, 'SDSU']
  ),
  prize(
    'plastic-spork',
    'plastic spork',
    ['versatile', 'slightly bent', 'takeout', 'unappreciated'],
    FOOD_SPOTS
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
    'red-solo-cup',
    'red Solo cup',
    ['party', 'slightly crushed', 'classic', 'suspicious'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'rellerindos-tamarindo-candy',
    'Rellerindos tamarindo candy',
    ['tangy', 'sticky', 'chili-dusted', 'nostalgic'],
    [...FOOD_SPOTS, 'Barrio Logan']
  ),
  prize(
    'rubber-duck',
    'rubber duck',
    ['squeaky', 'bath-escaped', 'cheerful', 'bobbing'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'rubiks-cube',
    "Rubik's Cube",
    ['scrambled', 'half-solved', 'frustrating', 'classic'],
    [...NEIGHBORHOOD, 'Balboa Park']
  ),
  prize(
    'rusty-nail',
    'rusty nail',
    ['tetanus-adjacent', 'construction', 'forgotten', 'dangerous'],
    [...BEACH, ...NEIGHBORHOOD]
  ),
  prize(
    'san-diego-airport-luggage-tag',
    'San Diego airport luggage tag',
    ['travel-worn', 'looped', 'almost-lost', 'official'],
    ['San Diego International Airport']
  ),
  prize(
    'san-diego-balboa-park-sticker',
    'San Diego Balboa Park sticker',
    ['peeling', 'proud', 'sun-faded', 'tourist'],
    ['Balboa Park']
  ),
  prize(
    'san-diego-parking-receipt',
    'San Diego parking receipt',
    ['expensive', 'faded', 'guilt-inducing', 'crumpled'],
    [...DOWNTOWN, 'Pacific Beach', 'La Jolla']
  ),
  prize(
    'san-diego-parrot',
    'San Diego parrot',
    ['loud', 'escaped', 'tropical', 'gossiping'],
    [...NEIGHBORHOOD, 'Balboa Park', 'Ocean Beach']
  ),
  prize(
    'san-diego-trolley',
    'San Diego trolley',
    ['clattering', 'orange', 'punctual-ish', 'familiar'],
    [...DOWNTOWN, 'Old Town', 'UTC']
  ),
  prize(
    'san-diego-wave-soccer-sticker',
    'San Diego Wave soccer sticker',
    ['spirited', 'peeling', 'game-day', 'proud'],
    [...DOWNTOWN, 'Snapdragon Stadium']
  ),
  prize(
    'san-diego-zoo-magnet',
    'San Diego Zoo magnet',
    ['fridge-ready', 'slightly chipped', 'souvenir', 'animal'],
    ['Balboa Park']
  ),
  prize(
    'sand-dollar',
    'sand dollar',
    ['fragile', 'perfect', 'bleached', 'tide-gifted'],
    BEACH
  ),
  prize(
    'sdsu-aztecs-sticker',
    'SDSU Aztecs sticker',
    ['campus', 'slightly peeled', 'spirited', 'textbook'],
    [...NEIGHBORHOOD, 'SDSU', 'College Area']
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
    'soapy-joes-air-freshener',
    "Soapy Joe's air freshener",
    ['pine-scented', 'dashboard', 'faded', 'carwash'],
    [...NEIGHBORHOOD, 'Pacific Beach']
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
    'soy-sauce-packet',
    'soy sauce packet',
    ['leaky', 'takeout', 'forgotten', 'salty'],
    [...FOOD_SPOTS, 'Convoy']
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
    'sun-bum-banana-lip-balm',
    'Sun Bum banana lip balm',
    ['tropical', 'sticky', 'beach-bag', 'sunscreen-adjacent'],
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
    'the-koala-newspaper',
    'The Koala newspaper',
    ['controversial', 'coffee-stained', 'campus', 'vintage'],
    [...DOWNTOWN, 'SDSU']
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
    'toy-shark',
    'toy shark',
    ['chomp-ready', 'bathtub', 'plastic', 'menacing'],
    [...BEACH, 'Mission Bay']
  ),
  prize(
    'trader-joes-mini-tote-bag',
    "Trader Joe's mini tote bag",
    ['reusable', 'tiny', 'grocery', 'unexpectedly sturdy'],
    [...NEIGHBORHOOD, 'Hillcrest']
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
    'unconditional-surrender-statue',
    'Unconditional Surrender statue',
    ['iconic', 'tourist', 'kissing', 'photographed'],
    [...DOWNTOWN, 'Seaport Village', 'Embarcadero']
  ),
  prize(
    'usb-flash-drive',
    'USB flash drive',
    ['mysterious', 'unlabeled', 'probably-empty', 'tech'],
    [...DOWNTOWN, ...NEIGHBORHOOD]
  ),
  prize(
    'uss-midway-aircraft-carrier',
    'USS Midway',
    ['historic', 'towering', 'harbor', 'museum'],
    ['Downtown', 'Embarcadero', 'Seaport Village']
  ),
  prize(
    'volleyball',
    'volleyball',
    ['sandy', 'deflated', 'court-worn', 'spike-ready'],
    BEACH
  ),
]
