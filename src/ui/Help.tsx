import { useEffect } from 'react'
import { isLive } from '../engine/calendar'
import { useGame } from '../store'
import { Modal } from './Modal'
import { Tabs } from './panel'
import { regCtxOf } from './regCtx'
import { shortcutRows, shortcutsFor } from './shortcuts'

const TURN = [
  { title: 'Read the Briefing', body: 'Your advisor lists what needs you this month, most urgent first. Every item has a button that takes you to the fix.' },
  { title: 'Give your orders', body: 'Upgrades, training, weapons, laws, declaring war and attacks happen the moment you press the button. Research, taxes, the draft and offers to other nations take effect when the month ends.' },
  { title: 'Press Next turn', body: 'Every other nation moves, income arrives, units finish training, and attacks on you play out. A monthly report shows what changed.' },
]

const LIVE_STEPS = [
  { title: 'Press play', body: 'Time flows by itself: a month takes about a minute. Pause any time with Space, and speed it up with 1, 2 and 3. The clock stops while you plan an attack or decide an event, and a new game starts paused.' },
  { title: 'Give your orders', body: 'Upgrades, training, trades, shares and war work the moment you press the button. Research, taxes, the draft and offers to other nations take effect on the 1st of the next month, and the Orders bar says when.' },
  { title: 'Choose your force', body: 'In the War Room you pick exactly how many of each unit to send, with a stepper for every kind (infantry, tanks, guns, aircraft, drones, robots), quick buttons (None, Half, Probe, Main force, Max) and a missile box. The odds update as you click. Keys: M max, H half, N none, 1 2 3 the stance. Only the reserve can go: forces on station and attacks already ordered are not free.' },
  { title: 'Send armies', body: 'An attack in the War Room sends an army out of your military. It marches for days, fights when it arrives, and comes home. Units that are away do not defend your country. Recall an army while it is still on its way out.' },
  { title: 'Watch for armies and missiles coming', body: 'An enemy army shows in red with the days left. You have that time to recall your own armies, raise shields, fire missiles or make peace, which turns armies back. Missiles in the air toward you show as a purple alert with who fired them and the days left; each kind flies for its own number of days.' },
]

/** The words the game explains. The help window lists them; `Term` (widgets.tsx) shows the same text on hover, focus or tap. */
// oxlint-disable-next-line react/only-export-components
export const TERMS: [string, string][] = [
  ['Money', 'Comes from taxes, factories and ports. Pays for upgrades, units, their upkeep and your wars.'],
  ['Food', 'Farms grow it; people and soldiers eat it. Run out and your military fights 30% weaker.'],
  ['Influence', 'Political capital. You spend it to declare war, pass laws, sign treaties and put down rebels.'],
  ['Research', 'Universities produce it. You spend it on technologies that unlock units and make them stronger.'],
  ['Stability', 'How content your people are. High taxes, hunger, debt and long wars lower it. Below 30% rebels rise.'],
  ['Division', 'One unit. Infantry, tanks, planes and warships each have attack and defense numbers, and battles use exactly those.'],
  ['Defense Line', 'How much resistance a country has left. Each battle you win pushes it down. At zero the country is yours. It heals in months nobody attacks.'],
  ['Force size', 'How much of your military you send: a probe, the main force, or all in. In a turn game the rest of your army at home fights at half strength until the month ends. In a live game what you send leaves home until it is back.'],
  ['Stance', 'How you fight. Assault is balanced. Blitz breaks the line faster and costs more. Siege is slow, saves lives, and shuts their factories.'],
  ['War score', 'Points you can spend at the peace table, from -100 to 100, between you and one enemy. It is made of battles won, casualties inflicted (both fade by 5% a month, so an old victory is not a lead today), the land you hold that was theirs and they hold that was yours (counted while held, gone the moment it is retaken or breaks away), the enemy capital, and missile strikes. Next to it, Who is winning weighs the score with the two armies and how each home front is holding (unrest, war weariness, rebels, no oil or food): a big score with a broken army or a rebellion at home is not a safe lead. The Wars panel and Diplomacy show the breakdown.'],
  ['Strength is not odds', 'Military strength adds up what each unit is worth. It leaves out their garrison, the terrain, the Defense Line and the stance, how much of your force goes, and that a defender wins ties. A main force (two thirds, and in a live game never more than nine tenths) usually needs about twice their strength to be a sure thing. The country panel shows the real chance of a main force and of everything, and the War Room shows it for any plan: trust that number.'],
  ['War bill', 'Every war costs money every month. A small country can fight three wars at once, a big empire more.'],
  ['Settling', 'A conquered country gives about 40% of its output at first and reaches 100% after six months.'],
  ['Oil, steel, goods', 'Oil fuels tanks, planes and warships. Steel builds them. Goods keep your people content. Buy what you lack on the Market in Economy.'],
  ['Cities', 'Each country has cities. Grow them for workers and give each a focus that boosts the whole country.'],
  ['Business', 'Six private sectors grow on their own. Lower business tax, calm people and new technology make them grow faster.'],
  ['Bonds and credit', 'Borrow with bonds and pay interest at the rate fixed when you sold them. A bond that comes due is rolled over while lenders still lend, or paid from the treasury. A nation in the red for 3 months with debt defaults: half of every bond is written off and nobody lends to it for two years.'],
  ['Spending', 'Real money for schools, health and public works (levels 0 to 4) and for pensions, jobless support and housing (0 to 2). More costs more and buys a better life; less saves money and lets things slip.'],
  ['Programs for the people', 'The People tab has 22 programs in five groups: health, learning, work, family and safety. Each is Off, Pilot, National or Universal. Raising one costs influence and then money every month by its level, and its effect phases in over a few months. Cutting one costs stability at once. Programs for calm cost; programs for growth, like courts, public transport and small-business loans, earn most of their cost back. Stability from care has a ceiling, so the first programs help most.'],
  ['Why stability moves', 'The People tab lists every cause of stability with its points, so you can see which lever to pull: taxes, hunger, war weariness, rebels, stretched officials, programs. A campaign (a celebration, a vaccination drive) is a one-off bill for a burst of effect, with a long wait before the next.'],
  ['People and skills', 'Your workers are basic workers, skilled workers, engineers, doctors and scientists. Factories need engineers, universities need scientists, hospitals need doctors. Schools, and the focus you give them, decide the mix. Only people with jobs pay tax.'],
  ['Health and epidemics', 'Healthy people live longer, have more children and riot less. Poor health invites epidemics, which spread to neighbors and cost lives, output and calm. Doctors, health spending, a quarantine and medicine end them.'],
  ['Medicine', 'A seventh research column: Sanitation, Vaccines, Surgery, Genomics and Longevity. Surgery lets doctors return wounded soldiers to the ranks. The last two need a Medical Research Centre or doctors for every need.'],
  ['The bank', 'From a Regional power up you set the interest rate: higher cools prices, lower warms them. You can print money (money now, inflation later), sell bonds for 1, 3 or 5 years, sell war bonds in wartime, steer credit to one sector, and keep a wealth fund. A weak currency makes exports cheap and imports dear.'],
  ['Projects and public works', 'Seventeen national projects, from a rail network and a water network to a fusion plant and a Mars mission, each open at a different size of empire. Each can be built up to three levels: every level costs and takes more, and is worth more but not in proportion. Engineers set the pace, so building many at once slows them all. You can rush a project: pay four months of its bill to bring it two months closer, once a month. Public works spending speeds projects, trade and factories, and makes building cheaper.'],
  ['The space program', 'Economy, Space. Needs Fifth-Generation Fighters. An agency of engineers and astronauts (they come out of the same specialists your factories use, and are paid every month), a launch site, and rockets you develop once (sounding, orbital, heavy-lift, deep-space, interplanetary) and then build one at a time: every launch uses a rocket up. Fly missions up a ladder: a test flight, satellites (communications lift trade and research, weather calm the country, reconnaissance sees every enemy), a crewed orbit, then the Moon, asteroids, Mars and the outer planets. A flight takes months: build, launch, travel, arrive, and a seeded roll decides the launch and the arrival. A failure loses the rocket and payload, costs standing, and can kill a crew. Each mission can be flown in-house (cheap, needs a rocket, talent and experience, and builds experience that makes every launch safer) or hired from a private company (a fixed premium, faster to build, no experience, and companies grow better and cheaper as the world flies more rockets). Probes bring home samples; the Labs turn samples into discoveries (cheaper and safer rockets, life support, in-situ resource use, and spillovers: output, medicine, even a new Frontier technology). To take a world: survey it, land, claim it (influence, and nobody else may build there), then fly the cargo that founds an outpost. Outposts grow into stations and colonies, and carry mines that take years to build: metal for steel, rare metals for money, water and volatiles for oil and cheaper upkeep, helium-3 for the grid and a fusion plant. It is a long-term investment: a mine and its outpost take about ten years to pay back what they cost (about six with the right discoveries), before the rockets and staff that got you there, and an outpost the treasury cannot supply shrinks.'],
  ['Projects in your countries', 'Each country you hold can have its own projects: an industrial park, a tech hub, irrigation, a dam, a resort, a cultural centre, a border fortress, a special economic zone, a mine. Some need a coast, hills, a port or a university. They cost and give more in a bigger country, and they stay with the land if it is conquered. A cultural centre helps conquered land settle.'],
  ['State enterprises', 'The state can buy or seize a business sector and keep most of its profit. It grows at half speed, and seizing one frightens investors.'],
  ['Empire tiers', 'Holding 4, 10, 25 and 60 countries makes you a Regional power, Great power, Superpower and Hegemon. Each tier widens what you can do: interest rates, printing, bonds, projects, laws, the wealth fund, capitals, loans and the World Council. A puppet counts as half. You keep a tier until you fall a tenth below its line.'],
  ['Government desk', 'Economy, Government. A command view in seven sections. Cabinet: nine ministries (finance, interior, foreign affairs, defence, health, education, labour, industry, science), each filled from three candidates with competence, loyalty, corruption, popularity and an ideology; a new list every year. A minister delivers the ministry\'s effect by competence, as far as their profession is staffed, costs a salary and a signing fee, wastes money by corruption, may be caught in a scandal (stability falls) and may resign when disloyal; dismissing one costs stability. Talent: the professionals you have (administrators, economists, diplomats, engineers, scientists, doctors, teachers, officers, spies), who uses them (industry, space, missiles, agencies, schools, the civil service, ministries) and where you are short; schooling raises them, brain drain takes them, talent visas bring more. Jobs: the labour force, jobs by sector, why people are out of work, the civil service size (Lean to Vast: public jobs, cost, officials\' capacity, services, crowding out business) and the job programs. Policies: seven reform areas (tax reform, industrial policy, labour law, anti-corruption, central bank, digital government, talent visas); a reform is drafted by its ministry, voted on a month later (lobby with influence first) and phases in over six months. Groups: business, labour, the military, tradition and the provinces react to your choices and the times; their mood sets approval and the odds of a vote. A desk you never touch changes nothing.'],
  ['Administration', 'Your officials can run only so many countries at once. Beyond that, stability and output fall. Civic halls, governors, skilled workers, regional capitals and digital government raise the limit. Capitals carry no load.'],
  ['Occupation policy', 'How you hold conquered land: Standard, Autonomy (slow, few rebels), Assimilate (fast, more rebels), or Settle (costly, quick and calm). Bigger empires have more choices.'],
  ['World reaction', 'The bigger you grow, the more the world fears you. Your threat (0 to 100) comes from your empire tier, your share of the world\'s countries, people and output, and your reputation for aggression, and the tier decides how much of it turns into action. Easy rivals never band together. Medium rivals form alliances and blocs against you and join their friends\' wars. Hard rivals also plan joint strikes: several of them declare war and attack your weakest border in the same month (in a live game, on the same day), with at least two months of warning. The Empire desk\'s World reaction tab shows the threat, who is drawing together, what is coming and what you can do: pacts, aid, a better reputation, a Council recognition.'],
  ['Nuclear weapons', 'A Superpower (25 countries) with Hypersonic Missiles can build warheads, one at a time over four months, for money, steel and research, and keep four. From the War Room, a warhead can be fired at any country of a nation you are at war with, so a war with a reason comes first. It destroys the country\'s buildings, factories and army, kills about two thirds of its people, cripples its output for years and leaves rebels in the ruins; an Interceptor Shield stops only a quarter and missile hunters catch few. You must tick a box to confirm. The world never forgives it: your reputation soars, every nation despises you and sanctions you, world tension spikes, and the two strongest alliance blocs declare war on you at once. In a live game it flies for five days and its target sees it coming; making peace before it lands calls it off. Hard rivals that are Superpowers may do the same, but only when desperate or provoked, and never twice in three years.'],
  ['World Council', 'A Superpower may put resolutions to every nation: sanctions on a target, a ceasefire between two others, recognition that clears its reputation, or a trade accord. Votes are weighted by income and you see the projected result first.'],
  ['Academy and commander', 'A military academy sends recruits out already drilled, makes drill cheaper and sharpens combined arms. A commander has a trait: mountains, logistics, blitz, air power or defense.'],
  ['Puppet state', 'Win a war big enough and you can make the loser a puppet: it keeps its land, pays you tribute, and fights beside you in every war while it is loyal. After a year you can annex it: its land, army and treasury join yours (cheap when it is loyal, dear and slow to settle when it is restive).'],
  ['Territory', 'A harder kind of vassal than a puppet, asked for at the peace table ("Make them a territory", dearer than a puppet: 1.6 times the war score, up to 100). You take 30% of ALL its revenue (taxes, factories, trade, business tax) every month for ever, and nothing it does can lower that. It joins your faction (one is founded if you have none) and can never leave, fights in every war you fight, cannot make peace by itself, and never owes war reparations. It has no loyalty, never rebels and never breaks free. Its people, output and workforce are NOT yours: they do not count toward your population share or output share, and only half its countries count toward your tier. You command its army from Empire, Territories (it shows once you hold one): train, drill, post and set the alert of its troops, and tick "Send territory forces" in the War Room to send them with your own attack; it pays their cost and upkeep from its own treasury. You can force it into a trade deal (the other nation still has to agree, unless it is you; the deal must give it at least 70% of what it gives, at market prices). You may release it, or annex it after a year (its land, army and treasury become yours, half settled). If you fall it becomes independent. A Nation or Regional power can hold one, a Great power two, a Superpower three and a Hegemon four.'],
  ['Ruling a puppet', 'Empire, Puppets (it shows once you have one). Each puppet has a loyalty from 0 to 100. Heavy tax, a big draft, harsh laws (martial law, rationing, austerity) and a heavy tribute lower it every month; aid, your investment in its businesses, your troops on its border and fair taxes raise it, and it is always pulled back toward 60, so loyalty above that must be paid for again each month. A loyal puppet (75 and up) pays more tribute and counts for more toward your tier; a wavering one (under 35) loses stability; under 25 it rebels, will not follow you to war and the world may get a reason to free it; under 15 it can break free. You may change one puppet once a month, for influence: its tax (to 45%), draft, one law of six, its welfare spending, the form of its tribute (money, oil, steel or soldiers) and aid. The card shows the price, the loyalty it settles at and the tribute it will pay before you press the button. What you take from all your puppets together is held to a quarter of your own income; the rest is paid at half. A puppet run by another player in an online game keeps its own government. Its own bot no longer sets the taxes, draft or laws you control.'],
  ['Forces on station', 'In Military, Deployment, you post part of your fleet on coastal patrol or in a submarine screen, part of your fighters and drones on air patrol, and part of your ground troops on each border. What stands on station cannot attack (only the reserve can) and still costs its upkeep and oil. It still defends: a garrison fights 35% harder on its own border and at half strength on any other, and patrols fight 35% harder against a landing. Every rival keeps forces on station too, more of them and better placed on Hard. You see what they keep only with intelligence: otherwise it is a rounded guess. Moving forces takes a month.'],
  ['Theatres and presence', 'Military, Theatres shows where your forces stand: a card for each neighbor front or sea, with tension and what changed this month, your forces and (as far as intelligence shows) theirs, a map, a ledger of what your forces achieved, and one-click Defensive, Balanced and Forward postures with the advisor\'s pick. The globe shows patrol routes, submarine tracks, air circuits, the straits and who holds them, battle lines and supply lines; click a badge for its card (relocate, recall, upgrade). Patrols protect sea trade (never more than part of the fleet\'s own upkeep), hold straits, blockade an enemy at war, and learn what neighbors keep. Set an alert level (readiness moves 12 points a month), show force to a neighbor or hold an exercise (they cost money and oil, raise tension and train your forces). Tense neighbors\' patrols sometimes collide, and rivals read a guarded border before they attack.'],
  ['Patrols and garrisons', 'Patrols sink part of a landing from the sea or air before it comes ashore: coastal patrols against a crossing over a sea lane, the submarine screen against a fleet on the open ocean, air patrols against an airborne landing. Air patrols also shoot down part of a cruise missile salvo. In a live game your patrols sight a landing force the day it sets out. A garrison adds Defense Line to the countries on its border and makes a surprise attack harder in the first months of a war: a border nobody guards is a weak spot.'],
  ['Borders', 'Every pair of neighbors, by land or across the sea, has a border that is open, fortified, closed or disputed, with a tension from 0 to 100. War, troops massed on either side, incidents, a closed border and grievances raise it; pacts, alliances and trade lower it. The Borders map (key 7, the Map colors buttons on the globe when no desk is open, or Map colors in Ctrl+K) colors every border by its tension, draws the forces on station and marks the sea chokepoints. Troops massed on a border make incidents likelier, a garrison turns provocations back, and a border incident is a valid reason for war. Closing a border costs 3 influence: it halves the provocations and adds cover, but it adds tension and the neighbor will not like it.'],
  ['Reason for war', 'A war needs a reason: a border incident, an attack on your ally, a spy caught, sanctions, or a case you build in three months. Without one it costs far more, hurts stability and makes the world distrust you.'],
  ['Scenarios', 'On the main menu, Scenario starts you in a ready-made situation: a cold war, a tiny country among giants, a collapsing neighbor, a plague year and more. Each has a briefing, its own way to win (survive a number of months, grow to a Regional power, out-earn the world, or the usual goals) and a suggested nation and rival skill. The Briefing desk shows the goal and your progress.'],
  ['How rivals think', 'Each rival picks a posture every month: expand, opportunist, consolidate, defend, turtle or revenge. It chooses attacks from the same odds the War Room shows you, sends no more than it can spare, asks for peace when it is losing, weary or stuck, and wants its land back after a defeat. Easy rivals wait for a sure thing, Hard ones accept a fair fight. Nobody gets a hidden bonus.'],
  ['Reputation', 'Starting wars and taking land make other nations uneasy about you. It fades over a couple of years.'],
  ['Reach', 'You attack across a border or a short sea lane. A port plus warships reaches any coast in the world, and fighters or strike aircraft with a factory as a base reach anything within 7000 km (aerial refuelling and strategic bombers push that out). Ships or planes must be at least a twentieth of your military to carry it. Overseas attacks fight with a penalty.'],
  ['Agencies', 'An intelligence service works abroad (intelligence, cases for war, sabotage, rebels, coups, theft) and a security service works at home. Each level adds a team. Odds are shown first.'],
  ['Frontier weapons', 'Drone Swarms take the first losses and shred tanks. Robot Infantry need no soldiers and never tire your people. Missiles are described below. Each weapon has a counter: shields, fighters, and Cyber Command.'],
  ['Missiles', 'Five kinds, and every one of them kills people and cuts the Defense Line: they differ in how much, and in what else they do. Cruise missiles are cheap, best at wearing down the line and burning fuel and airfields, and a shield stops them easily. Tactical missiles kill a slice of the army and are the best weapon against launch sites and airbases; they spare civilians most. Hypersonic missiles (from technology and the training queue) are the fastest and hardest to stop, and crack the line. Ballistic missiles kill the most people, destroy buildings, draw two interceptor rounds each, and the world will not forgive them. Decoy rockets are nearly free and carry a token warhead: their job is to make a shield spend rounds. Cities make every kind deadlier, the dead cost the struck nation stability and earn you a war-crime reputation, and what is killed comes off the economy and counts toward the war score. Fire them from the Missiles section of the War Room (Fire 1, or a Custom number, aimed at the country or at its launch sites, with a forecast of the chance to get through). An attack on land never carries missiles by itself, and each one fired is used up. In a live game a salvo flies for its kind\'s days; in a turn game it lands when the month ends.'],
  ['The missile war', 'Missiles are a war of their own, in Military, Missile War. Defence: early-warning radar (shows a salvo the day it leaves, cues your interceptors), interceptor rounds (your shield holds 8 a level and a battery 4 more; every missile that arrives spends rounds, and a shield with none left stops nothing, so a big salvo or a wave of decoys saturates it; half the store comes back each month, and you can buy rounds), air-defence batteries in a country, mobile launchers, and fighters at home or on air patrol. Finished aircraft developments (radar network, integrated air shield) count as airborne early warning. In a live game you can scramble your fighters against one specific salvo in the air. Offence: counterforce (aim a strike at a launch site: it does a third of the harm to people and the line but destroys missiles in the enemy store and shuts the launchers for a few months; mobile launchers hide from it unless a recon flight found them), bomber raids with escorts (the forecast shows the chance the bombers come home; fighters and batteries shoot them down, stealth and escorts bring more back), and big salvos. A doctrine answers for you: Retaliate fires back once, never at an answer; Launch on warning (live, needs radar) fires while the salvo is still in the air, with a small monthly risk of a false alarm that grows with tension and shrinks with radar, and only ever at a nation you are already fighting. Every strike raises the world tension, a ladder of Calm, Skirmish, Missile war, Strategic exchange and Nuclear brink; high rungs make the world judge civilian deaths harder. A missile ceasefire (offer one to an AI rival in the same tab) stops missiles, raids and warheads between two nations for six months and cools the world: rivals accept when the tension is high or they are losing the exchange. Easy rivals ignore all of this; Normal ones defend, keep a retaliation doctrine and raid now and then; Hard ones run counterforce and decoys, and nobody opens new salvos at the brink. Nuclear weapons keep their own rules.'],
  ['Missile program', 'In Military, Missile Program, open from the first day. The charter (levels 1 to 3, money and research) opens cruise, then tactical, then ballistic missiles and sets how many the workshop builds a month (5, 10, 18). Around it you build the program. Structure: seven facilities with levels, months to build (days left in a live game) and upkeep: research institute (development speed and slots), design bureau (test success), engine test stand (needed for tests; a test a month per level), production plant (more a month, cheaper, and a production line that delivers day by day), silo field (stores more, safe from counterforce), interceptor works (more interceptor rounds) and warhead integration (more harm per hit). A facility can be one level above the charter, and your empire tier caps how big and how many at once. Talent: hire rocket engineers, propulsion scientists, guidance specialists, test crews, production managers and intelligence analysts from the people\'s engineers and scientists (the same pool the space agency uses), each with a salary, and one chief designer with a trait (engine wizard, precision fanatic, production genius, daredevil, meticulous, stealth visionary) whose skill grows with successful tests. Rivals poach staff now and then: analysts and a good budget keep people. Development: eighteen projects in five branches (propulsion, guidance, payload, production, defense), with prerequisites, months, money and research, done in-house or by a domestic or foreign contractor (dearer and faster, shakier tests; a foreign one shows your program to every rival). Most end with a test launch: press Test launch, a countdown runs, an arc flies out to sea on the globe, and a seeded roll decides; a success puts it in service, a failure teaches the engineers (the next try is likelier). Tests raise world tension a little and rivals nearby notice. What is in service changes real strikes and forecasts: range, harm per missile (a smaller CEP), evasion of interceptors, extra interception, interceptor rounds, radar, mobile launchers, hardened stores, cheaper missiles. A budget slider (Lean to Crash) trades money for speed. The program\'s monthly bill is its own line in the treasury, and an empty treasury stalls in-house work for a month.'],
  ['Aircraft development', 'On Military, Forces, press Develop to open the aircraft tree: sixteen developments in four branches. Interceptors (radar, long-range air-to-air missiles, missile-hunter fighters, an integrated air shield): fighters at home shoot down a share of incoming missiles and drones, so they counter missile strikes and drone swarms (three fighters at home cover everything; slow cruise missiles are easiest to catch, ballistic warheads hardest). Stealth and electronic war: bombers keep their strength when the enemy rules the air, shields and hunters stop less of your strikes, and enemy interceptors go blind. Range and payload: airbases reach farther than 7000 km, landings by air lose less, and bombers push a Defense Line back harder. Unmanned wingmen: stronger drones and fighters. Each development pays its research the day it starts and its money month by month, takes months of work, needs earlier developments, a technology and an empire tier, and uses one of your slots (one at first, two as a Great power). Pause one to free its slot. The attack and defense on the screen are exactly what battles use.'],
  ['Chance to win', 'The big number in the War Room is the real fight played out many times on evenly spread dice: the same battle code the game uses, so 60% means about six in ten. It comes with a range (how far the estimate could be off) and a list of what decides it: strength against defence, terrain, the Defense Line, stance, combined arms, supply, training and technology, garrison, air cover, missiles and how stretched the defender is. Open any line for how it works. Without AI Battle Command you see only a rough band that always holds the true chance but never pins it down, wider the less you can see of their army (spies and an Orbital Network help). Each unit also soaks up damage in proportion to what it costs (infantry 1, tanks 3), and each battle has a day of fortune: even a good plan can lose.'],
  ['AI Battle Command', 'Level 1: the exact chance to win with its range and breakdown, and a ranked list of your targets. Level 2: also the best stance and written advice (what to do first, which front is weak, when to wait, supply and weariness warnings, and what an attack leaves open at home). Level 3: Plan this attack for me fills the steppers with the best force for your goal (best chance to win, fewest losses, fastest capture, or keep home safe), shows it against your own plan, and a standing auto-command plans each month\'s attacks within limits you set (attacks a month, share kept home, least chance to win). Its attacks sit in the order tray in green: click one to cancel it before you press Next turn. Auto-command is for turn games.'],
  ['Systems', 'Cyber Command, Interceptor Shield, AI Battle Command, Quantum Codebreaking, Orbital Network and Nano-armor are programs you buy in three levels. They cost upkeep and each has a weakness.'],
  ['Stocks', 'Made-up companies in the countries you hold, at most two in a very developed one. Buy shares to take a stake: a board seat at 25% lets you tell a company what to do (pay dividends, expand its sector, or specialize for research, cheaper units, income and more), at full strength from 51%. If another nation takes the country, it takes your shares.'],
  ['Relations', 'The Relations desk (O) is where you win nations over and keep them. Every nation is in a searchable list with its opinion of you, an arrow for which way it is moving, and chips for allies, neighbors, trade and faction; filter by allies, neighbors, rivals, trade partners, your faction or the ones cooling, and keep a Watchlist. Open one to see why they feel as they do (shared enemies, trade, treaties, aid, visits, bad acts, borders, government, faction), what they need and want, a health meter with a warning when relations will cool, and everything you can do: state visits, cultural exchange, festivals, embassies and attachés (a monthly bill for slow, steady warmth), student exchange, joint research, trade missions, preferential tariffs, joint ventures, food, oil and steel aid, forgiving debts, sharing technology, ceding a border country, exercises, arms sales, training, intelligence sharing, basing rights, shared sanctions, joint war plans, apologies, recognition, mediation and favours. Every action shows its cost, its effect and its cooldown first; each partner has one cooldown per action, and the more you give a nation lately the less the next gift is worth, so no single action pins an opinion. Relations also need upkeep: a partner you have not been in touch with for a year starts to cool. A joint war plan is a short alliance against one enemy you both fight: hit the same country in the same month (a few days apart, live) for a combined strike, and the one who does not take it is paid a share of its value. Rivals ask you for help (Requests tab): answer before the deadline. Press Locate on any nation (or Shift+L in the desk) to close the desk and see it on the globe.'],
  ['Blocs', 'The Bloc desk (F) turns your friends into an alliance bloc. Found one (15 influence) and invite partners: the invitation list starts with your allies, pact and trade partners. A bloc has a level: prestige from objectives met, operations won and calls answered unlocks perks for every member: Combined Arms (level 1), Common Market (2: money each month), Shared Research (3), Mutual Defence (4: rival members join your wars at once) and Joint Production (5: steel, and harder operations). Each member can take one role: Arsenal (+2 steel a month), Shield (your countries defend 10% harder), Breadbasket (+3 food) or Spymaster (+1 research). The leader (the founder) picks the season objective and calls the bloc to arms. Your army is always your own: nothing is pooled, so leaving costs nothing but goodwill. Turn on the Blocs map (key 8) to see every bloc on the globe in its own color.'],
  ['Operations', 'A joint operation is the bloc fighting together. Any member plans one on the Operations tab: an enemy country a member at war with it can reach, and a D-Day (next month to three months away; 7 to 30 days in a live game). Each member pledges divisions from its own army with the steppers, and sees the odds of the force as pledged so far: a country is defended by its owner\'s whole army, so send enough. On D-Day the pledges march as one force over the border of the member that brings the most and can reach it, with +8% attack for every member beyond the first (Combined Arms). In a live game the force sets out so it arrives on D-Day: watch the countdown. Afterwards the joint battle report shows what each member sent and lost; a captured country goes to the member who sent the most, and the treasure is split by what each sent. Survivors go home to whoever sent them.'],
  ['Calls to arms and objectives', 'When a member goes to war the bloc is called in: a card on the Overview with Join and Decline, open until the end of the next month. Joining puts you at war beside them (no reason needed, no blame) and gives the bloc prestige. The leader can also call the bloc to arms against any enemy it is fighting. Each season (three months) the bloc chases one objective, picked by the leader from the ones on offer in the season\'s first month: take two countries, hold every country, defend a member, win an operation, grow the bloc, arm it (+25% strength) or outmatch the strongest rival bloc. Meeting it gives +40 prestige and +3 influence to every member. Rivals on Medium and Hard form blocs around allies and shared enemies, take roles, answer calls and plan operations; Easy rivals never do. Old saves: a faction\'s common pool is shared back to its members by what each put in, and it becomes a bloc.'],
  ['Live contracts', 'A trade deal can be a live contract: a start up to six months away, collateral that is held until it ends, and a promise to join the other side\'s wars. It runs by itself every month. A nation that breaks it loses the collateral, its reputation, and hands the other side a reason for war.'],
  ['Empire and governors', 'Every country you hold is listed together in Economy. A governor upgrades a country each month on a plan you pick.'],
]

/** Every key the game answers, built from the registry, so a new desk or tab lists its key here by itself. */
export function KeysSheet({ live }: { live: boolean }) {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  const rows = shortcutRows(regCtxOf(game, orders)).filter((r) => live || r.group !== 'Live games')
  const groups = [...new Set(rows.map((r) => r.group))]
  return (
    <div className="space-y-5">
      <p className="text-[14px] text-white/80">
        Keys work when you are not typing in a box. <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">K</kbd> or <kbd className="kbd">/</kbd> opens the jump window, which finds every desk, tab, setting, nation and country by name.
      </p>
      {groups.map((g) => (
        <section key={g} aria-label={g}>
          <h3 className="text-[15px] font-semibold mb-1.5">{g}</h3>
          <dl className="keys-grid">
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <div key={r.label + r.keys.join()} className="keys-row">
                  <dt className="flex flex-wrap items-center gap-1">
                    {r.keys.map((k, i) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-[12px] text-white/60">or</span>}
                        <kbd className="kbd">{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className="text-[14px] text-white/85">{r.label}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

export function Help() {
  const open = useGame((s) => s.helpOpen)
  const setHelp = useGame((s) => s.setHelp)
  const tab = useGame((s) => s.helpTab)
  const setTab = useGame((s) => s.setHelpTab)
  const game = useGame((s) => (s.helpOpen ? s.game : null))
  const online = useGame((s) => s.online?.status === 'playing')
  const liveRoom = useGame((s) => s.online?.lobby?.settings.mode === 'live')
  // ? flips between the guide and the list of keys while the window is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '?' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT') {
        e.preventDefault()
        const st = useGame.getState()
        st.setHelpTab(st.helpTab === 'keys' ? 'guide' : 'keys')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open || !game) return null
  const live = isLive(game)
  const steps = live ? LIVE_STEPS : TURN
  const total = Object.keys(game.regions).length
  return (
    <Modal
      title={tab === 'keys' ? 'Keyboard shortcuts' : 'How the game works'}
      kicker="Worlds of Others"
      onClose={() => setHelp(false)}
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={() => setHelp(false)}>
          Got it
        </button>
      }
    >
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          label="Help"
          options={
            [
              ['guide', 'How to play'],
              ['keys', 'Keyboard shortcuts'],
            ] as const
          }
        />
      </div>
      {tab === 'keys' ? (
        <KeysSheet live={live} />
      ) : (
        <>
      <p className="text-[15px] text-white/85">
        You run a country{live ? ' as the days pass' : ', one month at a time'}. <strong>To win</strong>, hold the whole world: all {total} countries yours or puppets of yours. It is a long game. A war needs a reason, so build a case, use your agencies and answer the crises in the news. You lose if your nation is wiped out.
      </p>
      <h3 className="text-[16px] font-semibold mt-5 mb-2">{live ? 'A live game' : 'A turn'}</h3>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex-none w-7 h-7 rounded-full bg-[#0a84ff] text-white text-[14px] font-semibold flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-[15px] font-semibold">{s.title}</div>
              <p className="text-[14px] text-white/80">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {online && liveRoom && (
        <p className="rounded-xl bg-white/5 px-3 py-2 mb-3 text-[14px] text-white/85">
          <strong>Live with friends.</strong> One shared clock runs for everyone. Orders reach the host as you give them, and a refused one says why. Pausing and speed follow the room&apos;s rule (host only, or more than half of the players agree). Battle windows, reports and decisions are yours alone and never stop the clock; a decision you leave is made for you at month end. If you leave, the AI plays your nation; if the host leaves, the next player takes over.
        </p>
      )}
      {online && !liveRoom && (
        <p className="mt-3 text-[14px] text-white/80 rounded-xl bg-[#0a84ff]/15 border border-[#0a84ff]/40 px-3 py-2.5">
          <strong>Playing with friends.</strong> Everyone plans the same month at once. Press <strong>Ready</strong> when you are done (press it again to keep planning). The month moves on when everyone is ready or the timer ends. Attacks are planned now and play out at month end, so nobody wins by clicking faster. A surprise decision comes to each player separately and never holds the month: if you do not choose, your ministers take the first option. There is no undo online, since your orders are already on their way. If everyone leaves, any player can reopen the room from <strong>Saved games</strong> under Play with friends, and the others take their seats back with the same code.
        </p>
      )}
      <h3 className="text-[16px] font-semibold mt-5 mb-2">Words you will see</h3>
      <dl className="space-y-2">
        {TERMS.map(([term, meaning]) => (
          <div key={term} className="grid grid-cols-[110px_1fr] gap-3 text-[14px]">
            <dt className="font-semibold">{term}</dt>
            <dd className="text-white/80">{meaning}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-[16px] font-semibold mt-5 mb-1">Keys</h3>
      <p className="text-[14px] text-white/75">{shortcutsFor(isLive(game))}</p>
        </>
      )}
    </Modal>
  )
}
